-- A single bounded operations projection. No clinical source/engine evaluation per case.
create or replace function public.patient_clinical_case_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare staff jsonb:=public.real_clinical_staff_identity();result jsonb;
begin
 if staff is null then raise insufficient_privilege using message='Active staff membership required';end if;
 with visible as materialized (
  select c.user_id,c.revision,c.assigned_doctor_id,c.assigned_nurse_id,c.created_at,p.display_name
  from public.patient_clinical_cases c join public.profiles p on p.id=c.user_id
  where staff->>'role'='admin' or public.staff_care_access(c.user_id,auth.uid(),true)
  order by c.created_at,c.user_id limit 200
 ), counts as (
  select r.user_id,count(*) filter(where r.status='requested') requested,
   count(*) filter(where r.status='provider-proposed') proposed,count(*) filter(where r.status='confirmed') confirmed,
   count(*) filter(where r.status='change-pending') pending
  from public.patient_test_requests r join visible v on v.user_id=r.user_id
  group by r.user_id
 )
 select coalesce(jsonb_agg(jsonb_build_object('id',v.user_id,'name',v.display_name,'revision',v.revision,
  'doctorId',v.assigned_doctor_id,'nurseId',v.assigned_nurse_id,'createdAt',v.created_at,
  'bookingCounts',jsonb_build_object('requested',coalesce(b.requested,0),'providerProposed',coalesce(b.proposed,0),
  'confirmed',coalesce(b.confirmed,0),'changePending',coalesce(b.pending,0))) order by v.created_at,v.user_id),'[]')
 into result from visible v left join counts b on b.user_id=v.user_id;
 return result;
end $$;
