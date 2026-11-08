-- Preserve the historical command's ORIGINAL authorization/session semantics.
-- The new pilot guard must not retroactively alter existing provider-flow rows.
-- The private delegate still performs its original actor/staff/source checks.
create or replace function public.command_patient_test_request(p_user_id uuid,p_actor uuid,p_staff boolean,p_id uuid,p_revision bigint,p_command_id uuid,p_operation text,p_input jsonb)returns jsonb
language plpgsql security definer set search_path='' as $$begin
 if exists(select 1 from public.booking_legacy_conversions where legacy_id=p_id)then raise insufficient_privilege using message='This request uses the scheduling email pilot';end if;
 return public._legacy_command_patient_test_request(p_user_id,p_actor,p_staff,p_id,p_revision,p_command_id,p_operation,p_input);
end $$;
