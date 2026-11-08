-- Clinic lab results: one screen, AI-suggested member, link without arrival or samples, and the visit
-- completed from the result (Khikar, 17 Oct 2026 19:19: minimise clinic admin work).
--
--  * A clinic links a stored PDF to a member who has a confirmed booking WITH THIS CLINIC (120 days back up
--    to now; _lab_clinic_bookings). Arrival and recorded samples are not needed. A member with
--    no booking here cannot be linked by the clinic; never across clinics.
--  * The booking is chosen by the database: the latest booking on or before the sheet's sample date (within
--    7 days of it), else, with no sample date, the nearest past booking. The clinic is asked to choose when
--    two are close (within 2 days of each other before the sample date, or two past ones within 45 days
--    without one) or when none fits.
--  * Linking completes that booking: if no visit is recorded for it, an inferred visit is created
--    (actor = the clinic user, source 'inferred-from-result-upload'), the file is attached to it, and a
--    'completed' check-in is recorded with the same source. No sample entries are invented: per-sample
--    evidence stays nurse-entered; the attachment itself is "results received" (existing stage logic and
--    the result-attached notice apply). Idempotent per submission and per booking. Accepted edge: a nurse
--    visit recorded AFTER the upload is not reused (an upload may not predate its visit), so that booking
--    then has two visits, the nurse's and the inferred one.
--  * A file the reader found to hold several people, or no member of this clinic, is "Needs Noreon
--    review": the clinic cannot link it; a Noreon admin uses the existing admin attach.

-- 1. Inferred visits and completion check-ins ---------------------------------------------------------------
alter table public.patient_care_visits add column source text not null default 'nurse-visit'check(source in('nurse-visit','inferred-from-result-upload'));
alter table public.patient_care_visits drop constraint patient_care_visits_actor_role_check;
alter table public.patient_care_visits add constraint patient_care_visits_actor_role_check check(
 (source='nurse-visit'and actor_role='nurse')or(source='inferred-from-result-upload'and actor_role='clinic'and booking_context is not null));
alter table public.clinic_booking_checkins drop constraint clinic_booking_checkins_outcome_check;
alter table public.clinic_booking_checkins add column source text not null default 'clinic-user'check(source in('clinic-user','inferred-from-result-upload'));
alter table public.clinic_booking_checkins add constraint clinic_booking_checkins_outcome_check check(
 (source='clinic-user'and outcome in('arrived','no-show'))or(source='inferred-from-result-upload'and outcome='completed'));

-- 2. Choosing the booking ----------------------------------------------------------------------------------
-- Returns {status:'one',appointmentId,startsAt} or {status:'choose',options:[...]} or {status:'none'}.
create function public._lab_clinic_pick_booking(p_clinic uuid,p_member uuid,p_sample date)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare opts jsonb;b1 record;b2 record;n int;
begin
 select jsonb_agg(jsonb_build_object('appointmentId',b.appointment_id,'startsAt',b.starts_at)order by b.starts_at desc)into opts
  from public._lab_clinic_bookings(p_clinic)b where b.member_id=p_member;
 if opts is null then return jsonb_build_object('status','none');end if;
 if p_sample is not null then
  -- The latest booking on or before the sample date (sheets often print a later processing date), within
  -- 7 days of it; ask if there is none, or if the next earlier booking is within 2 days of it (Fable R1).
  select b.appointment_id,b.starts_at,(b.starts_at at time zone 'Asia/Yerevan')::date d into b1 from public._lab_clinic_bookings(p_clinic)b
   where b.member_id=p_member and(b.starts_at at time zone 'Asia/Yerevan')::date<=p_sample order by b.starts_at desc limit 1;
  if b1.appointment_id is null or p_sample-b1.d>7 then return jsonb_build_object('status','choose','options',opts);end if;
  select b.appointment_id,(b.starts_at at time zone 'Asia/Yerevan')::date d into b2 from public._lab_clinic_bookings(p_clinic)b
   where b.member_id=p_member and b.appointment_id<>b1.appointment_id and(b.starts_at at time zone 'Asia/Yerevan')::date<=p_sample order by b.starts_at desc limit 1;
  if b2.appointment_id is not null and b1.d-b2.d<=2 then return jsonb_build_object('status','choose','options',opts);end if;
  return jsonb_build_object('status','one','appointmentId',b1.appointment_id,'startsAt',b1.starts_at);
 end if;
 -- No sample date: the nearest past booking, unless two past ones fall within 45 days; else the one upcoming.
 select count(*)into n from public._lab_clinic_bookings(p_clinic)b where b.member_id=p_member and b.starts_at<=clock_timestamp()and b.starts_at>clock_timestamp()-interval '45 days';
 if n>1 then return jsonb_build_object('status','choose','options',opts);end if;
 select b.appointment_id,b.starts_at into b1 from public._lab_clinic_bookings(p_clinic)b where b.member_id=p_member and b.starts_at<=clock_timestamp()order by b.starts_at desc limit 1;
 if b1.appointment_id is not null then return jsonb_build_object('status','one','appointmentId',b1.appointment_id,'startsAt',b1.starts_at);end if;
 if jsonb_array_length(opts)>1 then return jsonb_build_object('status','choose','options',opts);end if;
 return jsonb_build_object('status','one','appointmentId',opts->0->>'appointmentId','startsAt',opts->0->>'startsAt');
end$$;

-- The visit a result for this booking is attached to: the latest recorded visit for it, else a new
-- inferred one dated at the booking (or the upload, if earlier), so an upload is never older than its visit.
create function public._lab_clinic_visit_for(p_clinic uuid,p_member uuid,p_appointment uuid,p_actor uuid,p_actor_name text,p_file public.clinic_batch_files)returns uuid
language plpgsql security definer set search_path=''as $$
declare v public.patient_care_visits;a public.booking_appointments;ver public.booking_appointment_versions;seal public.booking_program_seals;tests jsonb;vid uuid;starts timestamptz;
begin
 select * into v from public.patient_care_visits where user_id=p_member and appointment_id=p_appointment and created_at<=p_file.created_at order by created_at desc,id limit 1;
 if found then return v.id;end if;
 select * into a from public.booking_appointments where id=p_appointment and member_id=p_member;
 select * into ver from public.booking_appointment_versions where appointment_id=a.id and notice_id in(select id from public.booking_scheduling_notices where appointment_id=a.id and clinic_id=p_clinic and state='accepted')
  and proposed_arrangement=a.current_arrangement order by revision desc limit 1;
 if not found then return null;end if;
 select * into seal from public.booking_program_seals where id=ver.program_id and member_id=p_member;
 select jsonb_agg(jsonb_build_object('id',i->>'id','title',i->>'title','method',i->>'method')order by ord)into tests
  from jsonb_array_elements(seal.program->'items')with ordinality as items(i,ord)where i->>'method'in('lab','clinic')and(a.current_arrangement->'coveredTestIds')?(i->>'id');
 starts:=least((a.current_arrangement->>'startsAt')::timestamptz,p_file.created_at);
 vid:=gen_random_uuid();
 insert into public.patient_care_visits(id,user_id,created_at,actor_id,actor_name,actor_role,clinic_id,appointment_id,accepted_revision,booking_context,source)
 values(vid,p_member,starts,p_actor,left(p_actor_name,180),'clinic',p_clinic,a.id,ver.revision,
  jsonb_build_object('version','booking-visit-context-v1','appointmentId',a.id,'acceptedRevision',ver.revision,'tests',coalesce(tests,'[]')),'inferred-from-result-upload');
 return vid;
end$$;

-- 3. Clinic read: one row per stored file with its reading, suggestion and link -----------------------------
create function public.clinic_portal_lab_results(p_clinic uuid,p_batch uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;
begin
 perform set_config('lock_timeout','1500ms',true);
 m:=public._clinic_portal_user(p_clinic);
 if not exists(select 1 from public.clinic_batches where id=p_batch and clinic_id=p_clinic)then raise insufficient_privilege;end if;
 if not public._clinic_result_enabled()then return jsonb_build_object('version','clinic-lab-results-v1','enabled',false,'reading',false,'files','[]'::jsonb,'members','[]'::jsonb);end if;
 return jsonb_build_object('version','clinic-lab-results-v1','enabled',true,'reading',public._lab_ai_enabled(),
  'files',coalesce((select jsonb_agg(r order by r->>'uploadedAt' desc,r->>'fileId')from(
   select jsonb_build_object('fileId',f.id,'name',f.name,'uploadedAt',f.created_at,
    'linked',(select case when cur.id is null or exists(select 1 from public.clinic_result_detachments d where d.attachment_id=cur.id)then null
      when cur.clinic_id<>p_clinic then null
      else jsonb_build_object('memberId',cur.user_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'linkedAt',cur.created_at)end
      from public._clinic_result_current(f.id)cur left join public.profiles p on p.id=cur.user_id),
    'everLinked',exists(select 1 from public.clinic_result_attachments x where x.file_id=f.id),
    'reading',(select case when j.id is null then null else jsonb_build_object('state',j.state,'outcome',j.outcome,'identityStatus',j.identity_status,
      'nameOnSheet',j.identity->>'nameOnSheet','birthDateOnSheet',j.identity->>'birthDateOnSheet','sampleDate',j.identity->>'sampleDate')end
      from public.lab_ai_jobs j where j.kind='file'and j.file_id=f.id),
    -- Only members who still have a booking here are ever shown.
    'suggestion',(select jsonb_build_object('memberId',s->>'memberId','confidence',s->>'confidence','name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',p.birth_date)
      from public.lab_ai_jobs j cross join lateral jsonb_array_elements(coalesce(j.suggestions,'[]'))with ordinality s(s,o) join public.profiles p on p.id=(s->>'memberId')::uuid
      where j.kind='file'and j.file_id=f.id and j.state='done'and exists(select 1 from public._lab_clinic_bookings(p_clinic)b where b.member_id=p.id)order by o limit 1))r
   from public.clinic_batch_files f where f.batch_id=p_batch and f.state='stored'order by f.created_at desc,f.id limit 100)x),'[]'),
  'members',coalesce((select jsonb_agg(jsonb_build_object('memberId',x.member_id,'name',coalesce(nullif(btrim(p.display_name),''),''),'birthDate',p.birth_date,'bookingAt',x.starts_at)
    order by lower(coalesce(p.display_name,'')),x.member_id)
   from(select * from(select distinct on(member_id)member_id,starts_at from public._lab_clinic_bookings(p_clinic)order by member_id,abs(extract(epoch from starts_at-clock_timestamp())))y
    order by starts_at desc limit 300)x
   join public.profiles p on p.id=x.member_id),'[]'));
end$$;

-- 4. Clinic confirm: link a file to a member of this clinic and complete the booking -------------------------
-- Command: {version:'clinic-lab-link-v1',submissionId,fileId,memberId,appointmentId?}.
create function public.clinic_portal_lab_link(p_clinic uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;sub uuid;fid uuid;mid uuid;aid uuid;f public.clinic_batch_files;j public.lab_ai_jobs;pick jsonb;vid uuid;res jsonb;prior public.clinic_result_attachments;
 a public.booking_appointments;completed boolean:=false;sample date;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','fileId','memberId','appointmentId']<>'{}'
  or not(p_command?&array['version','submissionId','fileId','memberId'])or p_command->>'version'is distinct from 'clinic-lab-link-v1'then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;fid:=(p_command->>'fileId')::uuid;mid:=(p_command->>'memberId')::uuid;aid:=(p_command->>'appointmentId')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 m:=public._clinic_portal_user(p_clinic);
 if not public._clinic_result_enabled()then return jsonb_build_object('status','disabled');end if;
 perform pg_advisory_xact_lock(hashtextextended('clinic-result-attach:'||fid::text,0));
 -- A resend of a saved link replays.
 select * into prior from public.clinic_result_attachments where submission_id=sub;
 if found then
  if prior.file_id<>fid or prior.user_id<>mid or prior.actor_id<>m.user_id then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','replayed',true);
 end if;
 select f2.* into f from public.clinic_batch_files f2 join public.clinic_batches b on b.id=f2.batch_id where f2.id=fid and b.clinic_id=p_clinic and f2.state='stored';
 if not found then return jsonb_build_object('status','invalid');end if;
 if exists(select 1 from public.clinic_result_attachments where file_id=fid)then return jsonb_build_object('status','stale');end if;
 select * into j from public.lab_ai_jobs where kind='file'and file_id=fid;
 if j.identity_status='multiple_patients'then return jsonb_build_object('status','needs-review');end if;
 -- Only a member with a booking at this clinic; another clinic's member is refused the same way as an unknown one.
 if not exists(select 1 from public._lab_clinic_bookings(p_clinic)b where b.member_id=mid)then
  perform public._clinic_schedule_audit(p_clinic,m.user_id,'lab-link-refused',jsonb_build_object('fileId',fid,'memberId',mid,'membershipId',m.id));
  return jsonb_build_object('status','not-this-clinic');
 end if;
 -- Serialise on the member before any visit is created, so two files confirmed at once share one inferred visit (Fable R4).
 perform 1 from public.patient_clinical_cases where user_id=mid for update nowait;
 if aid is not null then
  if not exists(select 1 from public._lab_clinic_bookings(p_clinic)b where b.member_id=mid and b.appointment_id=aid)then return jsonb_build_object('status','invalid');end if;
 else
  begin sample:=(j.identity->>'sampleDate')::date;exception when others then sample:=null;end;
  pick:=public._lab_clinic_pick_booking(p_clinic,mid,sample);
  if pick->>'status'='choose'then return jsonb_build_object('status','choose-visit','options',pick->'options');end if;
  aid:=(pick->>'appointmentId')::uuid;
 end if;
 vid:=public._lab_clinic_visit_for(p_clinic,mid,aid,m.user_id,m.display_name,f);
 if vid is null then return jsonb_build_object('status','invalid');end if;
 res:=public._clinic_result_attach('clinic-admin',m.user_id,sub,fid,mid,vid,p_clinic);
 if res->>'status'<>'saved'then return res-'attachmentId';end if;
 -- Complete the booking once, recorded as inferred from the result upload by this clinic user.
 select * into a from public.booking_appointments where id=aid;
 if not exists(select 1 from public.clinic_booking_checkins where reservation_id=a.current_reservation_id and outcome='completed')then
  insert into public.clinic_booking_checkins(clinic_id,appointment_id,reservation_id,outcome,actor_id,membership_id,source)values(p_clinic,a.id,a.current_reservation_id,'completed',m.user_id,m.id,'inferred-from-result-upload');
  completed:=true;
 end if;
 perform public._clinic_schedule_audit(p_clinic,m.user_id,'lab-linked',jsonb_build_object('fileId',fid,'memberId',mid,'appointmentId',aid,'visitId',vid,'completed',completed,
  'suggested',coalesce((select bool_or(s->>'memberId'=mid::text)from jsonb_array_elements(coalesce(j.suggestions,'[]'))s),false),'membershipId',m.id));
 return jsonb_build_object('status','saved','replayed',false,'startsAt',a.current_arrangement->>'startsAt','completed',completed);
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;

revoke all on function public._lab_clinic_pick_booking(uuid,uuid,date),public._lab_clinic_visit_for(uuid,uuid,uuid,uuid,text,public.clinic_batch_files),
 public.clinic_portal_lab_results(uuid,uuid),public.clinic_portal_lab_link(uuid,jsonb)from public,anon,authenticated,service_role;
grant execute on function public.clinic_portal_lab_results(uuid,uuid),public.clinic_portal_lab_link(uuid,jsonb)to authenticated;
