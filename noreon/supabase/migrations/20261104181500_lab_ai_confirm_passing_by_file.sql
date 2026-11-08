-- Reserved stamp: accept the viewed file ID and resolve its current member attachment.
create or replace function public.doctor_lab_ai_confirm_passing(p_command jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare
 d uuid;sub uuid;m uuid;fid uuid;aid uuid;candidate_id uuid;j public.lab_ai_jobs;v public.lab_ai_values;
 prior public.lab_ai_confirm_passing_commands;before_v jsonb;n integer:=0;left_n integer;
begin
 perform set_config('lock_timeout','1500ms',true);
 if jsonb_typeof(p_command)is distinct from 'object'
  or p_command-array['version','submissionId','memberId','fileId']<>'{}'
  or not(p_command?&array['version','submissionId','memberId','fileId'])
  or p_command->>'version'is distinct from 'lab-ai-confirm-passing-v1'
  or jsonb_typeof(p_command->'submissionId')is distinct from 'string'
  or jsonb_typeof(p_command->'memberId')is distinct from 'string'
  or jsonb_typeof(p_command->'fileId')is distinct from 'string'then
  return jsonb_build_object('status','invalid');
 end if;
 begin
  sub:=(p_command->>'submissionId')::uuid;m:=(p_command->>'memberId')::uuid;fid:=(p_command->>'fileId')::uuid;
 exception when invalid_text_representation then return jsonb_build_object('status','invalid');end;
 d:=public._assigned_active_doctor(m);
 if not public._doctor_completion_enabled()or not public._lab_ai_enabled()then return jsonb_build_object('status','disabled');end if;
 -- Resolve the current attachment for this member on the server; file and attachment IDs differ.
 select attachment_id into aid from public.lab_ai_jobs
  where file_id=fid and user_id=m and public._lab_ai_current(attachment_id)order by created_at desc limit 1;
 if not found then return jsonb_build_object('status','stale');end if;
 -- Serialize retries, including empty batches. Per-value review does not take this lock.
 if not pg_try_advisory_xact_lock(hashtextextended('lab-ai-confirm-passing:'||sub::text,0))then
  return jsonb_build_object('status','unavailable');end if;
 select * into prior from public.lab_ai_confirm_passing_commands where submission_id=sub;
 if found then
  if prior.member_id<>m or prior.attachment_id<>aid or prior.actor_id<>d then return jsonb_build_object('status','stale');end if;
  return jsonb_build_object('status','saved','replayed',true,'confirmed',prior.confirmed,'remaining',prior.remaining);
 end if;
 -- Match value_review: values first, then an unlocked job read. Consistent ordering
 -- also serializes two bulk commands without reversing per-value/worker lock order.
 perform 1 from public.lab_ai_values where attachment_id=aid and user_id=m order by id for update;
 select * into j from public.lab_ai_jobs where attachment_id=aid and user_id=m;
 if not found or not public._lab_ai_current(aid)then return jsonb_build_object('status','stale');end if;
 if(j.identity_status is distinct from 'match'or exists(select 1 from public.clinic_upload_overrides o where o.attachment_id=aid))
  and j.identity_confirmed_at is null then return jsonb_build_object('status','identity-first');end if;
 if not exists(select 1 from public.patient_document_opens o where o.file_id=j.file_id and o.attachment_id=aid and o.actor_id=d and o.actor_kind='doctor')then
  return jsonb_build_object('status','open-first');end if;
 -- A worker may add candidates after the initial lock query. Lock and reread each
 -- candidate before checking eligibility; never revisit an already reviewed value.
 for candidate_id in select id from public.lab_ai_values where attachment_id=aid and user_id=m and status='unverified'order by id loop
  select * into v from public.lab_ai_values where id=candidate_id and attachment_id=aid and user_id=m for update;
  if not found or v.status is distinct from 'unverified'or not public._lab_ai_auto_accept_ok(v)then continue;end if;
  before_v:=jsonb_build_object('status',v.status,'correctedValue',v.corrected_value,'correctedUnit',v.corrected_unit,'reviewNote',v.review_note,'reviewedBy',v.reviewed_by,'reviewedAt',v.reviewed_at);
  -- Exactly the per-value confirm transition for an unverified value; the existing guard runs.
  update public.lab_ai_values set status='verified',corrected_value=null,corrected_unit=null,review_note=null,
   reviewed_by=d,reviewed_at=clock_timestamp()where id=v.id and status='unverified'returning * into v;
  if not found then continue;end if;
  insert into public.lab_ai_value_reviews(value_id,submission_id,actor_id,action,before,after)
   values(v.id,md5('lab-ai-confirm-passing-v1:'||sub::text||':'||v.id::text)::uuid,d,'confirm',before_v,
    jsonb_build_object('status',v.status,'correctedValue',v.corrected_value,'correctedUnit',v.corrected_unit,'reviewNote',v.review_note,'reviewedBy',v.reviewed_by,'reviewedAt',v.reviewed_at));
  n:=n+1;
 end loop;
 select count(*)into left_n from public.lab_ai_values where attachment_id=aid and user_id=m and status='unverified';
 insert into public.lab_ai_confirm_passing_commands(submission_id,member_id,attachment_id,actor_id,confirmed,remaining)
  values(sub,m,aid,d,n,left_n);
 return jsonb_build_object('status','saved','replayed',false,'confirmed',n,'remaining',left_n);
-- The exception block rolls back every value and audit write, even on a late conflict.
exception
 when lock_not_available then return jsonb_build_object('status','unavailable');
 when unique_violation then return jsonb_build_object('status','stale');
end$$;
revoke all on function public.doctor_lab_ai_confirm_passing(jsonb)from public,anon,authenticated,service_role;
grant execute on function public.doctor_lab_ai_confirm_passing(jsonb)to authenticated;
