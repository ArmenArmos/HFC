-- Home visits while clinic scheduling is on and email is off (lead decision D2, 17 Oct): a home
-- visit stays a request in the admin booking queue (this legacy flow). Same as 20261016061002
-- except a member whose slot bookings are all cancelled (cancelled, withdrawn or declined by the
-- clinic) may request one; any live slot booking still fences it. The app allows this only for
-- home requests with the portal channel on and email off.
create or replace function public.create_patient_test_request(p_user_id uuid,p_request_id uuid,p_context_token text,p_terms jsonb,p_requirements jsonb,p_algorithm_version text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare replay boolean;result jsonb;
begin
 perform public.lock_patient_clinical_sources(p_user_id);
 perform 1 from public.patient_clinical_cases where user_id=p_user_id for update nowait;
 perform 1 from public.patient_test_requests where id=p_request_id and user_id=p_user_id for update nowait;
 replay:=found;
 if exists(select 1 from public.booking_legacy_conversions where legacy_id=p_request_id)then
  raise insufficient_privilege using message='This request uses the scheduling email pilot';
 end if;
 -- Delegate retains all baseline clinical validation, canonical payload replay,
 -- first enrollment, enrollment event and requested/preference semantics.
 result:=public._legacy_create_patient_test_request(p_user_id,p_request_id,p_context_token,p_terms,p_requirements,p_algorithm_version);
 -- The delegate now holds the SAME case UPDATE lock as pilot selection, including
 -- first enrollment. Recheck here, not before delegation: any conflict rolls back
 -- its request/event/enrollment together. No extra opposite-order advisory lock.
 if not replay and exists(select 1 from public.booking_appointments where member_id=p_user_id and status<>'cancelled')then
  raise serialization_failure using message='Reconcile the existing pilot appointment before creating a manual request';
 end if;
 return result;
end$$;
