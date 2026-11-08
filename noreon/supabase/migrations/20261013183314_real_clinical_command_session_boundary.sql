-- Route every assigned clinical mutation through the managed-session boundary,
-- including authenticated review commands, while preserving clinical hold logic.
alter function public.lock_assigned_clinical_case(uuid,uuid,bigint,text) rename to lock_assigned_clinical_case_before_managed_session;
revoke all on function public.lock_assigned_clinical_case_before_managed_session(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
create function public.lock_assigned_clinical_case(p_user_id uuid,p_actor uuid,p_revision bigint,p_token text) returns public.patient_clinical_cases
language plpgsql security definer set search_path='' as $$
begin
 if not public._real_staff_managed_session_allowed(p_actor) then raise insufficient_privilege using message='Current doctor session required';end if;
 return public.lock_assigned_clinical_case_before_managed_session(p_user_id,p_actor,p_revision,p_token);
end $$;
revoke all on function public.lock_assigned_clinical_case(uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
