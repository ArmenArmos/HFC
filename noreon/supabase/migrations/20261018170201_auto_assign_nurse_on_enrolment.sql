-- A nurse is assigned automatically at enrolment too (Khikar, 18 Oct 2026; lead's rule), so
-- home-visit notices no longer stop at 'no_nurse_assigned': the active nurse in the assigned
-- doctor's clinic (the care boundary admin assignment enforces) with the fewest assigned members,
-- ties broken by the oldest most recent assignment (never assigned first), then by id. Same
-- transaction, lock and FOR SHARE re-check as the doctor; audited as a 'nurse-assigned' case event
-- by the system. No doctor, or no eligible nurse: the nurse stays empty for an admin. Admins
-- reassign as before. Body otherwise unchanged from 20261017075219_auto_assign_doctor_on_enrolment.sql.

-- The nurse to assign next for a member of this doctor, or null.
create function public._auto_assign_nurse(p_doctor uuid)returns uuid language sql stable security definer set search_path=''as $$
 select s.user_id from public.workspace_staff s
 join public.workspace_staff d on d.user_id=p_doctor and d.clinic_id=s.clinic_id
 join public.workspace_clinics k on k.id=s.clinic_id and k.active
 where s.role='nurse'and s.active and s.removed_at is null
 order by(select count(*)from public.patient_clinical_cases c where c.assigned_nurse_id=s.user_id),
  (select max(e.created_at)from public.patient_clinical_case_events e where e.kind='nurse-assigned'and e.detail->>'nurseId'=s.user_id::text)asc nulls first,
  s.user_id
 limit 1
$$;
revoke all on function public._auto_assign_nurse(uuid)from public,anon,authenticated,service_role;

create or replace function public.enroll_patient_clinical_case() returns uuid
language plpgsql security definer set search_path='' as $$
declare uid uuid:=auth.uid();inserted uuid;doctor uuid;nurse uuid;n bigint;tries integer:=0;
begin
 if uid is null then raise insufficient_privilege using message='Verified membership required';end if;
 perform 1 from auth.users where id=uid and phone is not null and phone_confirmed_at is not null for share;
 if not found or not exists(select 1 from public.profiles where id=uid and nullif(btrim(display_name),'') is not null and birth_date is not null and biological_sex in ('male','female'))
 or not exists(select 1 from public.patient_consents where user_id=uid and version='patient-pilot-v1')
 or not exists(select 1 from public.patient_assessments where user_id=uid) then raise insufficient_privilege using message='Complete your verified profile and consent first';end if;
 insert into public.patient_clinical_cases(user_id) values(uid) on conflict do nothing returning user_id into inserted;
 if inserted is not null then
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id) values(uid,0,'enrolled',uid);
  -- Concurrent enrolments choose one at a time, so the load counts stay fair.
  perform pg_advisory_xact_lock(hashtextextended('auto-assign-doctor',0));
  -- Lock the chosen doctor with the full eligibility check, as admin assignment does: a doctor
  -- removed, moved or whose clinic closed meanwhile is not assigned; choose again (review F1).
  loop
   doctor:=public._auto_assign_doctor();tries:=tries+1;
   exit when doctor is null;
   perform 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id
    where s.user_id=doctor and s.role='doctor'and s.active and s.removed_at is null and k.active for share of s,k;
   exit when found;
   doctor:=null;
   exit when tries>=3;
  end loop;
  if doctor is not null then
   update public.patient_clinical_cases set assigned_doctor_id=doctor,revision=revision+1,updated_at=now() where user_id=uid returning revision into n;
   -- The case event needs an Auth actor: the enrolling member's own action, marked as the system's choice.
   insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
   values(uid,n,'assigned',uid,jsonb_build_object('doctorId',doctor,'by','system','reason','auto_least_loaded_on_enrolment'));
   -- The nurse comes after the doctor (clear_patient_nurse empties the nurse when the doctor
   -- changes) and from the doctor's clinic, as admin assignment requires (assign_case_nurse).
   tries:=0;
   loop
    nurse:=public._auto_assign_nurse(doctor);tries:=tries+1;
    exit when nurse is null;
    perform 1 from public.workspace_staff s join public.workspace_staff d on d.user_id=doctor join public.workspace_clinics k on k.id=s.clinic_id
     where s.user_id=nurse and s.role='nurse'and s.active and s.removed_at is null and d.clinic_id=s.clinic_id and k.active for share of s,k;
    exit when found;
    nurse:=null;
    exit when tries>=3;
   end loop;
   if nurse is not null then
    update public.patient_clinical_cases set assigned_nurse_id=nurse,revision=revision+1,updated_at=now() where user_id=uid returning revision into n;
    insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
    values(uid,n,'nurse-assigned',uid,jsonb_build_object('nurseId',nurse,'by','system','reason','auto_least_loaded_on_enrolment'));
   end if;
  end if;
 end if;
 return uid;
end $$;

-- The tie-break reads the latest automatic or admin nurse assignment per nurse.
create index patient_clinical_case_events_assigned_nurse on public.patient_clinical_case_events((detail->>'nurseId'),created_at)where kind='nurse-assigned';
