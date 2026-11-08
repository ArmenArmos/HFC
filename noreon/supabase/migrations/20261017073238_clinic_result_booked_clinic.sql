-- Lab-result attach fixes from the Fable care-flow review (17 Oct 2026):
--  CF-1  scope visits by the clinic the member booked with, taken from the
--        accepted booking version's scheduling notice, instead of
--        patient_care_visits.clinic_id (the nurse's employer clinic);
--  CF-2  give the clinic the booking reference it already holds from the
--        scheduling email (the notice id, which the email prints as its
--        reference), and refuse a clinic-admin attach for a visit whose member
--        name is blank or shared with another open visit that day.
-- Bodies are otherwise unchanged from 20261016215605; create or replace keeps
-- each function's existing grants.

-- Open visits of the clinic the member BOOKED with (the clinic the scheduling
-- email went to), not the nurse's employer clinic (review CF-1). Each row
-- carries the email reference the clinic already holds, and is flagged
-- ambiguous when its name is blank or another member's open visit shares the
-- name on the same Yerevan day (review CF-2). Still bounded: 180 days, at most 200.
create or replace function public._clinic_result_open_visits(p_clinic uuid)returns jsonb
language sql stable security definer set search_path=''as $$
 select coalesce(jsonb_agg(jsonb_build_object('visitId',q.id,'memberId',q.user_id,'memberName',q.display_name,'visitedAt',q.created_at,
  'atLab',q.at_lab,'collectedOnly',q.collected_only,'reference',q.reference,'ambiguous',q.ambiguous)order by q.created_at desc,q.id),'[]')
 from(select o.*,nullif(btrim(coalesce(o.display_name,'')),'')is null
   or count(*)over(partition by lower(btrim(coalesce(o.display_name,''))),(o.created_at at time zone 'Asia/Yerevan')::date)
    <>count(*)over(partition by lower(btrim(coalesce(o.display_name,''))),(o.created_at at time zone 'Asia/Yerevan')::date,o.user_id)ambiguous
 from(select v.id,v.user_id,v.created_at,p.display_name,x.at_lab,x.collected_only,n.id::text reference
 from public.patient_care_visits v join public.profiles p on p.id=v.user_id
 join public.booking_appointment_versions bv on bv.appointment_id=v.appointment_id and bv.revision=v.accepted_revision
 join public.booking_scheduling_notices n on n.id=bv.notice_id
 cross join lateral(select
   count(*)filter(where exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='at-lab')
    and(public._patient_lab_active_result(e.id)).id is null)at_lab,
   count(*)filter(where not exists(select 1 from public.patient_care_lab_stages s where s.collection_entry_id=e.id and s.stage='at-lab'))collected_only,
   count(*)filter(where(public._patient_lab_active_result(e.id)).id is null)open_count
  from public.patient_care_visit_entries e where e.visit_id=v.id and e.user_id=v.user_id and public._patient_lab_current_collection(e))x
 where n.clinic_id=p_clinic and v.booking_context is not null and x.at_lab>0 and v.created_at>clock_timestamp()-interval '180 days'
 order by v.created_at desc,v.id limit 200)o)q
$$;

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
 -- The visit must have been booked with the upload's clinic (review CF-1).
 select v2.* into v from public.patient_care_visits v2
  join public.booking_appointment_versions bv on bv.appointment_id=v2.appointment_id and bv.revision=v2.accepted_revision
  join public.booking_scheduling_notices n on n.id=bv.notice_id
  where v2.id=p_visit and v2.user_id=p_member and n.clinic_id=clinic and v2.booking_context is not null;
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

create or replace function public.clinic_portal_result_visits(p_clinic uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public._clinic_portal_user(p_clinic);
 if not public._clinic_result_enabled()then return jsonb_build_object('version','clinic-result-visits-v1','enabled',false,'visits','[]'::jsonb);end if;
 return jsonb_build_object('version','clinic-result-visits-v1','enabled',true,'visits',coalesce((select jsonb_agg(jsonb_build_object('visitId',x->>'visitId','memberName',x->>'memberName','visitedAt',x->>'visitedAt','reference',x->>'reference','ambiguous',(x->>'ambiguous')::boolean))
  from jsonb_array_elements(public._clinic_result_open_visits(p_clinic))x),'[]'));
end$$;

create or replace function public.clinic_portal_result_attach(p_clinic uuid,p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare m public.clinic_portal_memberships;sub uuid;fid uuid;vid uuid;member uuid;res jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'or p_command-array['version','submissionId','fileId','visitId']<>'{}'
  or not(p_command?&array['version','submissionId','fileId','visitId'])or p_command->>'version'is distinct from 'clinic-result-attach-v1'then return jsonb_build_object('status','invalid');end if;
 begin sub:=(p_command->>'submissionId')::uuid;fid:=(p_command->>'fileId')::uuid;vid:=(p_command->>'visitId')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 m:=public._clinic_portal_user(p_clinic);
 if not public._clinic_result_enabled()then return jsonb_build_object('status','disabled');end if;
 -- Only this clinic's open visits may be chosen.
 if not exists(select 1 from jsonb_array_elements(public._clinic_result_open_visits(p_clinic))x where x->>'visitId'=vid::text)then
  if exists(select 1 from public.clinic_result_attachments where submission_id=sub and visit_id=vid and actor_id=m.user_id)then null;
  else return jsonb_build_object('status','invalid');end if;
 end if;
 -- A visit the clinic cannot tell apart from another is left to Noreon (review CF-2).
 -- A resend of this clinic admin's own saved link replays instead (Fable N-2).
 if not exists(select 1 from public.clinic_result_attachments where submission_id=sub and file_id=fid and visit_id=vid and actor_id=m.user_id)
  and exists(select 1 from jsonb_array_elements(public._clinic_result_open_visits(p_clinic))x where x->>'visitId'=vid::text and(x->>'ambiguous')::boolean)then
  return jsonb_build_object('status','ambiguous');end if;
 select user_id into member from public.patient_care_visits where id=vid;
 res:=public._clinic_result_attach('clinic-admin',m.user_id,sub,fid,member,vid,p_clinic);
 -- The clinic sees counts only, never member identifiers.
 return res-'attachmentId';
exception when insufficient_privilege then return jsonb_build_object('status','access');
 when lock_not_available or query_canceled or deadlock_detected then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;
