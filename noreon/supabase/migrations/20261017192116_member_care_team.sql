-- Member Home "Your care team" (Khikar, 17 Oct): a member may see the display name
-- of the one doctor assigned to their own case, and nothing else about staff.
-- Same gate as patient_clinical_case_status: own case only, phone-confirmed member.
-- An inactive or removed doctor, or one whose clinic is inactive, is not shown (the
-- member then sees "being assigned"), matching how doctors are assigned and listed.
create or replace function public.patient_care_team() returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('doctor',
   case when s.user_id is null then null else jsonb_build_object('name',s.display_name) end)
 from public.patient_clinical_cases c
 left join public.workspace_staff s
   on s.user_id=c.assigned_doctor_id and s.role='doctor' and s.active and s.removed_at is null
   and exists(select 1 from public.workspace_clinics k where k.id=s.clinic_id and k.active)
 where c.user_id=auth.uid()
 and exists(select 1 from auth.users u where u.id=auth.uid() and u.phone_confirmed_at is not null)
$$;
revoke all on function public.patient_care_team() from public,anon,authenticated,service_role;
grant execute on function public.patient_care_team() to authenticated;
