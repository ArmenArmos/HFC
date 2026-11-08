-- Exact operational totals across native records, independent of bounded queue pages.
-- No clinical evidence, member identifiers, provider payloads or payment data are returned.
create function public.real_admin_operations_summary() returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform public._real_staff_require_admin();
 -- One statement supplies one MVCC snapshot for all counts. Assignment means an
 -- assignment id is recorded; task owner eligibility follows the existing predicate.
 select jsonb_build_object(
  'asOf',statement_timestamp(),
  'cases',(select jsonb_build_object('total',count(*),
   'doctorAssigned',count(*) filter(where assigned_doctor_id is not null),
   'doctorUnassigned',count(*) filter(where assigned_doctor_id is null),
   'nurseAssigned',count(*) filter(where assigned_nurse_id is not null),
   'nurseUnassigned',count(*) filter(where assigned_nurse_id is null)) from public.patient_clinical_cases),
  'bookings',(select jsonb_build_object('total',count(*),
   'requested',count(*) filter(where status='requested'),
   'providerProposed',count(*) filter(where status='provider-proposed'),
   'confirmed',count(*) filter(where status='confirmed'),
   'changePending',count(*) filter(where status='change-pending'),
   'cancelled',count(*) filter(where status='cancelled')) from public.patient_test_requests),
  'coordination',(select jsonb_build_object('total',count(*),
   'open',count(*) filter(where status='open'),
   'awaitingMember',count(*) filter(where status='awaiting-member'),
   'awaitingDoctor',count(*) filter(where status='awaiting-doctor'),
   'completed',count(*) filter(where status='completed'),
   'cancelled',count(*) filter(where status='cancelled'),
   'needsReassignment',count(*) filter(where status not in ('completed','cancelled')
    and not public._patient_coordination_owner_valid(patient_case_id,owner_id,kind='doctor-referral')))
   from public.patient_coordination_tasks)
 ) into result;
 return result;
end $$;
revoke all on function public.real_admin_operations_summary() from public,anon,authenticated,service_role;
grant execute on function public.real_admin_operations_summary() to authenticated;
