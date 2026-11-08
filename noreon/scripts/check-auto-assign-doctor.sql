-- A doctor is assigned automatically at enrolment (least loaded), rolled back. Synthetic fixtures only.
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
create function pg_temp.doctor_of(p_id uuid)returns uuid language sql as $$select assigned_doctor_id from public.patient_clinical_cases where user_id=p_id$$;

-- Doctors: A and B active in an active clinic; C inactive; D in an inactive clinic. Admin E.
insert into auth.users(id,email)values('d1900000-0000-4000-8000-0000000000a1','a@example.invalid'),('d1900000-0000-4000-8000-0000000000b1','b@example.invalid'),
 ('d1900000-0000-4000-8000-0000000000c1','c@example.invalid'),('d1900000-0000-4000-8000-0000000000d1','d@example.invalid'),('d1900000-0000-4000-8000-0000000000e1','e@example.invalid');
insert into public.workspace_clinics(id,name,active)values('d1900000-0000-4000-8000-000000000001','Synthetic open clinic',true),('d1900000-0000-4000-8000-000000000002','Synthetic closed clinic',false);
insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)values
 ('d1900000-0000-4000-8000-0000000000a1','doctor','Dr A','d1900000-0000-4000-8000-000000000001',true),
 ('d1900000-0000-4000-8000-0000000000b1','doctor','Dr B','d1900000-0000-4000-8000-000000000001',true),
 ('d1900000-0000-4000-8000-0000000000c1','doctor','Dr C','d1900000-0000-4000-8000-000000000001',false),
 ('d1900000-0000-4000-8000-0000000000d1','doctor','Dr D','d1900000-0000-4000-8000-000000000002',true),
 ('d1900000-0000-4000-8000-0000000000e1','admin','Admin E',null,true);
insert into auth.sessions(id,user_id,created_at,updated_at)values('d1900000-0000-4000-8000-0000000000e1','d1900000-0000-4000-8000-0000000000e1',now(),now());
-- Dr A already has one member.
select pg_temp.member('d1900000-0000-4000-8000-000000000101','37499019101');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1900000-0000-4000-8000-000000000101','d1900000-0000-4000-8000-0000000000a1');

-- 1. Least loaded active doctor: B (A has one member; C and D are not eligible).
select pg_temp.member('d1900000-0000-4000-8000-000000000102','37499019102');
select pg_temp.enrol('d1900000-0000-4000-8000-000000000102');
select pg_temp.ok(pg_temp.doctor_of('d1900000-0000-4000-8000-000000000102')='d1900000-0000-4000-8000-0000000000b1','Least loaded doctor assigned');
select pg_temp.ok((select revision=1 from public.patient_clinical_cases where user_id='d1900000-0000-4000-8000-000000000102'),'One assignment revision');
select pg_temp.ok((select detail->>'by'='system'and detail->>'reason'='auto_least_loaded_on_enrolment'and revision=1 from public.patient_clinical_case_events where user_id='d1900000-0000-4000-8000-000000000102'and kind='assigned'),'Assignment audited as the system');
-- Enrolling again changes nothing.
select pg_temp.enrol('d1900000-0000-4000-8000-000000000102');
select pg_temp.ok((select count(*)=1 from public.patient_clinical_case_events where user_id='d1900000-0000-4000-8000-000000000102'and kind='assigned'),'Repeat enrolment does not reassign');

-- 2. Tie (A and B one each): the doctor whose latest assignment is oldest. A was never assigned by an event.
select pg_temp.member('d1900000-0000-4000-8000-000000000103','37499019103');
select pg_temp.enrol('d1900000-0000-4000-8000-000000000103');
select pg_temp.ok(pg_temp.doctor_of('d1900000-0000-4000-8000-000000000103')='d1900000-0000-4000-8000-0000000000a1','Tie goes to the doctor assigned least recently');

-- 3. An admin can still reassign.
select pg_temp.as_user('d1900000-0000-4000-8000-0000000000e1');set local role authenticated;
select pg_temp.ok(public.assign_patient_clinical_case('d1900000-0000-4000-8000-000000000103',1,'d1900000-0000-4000-8000-0000000000b1')=2,'Admin reassigns');
reset role;
select pg_temp.ok(pg_temp.doctor_of('d1900000-0000-4000-8000-000000000103')='d1900000-0000-4000-8000-0000000000b1','Reassignment stored');

-- 4. No eligible doctor: the member stays unassigned.
update public.workspace_staff set active=false where role='doctor';
select pg_temp.member('d1900000-0000-4000-8000-000000000104','37499019104');
select pg_temp.enrol('d1900000-0000-4000-8000-000000000104');
select pg_temp.ok(pg_temp.doctor_of('d1900000-0000-4000-8000-000000000104')is null,'No active doctor: unassigned');
select pg_temp.ok(not has_function_privilege('authenticated','public._auto_assign_doctor()','execute'),'Chooser is internal');

rollback;
\echo 'check-auto-assign-doctor: ok'
