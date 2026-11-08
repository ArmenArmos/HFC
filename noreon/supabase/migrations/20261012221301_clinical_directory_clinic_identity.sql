-- Clinic names are display text; assignment pickers compare stable clinic identity.
create or replace function public.patient_clinical_doctor_directory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.real_clinical_staff_identity()->>'role' is distinct from 'admin' then raise insufficient_privilege using message='Administrator required';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.display_name,'clinic',c.name,'clinicId',c.id) order by s.display_name,s.user_id),'[]') from public.workspace_staff s join public.workspace_clinics c on c.id=s.clinic_id where s.role='doctor' and s.active and c.active);
end $$;
