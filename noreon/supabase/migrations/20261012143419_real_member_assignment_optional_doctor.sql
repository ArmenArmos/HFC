-- Explicit unassignment may omit the optional doctor parameter.
create or replace function public.assign_patient_clinical_case(p_user_id uuid,p_expected_revision bigint,p_doctor_id uuid default null) returns bigint
language plpgsql security definer set search_path='' as $$
declare c public.patient_clinical_cases;n bigint;
begin
 perform 1 from public.workspace_staff where user_id=auth.uid() and role='admin' and active for share;
 if not found then raise insufficient_privilege using message='Administrator required';end if;
 select * into c from public.patient_clinical_cases where user_id=p_user_id for update;
 if not found then raise insufficient_privilege using message='Case unavailable';end if;
 if c.revision is distinct from p_expected_revision then raise serialization_failure using message='Case changed. Reload before assigning';end if;
 if p_doctor_id is not null then
  perform 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id where s.user_id=p_doctor_id and s.role='doctor' and s.active and k.active for share of s,k;
  if not found then raise insufficient_privilege using message='Choose an active doctor in an active clinic';end if;
 end if;
 if c.assigned_doctor_id is not distinct from p_doctor_id then return c.revision;end if;
 update public.patient_clinical_cases set assigned_doctor_id=p_doctor_id,revision=revision+1,updated_at=now() where user_id=p_user_id returning revision into n;
 insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_user_id,n,'assigned',auth.uid(),jsonb_build_object('doctorId',p_doctor_id));
 return n;
end $$;

