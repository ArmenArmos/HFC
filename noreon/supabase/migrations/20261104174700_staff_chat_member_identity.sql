-- Chat-only extension of the existing audited, assignment-scoped masked identity read.
-- The assigned doctor's clinic is the member's linked clinic, never the viewing staff's clinic.
create function public.staff_chat_member_identities(p_members uuid[]) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare masked jsonb;result jsonb;staff jsonb:=public.real_clinical_staff_identity();
begin
 masked:=public.staff_member_identities(p_members);
 select coalesce(jsonb_agg(r.value||jsonb_build_object(
  'sex',p.biological_sex,'clinic',k.name,'shortId',upper(right(c.user_id::text,8))
 )||case when public.staff_care_access(c.user_id,auth.uid(),true)
    and u.phone_confirmed_at is not null and phone.digits~'^[0-9]{4,15}$'
   then jsonb_build_object('phone','+'||phone.digits) else '{}'::jsonb end
 order by r.ordinality),'[]'::jsonb) into result
 from jsonb_array_elements(masked) with ordinality r(value,ordinality)
 join public.patient_clinical_cases c on c.user_id=(r.value->>'id')::uuid
 join public.profiles p on p.id=c.user_id
 left join public.workspace_staff d on d.user_id=c.assigned_doctor_id
 left join public.workspace_clinics k on k.id=d.clinic_id
 left join auth.users u on u.id=c.user_id and u.phone_confirmed_at is not null
 cross join lateral(select regexp_replace(u.phone,'[^0-9]','','g') as digits)phone;
 -- Follow _access_audit_record's actor/role/session pattern, but include every
 -- requested ID. That helper skips self-reads; even a probe of the actor's own
 -- nonexistent member ID must leave an audit here. Outcomes never enter the response.
 insert into public.access_audit(actor_id,actor_role,member_id,surface,object_id,session_id)
 select auth.uid(),staff->>'role',requested.id,'chat_member_identities',
  case when exists(select 1 from jsonb_array_elements(result) r where (r->>'id')::uuid=requested.id)
   then case when public.staff_care_access(requested.id,auth.uid(),true) then 'allowed' else 'admin-masked' end
   when exists(select 1 from public.patient_clinical_cases c where c.user_id=requested.id) then 'not assigned'
   else 'not found' end,
  left(auth.jwt()->>'session_id',80)
 from (select distinct unnest(p_members) as id) requested;
 return result;
end $$;
revoke all on function public.staff_chat_member_identities(uuid[]) from public,anon,authenticated,service_role;
grant execute on function public.staff_chat_member_identities(uuid[]) to authenticated;
