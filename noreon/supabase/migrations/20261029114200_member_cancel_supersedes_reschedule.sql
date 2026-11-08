-- QA 160: a member can cancel while a time change waits for the provider.
-- Same engine as 20261014220153 (renamed to _legacy_command_patient_test_request by
-- 20261015235558) except, for member commands:
--  * cancel replaces a pending reschedule: the requested time and any replacement terms
--    recorded for it are withdrawn, and pending_change carries replacedReschedule=true;
--  * a pending cancellation blocks further member cancel or change requests.
create or replace function public._legacy_command_patient_test_request(p_user_id uuid,p_actor uuid,p_staff boolean,p_id uuid,p_revision bigint,p_command_id uuid,p_operation text,p_input jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.patient_test_requests;e public.patient_test_request_events;result jsonb;payload jsonb;staff jsonb;arrangement jsonb;context jsonb;
begin
 perform set_config('lock_timeout','1500ms',true);
 perform public.lock_patient_clinical_sources(p_user_id);
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 if not found then raise insufficient_privilege using message='Request unavailable';end if;
 if p_staff then
  if not exists(select 1 from public.workspace_staff s where s.user_id=p_actor and s.active and (s.role='admin' or public.staff_care_access(p_user_id,p_actor,true))) then raise insufficient_privilege using message='Active assigned operations access required';end if;
 elsif p_actor is distinct from p_user_id then raise insufficient_privilege;end if;
 select * into r from public.patient_test_requests where id=p_id and user_id=p_user_id for update nowait;
 if not found then raise insufficient_privilege using message='Request unavailable';end if;
 if p_command_id is null or jsonb_typeof(p_input) is distinct from 'object' or octet_length(p_input::text)>16000 then raise exception 'Invalid command';end if;
 if p_operation in ('confirm','accept') then
  context:=public.patient_test_context(p_user_id);
  if r.context_token is distinct from context->>(case when r.context_token like 'v2:%' then 'requirementsToken' else 'token' end) then raise serialization_failure using message='Test requirements changed. Keep the existing provider time and arrange a new review';end if;
  -- The server derived the engine from exactly this snapshot. A source insertion
  -- after derivation (including a crisis reading) conflicts before replay or write.
  if p_input#>>'{engine,sourceToken}' is distinct from context->>'token' then raise serialization_failure using message='Clinical source changed. Reload before continuing';end if;
  if jsonb_typeof(p_input#>'{engine,tests}') is distinct from 'array' or r.algorithm_version is distinct from p_input#>>'{engine,version}' then raise serialization_failure using message='The clinical algorithm changed. Request a new review';end if;
  if exists(select 1 from jsonb_array_elements(r.requirements) requirement where not exists(select 1 from jsonb_array_elements(p_input#>'{engine,tests}') current_test where current_test=requirement)) then raise serialization_failure using message='Recommended requirements changed. Request a new review';end if;
 end if;
 payload:=jsonb_build_object('operation',p_operation,'input',p_input #- '{engine,sourceToken}','revision',p_revision,'staff',p_staff);
 select * into e from public.patient_test_request_events where request_id=p_id and command_id=p_command_id;
 if found then
  if e.actor_id is distinct from p_actor or e.payload is distinct from payload then raise serialization_failure using message='Command identity was already used with different details';end if;
  return e.result;
 end if;
 if r.revision is distinct from p_revision then raise serialization_failure using message='This request changed. Reload before continuing';end if;
 if p_staff and p_operation='confirm' then
  if r.status not in ('requested','provider-proposed','confirmed','change-pending') or (r.status='change-pending' and r.pending_change->>'kind'='cancel') then raise exception 'Resolve the pending cancellation first';end if;
  if not public.valid_patient_test_terms(p_input->'terms') or not public.valid_patient_provider_source(p_input) or coalesce(length(btrim(p_input->>'provider')),0) not between 2 and 300 or coalesce(length(btrim(p_input->>'preparation')),0) not between 3 and 8000 or (p_input#>>'{terms,startsAt}')::timestamptz<=now() then raise exception 'Record complete actual provider terms, source and preparation';end if;
  if r.current_arrangement is not null and (r.current_arrangement#>>'{terms,startsAt}')::timestamptz<=now() then raise exception 'Past provider arrangements require operational follow-up';end if;
  if coalesce(r.current_arrangement,r.proposal) is not null and (p_input->>'replacesExisting' is distinct from 'true' or p_input->>'provider' is distinct from coalesce(r.current_arrangement,r.proposal)->>'provider') then raise exception 'The same provider must offer replacement terms while retaining the existing arrangement. Cancel separately before changing provider';end if;
  select jsonb_build_object('recordedBy',display_name,'recordedAt',now()) into staff from public.workspace_staff where user_id=p_actor;
  arrangement:=jsonb_build_object('provider',p_input->'provider','terms',p_input->'terms','obtainedAt',p_input->'obtainedAt','channel',p_input->'channel','source',p_input->'source','preparation',p_input->'preparation','replacesExisting',coalesce(p_input->'replacesExisting','false'::jsonb))||staff;
  -- Every new/corrected proposal requires explicit acceptance, also covering preparation corrections.
  r.proposal:=arrangement;r.pending_change:=null;r.status:='provider-proposed';
 elsif not p_staff and p_operation='accept' then
  if r.status<>'provider-proposed' or r.proposal is null or (r.proposal#>>'{terms,startsAt}')::timestamptz<=now() then raise exception 'No current future provider proposal to accept';end if;
  if r.current_arrangement is not null then
   r.pending_change:=jsonb_build_object('kind','reschedule','terms',r.proposal->'terms','memberAccepted',true);r.status:='change-pending';
  else r.current_arrangement:=r.proposal;r.proposal:=null;r.pending_change:=null;r.status:='confirmed';end if;
 elsif not p_staff and p_operation in ('cancel','request-change') then
  if r.status='cancelled' then raise exception 'This request is already cancelled';end if;
  if r.status='change-pending' and r.pending_change->>'kind'='cancel' then raise exception 'Resolve the pending cancellation first';end if;
  if p_operation='request-change' and (not public.valid_patient_test_preference(p_input->'terms') or (p_input#>>'{terms,startsAt}')::timestamptz<=now()) then raise exception 'Choose valid future preferred terms';end if;
  if r.current_arrangement is null and r.proposal is null then
   if p_operation='request-change' then raise exception 'Cancel this unconfirmed request and send a new preference';end if;
   r.status:='cancelled';r.pending_change:=null;
  elsif p_operation='cancel' then
   -- Cancel wins: a pending time change and any replacement terms recorded for it are
   -- withdrawn, so a declined cancellation returns to the current arrangement alone.
   r.pending_change:=jsonb_build_object('kind','cancel')||case when r.current_arrangement is not null and (r.proposal is not null or r.pending_change->>'kind'='reschedule') then '{"replacedReschedule":true}'::jsonb else '{}'::jsonb end;
   if r.current_arrangement is not null then r.proposal:=null;end if;
   r.status:='change-pending';
  else
   r.pending_change:=jsonb_build_object('kind','reschedule','terms',p_input->'terms');
   r.status:='change-pending';
  end if;
 elsif p_staff and p_operation='change-outcome' then
  if r.status<>'change-pending' or r.pending_change is null or not public.valid_patient_provider_source(p_input) or coalesce(p_input->>'outcome','') not in ('accepted','declined') then raise exception 'Record the actual provider response to the pending change';end if;
  if p_input->>'outcome'='accepted' and r.pending_change->>'kind'='reschedule' then
   if r.pending_change->>'memberAccepted' is distinct from 'true' or r.proposal is null then raise exception 'Record complete replacement terms and obtain member acceptance first';end if;
   r.status:='confirmed';r.current_arrangement:=r.proposal;r.proposal:=null;
  elsif p_input->>'outcome'='accepted' then r.status:='cancelled';r.current_arrangement:=null;r.proposal:=null;
  elsif r.pending_change->>'kind'='reschedule' and r.pending_change->>'memberAccepted'='true' then r.proposal:=null;r.status:=case when r.current_arrangement is not null then 'confirmed' else 'requested' end;
  else r.status:=case when r.proposal is not null then 'provider-proposed' when r.current_arrangement is not null then 'confirmed' else 'requested' end;end if;
  r.pending_change:=null;
 else raise insufficient_privilege using message='Command unavailable';end if;
 update public.patient_test_requests set revision=revision+1,status=r.status,proposal=r.proposal,current_arrangement=r.current_arrangement,pending_change=r.pending_change,updated_at=now() where id=r.id returning * into r;
 result:=public.patient_test_request_dto(r);
 insert into public.patient_test_request_events(request_id,command_id,actor_id,revision,operation,payload,result) values(r.id,p_command_id,p_actor,r.revision,p_operation,payload,result);
 return result;
end $$;
