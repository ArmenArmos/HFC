-- Member Home care team: a member sees only their own assigned doctor's display name, rolled back. Synthetic fixtures only.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(p_id uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated')::text,true);end$$;
create function pg_temp.team(p_id uuid)returns jsonb language plpgsql as $$declare r jsonb;begin
 perform pg_temp.as_user(p_id);set local role authenticated;r:=public.patient_care_team();reset role;return r;end$$;

insert into auth.users(id,email)values('d2330000-0000-4000-8000-0000000000d1','d@example.invalid'),('d2330000-0000-4000-8000-0000000000a1','a@example.invalid'),('d2330000-0000-4000-8000-0000000000b1','b@example.invalid'),('d2330000-0000-4000-8000-0000000000c1','c@example.invalid');
insert into public.workspace_clinics(id,name,active)values('d2330000-0000-4000-8000-000000000001','Synthetic clinic',true),('d2330000-0000-4000-8000-000000000002','Synthetic closed clinic',false);
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values
 ('d2330000-0000-4000-8000-0000000000a1','doctor','Dr Synthetic A','d2330000-0000-4000-8000-000000000001',true),
 ('d2330000-0000-4000-8000-0000000000b1','doctor','Dr Synthetic B','d2330000-0000-4000-8000-000000000001',true),
 ('d2330000-0000-4000-8000-0000000000c1','doctor','Dr Synthetic C','d2330000-0000-4000-8000-000000000001',false),
 ('d2330000-0000-4000-8000-0000000000d1','doctor','Dr Synthetic D','d2330000-0000-4000-8000-000000000002',true);
-- Members: 1 with doctor A, 2 with doctor B, 3 enrolled without a doctor, 4 not enrolled,
-- 5 phone not confirmed (with doctor A), 6 with the inactive doctor C.
insert into auth.users(id,phone,phone_confirmed_at)values
 ('d2330000-0000-4000-8000-000000000101','37499023301',now()),('d2330000-0000-4000-8000-000000000102','37499023302',now()),
 ('d2330000-0000-4000-8000-000000000103','37499023303',now()),('d2330000-0000-4000-8000-000000000104','37499023304',now()),
 ('d2330000-0000-4000-8000-000000000105','37499023305',null),('d2330000-0000-4000-8000-000000000106','37499023306',now()),('d2330000-0000-4000-8000-000000000107','37499023307',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values
 ('d2330000-0000-4000-8000-000000000101','d2330000-0000-4000-8000-0000000000a1'),('d2330000-0000-4000-8000-000000000102','d2330000-0000-4000-8000-0000000000b1'),
 ('d2330000-0000-4000-8000-000000000103',null),('d2330000-0000-4000-8000-000000000105','d2330000-0000-4000-8000-0000000000a1'),
 ('d2330000-0000-4000-8000-000000000106','d2330000-0000-4000-8000-0000000000c1'),('d2330000-0000-4000-8000-000000000107','d2330000-0000-4000-8000-0000000000d1');

select pg_temp.ok(pg_temp.team('d2330000-0000-4000-8000-000000000101')='{"doctor":{"name":"Dr Synthetic A"}}'::jsonb,'Member sees own doctor name only');
select pg_temp.ok(pg_temp.team('d2330000-0000-4000-8000-000000000102')->'doctor'->>'name'='Dr Synthetic B','Second member sees their own doctor, not the first');
select pg_temp.ok(pg_temp.team('d2330000-0000-4000-8000-000000000103')='{"doctor":null}'::jsonb,'No doctor yet');
select pg_temp.ok(pg_temp.team('d2330000-0000-4000-8000-000000000104') is null,'Not enrolled: nothing');
select pg_temp.ok(pg_temp.team('d2330000-0000-4000-8000-000000000105') is null,'Phone not confirmed: nothing');
select pg_temp.ok(pg_temp.team('d2330000-0000-4000-8000-000000000106')='{"doctor":null}'::jsonb,'Inactive doctor is not shown');
select pg_temp.ok(pg_temp.team('d2330000-0000-4000-8000-000000000107')='{"doctor":null}'::jsonb,'Doctor in an inactive clinic is not shown');
-- A staff account (no case) gets nothing.
select pg_temp.ok(pg_temp.team('d2330000-0000-4000-8000-0000000000a1') is null,'Staff without a case: nothing');
-- Anonymous callers cannot execute it.
select pg_temp.ok(not has_function_privilege('anon','public.patient_care_team()','execute'),'anon cannot execute');
select pg_temp.ok(has_function_privilege('authenticated','public.patient_care_team()','execute'),'authenticated can execute');
-- The result never carries ids, clinic or contact details.
select pg_temp.ok((select count(*)=1 from jsonb_object_keys(pg_temp.team('d2330000-0000-4000-8000-000000000101')->'doctor')),'Only the name key');

-- Care-team save (quality review 18 Oct, aB-1): changing the doctor clears the nurse (trigger clear_patient_nurse), so the
-- admin dialog sends the kept nurse again with the revision the doctor save returned. This is the database half of
-- scripts/check-care-team-save.ts: the nurse is gone after the doctor change and is kept after the second call.
insert into auth.users(id,email)values('d2330000-0000-4000-8000-0000000000e1','n@example.invalid'),('d2330000-0000-4000-8000-0000000000f1','adm@example.invalid');
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values
 ('d2330000-0000-4000-8000-0000000000e1','nurse','Nurse Synthetic E','d2330000-0000-4000-8000-000000000001',true),
 ('d2330000-0000-4000-8000-0000000000f1','admin','Admin Synthetic F',null,true);
select public.assign_case_nurse('d2330000-0000-4000-8000-000000000101','d2330000-0000-4000-8000-0000000000f1',
 (select revision from public.patient_clinical_cases where user_id='d2330000-0000-4000-8000-000000000101'),'d2330000-0000-4000-8000-0000000000e1',true);
select pg_temp.ok((select assigned_nurse_id='d2330000-0000-4000-8000-0000000000e1' from public.patient_clinical_cases where user_id='d2330000-0000-4000-8000-000000000101'),'Nurse assigned with doctor A');
-- The doctor save (same write as assign_patient_clinical_case): doctor A -> doctor B, same clinic.
update public.patient_clinical_cases set assigned_doctor_id='d2330000-0000-4000-8000-0000000000b1',revision=revision+1 where user_id='d2330000-0000-4000-8000-000000000101';
select pg_temp.ok((select assigned_nurse_id is null from public.patient_clinical_cases where user_id='d2330000-0000-4000-8000-000000000101'),'Doctor change clears the nurse in the database');
-- The dialog's second call: the kept nurse with the returned revision.
select pg_temp.ok(public.assign_case_nurse('d2330000-0000-4000-8000-000000000101','d2330000-0000-4000-8000-0000000000f1',
 (select revision from public.patient_clinical_cases where user_id='d2330000-0000-4000-8000-000000000101'),'d2330000-0000-4000-8000-0000000000e1',true)>0,'Kept nurse re-sent after the doctor change');
select pg_temp.ok((select assigned_doctor_id='d2330000-0000-4000-8000-0000000000b1' and assigned_nurse_id='d2330000-0000-4000-8000-0000000000e1' from public.patient_clinical_cases where user_id='d2330000-0000-4000-8000-000000000101'),'New doctor and the kept nurse both saved');
-- A stale revision (the one from before the doctor change) is refused rather than silently applied.
do $$begin perform public.assign_case_nurse('d2330000-0000-4000-8000-000000000101','d2330000-0000-4000-8000-0000000000f1',0,'d2330000-0000-4000-8000-0000000000e1',true);
 raise exception 'FAIL: stale revision accepted';exception when serialization_failure then null;end$$;
-- A kept nurse that does not fit the new doctor's clinic is refused, so the dialog reports it.
update public.patient_clinical_cases set assigned_doctor_id='d2330000-0000-4000-8000-0000000000d1',revision=revision+1 where user_id='d2330000-0000-4000-8000-000000000101';
do $$begin perform public.assign_case_nurse('d2330000-0000-4000-8000-000000000101','d2330000-0000-4000-8000-0000000000f1',
 (select revision from public.patient_clinical_cases where user_id='d2330000-0000-4000-8000-000000000101'),'d2330000-0000-4000-8000-0000000000e1',true);
 raise exception 'FAIL: nurse from another clinic accepted';exception when insufficient_privilege then null;end$$;
rollback;
\echo 'Member care team: own assigned doctor name only; no doctor, inactive doctor or clinic, unconfirmed phone and anon are refused; a doctor change clears the nurse and the re-sent nurse is kept.'
