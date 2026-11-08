-- Upload results from the member's record (Khikar via the lead, 18 Oct 2026 14:00, 14:01, 14:03, 14:07).
-- Design: output/clinic-admin-powers-2026-10-18/DESIGN.md. Behind the same switch as 20261018161307
-- (clinic_portal_capabilities.clinic_admin_full_access) plus the existing storage, result attach and
-- lab AI switches.
--
--  * A clinic admin uploads one or more PDFs on a member's record. Under the hood: an implicit batch
--    (existing create-batch and reserve-upload commands and storage path), registered here as an
--    upload for that member.
--  * The reading of each file compares the sheet with the chosen member (the worker asks
--    lab_ai_file_target). When the reading finishes, or at once when reading is off, the file is
--    attached automatically unless: several people are on the sheet (blocked), or the name or date of
--    birth differ (waits for "Continue anyway", which is recorded in clinic_upload_overrides).
--  * Booking rule: the clinic's own members (assigned doctor or nurse here) need no booking; the file
--    goes on a 'clinic-upload' visit. Members reached only by booking keep the existing rule (a
--    confirmed booking here in the last 120 days, the same booking pick, inferred visit and
--    completion); without one the page says "Book a visit first".
--  * Old clinic files stuck in "Needs Noreon review" are listed on the matching member's record, where
--    an admin attaches them with the same comparison and confirmation.
--  * Noreon admins see every override (admin_lab_upload_overrides); the member page in the backoffice
--    shows "Attached despite a mismatch" (staff_member_upload_overrides). Every read is audited.
--  * clinic_portal_identity tells the clinic shell when full access is on, so batch pages leave the
--    navigation. Nothing is deleted.

-- 1. Visits for an upload without a booking --------------------------------------------------------------
alter table public.patient_care_visits drop constraint patient_care_visits_source_check;
alter table public.patient_care_visits add constraint patient_care_visits_source_check check(source in('nurse-visit','inferred-from-result-upload','clinic-upload'));
alter table public.patient_care_visits drop constraint patient_care_visits_actor_role_check;
alter table public.patient_care_visits add constraint patient_care_visits_actor_role_check check(
 (source='nurse-visit'and actor_role='nurse')
 or(source='inferred-from-result-upload'and actor_role='clinic'and booking_context is not null)
 or(source='clinic-upload'and actor_role='clinic'and booking_context is null));

-- 2. Tables -----------------------------------------------------------------------------------------------
create table public.clinic_member_uploads(
 batch_id uuid primary key references public.clinic_batches(id),
 clinic_id uuid not null references public.workspace_clinics(id),
 member_id uuid not null references auth.users(id),
 actor_id uuid not null references auth.users(id),
 membership_id uuid not null references public.clinic_portal_memberships(id),
 visit_id uuid references public.patient_care_visits(id),
 created_at timestamptz not null default clock_timestamp()
);
create index clinic_member_uploads_member on public.clinic_member_uploads(member_id,created_at desc);
-- The latest automatic outcome per file. 'attached' is final; the others are retried on the next read.
create table public.clinic_member_upload_files(
 file_id uuid primary key references public.clinic_batch_files(id),
 batch_id uuid not null references public.clinic_member_uploads(batch_id),
 state text not null check(state in('reading','check','blocked','book-first','choose-visit','attached','paused','error')),
 updated_at timestamptz not null default clock_timestamp()
);
create table public.clinic_upload_overrides(
 id uuid primary key default gen_random_uuid(),
 clinic_id uuid not null references public.workspace_clinics(id),
 actor_id uuid not null references auth.users(id),
 membership_id uuid not null references public.clinic_portal_memberships(id),
 member_id uuid not null references auth.users(id),
 file_id uuid not null references public.clinic_batch_files(id),
 attachment_id uuid not null references public.clinic_result_attachments(id),
 submission_id uuid not null,
 sheet jsonb not null,
 member_values jsonb not null,
 mismatch text not null check(mismatch in('name','birth_date','both')),
 reason text check(length(reason)between 1 and 300),
 created_at timestamptz not null default clock_timestamp(),
 unique(actor_id,submission_id),
 unique(attachment_id)
);
create index clinic_upload_overrides_at on public.clinic_upload_overrides(created_at desc,id desc);
create index clinic_upload_overrides_member on public.clinic_upload_overrides(member_id,created_at desc);
do $$declare n text;begin
 foreach n in array array['clinic_member_uploads','clinic_member_upload_files','clinic_upload_overrides']loop
  execute format('alter table public.%I enable row level security',n);execute format('revoke all on public.%I from public,anon,authenticated,service_role',n);
 end loop;
end$$;
create trigger clinic_upload_overrides_immutable before update or delete on public.clinic_upload_overrides for each row execute function public._audit_immutable();

-- 3. Attach accepts a clinic-upload visit of the upload's clinic -------------------------------------------
-- Same as 20261017073238 except the visit check: a booked visit with the upload's clinic, or a
-- 'clinic-upload' visit recorded by that clinic.
create or replace function public._clinic_result_attach(p_kind text,p_actor uuid,p_sub uuid,p_file uuid,p_member uuid,p_visit uuid,p_clinic_only uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare f public.clinic_batch_files;clinic uuid;v public.patient_care_visits;cur public.clinic_result_attachments;prior public.clinic_result_attachments;
 att public.clinic_result_attachments;applied jsonb;undone jsonb:=null;r bigint;corrected boolean:=false;changed boolean;
begin
 if not public._clinic_result_enabled()then return jsonb_build_object('status','disabled');end if;
 perform pg_advisory_xact_lock(hashtextextended('clinic-result-attach:'||p_file::text,0));
 select * into prior from public.clinic_result_attachments where submission_id=p_sub;
 if found and(prior.file_id<>p_file or prior.user_id<>p_member or prior.visit_id<>p_visit or prior.actor_id<>p_actor)then return jsonb_build_object('status','stale');end if;
 select f2.* into f from public.clinic_batch_files f2 where f2.id=p_file and f2.state='stored'for share nowait;if not found then return jsonb_build_object('status','invalid');end if;
 select b.clinic_id into clinic from public.clinic_batches b where b.id=f.batch_id;
 if p_clinic_only is not null and clinic is distinct from p_clinic_only then return jsonb_build_object('status','invalid');end if;
 -- The visit must have been booked with the upload's clinic (review CF-1), or recorded by it for an upload.
 select v2.* into v from public.patient_care_visits v2
  where v2.id=p_visit and v2.user_id=p_member and(
   (v2.booking_context is not null and exists(select 1 from public.booking_appointment_versions bv join public.booking_scheduling_notices n on n.id=bv.notice_id
     where bv.appointment_id=v2.appointment_id and bv.revision=v2.accepted_revision and n.clinic_id=clinic))
   or(v2.source='clinic-upload'and v2.clinic_id=clinic and v2.booking_context is null));
 if not found or f.created_at<v.created_at then return jsonb_build_object('status','invalid');end if;
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 cur:=public._clinic_result_current(p_file);
 if cur.id is not null and cur.user_id=p_member and cur.visit_id=p_visit then att:=cur;
 else
  -- A clinic admin attaches only an unattached upload; moves are a Noreon admin correction.
  if p_kind='clinic-admin'and exists(select 1 from public.clinic_result_attachments where file_id=p_file)then return jsonb_build_object('status','stale');end if;
  if cur.id is not null then
   corrected:=true;
   perform 1 from public.patient_clinical_cases where user_id=cur.user_id for update nowait;
   undone:=public._clinic_result_retract(cur,p_actor,gen_random_uuid(),'Moved to another visit');
  end if;
  insert into public.clinic_result_attachments(file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id,previous_id)
   values(p_file,clinic,p_member,p_visit,p_kind,p_actor,p_sub,cur.id)returning * into att;
  insert into public.clinic_portal_audit(clinic_id,batch_id,actor_id,kind,detail)values(clinic,f.batch_id,p_actor,case when corrected then 'result-reattached'else 'result-attached'end,
   jsonb_build_object('attachmentId',att.id,'actorKind',p_kind,'fileId',p_file,'memberId',p_member,'visitId',p_visit,'previousAttachmentId',cur.id,'previousMemberId',cur.user_id,'previousVisitId',cur.visit_id,'undone',undone));
 end if;
 applied:=public._clinic_result_apply(att,f);
 changed:=(applied->>'moved')::int>0;
 if changed then
  update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=p_member returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(p_member,r,'care-evidence',p_actor,jsonb_build_object('actor','system','attachmentId',att.id,'fileId',p_file,'labStageIds',applied->'ids','requestedBy',p_actor,'requestedByKind',p_kind));
 end if;
 if undone is not null and jsonb_array_length(undone->'ids')>0 then
  update public.patient_clinical_cases set revision=revision+1,updated_at=clock_timestamp()where user_id=cur.user_id returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(cur.user_id,r,'care-evidence',p_actor,jsonb_build_object('actor','system','detachedAttachmentId',cur.id,'labStageIds',undone->'ids','requestedBy',p_actor));
 end if;
 return jsonb_build_object('status','saved','attachmentId',att.id,'corrected',corrected,'moved',(applied->>'moved')::int,'waitingForLab',(applied->>'waiting')::int,
  'atLabAfterUpload',(applied->>'later')::int,'alreadyReceived',(applied->>'received')::int,'retracted',coalesce((undone->>'retracted')::int,0));
end$$;

-- 4. Helpers ----------------------------------------------------------------------------------------------
create function public._clinic_member_assigned_here(c uuid,mm uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select exists(select 1 from public.patient_clinical_cases k join public.workspace_staff s on s.user_id in(k.assigned_doctor_id,k.assigned_nurse_id)where k.user_id=mm and s.clinic_id=c)
$$;

-- Lower-case letter tokens, sorted and distinct: the same name in another order or case compares equal.
create function public._name_tokens(p text)returns text[]
language sql immutable set search_path=''as $$
 select coalesce(array_agg(distinct t order by t),'{}')from regexp_split_to_table(lower(coalesce(p,'')),'[^[:alpha:]]+')t where length(t)>=2
$$;

-- What the sheet says compared with the member. status: reading | blocked | compared.
-- A reading made for this member (identity.memberId) carries the worker's transliterating name check;
-- otherwise names compare by tokens. Nothing on the sheet to compare is not a difference.
create function public._clinic_member_file_compare(p_file uuid,p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare j public.lab_ai_jobs;p public.profiles;sheet_name text;sheet_dob text;name_diff boolean:=false;dob_diff boolean:=false;mname text;
begin
 select * into j from public.lab_ai_jobs where kind='file'and file_id=p_file;
 select * into p from public.profiles where id=p_member;
 mname:=coalesce(nullif(btrim(p.display_name),''),'');
 if public._lab_ai_enabled()and(j.id is null or j.state in('queued','running'))then
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

-- Attach one stored clinic file to the member under the booking rule. Returns the attach result, or
-- {status:'book-first'} / {status:'choose-visit',options} / {status:'invalid'}.
create function public._clinic_member_attach(p_clinic uuid,p_member uuid,p_file uuid,p_actor uuid,p_actor_name text,p_membership uuid,p_sub uuid,p_appointment uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare f public.clinic_batch_files;u public.clinic_member_uploads;j public.lab_ai_jobs;pick jsonb;aid uuid:=p_appointment;vid uuid;res jsonb;a public.booking_appointments;sample date;completed boolean:=false;
begin
 select f2.* into f from public.clinic_batch_files f2 join public.clinic_batches b on b.id=f2.batch_id where f2.id=p_file and b.clinic_id=p_clinic and f2.state='stored';
 if not found then return jsonb_build_object('status','invalid');end if;
 select * into u from public.clinic_member_uploads where batch_id=f.batch_id;
 if u.batch_id is not null and u.member_id<>p_member then return jsonb_build_object('status','invalid');end if;
 -- Serialise on the member before any visit is created, so files of one upload share one visit.
 perform 1 from public.patient_clinical_cases where user_id=p_member for update nowait;
 if not found then return jsonb_build_object('status','invalid');end if;
 if public._clinic_member_assigned_here(p_clinic,p_member)then
  -- The clinic's own member: no booking needed. One clinic-upload visit per upload action.
  if u.batch_id is not null and u.visit_id is not null then vid:=u.visit_id;
  else
   vid:=gen_random_uuid();
   insert into public.patient_care_visits(id,user_id,created_at,actor_id,actor_name,actor_role,clinic_id,source)
    values(vid,p_member,least(coalesce(u.created_at,f.created_at),f.created_at),p_actor,left(p_actor_name,180),'clinic',p_clinic,'clinic-upload');
   if u.batch_id is not null then update public.clinic_member_uploads set visit_id=vid where batch_id=u.batch_id;end if;
  end if;
  res:=public._clinic_result_attach('clinic-admin',p_actor,p_sub,p_file,p_member,vid,p_clinic);
  if res->>'status'='saved'then
   perform public._clinic_schedule_audit(p_clinic,p_actor,'member-file-attached',jsonb_build_object('fileId',p_file,'memberId',p_member,'visitId',vid,'path','assigned','membershipId',p_membership));
  end if;
  return res;
 end if;
 -- Reached by booking only: the existing rule (a confirmed booking here in the last 120 days).
 if not exists(select 1 from public._lab_clinic_bookings(p_clinic)b where b.member_id=p_member)then return jsonb_build_object('status','book-first');end if;
 if aid is not null then
  if not exists(select 1 from public._lab_clinic_bookings(p_clinic)b where b.member_id=p_member and b.appointment_id=aid)then return jsonb_build_object('status','invalid');end if;
 else
  select * into j from public.lab_ai_jobs where kind='file'and file_id=p_file;
  begin sample:=(j.identity->>'sampleDate')::date;exception when others then sample:=null;end;
  pick:=public._lab_clinic_pick_booking(p_clinic,p_member,sample);
  if pick->>'status'='choose'then return jsonb_build_object('status','choose-visit','options',pick->'options');end if;
  if pick->>'status'<>'one'then return jsonb_build_object('status','book-first');end if;
  aid:=(pick->>'appointmentId')::uuid;
 end if;
 vid:=public._lab_clinic_visit_for(p_clinic,p_member,aid,p_actor,p_actor_name,f);
 if vid is null then return jsonb_build_object('status','invalid');end if;
 res:=public._clinic_result_attach('clinic-admin',p_actor,p_sub,p_file,p_member,vid,p_clinic);
 if res->>'status'<>'saved'then return res;end if;
 select * into a from public.booking_appointments where id=aid;
 if not exists(select 1 from public.clinic_booking_checkins where reservation_id=a.current_reservation_id and outcome='completed')then
  insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id,source)values(p_clinic,a.id,a.current_reservation_id,'completed',p_actor,p_membership,'inferred-from-result-upload');
  completed:=true;
 end if;
 perform public._clinic_schedule_audit(p_clinic,p_actor,'member-file-attached',jsonb_build_object('fileId',p_file,'memberId',p_member,'visitId',vid,'path','booking','appointmentId',aid,'completed',completed,'membershipId',p_membership));
 return res;
end$$;

-- The automatic step for a member-upload file, after it is stored or read. Acts as the uploader, and
-- only while that admin's membership, the switches and the member's scope still hold. Never raises.
create function public._clinic_member_upload_try(p_file uuid)returns text
language plpgsql security definer set search_path=''as $$
declare uf public.clinic_member_upload_files;u public.clinic_member_uploads;m public.clinic_portal_memberships;cmp jsonb;res jsonb;st text;
begin
 select * into uf from public.clinic_member_upload_files where file_id=p_file for update;
 if not found then
  select u2.* into u from public.clinic_member_uploads u2 join public.clinic_batch_files f on f.batch_id=u2.batch_id where f.id=p_file and f.state='stored';
  if not found then return null;end if;
  insert into public.clinic_member_upload_files(file_id,batch_id,state)values(p_file,u.batch_id,'reading')on conflict(file_id)do nothing;
  select * into uf from public.clinic_member_upload_files where file_id=p_file for update;
 end if;
 if uf.state='attached'then return 'attached';end if;
 select * into u from public.clinic_member_uploads where batch_id=uf.batch_id;
 if exists(select 1 from public.clinic_result_attachments where file_id=p_file)then st:='attached';
 else
  select * into m from public.clinic_portal_memberships where id=u.membership_id;
  if not(m.active and m.role='admin'and m.user_id=u.actor_id)or not public._clinic_admin_full_access_enabled()or not public._clinic_result_enabled()
   or not exists(select 1 from public.workspace_clinics where id=u.clinic_id and active)or not public._clinic_admin_patient(u.clinic_id,u.member_id)then st:='paused';
  else
   cmp:=public._clinic_member_file_compare(p_file,u.member_id);
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

create function public._clinic_member_upload_file_stored()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.state='stored'and(tg_op='INSERT'or old.state is distinct from 'stored')and exists(select 1 from public.clinic_member_uploads where batch_id=new.batch_id)then
  perform public._clinic_member_upload_try(new.id);
 end if;
 return null;
end$$;
create trigger clinic_member_upload_file_stored after insert or update of state on public.clinic_batch_files
 for each row execute function public._clinic_member_upload_file_stored();
create function public._clinic_member_upload_read()returns trigger language plpgsql security definer set search_path=''as $$
begin
 if new.kind='file'and new.state in('done','rejected','failed')and old.state is distinct from new.state
  and exists(select 1 from public.clinic_member_uploads u join public.clinic_batch_files f on f.batch_id=u.batch_id where f.id=new.file_id)then
  perform public._clinic_member_upload_try(new.file_id);
 end if;
 return null;
end$$;
create trigger clinic_member_upload_read after update of state on public.lab_ai_jobs
 for each row execute function public._clinic_member_upload_read();

-- 5. The worker asks which member a file was uploaded for, so the reading compares with that member ----------
create function public.lab_ai_file_target(p_job uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare r record;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select u.member_id,coalesce(p.display_name,'')name,p.birth_date into r from public.lab_ai_jobs j join public.clinic_batch_files f on f.id=j.file_id
  join public.clinic_member_uploads u on u.batch_id=f.batch_id join public.profiles p on p.id=u.member_id where j.id=p_job and j.kind='file';
 if r.member_id is null then return jsonb_build_object('target',null);end if;
 return jsonb_build_object('target',jsonb_build_object('memberId',r.member_id,'name',r.name,'birthDate',r.birth_date));
end$$;

-- 6. Clinic admin RPCs ------------------------------------------------------------------------------------
-- Register a batch the caller just created (existing create-batch command, empty) as an upload for this member.
create function public.clinic_admin_member_upload_register(p_clinic uuid,p_member uuid,p_batch uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;b public.clinic_batches;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-upload-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id));
  return jsonb_build_object('status','refused');
 end if;
 if not exists(select 1 from public.patient_clinical_cases where user_id=p_member)then return jsonb_build_object('status','not_enrolled');end if;
 select * into b from public.clinic_batches where id=p_batch for update;
 if not found or b.clinic_id<>p_clinic or b.uploader_id<>m.user_id then return jsonb_build_object('status','invalid');end if;
 if exists(select 1 from public.clinic_member_uploads where batch_id=p_batch)then
  return case when(select member_id from public.clinic_member_uploads where batch_id=p_batch)=p_member then jsonb_build_object('status','registered')else jsonb_build_object('status','invalid')end;
 end if;
 if exists(select 1 from public.clinic_batch_files where batch_id=p_batch)then return jsonb_build_object('status','invalid');end if;
 insert into public.clinic_member_uploads(batch_id,clinic_id,member_id,actor_id,membership_id)values(p_batch,p_clinic,p_member,m.user_id,m.id);
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-upload-started',jsonb_build_object('batchId',p_batch,'memberId',p_member,'membershipId',m.id));
 return jsonb_build_object('status','registered');
end$$;

create function public._clinic_member_file_json(c uuid,mm uuid,f public.clinic_batch_files,p_state text,p_upload boolean)returns jsonb
language sql stable security definer set search_path=''as $$
 select jsonb_build_object('fileId',f.id,'name',f.name,'uploadedAt',f.created_at,'fromRecord',p_upload,'state',p_state,
  'attached',cur.id is not null and cur.user_id=mm and not exists(select 1 from public.clinic_result_detachments d where d.attachment_id=cur.id),
  'override',exists(select 1 from public.clinic_upload_overrides o where o.file_id=f.id and o.member_id=mm),
  'fileReading',(select j.state from public.lab_ai_jobs j where j.kind='file'and j.file_id=f.id),
  'memberReading',(select j.state from public.lab_ai_jobs j where j.kind='attachment'and j.attachment_id=cur.id),
  'readingOn',public._lab_ai_enabled(),
  'compare',case when cur.id is null then public._clinic_member_file_compare(f.id,mm)end)
 from(select(public._clinic_result_current(f.id)).*)cur
$$;

-- This member's files on the record: uploads made from it, and old unattached clinic files whose reading
-- names this member. Pending automatic steps are retried here. Audited.
create function public.clinic_admin_member_files(p_clinic uuid,p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;fid uuid;mdob text;mtok text[];
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('version','clinic-member-files-v1','enabled',false);end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-files-refused',jsonb_build_object('memberId',p_member,'membershipId',m.id));
  return jsonb_build_object('version','clinic-member-files-v1','enabled',true,'status','refused');
 end if;
 for fid in select uf.file_id from public.clinic_member_upload_files uf join public.clinic_member_uploads u on u.batch_id=uf.batch_id
  where u.member_id=p_member and u.clinic_id=p_clinic and uf.state in('reading','paused','error','book-first')loop
  perform public._clinic_member_upload_try(fid);
 end loop;
 select birth_date::text,public._name_tokens(display_name)into mdob,mtok from public.profiles where id=p_member;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-files-read',jsonb_build_object('memberId',p_member,'membershipId',m.id));
 perform public._access_audit_record(p_member,'clinic_admin_files',p_clinic::text);
 return jsonb_build_object('version','clinic-member-files-v1','enabled',true,'status','ok','uploadAvailable',public._clinic_result_enabled(),
  'uploads',(select coalesce(jsonb_agg(public._clinic_member_file_json(p_clinic,p_member,f,coalesce(uf.state,'reading'),true)order by f.created_at desc,f.id),'[]'::jsonb)
   from public.clinic_member_uploads u join public.clinic_batch_files f on f.batch_id=u.batch_id left join public.clinic_member_upload_files uf on uf.file_id=f.id
   where u.member_id=p_member and u.clinic_id=p_clinic and f.state='stored'),
  'unmatched',(select coalesce(jsonb_agg(public._clinic_member_file_json(p_clinic,p_member,f,'unmatched',false)order by f.created_at desc,f.id),'[]'::jsonb)
   from public.clinic_batch_files f where f.id in(select f.id from public.clinic_batch_files f join public.clinic_batches b on b.id=f.batch_id join public.lab_ai_jobs j on j.kind='file'and j.file_id=f.id and j.state='done'
    where b.clinic_id=p_clinic and f.state='stored'
     and not exists(select 1 from public.clinic_member_uploads u where u.batch_id=f.batch_id)
     and not exists(select 1 from public.clinic_result_attachments x where x.file_id=f.id)
     and(j.identity->>'birthDateOnSheet'=mdob
      or(nullif(j.identity->>'nameOnSheet','')is not null and public._name_tokens(j.identity->>'nameOnSheet')=mtok and cardinality(mtok)>0)
      or exists(select 1 from jsonb_array_elements(coalesce(j.suggestions,'[]'))s where s->>'memberId'=p_member::text))
    order by f.created_at desc,f.id limit 50)));
end$$;

-- Attach one file from the record: a member-upload file waiting for a check, or an old unattached clinic
-- file. When the sheet differs from the member, p_confirm must be true ("Continue anyway"); the override is
-- recorded with the sheet's and the member's values, the mismatch type and the optional reason.
create function public.clinic_admin_member_file_attach(p_clinic uuid,p_member uuid,p_file uuid,p_submission uuid,p_confirm boolean default false,p_reason text default null,p_appointment uuid default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;f public.clinic_batch_files;u public.clinic_member_uploads;cmp jsonb;res jsonb;reason text:=nullif(btrim(coalesce(p_reason,'')),'');prior public.clinic_upload_overrides;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_admin_member(p_clinic);
 if not public._clinic_admin_full_access_enabled()then return jsonb_build_object('status','disabled');end if;
 if p_submission is null or p_file is null or length(reason)>300 then return jsonb_build_object('status','invalid');end if;
 if not public._clinic_admin_patient(p_clinic,p_member)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-refused',jsonb_build_object('memberId',p_member,'fileId',p_file,'membershipId',m.id));
  return jsonb_build_object('status','refused');
 end if;
 -- A resend of a saved attach replays.
 if exists(select 1 from public.clinic_result_attachments where submission_id=p_submission and file_id=p_file and user_id=p_member and actor_id=m.user_id)then
  return jsonb_build_object('status','saved','replayed',true);
 end if;
 select f2.* into f from public.clinic_batch_files f2 join public.clinic_batches b on b.id=f2.batch_id where f2.id=p_file and b.clinic_id=p_clinic and f2.state='stored';
 if not found then return jsonb_build_object('status','invalid');end if;
 select * into u from public.clinic_member_uploads where batch_id=f.batch_id;
 if u.batch_id is not null and u.member_id<>p_member then return jsonb_build_object('status','invalid');end if;
 if exists(select 1 from public.clinic_result_attachments where file_id=p_file)then return jsonb_build_object('status','stale');end if;
 cmp:=public._clinic_member_file_compare(p_file,p_member);
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
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'member-file-override',jsonb_build_object('memberId',p_member,'fileId',p_file,'mismatch',cmp->>'mismatch','reasonGiven',reason is not null,'membershipId',m.id));
 end if;
 if u.batch_id is not null then
  insert into public.clinic_member_upload_files(file_id,batch_id,state)values(p_file,u.batch_id,'attached')on conflict(file_id)do update set state='attached',updated_at=clock_timestamp();
 end if;
 return jsonb_build_object('status','saved','replayed',false,'override',(cmp->>'differs')::boolean);
exception when insufficient_privilege then raise;
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

-- 7. Noreon oversight ---------------------------------------------------------------------------------------
-- Every "Continue anyway", for Noreon admins only. Each read is recorded in access_audit.
create function public.admin_lab_upload_overrides(p_clinic uuid default null,p_from date default null,p_to date default null,p_mismatch text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare a uuid;
begin
 a:=public._real_staff_require_admin();
 if p_mismatch is not null and p_mismatch not in('name','birth_date','both')then raise invalid_parameter_value;end if;
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)
  values(a,'admin',null,'admin_upload_overrides',left(coalesce(p_clinic::text,'all'),200),left(auth.jwt()->>'session_id',80));
 return jsonb_build_object('version','admin-upload-overrides-v1','overrides',coalesce((select jsonb_agg(jsonb_build_object('id',o.id,'at',o.created_at,'clinicId',o.clinic_id,'clinicName',c.name,
   'by',(select display_name from public.clinic_portal_memberships where id=o.membership_id),'memberId',o.member_id,'fileId',o.file_id,'fileName',f.name,
   'sheet',o.sheet,'member',o.member_values,'mismatch',o.mismatch,'reason',o.reason)order by o.created_at desc,o.id)
  from(select * from public.clinic_upload_overrides o where(p_clinic is null or o.clinic_id=p_clinic)
    and(p_from is null or(o.created_at at time zone 'Asia/Yerevan')::date>=p_from)and(p_to is null or(o.created_at at time zone 'Asia/Yerevan')::date<=p_to)
    and(p_mismatch is null or o.mismatch=p_mismatch)order by o.created_at desc,o.id limit 500)o
  join public.workspace_clinics c on c.id=o.clinic_id join public.clinic_batch_files f on f.id=o.file_id),'[]'::jsonb),
  'clinics',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name)order by c.name,c.id)from public.workspace_clinics c
   where exists(select 1 from public.clinic_upload_overrides o where o.clinic_id=c.id)),'[]'::jsonb));
end$$;

-- The member's files attached despite a mismatch, for the backoffice member page (admin, assigned doctor or nurse).
create function public.staff_member_upload_overrides(p_member uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform 1 from public.workspace_staff where user_id=auth.uid()and active and removed_at is null;
 if not found then raise insufficient_privilege;end if;
 if p_member is null or not(public._member_history_reader(p_member)or public.staff_care_access(p_member,auth.uid(),true))then raise insufficient_privilege;end if;
 perform public._access_audit_record(p_member,'member_upload_overrides',null);
 return coalesce((select jsonb_agg(jsonb_build_object('fileId',o.file_id,'fileName',f.name,'at',o.created_at,'clinicName',c.name,'mismatch',o.mismatch,'reason',o.reason,
   'sheet',o.sheet,'member',o.member_values,'current',public._lab_ai_current(o.attachment_id))order by o.created_at desc,o.id)
  from public.clinic_upload_overrides o join public.clinic_batch_files f on f.id=o.file_id join public.workspace_clinics c on c.id=o.clinic_id where o.member_id=p_member),'[]'::jsonb);
end$$;

-- 8. The clinic shell learns whether full access is on (admins only) ----------------------------------------
-- Same as 20261017111652 plus 'fullAccess'.
create or replace function public.clinic_portal_identity(p_clinic_id uuid default null)returns jsonb language plpgsql security definer set search_path=''as $$declare m public.clinic_portal_memberships;cs jsonb;cid uuid;begin
 if p_clinic_id is null then
 select jsonb_agg(jsonb_build_object('id',x.clinic_id,'name',c.name)order by x.clinic_id)into cs from public.clinic_portal_memberships x join public.workspace_clinics c on c.id=x.clinic_id and c.active where x.user_id=auth.uid()and x.active;
 if cs is null then raise insufficient_privilege;end if;
 for cid in select(value->>'id')::uuid from jsonb_array_elements(cs)loop perform public._clinic_portal_user(cid);end loop;
 if jsonb_array_length(cs)>1 then return jsonb_build_object('status','selection-required','clinics',cs);end if;
 p_clinic_id:=(cs->0->>'id')::uuid;
 end if;
 m:=public._clinic_portal_user(p_clinic_id);
 return jsonb_build_object('status','ready','identity',jsonb_build_object('version','clinic-portal-v1','userId',m.user_id,'membershipId',m.id,'membershipRevision',m.revision,'clinicId',m.clinic_id,'clinicName',(select name from public.workspace_clinics where id=m.clinic_id),'displayName',m.display_name,
  'capability',case when m.role='staff'then 'clinic_staff'else 'clinic_admin'end,
  'fullAccess',m.role='admin'and public._clinic_admin_full_access_enabled()));
end$$;

-- 9. Grants -------------------------------------------------------------------------------------------------
revoke all on function public._clinic_member_assigned_here(uuid,uuid),public._name_tokens(text),public._clinic_member_file_compare(uuid,uuid),
 public._clinic_member_attach(uuid,uuid,uuid,uuid,text,uuid,uuid,uuid),public._clinic_member_upload_try(uuid),public._clinic_member_upload_file_stored(),public._clinic_member_upload_read(),
 public.lab_ai_file_target(uuid),public.clinic_admin_member_upload_register(uuid,uuid,uuid),public._clinic_member_file_json(uuid,uuid,public.clinic_batch_files,text,boolean),
 public.clinic_admin_member_files(uuid,uuid),public.clinic_admin_member_file_attach(uuid,uuid,uuid,uuid,boolean,text,uuid),
 public.admin_lab_upload_overrides(uuid,date,date,text),public.staff_member_upload_overrides(uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.lab_ai_file_target(uuid)to service_role;
grant execute on function public.clinic_admin_member_upload_register(uuid,uuid,uuid),public.clinic_admin_member_files(uuid,uuid),
 public.clinic_admin_member_file_attach(uuid,uuid,uuid,uuid,boolean,text,uuid),public.admin_lab_upload_overrides(uuid,date,date,text),public.staff_member_upload_overrides(uuid)to authenticated;
