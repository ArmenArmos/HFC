\set ON_ERROR_STOP on
begin;
-- Ordinary password sign-in fixtures carry a live session and explicit AMR.
-- This helper only selects claims; it never creates/resurrects a session.
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;

do $$begin if to_regprocedure('public.enroll_patient_clinical_case()') is null then raise exception 'TEST real member enrollment RPC is missing';end if;end$$;
insert into auth.users(id,phone,phone_confirmed_at) values
('70000000-0000-4000-8000-000000000001','37499000101',now()),('70000000-0000-4000-8000-000000000002','37499000102',now()),
('70000000-0000-4000-8000-000000000003',null,null),('70000000-0000-4000-8000-000000000004',null,null),('70000000-0000-4000-8000-000000000005',null,null),('70000000-0000-4000-8000-000000000006','37499000106',null);
update public.profiles set display_name='Integration fixture',birth_date='1980-01-01',biological_sex='female' where id::text like '70000000%';
insert into public.patient_consents(user_id,version) select id,'patient-pilot-v1' from auth.users where id::text like '70000000%';
insert into public.patient_assessments(user_id,revision,completed_at) select id,2,now() from auth.users where id::text like '70000000%';
insert into public.workspace_clinics(id,name) values('70000000-0000-4000-8000-000000000010','Test clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
('70000000-0000-4000-8000-000000000003','admin','Test admin',null),('70000000-0000-4000-8000-000000000004','doctor','Assigned doctor','70000000-0000-4000-8000-000000000010'),('70000000-0000-4000-8000-000000000005','doctor','Other doctor','70000000-0000-4000-8000-000000000010');
insert into auth.sessions(id,user_id,created_at,updated_at) select user_id,user_id,clock_timestamp(),clock_timestamp() from public.workspace_staff where user_id::text like '70000000%';
-- This check covers enrolment without a doctor and admin assignment; automatic assignment has
-- its own check (check-auto-assign-doctor.sql). No eligible doctor while enrolling here.
update public.workspace_clinics set active=false where id='70000000-0000-4000-8000-000000000010';
select pg_temp.password_actor('70000000-0000-4000-8000-000000000001');
set local role authenticated;
select public.enroll_patient_clinical_case();
select public.enroll_patient_clinical_case();
do $$begin
 if public.patient_clinical_case_status()->>'status'<>'awaiting_assignment' then raise exception 'TEST enrollment status';end if;
 begin perform public.patient_clinical_case_snapshot('70000000-0000-4000-8000-000000000001');raise exception 'TEST member read draft';exception when insufficient_privilege then null;end;
end$$;
reset role;
do $$begin if (select count(*) from public.patient_clinical_cases where user_id='70000000-0000-4000-8000-000000000001')<>1 then raise exception 'TEST duplicate enrollment';end if;end$$;
select pg_temp.password_actor('70000000-0000-4000-8000-000000000006');
set local role authenticated;
do $$begin begin perform public.enroll_patient_clinical_case();raise exception 'TEST unverified enrollment';exception when insufficient_privilege then null;end;end$$;
reset role;
delete from public.patient_consents where user_id='70000000-0000-4000-8000-000000000002';
select pg_temp.password_actor('70000000-0000-4000-8000-000000000002');
set local role authenticated;
do $$begin
 if public.patient_clinical_case_status() is not null then raise exception 'TEST another member status leaked';end if;
 begin perform public.enroll_patient_clinical_case();raise exception 'TEST missing consent enrolled';exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.password_actor('70000000-0000-4000-8000-000000000003');
set local role authenticated;
reset role;
update public.workspace_clinics set active=true where id='70000000-0000-4000-8000-000000000010';
select pg_temp.password_actor('70000000-0000-4000-8000-000000000003');
set local role authenticated;
select public.assign_patient_clinical_case('70000000-0000-4000-8000-000000000001',0,'70000000-0000-4000-8000-000000000004');
do $$begin begin perform public.patient_clinical_case_snapshot('70000000-0000-4000-8000-000000000001');raise exception 'TEST admin clinical access';exception when insufficient_privilege then null;end;end$$;
reset role;
select pg_temp.password_actor('70000000-0000-4000-8000-000000000005');
set local role authenticated;
do $$begin
 if jsonb_array_length(public.patient_clinical_case_queue())<>0 then raise exception 'TEST other doctor queue leak';end if;
 begin perform public.patient_clinical_case_snapshot('70000000-0000-4000-8000-000000000001');raise exception 'TEST other doctor read';exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.password_actor('70000000-0000-4000-8000-000000000004');
set local role authenticated;
do $$declare s jsonb;d jsonb:='{"explanation":"Reviewed actual answers","instructions":"Clinician draft","followUp":"","medicationName":"","medicationDose":"","medicationInstructions":"","medicationTimes":[]}';begin
 s:=public.patient_clinical_case_snapshot('70000000-0000-4000-8000-000000000001');
 perform public.save_patient_clinical_draft('70000000-0000-4000-8000-000000000001',1,s->>'evidenceToken',d);
 begin perform public.save_patient_clinical_draft('70000000-0000-4000-8000-000000000001',1,s->>'evidenceToken',d);raise exception 'TEST stale case accepted';exception when serialization_failure then null;end;
 begin perform public.save_patient_clinical_draft('70000000-0000-4000-8000-000000000001',2,'old',d);raise exception 'TEST stale evidence accepted';exception when serialization_failure then null;end;
end$$;
reset role;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at) values('70000000-0000-4000-8000-000000000001',gen_random_uuid(),120,80,now());
set local role authenticated;
do $$begin if not (public.patient_clinical_case_snapshot('70000000-0000-4000-8000-000000000001')->>'draftStale')::boolean then raise exception 'TEST measurement failed to stale draft';end if;end$$;
reset role;
insert into public.patient_reports(user_id,object_path,file_name,mime,size_bytes,state,consent_version,deleted_at,reviewed) values('70000000-0000-4000-8000-000000000001','local-deleted-review-fixture','removed.pdf','application/pdf',1,'deleted','test',now(),'{"removed":"private"}');
set local role authenticated;
do $$begin if jsonb_array_length(public.patient_clinical_case_snapshot('70000000-0000-4000-8000-000000000001')#>'{evidence,reports}')<>0 then raise exception 'TEST deleted report disclosed';end if;end$$;
reset role;
update public.patient_assessments set urgent_rule='RF-01',completed_at=null where user_id='70000000-0000-4000-8000-000000000001';
set local role authenticated;
do $$declare s jsonb;begin
 s:=public.patient_clinical_case_snapshot('70000000-0000-4000-8000-000000000001');
 begin perform public.save_patient_clinical_draft('70000000-0000-4000-8000-000000000001',2,s->>'evidenceToken',s->'draft');raise exception 'TEST urgent draft accepted';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
end$$;
reset role;
update public.workspace_clinics set active=false where id='70000000-0000-4000-8000-000000000010';
set local role authenticated;
do $$begin begin perform public.patient_clinical_case_snapshot('70000000-0000-4000-8000-000000000001');raise exception 'TEST inactive clinic read';exception when insufficient_privilege then null;end;end$$;
reset role;
select pg_temp.password_actor('70000000-0000-4000-8000-000000000003');
set local role authenticated;
do $$begin begin perform public.assign_patient_clinical_case('70000000-0000-4000-8000-000000000001',2,'70000000-0000-4000-8000-000000000005');raise exception 'TEST inactive assignment';exception when insufficient_privilege then null;end;end$$;
reset role;
select pg_temp.password_actor('70000000-0000-4000-8000-000000000003');
set local role authenticated;
select public.assign_patient_clinical_case('70000000-0000-4000-8000-000000000001',2);
reset role;
do $$begin
 if has_table_privilege('authenticated','public.patient_clinical_cases','select') or has_function_privilege('anon','public.enroll_patient_clinical_case()','execute') then raise exception 'TEST broad grant';end if;
 if exists(select 1 from public.patient_care_plans where user_id::text like '70000000%') then raise exception 'TEST foundation published';end if;
end$$;
rollback;
\echo Real member case identity, assignment, context and draft checks pass.
