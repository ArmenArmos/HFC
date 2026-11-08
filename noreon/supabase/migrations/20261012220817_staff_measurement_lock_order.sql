-- Keep ordinary staff measurement writes independent across cases.
create or replace function public.staff_care_command(p_id uuid,p_actor uuid,p_revision bigint,p_native boolean,p_operation text,p_input jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare r bigint;s public.workspace_staff;m uuid;saved public.patient_measurements;submission uuid;measured timestamptz;sys integer;dia integer;pulse integer;note text;kind text;
begin
 if p_native then
  -- Evidence collection writes a source table. Do not take publication's table SHARE lock:
  -- concurrent measurements would otherwise need conflicting lock upgrades. Publication
  -- itself takes the case lock NOWAIT, so a simultaneous collection fails that review safely.
  perform 1 from auth.users where id=p_id and phone is not null and phone_confirmed_at is not null for share;
  if not found then raise insufficient_privilege using message='Verified member required';end if;
  select revision into r from public.patient_clinical_cases where user_id=p_id for update;
 else select revision into r from public.workspace_cases where id=p_id and expires_at>now() for update;end if;
 if not found then raise insufficient_privilege using message='Assigned care access required';end if;
 -- Lock access rows so deactivation/clinic changes cannot race the authorized write.
 perform 1 from public.workspace_staff t join public.workspace_clinics k on k.id=t.clinic_id where t.user_id=p_actor for share of t,k;
 perform 1 from public.workspace_staff doctor where doctor.user_id=case when p_native then (select assigned_doctor_id from public.patient_clinical_cases where user_id=p_id) else (select assigned_doctor_id from public.workspace_cases where id=p_id) end for share;
 if not public.staff_care_access(p_id,p_actor,p_native) then raise insufficient_privilege using message='Assigned care access required';end if;
 select * into s from public.workspace_staff where user_id=p_actor;
 if r is distinct from p_revision then raise serialization_failure using message='Case changed';end if;
 if p_operation='measurement' then
  submission:=(p_input->>'submissionId')::uuid;measured:=(p_input->>'measuredAt')::timestamptz;sys:=(p_input->>'systolic')::integer;dia:=(p_input->>'diastolic')::integer;pulse:=(p_input->>'pulse')::integer;
  if submission is null or measured is null or not isfinite(measured) or measured>now()+interval '5 minutes' or sys is null or sys not between 60 and 300 or dia is null or dia not between 30 and 200 or dia>=sys or (pulse is not null and pulse not between 20 and 250) then raise exception 'Invalid measurement';end if;
  if p_native then
   insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at) values(p_id,submission,sys,dia,pulse,measured)
   on conflict(user_id,submission_id) do nothing returning * into saved;
   if saved.id is null then
    select * into saved from public.patient_measurements where user_id=p_id and submission_id=submission;
    if saved.systolic is distinct from sys or saved.diastolic is distinct from dia or saved.pulse is distinct from pulse or saved.measured_at is distinct from measured then raise exception 'Measurement conflict';end if;
    return r;
   end if;m:=saved.id;
  else
   if exists(select 1 from public.workspace_accepted_readings where case_id=p_id and submission_id=submission) then
    perform public.workspace_accept_reading(p_id,submission,measured,sys,dia,pulse);return r;
   end if;
   m:=public.workspace_accept_reading(p_id,submission,measured,sys,dia,pulse);
  end if;
  kind:='measurement';note:='Blood pressure measurement recorded';
 elsif p_operation='note' then
  kind:=p_input->>'kind';note:=btrim(p_input->>'note');
  if kind is null or kind not in ('evidence','contact-attempted','reached','unreachable','refer-doctor') or note is null or length(note) not between 1 and 2000 then raise exception 'Enter an evidence or contact note';end if;
 else raise insufficient_privilege using message='Care command unavailable';end if;
 insert into public.staff_care_notes(workspace_case_id,patient_case_id,actor_id,actor_name,actor_role,kind,note,detail)
 values(case when not p_native then p_id end,case when p_native then p_id end,p_actor,s.display_name,s.role,kind,note,case when m is null then '{}'::jsonb else jsonb_build_object('measurementId',m) end);
 if p_native then
  update public.patient_clinical_cases set revision=revision+1,updated_at=now() where user_id=p_id returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_id,r,'care-'||kind,p_actor,jsonb_build_object('measurementId',m));
 else
  if kind='refer-doctor' then perform public.workspace_reconcile_review_task(p_id,true,'care.referred');end if;
  perform public.workspace_set_actor(p_actor,p_id);
  update public.workspace_cases set revision=revision+1 where id=p_id returning revision into r;
  perform public.workspace_record_event(p_id,'care.'||kind,r::integer);
 end if;return r;
end $$;
