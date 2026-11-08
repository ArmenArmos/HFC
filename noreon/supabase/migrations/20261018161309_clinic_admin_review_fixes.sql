-- Fable review of PR #276 (output/clinic-admin-powers-2026-10-18/FABLE_REVIEW.md), fixes F1 to F6.
--
--  F1 A clinic date-of-birth edit that would change the age recorded in the member's questionnaire is
--     refused ('age-changes'): the member's own save re-seeds q1.age, prunes answers and re-derives the
--     urgent rule in app code, and a clinic edit must not leave the profile and questionnaire disagreeing
--     (booking and doctor publication refuse that). A change within the same age, or before any
--     questionnaire, is allowed. Name edits are unaffected.
--  F2 Only the admin who started a record upload can put files into its batch (a guard on the file row,
--     so the existing reserve-upload command cannot be used as a side door), and a file stored by anyone
--     else is never attached automatically or by hand.
--  F3 The "booked" half of a clinic's members is now a confirmed booking with this clinic (the
--     appointment is confirmed at this clinic and its notice was accepted), or a lab PDF of this clinic
--     currently linked to the member. A pending, declined, superseded or cancelled request no longer
--     opens the full record or the care team. The narrow member file keeps _clinic_member_known.
--  F4 When this clinic changed the member's name or date of birth in the last 24 hours, a sheet is also
--     compared with the values before that change; a difference then needs "Continue anyway" and is
--     recorded as an override with the pre-edit values.
--  F5 A reading still queued or running 15 minutes after the file was stored no longer blocks: the file
--     is treated as not read (attached for the doctor to read by hand).
--  F6 Home visit auto-close fires only for a nurse visit, never for a visit inferred or recorded for an
--     upload.

-- F3 -----------------------------------------------------------------------------------------------------
create function public._clinic_admin_booked(c uuid,mm uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.booking_appointments a
   where a.member_id=mm and a.status='confirmed'and a.current_arrangement->>'clinicId'=c::text
    and exists(select 1 from public.booking_scheduling_notices n where n.appointment_id=a.id and n.clinic_id=c and n.state='accepted'))
 or exists(select 1 from public.clinic_result_attachments x where x.clinic_id=c and x.user_id=mm and(public._clinic_result_current(x.file_id)).id=x.id
   and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=x.id))
$$;

create or replace function public._clinic_admin_patient(c uuid,mm uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select mm is not null
  and exists(select 1 from public.profiles where id=mm)
  and not exists(select 1 from public.workspace_staff where user_id=mm)
  and not exists(select 1 from public.clinic_portal_memberships where user_id=mm)
  and(public._clinic_member_assigned_here(c,mm)or public._clinic_admin_booked(c,mm))
$$;

create or replace function public._clinic_admin_patients(c uuid)returns table(member_id uuid)
language sql stable security definer set search_path=''as $$
 select x.member_id from(
  select k.user_id member_id from public.patient_clinical_cases k join public.workspace_staff s on s.user_id in(k.assigned_doctor_id,k.assigned_nurse_id)where s.clinic_id=c
  union select a.member_id from public.booking_appointments a where a.status='confirmed'and a.current_arrangement->>'clinicId'=c::text
   and exists(select 1 from public.booking_scheduling_notices n where n.appointment_id=a.id and n.clinic_id=c and n.state='accepted')
  union select x.user_id from public.clinic_result_attachments x where x.clinic_id=c and(public._clinic_result_current(x.file_id)).id=x.id
   and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=x.id))x
 where not exists(select 1 from public.workspace_staff where user_id=x.member_id)
  and not exists(select 1 from public.clinic_portal_memberships where user_id=x.member_id)
  and exists(select 1 from public.profiles where id=x.member_id)
$$;

-- F1 -----------------------------------------------------------------------------------------------------
-- Same as 20261018161307 plus the age check against the questionnaire.
create or replace function public.clinic_admin_patient_profile_update(p_clinic uuid,p_member uuid,p_submission uuid,p_expected jsonb,p_name text,p_birth_date date)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;p public.profiles;prior public.clinic_member_profile_changes;new_name text:=btrim(coalesce(p_name,''));
 today date:=(clock_timestamp()at time zone 'Asia/Yerevan')::date;yrs int;v_before jsonb;v_after jsonb;change uuid;a public.patient_assessments;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_submission is null or p_member is null then return jsonb_build_object('status','invalid');end if;
 select * into prior from public.clinic_member_profile_changes where actor_id=m.user_id and submission_id=p_submission;
 if found then
  return case when prior.member_id=p_member and prior.clinic_id=p_clinic and prior.after=jsonb_build_object('name',new_name,'birthDate',p_birth_date)
   then jsonb_build_object('status','committed','changeId',prior.id)else jsonb_build_object('status','conflict')end;
 end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-profile-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id));
  return jsonb_build_object('status','refused');
 end if;
 yrs:=case when p_birth_date is null then null else extract(year from age(today,p_birth_date))::int end;
 if length(new_name)not between 1 and 100 or new_name~'[[:cntrl:]]'or yrs is null or yrs not between 18 and 110 then return jsonb_build_object('status','invalid');end if;
 select * into p from public.profiles where id=p_member for update;
 if jsonb_typeof(p_expected)is distinct from 'object'
  or p_expected->>'name'is distinct from coalesce(nullif(btrim(p.display_name),''),'')
  or p_expected->>'birthDate'is distinct from p.birth_date::text then return jsonb_build_object('status','stale');end if;
 -- The questionnaire records the age on its assessment date; a new date of birth must not change it (F1).
 if p_birth_date is distinct from p.birth_date then
  select * into a from public.patient_assessments where user_id=p_member for share;
  if found and p.birth_date is not null and extract(year from age(a.assessment_date,p_birth_date))<>extract(year from age(a.assessment_date,p.birth_date))then
   perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-profile-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id,'reason','age-changes'));
   return jsonb_build_object('status','age-changes');
  end if;
 end if;
 v_before:=jsonb_build_object('name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',p.birth_date);
 v_after:=jsonb_build_object('name',new_name,'birthDate',p_birth_date);
 if v_before=v_after then return jsonb_build_object('status','unchanged');end if;
 update public.profiles set display_name=new_name,birth_date=p_birth_date,updated_at=now()where id=p_member;
 insert into public.clinic_member_profile_changes(clinic_id,actor_id,membership_id,member_id,submission_id,before,after)
  values(p_clinic,m.user_id,m.id,p_member,p_submission,v_before,v_after)returning id into change;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'admin-profile-updated',jsonb_build_object('memberId',p_member,'changeId',change,'membershipId',m.id,
  'fields',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb)from jsonb_each(v_after)where v_before->key is distinct from value)));
 return jsonb_build_object('status','committed','changeId',change);
end$$;

-- F2 -----------------------------------------------------------------------------------------------------
create function public._clinic_member_upload_file_guard()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if exists(select 1 from public.clinic_member_uploads u where u.batch_id=new.batch_id and(u.actor_id<>new.actor_id or u.membership_id<>new.membership_id))then
  raise insufficient_privilege using message='Only the admin who started this upload can add files';
 end if;
 return new;
end$$;
create trigger clinic_member_upload_file_guard before insert or update of batch_id,actor_id,membership_id on public.clinic_batch_files
 for each row execute function public._clinic_member_upload_file_guard();

-- F5 (timeout) in the comparison; F4 in a wrapper that knows the clinic ---------------------------------------
-- Same as 20261018161308 except: a reading still pending 15 minutes after the file was stored counts as not read.
create or replace function public._clinic_member_file_compare(p_file uuid,p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare j public.lab_ai_jobs;p public.profiles;sheet_name text;sheet_dob text;name_diff boolean:=false;dob_diff boolean:=false;mname text;stored timestamptz;
begin
 select * into j from public.lab_ai_jobs where kind='file'and file_id=p_file;
 select * into p from public.profiles where id=p_member;
 select created_at into stored from public.clinic_batch_files where id=p_file;
 mname:=coalesce(nullif(btrim(p.display_name),''),'');
 if public._lab_ai_enabled()and(j.id is null or j.state in('queued','running'))and stored>clock_timestamp()-interval '15 minutes'then
  return jsonb_build_object('status','reading','read',false);
 end if;
 if j.state='done'and j.identity_status='multiple_patients'then return jsonb_build_object('status','blocked','read',true);end if;
 if j.id is null or j.state<>'done'then
  return jsonb_build_object('status','compared','read',false,'differs',false,'mismatch',null,'sheet',null,'member',jsonb_build_object('name',mname,'birthDate',p.birth_date));
 end if;
 sheet_name:=nullif(btrim(j.identity->>'nameOnSheet'),'');sheet_dob:=nullif(btrim(j.identity->>'birthDateOnSheet'),'');
 if j.identity->>'memberId'=p_member::text and j.identity ? 'nameMatch'then
  name_diff:=sheet_name is not null and j.identity->>'nameMatch'<>'yes';
 else
  name_diff:=sheet_name is not null and public._name_tokens(sheet_name)<>public._name_tokens(mname);
 end if;
 dob_diff:=sheet_dob is not null and p.birth_date is not null and sheet_dob<>p.birth_date::text;
 return jsonb_build_object('status','compared','read',true,'differs',name_diff or dob_diff,
  'mismatch',case when name_diff and dob_diff then 'both'when name_diff then 'name'when dob_diff then 'birth_date'end,
  'sheet',jsonb_build_object('name',sheet_name,'birthDate',sheet_dob,'sampleDate',j.identity->>'sampleDate'),
  'member',jsonb_build_object('name',mname,'birthDate',p.birth_date));
end$$;

-- The comparison an attach uses: when this clinic changed the member's name or date of birth in the last 24
-- hours, a sheet that matches only the edited values still counts as differing from the values before (F4).
create function public._clinic_member_file_check(p_clinic uuid,p_file uuid,p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare cmp jsonb:=public._clinic_member_file_compare(p_file,p_member);h public.clinic_member_profile_changes;name_diff boolean;dob_diff boolean;
begin
 if cmp->>'status'<>'compared'or(cmp->>'differs')::boolean or not(cmp->>'read')::boolean then return cmp;end if;
 select * into h from public.clinic_member_profile_changes where member_id=p_member and clinic_id=p_clinic and created_at>clock_timestamp()-interval '24 hours'order by created_at limit 1;
 if not found then return cmp;end if;
 name_diff:=cmp#>>'{sheet,name}'is not null and public._name_tokens(cmp#>>'{sheet,name}')<>public._name_tokens(h.before->>'name');
 dob_diff:=cmp#>>'{sheet,birthDate}'is not null and h.before->>'birthDate'is not null and cmp#>>'{sheet,birthDate}'<>h.before->>'birthDate';
 if not(name_diff or dob_diff)then return cmp;end if;
 return cmp||jsonb_build_object('differs',true,'mismatch',case when name_diff and dob_diff then 'both'when name_diff then 'name'else 'birth_date'end,
  'member',jsonb_build_object('name',h.before->>'name','birthDate',h.before->>'birthDate','editedAt',h.created_at,'current',cmp->'member'));
end$$;

-- Same as 20261018161308 with F2 (the file must be the upload admin's) and F4 (the guarded comparison).
create or replace function public._clinic_member_upload_try(p_file uuid)returns text
language plpgsql security definer set search_path=''as $$
declare uf public.clinic_member_upload_files;u public.clinic_member_uploads;m public.clinic_portal_memberships;f public.clinic_batch_files;cmp jsonb;res jsonb;st text;
begin
 select * into uf from public.clinic_member_upload_files where file_id=p_file for update;
 if not found then
  select u2.* into u from public.clinic_member_uploads u2 join public.clinic_batch_files f2 on f2.batch_id=u2.batch_id where f2.id=p_file and f2.state='stored';
  if not found then return null;end if;
  insert into public.clinic_member_upload_files(file_id,batch_id,state)values(p_file,u.batch_id,'reading')on conflict(file_id)do nothing;
  select * into uf from public.clinic_member_upload_files where file_id=p_file for update;
 end if;
 if uf.state='attached'then return 'attached';end if;
 select * into u from public.clinic_member_uploads where batch_id=uf.batch_id;
 select * into f from public.clinic_batch_files where id=p_file;
 if exists(select 1 from public.clinic_result_attachments where file_id=p_file)then st:='attached';
 else
  select * into m from public.clinic_portal_memberships where id=u.membership_id;
  if f.actor_id<>u.actor_id or f.membership_id<>u.membership_id
   or not(m.active and m.role='admin'and m.user_id=u.actor_id)or not public._clinic_admin_full_access_enabled()or not public._clinic_result_enabled()
   or not exists(select 1 from public.workspace_clinics where id=u.clinic_id and active)or not public._clinic_admin_patient(u.clinic_id,u.member_id)then st:='paused';
  else
   cmp:=public._clinic_member_file_check(u.clinic_id,p_file,u.member_id);
   if cmp->>'status'='reading'then st:='reading';
   elsif cmp->>'status'='blocked'then st:='blocked';
   elsif(cmp->>'differs')::boolean then st:='check';
   else
    begin
     res:=public._clinic_member_attach(u.clinic_id,u.member_id,p_file,u.actor_id,m.display_name,m.id,gen_random_uuid(),null);
     st:=case res->>'status'when 'saved'then 'attached'when 'book-first'then 'book-first'when 'choose-visit'then 'choose-visit'else 'error'end;
    exception when others then st:='error';
    end;
   end if;
  end if;
 end if;
 update public.clinic_member_upload_files set state=st,updated_at=clock_timestamp()where file_id=p_file;
 return st;
exception when others then return 'error';
end$$;

-- Same as 20261018161308 with F2 and F4.
create or replace function public.clinic_admin_member_file_attach(p_clinic uuid,p_member uuid,p_file uuid,p_submission uuid,p_confirm boolean default false,p_reason text default null,p_appointment uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;f public.clinic_batch_files;u public.clinic_member_uploads;cmp jsonb;res jsonb;reason text:=nullif(btrim(coalesce(p_reason,'')),'');
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_submission is null or p_file is null or length(reason)>300 then return jsonb_build_object('status','invalid');end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-refused',jsonb_build_object('memberId',p_member,'fileId',p_file,'membershipId',m.id));
  return jsonb_build_object('status','refused');
 end if;
 if exists(select 1 from public.clinic_result_attachments where submission_id=p_submission and file_id=p_file and user_id=p_member and actor_id=m.user_id)then
  return jsonb_build_object('status','saved','replayed',true);
 end if;
 select f2.* into f from public.clinic_batch_files f2 join public.clinic_batches b on b.id=f2.batch_id where f2.id=p_file and b.clinic_id=p_clinic and f2.state='stored';
 if not found then return jsonb_build_object('status','invalid');end if;
 select * into u from public.clinic_member_uploads where batch_id=f.batch_id;
 if u.batch_id is not null and(u.member_id<>p_member or f.actor_id<>u.actor_id or f.membership_id<>u.membership_id)then return jsonb_build_object('status','invalid');end if;
 if exists(select 1 from public.clinic_result_attachments where file_id=p_file)then return jsonb_build_object('status','stale');end if;
 cmp:=public._clinic_member_file_check(p_clinic,p_file,p_member);
 if cmp->>'status'='reading'then return jsonb_build_object('status','reading');end if;
 if cmp->>'status'='blocked'then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-blocked',jsonb_build_object('memberId',p_member,'fileId',p_file,'membershipId',m.id));
  return jsonb_build_object('status','blocked');
 end if;
 if(cmp->>'differs')::boolean and p_confirm is not true then return jsonb_build_object('status','mismatch','compare',cmp);end if;
 res:=public._clinic_member_attach(p_clinic,p_member,p_file,m.user_id,m.display_name,m.id,p_submission,p_appointment);
 if res->>'status'<>'saved'then return res-'attachmentId';end if;
 if(cmp->>'differs')::boolean then
  insert into public.clinic_upload_overrides(clinic_id,actor_id,membership_id,member_id,file_id,attachment_id,submission_id,sheet,member_values,mismatch,reason)
   values(p_clinic,m.user_id,m.id,p_member,p_file,(res->>'attachmentId')::uuid,p_submission,cmp->'sheet',cmp->'member',cmp->>'mismatch',reason);
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-override',jsonb_build_object('memberId',p_member,'fileId',p_file,'mismatch',cmp->>'mismatch',
   'reasonGiven',reason is not null,'afterProfileEdit',cmp#>'{member,editedAt}'is not null,'membershipId',m.id));
 end if;
 if u.batch_id is not null then
  insert into public.clinic_member_upload_files(file_id,batch_id,state)values(p_file,u.batch_id,'attached')on conflict(file_id)do update set state='attached',updated_at=clock_timestamp();
 end if;
 return jsonb_build_object('status','saved','replayed',false,'override',(cmp->>'differs')::boolean);
exception when insufficient_privilege then raise;
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

-- The record's file list shows the same guarded comparison (F4).
create or replace function public._clinic_member_file_json(c uuid,mm uuid,f public.clinic_batch_files,p_state text,p_upload boolean)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('fileId',f.id,'name',f.name,'uploadedAt',f.created_at,'fromRecord',p_upload,'state',p_state,
  'attached',cur.id is not null and cur.user_id=mm and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=cur.id),
  'override',exists(select 1 from public.clinic_upload_overrides o where o.file_id=f.id and o.member_id=mm),
  'fileReading',(select j.state from public.lab_ai_jobs j where j.kind='file'and j.file_id=f.id),
  'memberReading',(select j.state from public.lab_ai_jobs j where j.kind='attachment'and j.attachment_id=cur.id),
  'readingOn',public._lab_ai_enabled(),
  'compare',case when cur.id is null then public._clinic_member_file_check(c,f.id,mm)end)
 from(select(public._clinic_result_current(f.id)).*)cur
$$;

-- F6 ------------------------------------------------------------------------------------------------------
-- Same as 20261017123453 except that only a nurse visit closes a home visit request.
create or replace function public._home_visit_close_on_visit()returns trigger
language plpgsql security definer set search_path=''as $$declare r public.patient_test_requests;begin
 if new.source is distinct from 'nurse-visit'then return null;end if;
 if(select auto_close from public.home_visit_settings where singleton)is not true then return null;end if;
 for r in select * from public.patient_test_requests where user_id=new.user_id and status='confirmed'and current_arrangement#>>'{terms,mode}'='home'
  and((current_arrangement#>>'{terms,startsAt}')::timestamptz at time zone 'Asia/Yerevan')::date<=(new.created_at at time zone 'Asia/Yerevan')::date
  order by created_at for update loop
  update public.patient_test_requests set revision=revision+1,status='completed',updated_at=now()where id=r.id;
  insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result)
   values(r.id,gen_random_uuid(),new.actor_id,r.revision+1,'completed-by-visit',jsonb_build_object('visitId',new.id),jsonb_build_object('status','completed'));
 end loop;
 return null;
end$$;

revoke all on function public._clinic_admin_booked(uuid,uuid),public._clinic_member_upload_file_guard(),public._clinic_member_file_check(uuid,uuid,uuid)
 from public,anon,authenticated,service_role;
