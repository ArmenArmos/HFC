-- Enrolment backfill (Fable #277 F4). Run by the integrator on prod-as-staging after #277 merges,
-- and again whenever needed. Rehearse first (the default rolls back), then apply:
--   psql "$DB_URL" -v apply=0 -f docs/operations/enrolment-backfill.sql   # rehearse: counts, rolled back
--   psql "$DB_URL" -v apply=1 -f docs/operations/enrolment-backfill.sql   # apply: commits
-- psql only: the file uses psql meta-commands (\if, \set, \echo), so it does not run in the
-- Supabase SQL editor. Use psql with the database connection string (or docker exec ... psql locally).
--
-- 1. Members who finished the questionnaire (or reached a red flag) but have no case are enrolled
--    by enroll_patient_clinical_case() itself, acting as each member: the same eligibility checks,
--    case, events, doctor and nurse as at enrolment. A member it refuses is skipped and counted.
-- 2. Cases with a doctor but no nurse get the least-loaded active nurse in the doctor's clinic
--    (_auto_assign_nurse), audited as a system 'nurse-assigned' event (reason backfill_least_loaded).
--    This also refills a nurse cleared when an admin changed the doctor (clear_patient_nurse):
--    admins can instead pick a nurse on the member file, as before.
\if :{?apply}
\else
\set apply 0
\endif
\set ON_ERROR_STOP on
begin;
create temp table backfill_counts(step text primary key,n bigint);
insert into backfill_counts select 'before: finished, no case',count(*) from public.patient_assessments a
 where(a.completed_at is not null or a.urgent_rule is not null)and not exists(select 1 from public.patient_clinical_cases c where c.user_id=a.user_id);
insert into backfill_counts select 'before: doctor, no nurse',count(*) from public.patient_clinical_cases where assigned_doctor_id is not null and assigned_nurse_id is null;

do $$declare m uuid;done bigint:=0;skipped bigint:=0;begin
 for m in select a.user_id from public.patient_assessments a
  where(a.completed_at is not null or a.urgent_rule is not null)and not exists(select 1 from public.patient_clinical_cases c where c.user_id=a.user_id)
  order by a.user_id loop
  begin
   perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated')::text,true);
   perform public.enroll_patient_clinical_case();
   done:=done+1;
  exception when insufficient_privilege then skipped:=skipped+1;
  end;
 end loop;
 perform set_config('request.jwt.claims','',true);
 insert into backfill_counts values('enrolled',done),('refused (profile or consent incomplete)',skipped);
end$$;

do $$declare c record;nurse uuid;n bigint;done bigint:=0;none bigint:=0;begin
 perform pg_advisory_xact_lock(hashtextextended('auto-assign-doctor',0));
 for c in select user_id,assigned_doctor_id from public.patient_clinical_cases where assigned_doctor_id is not null and assigned_nurse_id is null order by created_at,user_id for update loop
  nurse:=public._auto_assign_nurse(c.assigned_doctor_id);
  if nurse is not null then
   perform 1 from public.workspace_staff s join public.workspace_staff d on d.user_id=c.assigned_doctor_id join public.workspace_clinics k on k.id=s.clinic_id
    where s.user_id=nurse and s.role='nurse'and s.active and s.removed_at is null and d.clinic_id=s.clinic_id and k.active for share of s,k;
   if not found then nurse:=null;end if;
  end if;
  if nurse is null then none:=none+1;continue;end if;
  update public.patient_clinical_cases set assigned_nurse_id=nurse,revision=revision+1,updated_at=now() where user_id=c.user_id returning revision into n;
  insert into public.patient_clinical_case_events(user_id,revision,kind,actor_id,detail)
  values(c.user_id,n,'nurse-assigned',c.user_id,jsonb_build_object('nurseId',nurse,'by','system','reason','backfill_least_loaded'));
  done:=done+1;
 end loop;
 insert into backfill_counts values('nurses assigned',done),('no eligible nurse',none);
end$$;

insert into backfill_counts select 'after: finished, no case',count(*) from public.patient_assessments a
 where(a.completed_at is not null or a.urgent_rule is not null)and not exists(select 1 from public.patient_clinical_cases c where c.user_id=a.user_id);
insert into backfill_counts select 'after: doctor, no nurse',count(*) from public.patient_clinical_cases where assigned_doctor_id is not null and assigned_nurse_id is null;
select step,n from backfill_counts order by step;
\if :apply
commit;
\echo 'enrolment backfill: APPLIED'
\else
rollback;
\echo 'enrolment backfill: rehearsal only (rolled back); rerun with -v apply=1'
\endif
