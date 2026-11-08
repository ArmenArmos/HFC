-- A nurse is assigned automatically at enrolment (least loaded, in the doctor's clinic), rolled back. Synthetic fixtures only.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(p_id uuid)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);end$$;
create function pg_temp.member(p_id uuid,phone text)returns void language plpgsql as $$begin
 insert into auth.users(id,phone,phone_confirmed_at)values(p_id,phone,now());
 update public.profiles set display_name='Synthetic member',birth_date='1980-01-01',biological_sex='female'where id=p_id;
 insert into public.patient_consents(user_id,version)values(p_id,'patient-pilot-v1');
 insert into public.patient_assessments(user_id,revision,completed_at)values(p_id,2,now());end$$;
create function pg_temp.enrol(p_id uuid)returns void language plpgsql as $$begin
 perform pg_temp.as_user(p_id);set local role authenticated;perform public.enroll_patient_clinical_case();reset role;end$$;
create function pg_temp.nurse_of(p_id uuid)returns uuid language sql as $$select assigned_nurse_id from public.patient_clinical_cases where user_id=p_id$$;

-- One open clinic with Dr A; a second open clinic with Dr Z. Nurses in A's clinic: N3 inactive and
-- N5 removed (both sort first by id and load), N1 and N2 active; N4 active but in Z's clinic.
insert into auth.users(id,email)values('d2100000-0000-4000-8000-0000000000a1','a@example.invalid'),('d2100000-0000-4000-8000-0000000000f1','z@example.invalid'),
 ('d2100000-0000-4000-8000-000000000011','n1@example.invalid'),('d2100000-0000-4000-8000-000000000012','n2@example.invalid'),('d2100000-0000-4000-8000-000000000003','n3@example.invalid'),
 ('d2100000-0000-4000-8000-000000000004','n4@example.invalid'),('d2100000-0000-4000-8000-000000000005','n5@example.invalid'),('d2100000-0000-4000-8000-0000000000e1','e@example.invalid');
insert into public.workspace_clinics(id,name,active)values('d2100000-0000-4000-8000-000000000001','Synthetic clinic A',true),('d2100000-0000-4000-8000-000000000002','Synthetic clinic Z',true);
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values
 ('d2100000-0000-4000-8000-0000000000a1','doctor','Dr A','d2100000-0000-4000-8000-000000000001',true),
 ('d2100000-0000-4000-8000-0000000000f1','doctor','Dr Z','d2100000-0000-4000-8000-000000000002',false),
 ('d2100000-0000-4000-8000-000000000011','nurse','Nurse 1','d2100000-0000-4000-8000-000000000001',true),
 ('d2100000-0000-4000-8000-000000000012','nurse','Nurse 2','d2100000-0000-4000-8000-000000000001',true),
 ('d2100000-0000-4000-8000-000000000003','nurse','Nurse 3','d2100000-0000-4000-8000-000000000001',false),
 ('d2100000-0000-4000-8000-000000000004','nurse','Nurse 4','d2100000-0000-4000-8000-000000000002',true),
 ('d2100000-0000-4000-8000-000000000005','nurse','Nurse 5','d2100000-0000-4000-8000-000000000001',true),
 ('d2100000-0000-4000-8000-0000000000e1','admin','Admin E',null,true);
update public.workspace_staff set active=false,removed_at=now() where user_id='d2100000-0000-4000-8000-000000000005';
insert into auth.sessions(id,user_id,created_at,updated_at)values('d2100000-0000-4000-8000-0000000000e1','d2100000-0000-4000-8000-0000000000e1',now(),now());
-- Nurse 2 already has one member (assigned by an admin earlier, no event).
select pg_temp.member('d2100000-0000-4000-8000-000000000101','37499021101');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d2100000-0000-4000-8000-000000000101','d2100000-0000-4000-8000-0000000000a1');
update public.patient_clinical_cases set assigned_nurse_id='d2100000-0000-4000-8000-000000000012'where user_id='d2100000-0000-4000-8000-000000000101';

-- 1. Least loaded active nurse in the doctor's clinic: N1 (N2 has one; N3 inactive, N5 removed, N4 other clinic).
select pg_temp.member('d2100000-0000-4000-8000-000000000102','37499021102');
select pg_temp.enrol('d2100000-0000-4000-8000-000000000102');
select pg_temp.ok((select assigned_doctor_id='d2100000-0000-4000-8000-0000000000a1'from public.patient_clinical_cases where user_id='d2100000-0000-4000-8000-000000000102'),'Doctor assigned first');
select pg_temp.ok(pg_temp.nurse_of('d2100000-0000-4000-8000-000000000102')='d2100000-0000-4000-8000-000000000011','Least loaded eligible nurse assigned; inactive, removed and other-clinic nurses skipped');
select pg_temp.ok((select revision=2 from public.patient_clinical_cases where user_id='d2100000-0000-4000-8000-000000000102'),'Doctor then nurse: two revisions');
select pg_temp.ok((select detail->>'by'='system'and detail->>'reason'='auto_least_loaded_on_enrolment'and detail->>'nurseId'='d2100000-0000-4000-8000-000000000011'and revision=2
 from public.patient_clinical_case_events where user_id='d2100000-0000-4000-8000-000000000102'and kind='nurse-assigned'),'Nurse assignment audited as the system');
select pg_temp.enrol('d2100000-0000-4000-8000-000000000102');
select pg_temp.ok((select count(*)=1 from public.patient_clinical_case_events where user_id='d2100000-0000-4000-8000-000000000102'and kind='nurse-assigned'),'Repeat enrolment does not reassign the nurse');

-- 2. Tie (N1 and N2 one each): the nurse assigned least recently; N2 has no assignment event.
select pg_temp.member('d2100000-0000-4000-8000-000000000103','37499021103');
select pg_temp.enrol('d2100000-0000-4000-8000-000000000103');
select pg_temp.ok(pg_temp.nurse_of('d2100000-0000-4000-8000-000000000103')='d2100000-0000-4000-8000-000000000012','Tie goes to the nurse assigned least recently');

-- 3. An admin can still reassign the nurse.
select revision as rev from public.patient_clinical_cases where user_id='d2100000-0000-4000-8000-000000000103' \gset
select pg_temp.as_user('d2100000-0000-4000-8000-0000000000e1');set local role authenticated;
select pg_temp.ok(public.assign_patient_case_nurse('d2100000-0000-4000-8000-000000000103',:rev,'d2100000-0000-4000-8000-000000000011')>:rev,'Admin reassigns the nurse');
reset role;
select pg_temp.ok(pg_temp.nurse_of('d2100000-0000-4000-8000-000000000103')='d2100000-0000-4000-8000-000000000011','Nurse reassignment stored');

-- 4. No eligible nurse in the doctor's clinic: doctor assigned, nurse left empty, no nurse event.
update public.workspace_staff set active=false where role='nurse'and clinic_id='d2100000-0000-4000-8000-000000000001';
select pg_temp.member('d2100000-0000-4000-8000-000000000104','37499021104');
select pg_temp.enrol('d2100000-0000-4000-8000-000000000104');
select pg_temp.ok((select assigned_doctor_id is not null and assigned_nurse_id is null from public.patient_clinical_cases where user_id='d2100000-0000-4000-8000-000000000104'),'No active nurse: nurse empty, doctor kept');
select pg_temp.ok(not exists(select 1 from public.patient_clinical_case_events where user_id='d2100000-0000-4000-8000-000000000104'and kind='nurse-assigned'),'No nurse event without a nurse');

-- 5. No eligible doctor: no nurse either (the nurse must share the doctor's clinic).
update public.workspace_staff set active=true where role='nurse'and removed_at is null;
update public.workspace_staff set active=false where role='doctor';
select pg_temp.member('d2100000-0000-4000-8000-000000000105','37499021105');
select pg_temp.enrol('d2100000-0000-4000-8000-000000000105');
select pg_temp.ok((select assigned_doctor_id is null and assigned_nurse_id is null from public.patient_clinical_cases where user_id='d2100000-0000-4000-8000-000000000105'),'No doctor: no nurse');
select pg_temp.ok(not has_function_privilege('authenticated','public._auto_assign_nurse(uuid)','execute'),'Nurse chooser is internal');

rollback;
\echo 'check-auto-assign-nurse: ok'
