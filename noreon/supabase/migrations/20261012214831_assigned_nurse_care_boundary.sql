-- Nurses collect evidence and coordinate assigned care; clinical authority remains doctor-only.
alter table public.workspace_staff drop constraint workspace_staff_role_check;
alter table public.workspace_staff add constraint workspace_staff_role_check check(role in ('admin','doctor','nurse'));
alter table public.workspace_cases add column assigned_nurse_id uuid references public.workspace_staff(user_id) on delete set null;
alter table public.patient_clinical_cases add column assigned_nurse_id uuid references public.workspace_staff(user_id) on delete set null;
create index workspace_cases_nurse on public.workspace_cases(assigned_nurse_id,expires_at);
create index patient_clinical_cases_nurse on public.patient_clinical_cases(assigned_nurse_id);

create function public.staff_care_access(p_id uuid,p_actor uuid,p_native boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare d uuid;n uuid;
begin
 if p_native then select assigned_doctor_id,assigned_nurse_id into d,n from public.patient_clinical_cases where user_id=p_id;
 else select assigned_doctor_id,assigned_nurse_id into d,n from public.workspace_cases where id=p_id and expires_at>now();end if;
 return exists(select 1 from public.workspace_staff s join public.workspace_clinics k on k.id=s.clinic_id
 where s.user_id=p_actor and s.active and k.active and ((s.role='doctor' and s.user_id=d) or
 (s.role='nurse' and s.user_id=n and exists(select 1 from public.workspace_staff doctor where doctor.user_id=d and doctor.role='doctor' and doctor.active and doctor.clinic_id=s.clinic_id))));
end $$;
revoke all on function public.staff_care_access(uuid,uuid,boolean) from public,anon,authenticated;
grant execute on function public.staff_care_access(uuid,uuid,boolean) to service_role;

-- Changing the accountable doctor requires deliberate nurse reassignment.
create function public.clear_changed_doctor_nurse() returns trigger language plpgsql set search_path='' as $$
begin if new.assigned_doctor_id is distinct from old.assigned_doctor_id then new.assigned_nurse_id:=null;end if;return new;end $$;
create trigger clear_workspace_nurse before update of assigned_doctor_id on public.workspace_cases for each row execute function public.clear_changed_doctor_nurse();
create trigger clear_patient_nurse before update of assigned_doctor_id on public.patient_clinical_cases for each row execute function public.clear_changed_doctor_nurse();

create function public.assign_case_nurse(p_id uuid,p_actor uuid,p_revision bigint,p_nurse uuid default null,p_native boolean default false) returns bigint
language plpgsql security definer set search_path='' as $$
declare d uuid;r bigint;
begin
 if p_native then select assigned_doctor_id,revision into d,r from public.patient_clinical_cases where user_id=p_id for update;
 else select assigned_doctor_id,revision into d,r from public.workspace_cases where id=p_id and expires_at>now() for update;end if;
 if not found then raise insufficient_privilege using message='Case unavailable';end if;
 perform 1 from public.workspace_staff where user_id=p_actor and role='admin' and active for share;
 if not found then raise insufficient_privilege using message='Administrator required';end if;
 if r is distinct from p_revision then raise serialization_failure using message='Case changed';end if;
 if p_nurse is not null then
  perform 1 from public.workspace_staff n join public.workspace_staff doctor on doctor.user_id=d join public.workspace_clinics k on k.id=n.clinic_id
  where n.user_id=p_nurse and n.role='nurse' and n.active and doctor.role='doctor' and doctor.active and doctor.clinic_id=n.clinic_id and k.active for share of n,doctor,k;
  if not found then raise insufficient_privilege using message='Choose an active nurse in the assigned doctor clinic';end if;
 end if;
 if p_native then
  update public.patient_clinical_cases set assigned_nurse_id=p_nurse,revision=revision+1,updated_at=now() where user_id=p_id returning revision into r;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail) values(p_id,r,'nurse-assigned',p_actor,jsonb_build_object('nurseId',p_nurse));
 else
  perform public.workspace_set_actor(p_actor,p_id);
  update public.workspace_cases set assigned_nurse_id=p_nurse,revision=revision+1 where id=p_id returning revision into r;
  perform public.workspace_record_event(p_id,'nurse-assignment.changed',r::integer);
 end if;return r;
end $$;
revoke all on function public.assign_case_nurse(uuid,uuid,bigint,uuid,boolean) from public,anon,authenticated;
grant execute on function public.assign_case_nurse(uuid,uuid,bigint,uuid,boolean) to service_role;
create function public.assign_patient_case_nurse(p_id uuid,p_revision bigint,p_nurse uuid default null) returns bigint
language sql security definer set search_path='' as $$select public.assign_case_nurse(p_id,auth.uid(),p_revision,p_nurse,true)$$;
revoke all on function public.assign_patient_case_nurse(uuid,bigint,uuid) from public,anon,service_role;
grant execute on function public.assign_patient_case_nurse(uuid,bigint,uuid) to authenticated;

create table public.staff_care_notes(
 id uuid primary key default gen_random_uuid(),workspace_case_id uuid references public.workspace_cases(id) on delete cascade,
 patient_case_id uuid references public.patient_clinical_cases(user_id) on delete cascade,
 actor_id uuid not null references public.workspace_staff(user_id),actor_name text not null,actor_role text not null,
 kind text not null check(kind in ('measurement','evidence','contact-attempted','reached','unreachable','refer-doctor')),
 note text not null check(length(note)<=2000),detail jsonb not null default '{}',created_at timestamptz not null default now(),
 check(num_nonnulls(workspace_case_id,patient_case_id)=1)
);
alter table public.staff_care_notes enable row level security;
revoke all on public.staff_care_notes from public,anon,authenticated,service_role;
grant select on public.staff_care_notes to service_role;

create function public.staff_care_command(p_id uuid,p_actor uuid,p_revision bigint,p_native boolean,p_operation text,p_input jsonb) returns bigint
language plpgsql security definer set search_path='' as $$
declare r bigint;s public.workspace_staff;m uuid;saved public.patient_measurements;submission uuid;measured timestamptz;sys integer;dia integer;pulse integer;note text;kind text;
begin
 if p_native then
  -- Match clinical publication's source-before-case lock order.
  perform public.lock_patient_clinical_sources(p_id);
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
revoke all on function public.staff_care_command(uuid,uuid,bigint,boolean,text,jsonb) from public,anon,authenticated;
grant execute on function public.staff_care_command(uuid,uuid,bigint,boolean,text,jsonb) to service_role;
create function public.patient_staff_care_command(p_id uuid,p_revision bigint,p_operation text,p_input jsonb) returns bigint
language sql security definer set search_path='' as $$select public.staff_care_command(p_id,auth.uid(),p_revision,true,p_operation,p_input)$$;
revoke all on function public.patient_staff_care_command(uuid,bigint,text,jsonb) from public,anon,service_role;
grant execute on function public.patient_staff_care_command(uuid,bigint,text,jsonb) to authenticated;

-- Native nurses read explicitly assigned raw evidence, never a private treatment draft.
alter function public.patient_clinical_case_snapshot(uuid) rename to patient_clinical_case_snapshot_doctor;
revoke all on function public.patient_clinical_case_snapshot_doctor(uuid) from public,anon,authenticated,service_role;
create function public.patient_clinical_case_snapshot(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;c public.patient_clinical_cases;e jsonb;
begin
 if public.real_clinical_staff_identity()->>'role'='nurse' then
  if not public.staff_care_access(p_user_id,auth.uid(),true) then raise insufficient_privilege using message='Assigned care access required';end if;
  select * into c from public.patient_clinical_cases where user_id=p_user_id;e:=public.patient_clinical_evidence(p_user_id);
  s:=jsonb_build_object('id',c.user_id,'revision',c.revision,'evidenceToken',e->>'token','evidence',e->'data','draft',null,'draftSavedAt',null,'draftStale',false,'review',null,'publications','[]'::jsonb);
 else s:=public.patient_clinical_case_snapshot_doctor(p_user_id);end if;
 return s||jsonb_build_object('careNotes',(select coalesce(jsonb_agg(to_jsonb(n)-'workspace_case_id'-'patient_case_id' order by n.created_at desc),'[]') from public.staff_care_notes n where patient_case_id=p_user_id));
end $$;
revoke all on function public.patient_clinical_case_snapshot(uuid) from public,anon,service_role;
grant execute on function public.patient_clinical_case_snapshot(uuid) to authenticated;
create or replace function public.patient_clinical_case_queue() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare staff jsonb:=public.real_clinical_staff_identity();result jsonb;
begin
 if staff is null then raise insufficient_privilege using message='Active staff membership required';end if;
 select coalesce(jsonb_agg(to_jsonb(q) order by q."createdAt",q.id),'[]') into result from (
 select c.user_id id,p.display_name name,c.revision,c.assigned_doctor_id "doctorId",c.assigned_nurse_id "nurseId",c.created_at "createdAt"
 from public.patient_clinical_cases c join public.profiles p on p.id=c.user_id
 where staff->>'role'='admin' or public.staff_care_access(c.user_id,auth.uid(),true)
 order by c.created_at,c.user_id limit 200) q;return result;
end $$;

create or replace function public.workspace_followup_contact(p_id uuid,p_actor uuid,p_expected_revision integer,p_requirement uuid,p_outcome text,p_note text) returns integer
language plpgsql security definer set search_path='' as $$
declare c public.workspace_cases;s public.workspace_staff;task uuid;
begin
 select * into c from public.workspace_cases where id=p_id and expires_at>now() for update;
 if not found or c.revision is distinct from p_expected_revision then raise exception 'workspace case conflict';end if;
 select * into s from public.workspace_staff where user_id=p_actor and active for share;
 if not found or s.role not in ('admin','doctor','nurse') then raise exception 'forbidden';end if;
 if s.role='doctor' then perform public.workspace_review_doctor(p_id,p_actor);end if;
 if s.role='nurse' and not public.staff_care_access(p_id,p_actor,false) then raise insufficient_privilege using message='Assigned care access required';end if;
 if p_outcome is null or p_outcome not in ('attempted','reached','unreachable','referred') or p_note is null or length(btrim(p_note)) not between 1 and 1500 then raise exception 'Enter a contact outcome and note.';end if;
 perform public.workspace_reconcile_monitoring(p_id);
 if not exists(select 1 from public.workspace_followup_work w join public.workspace_monitoring_requirements r on r.id=w.requirement_id where w.case_id=p_id and w.requirement_id=p_requirement and w.status='open' and r.status='active') then raise exception 'This follow-up is no longer open.';end if;
 if p_outcome='referred' then
  if exists(select 1 from public.workspace_followup_review_links where requirement_id=p_requirement and event='referred') then return (select revision from public.workspace_cases where id=p_id);end if;
  task:=public.workspace_reconcile_review_task(p_id,true,'monitoring.referred');
  insert into public.workspace_followup_review_links(case_id,requirement_id,review_task_id,event) values(p_id,p_requirement,task,'referred');
 end if;
 insert into public.workspace_followup_events(requirement_id,kind,actor_id,actor_label,note) values(p_requirement,p_outcome,p_actor,s.display_name,btrim(p_note));
 perform public.workspace_set_actor(p_actor,p_id);
 update public.workspace_cases set revision=revision+1 where id=p_id returning revision into c.revision;
 return c.revision;
end $$;

create function public.patient_clinical_nurse_directory() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if public.real_clinical_staff_identity()->>'role' is distinct from 'admin' then raise insufficient_privilege using message='Administrator required';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('id',s.user_id,'name',s.display_name,'clinic',c.name,'clinicId',c.id) order by s.display_name,s.user_id),'[]') from public.workspace_staff s join public.workspace_clinics c on c.id=s.clinic_id where s.role='nurse' and s.active and c.active);
end $$;
revoke all on function public.patient_clinical_nurse_directory() from public,anon,service_role;
grant execute on function public.patient_clinical_nurse_directory() to authenticated;
