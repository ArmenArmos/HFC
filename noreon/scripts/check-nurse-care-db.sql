\set ON_ERROR_STOP on
begin;
-- Ordinary password sign-in fixtures carry a live session and explicit AMR.
-- This helper only selects claims; it never creates/resurrects a session.
create function pg_temp.password_actor(p_id uuid) returns text language plpgsql as $password$begin
 perform set_config('request.jwt.claim.sub',p_id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',p_id,'role','authenticated','session_id',p_id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
 return p_id::text;end$password$;

insert into auth.users(id,phone,phone_confirmed_at) select ('83000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'37499100'||lpad(i::text,3,'0'),now() from generate_series(1,7) i;
update public.profiles set display_name='Nurse boundary fixture',birth_date='1980-01-01',biological_sex='female' where id::text like '83000000%';
insert into public.workspace_clinics(id,name) values('83000000-0000-4000-8000-000000000020','Care clinic'),('83000000-0000-4000-8000-000000000021','Other clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values
('83000000-0000-4000-8000-000000000002','admin','Admin',null),
('83000000-0000-4000-8000-000000000003','doctor','Doctor','83000000-0000-4000-8000-000000000020'),
('83000000-0000-4000-8000-000000000004','nurse','Assigned nurse','83000000-0000-4000-8000-000000000020'),
('83000000-0000-4000-8000-000000000005','nurse','Unassigned nurse','83000000-0000-4000-8000-000000000020'),
('83000000-0000-4000-8000-000000000006','nurse','Other clinic nurse','83000000-0000-4000-8000-000000000021'),
('83000000-0000-4000-8000-000000000007','doctor','Other doctor','83000000-0000-4000-8000-000000000020');
insert into public.patient_consents(user_id,version) values('83000000-0000-4000-8000-000000000001','patient-pilot-v1');
insert into public.patient_assessments(user_id,completed_at) values('83000000-0000-4000-8000-000000000001',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id) values('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000003');
insert into public.workspace_cases(id,assigned_doctor_id,state) values('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000003','{"version":1,"userId":"83000000-0000-4000-8000-000000000001","state":{"consentAccepted":true,"profile":{"userId":"83000000-0000-4000-8000-000000000001"}}}');
insert into auth.sessions(id,user_id,created_at,updated_at) select user_id,user_id,clock_timestamp(),clock_timestamp() from public.workspace_staff where user_id::text like '83000000%';
do $$declare id uuid:='83000000-0000-4000-8000-000000000001';a uuid:='83000000-0000-4000-8000-000000000002';n uuid:='83000000-0000-4000-8000-000000000004';begin
 perform public.assign_case_nurse(id,a,0,n,true);perform public.assign_case_nurse(id,a,0,n,false);
 begin perform public.assign_case_nurse(id,a,1,'83000000-0000-4000-8000-000000000006',true);raise exception 'TEST cross clinic assignment';exception when insufficient_privilege then null;end;
 begin perform public.assign_case_nurse(id,n,1,n,true);raise exception 'TEST nurse self assignment';exception when insufficient_privilege then null;end;
 begin perform public.staff_care_command(id,'83000000-0000-4000-8000-000000000005',1,false,'note','{"kind":"evidence","note":"No access"}');raise exception 'TEST unassigned write';exception when insufficient_privilege then null;end;
 begin perform public.staff_care_command(id,a,1,false,'note','{"kind":"evidence","note":"No access"}');raise exception 'TEST admin clinical write';exception when insufficient_privilege then null;end;
 perform public.staff_care_command(id,n,1,false,'measurement',jsonb_build_object('submissionId',gen_random_uuid(),'measuredAt',now(),'systolic',120,'diastolic',80));
 if (select count(*) from public.workspace_accepted_readings where case_id='83000000-0000-4000-8000-000000000001')<>1 then raise exception 'TEST measurement not persisted';end if;
 perform pg_temp.password_actor(n);
 if public.real_clinical_staff_identity()->>'role' is distinct from 'nurse' or not public.staff_care_access(id,n,true) then raise exception 'TEST valid nurse session prerequisite';end if;
 begin perform public.prepare_patient_clinical_review(id,n,1,'invalid','{}');raise exception 'TEST nurse prepared clinical review';exception when insufficient_privilege then null;end;
 begin perform public.publish_patient_clinical_plan(id,n,1,'invalid','{}',gen_random_uuid());raise exception 'TEST nurse published clinical plan';exception when insufficient_privilege then null;end;
 begin perform public.workspace_review_doctor(id,n);raise exception 'TEST nurse clinical authority';exception when others then if sqlerrm like 'TEST%' then raise;end if;end;
end$$;
select pg_temp.password_actor('83000000-0000-4000-8000-000000000004');
set local role authenticated;
do $$declare s jsonb;r bigint;begin
 s:=public.patient_clinical_case_snapshot('83000000-0000-4000-8000-000000000001');
 if s->'draft'<>'null'::jsonb or s->'review'<>'null'::jsonb then raise exception 'TEST private draft visible';end if;
 if jsonb_array_length(public.patient_clinical_case_queue())<>1 then raise exception 'TEST assigned queue';end if;
 r:=public.patient_staff_care_command('83000000-0000-4000-8000-000000000001',1,'measurement',jsonb_build_object('submissionId','83000000-0000-4000-8000-000000000099','measuredAt',now(),'systolic',120,'diastolic',80));
 perform public.patient_staff_care_command('83000000-0000-4000-8000-000000000001',r,'note','{"kind":"evidence","note":"Collected source details for doctor review"}');
 s:=public.patient_clinical_case_snapshot('83000000-0000-4000-8000-000000000001');
 if jsonb_array_length(s->'careNotes')<>2 or jsonb_array_length(s#>'{evidence,measurements}')<>1 then raise exception 'TEST native care persistence';end if;
 begin perform public.save_patient_clinical_draft('83000000-0000-4000-8000-000000000001',(s->>'revision')::bigint,s->>'evidenceToken','{}');raise exception 'TEST nurse saved treatment';exception when insufficient_privilege then null;end;
 begin perform public.command_patient_clinical_review('83000000-0000-4000-8000-000000000001',(s->>'revision')::bigint,s->>'evidenceToken','approve-report','{}');raise exception 'TEST nurse approved report';exception when insufficient_privilege then null;end;
 begin perform public.patient_staff_care_command('83000000-0000-4000-8000-000000000001',(s->>'revision')::bigint,'publish','{}');raise exception 'TEST care command published';exception when insufficient_privilege then null;end;
 begin insert into public.staff_care_notes(patient_case_id,actor_id,actor_name,actor_role,kind,note) values('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000004','spoof','doctor','evidence','spoof');raise exception 'TEST direct note write';exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.password_actor('83000000-0000-4000-8000-000000000005');
set local role authenticated;
do $$begin
 if jsonb_array_length(public.patient_clinical_case_queue())<>0 then raise exception 'TEST unrelated queue';end if;
 begin perform public.patient_clinical_case_snapshot('83000000-0000-4000-8000-000000000001');raise exception 'TEST unrelated evidence';exception when insufficient_privilege then null;end;
end$$;
reset role;
select pg_temp.password_actor('83000000-0000-4000-8000-000000000004');
update public.workspace_staff set active=false where user_id='83000000-0000-4000-8000-000000000004';
do $$begin if public.staff_care_access('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000004',true) then raise exception 'TEST inactive access';end if;end$$;
update public.workspace_staff set active=true where user_id='83000000-0000-4000-8000-000000000004';
update public.workspace_clinics set active=false where id='83000000-0000-4000-8000-000000000020';
do $$begin if public.staff_care_access('83000000-0000-4000-8000-000000000001','83000000-0000-4000-8000-000000000004',false) then raise exception 'TEST inactive clinic access';end if;end$$;
update public.workspace_clinics set active=true where id='83000000-0000-4000-8000-000000000020';
update public.patient_clinical_cases set assigned_doctor_id='83000000-0000-4000-8000-000000000007' where user_id='83000000-0000-4000-8000-000000000001';
do $$begin if (select assigned_nurse_id from public.patient_clinical_cases where user_id='83000000-0000-4000-8000-000000000001') is not null then raise exception 'TEST reassignment retained nurse';end if;end$$;
rollback;
