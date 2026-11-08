-- Synthetic authority/persistence tests on an explicitly owned replay database.
\set ON_ERROR_STOP on
begin;
create function pg_temp.email_assert(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.email_reject(q text,expected text) returns void language plpgsql as $$begin
 begin execute q;exception when others then if sqlstate=expected then return;end if;raise;end;
 raise exception 'Expected rejection %',expected;
end$$;
create function pg_temp.email_actor(id uuid) returns void language plpgsql as $$begin
 perform set_config('request.jwt.claim.sub',id::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',id,'role','authenticated','session_id',id,'amr',jsonb_build_array(jsonb_build_object('method','password')))::text,true);
end$$;
insert into auth.users(id,phone,phone_confirmed_at)values
 ('c4650000-0000-4000-8000-000000000001','374000000001',now()),('c4650000-0000-4000-8000-000000000002','374000000002',now()),
 ('c4650000-0000-4000-8000-000000000003',null,null),('c4650000-0000-4000-8000-000000000004',null,null),('c4650000-0000-4000-8000-000000000005',null,null);
update public.profiles set display_name='Synthetic booking member',birth_date='1980-01-01',biological_sex='female' where id::text like 'c4650000%';
insert into public.patient_consents(user_id,version)values('c4650000-0000-4000-8000-000000000001','patient-pilot-v1'),('c4650000-0000-4000-8000-000000000002','patient-pilot-v1');
insert into public.patient_assessments(user_id,revision,completed_at)values('c4650000-0000-4000-8000-000000000001',1,now()),('c4650000-0000-4000-8000-000000000002',1,now());
insert into auth.sessions(id,user_id,created_at,updated_at)select id,id,now(),now()from auth.users where id::text like 'c4650000%';
insert into public.workspace_clinics(id,name,address,scheduling_email)values('c4650000-0000-4000-8000-000000000010','Synthetic booking clinic','Synthetic clinic address','clinic@example.invalid');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 ('c4650000-0000-4000-8000-000000000003','admin','Synthetic booking admin',null),('c4650000-0000-4000-8000-000000000004','doctor','Synthetic booking doctor','c4650000-0000-4000-8000-000000000010'),('c4650000-0000-4000-8000-000000000005','nurse','Synthetic booking nurse','c4650000-0000-4000-8000-000000000010');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values('c4650000-0000-4000-8000-000000000001','c4650000-0000-4000-8000-000000000004','c4650000-0000-4000-8000-000000000005');
update public.workspace_scheduling_settings set copy_email='copy@example.invalid',revision=1;
create temp table email_ctx as select 'c4650000-0000-4000-8000-000000000001'::uuid member,'c4650000-0000-4000-8000-000000000020'::uuid command,
 jsonb_build_object('memberId','c4650000-0000-4000-8000-000000000001','sourceToken',c->>'token','requirementsToken',c->>'requirementsToken','engineVersion','synthetic-engine-v1','items',jsonb_build_array(
  jsonb_build_object('id','synthetic-lab','title','Synthetic lab','method','lab','preparation','Synthetic only','source','fixture'),
  jsonb_build_object('id','synthetic-clinic','title','Synthetic clinic test','method','clinic','preparation','Synthetic only','source','fixture'),
  jsonb_build_object('id','synthetic-home','title','Synthetic home task','method','home-log','preparation','Synthetic only','source','fixture'))) program
 from(select public.patient_test_context('c4650000-0000-4000-8000-000000000001')c)s;
grant select on email_ctx to authenticated,service_role;
select set_config('test.email_other_requirements',public.patient_test_context('c4650000-0000-4000-8000-000000000002')->>'requirementsToken',true);
select set_config('test.email_other_source',public.patient_test_context('c4650000-0000-4000-8000-000000000002')->>'token',true);
set local role service_role;
select public.register_booking_program(command,member,member,program)from email_ctx;
select public.register_booking_program(command,member,member,program)from email_ctx;
reset role;
select pg_temp.email_assert((select count(*)=1 from public.booking_program_seals),'Program seal retry writes once');
select pg_temp.email_assert((select public.patient_test_context(member)->>'token'=program->>'sourceToken'from email_ctx),'Seal registration does not invalidate its own clinical source');
set local role service_role;
select pg_temp.email_reject(format('select public.register_booking_program(%L,%L,%L,%L)',command,member,member,jsonb_set(program,'{items}','[]')),'22023')from email_ctx;
-- Manual continuity restores valid fresh requests; malformed trusted input remains denied.
select pg_temp.email_reject(format('select public.create_patient_test_request(%L,gen_random_uuid(),%L,%L,%L,%L)','c4650000-0000-4000-8000-000000000002',current_setting('test.email_other_source'),'{}','[]','synthetic-engine-v1'),'P0001');
reset role;
select pg_temp.email_actor('c4650000-0000-4000-8000-000000000001');
set local role authenticated;
select pg_temp.email_reject(format('select public.register_booking_program(%L,%L,%L,%L)',gen_random_uuid(),member,member,program),'42501')from email_ctx;
select pg_temp.email_reject('select * from public.booking_program_seals','42501');
select pg_temp.email_reject('insert into public.booking_program_seals(id)values(gen_random_uuid())','42501');
select pg_temp.email_reject('select public.booking_program_source(''c4650000-0000-4000-8000-000000000001'',''c4650000-0000-4000-8000-000000000001'')','42501');
reset role;
-- Production-capable manual/configured source: actual capacity/validity supplied
-- by its trusted operator, never generated for the real member UI.
select pg_temp.email_actor('c4650000-0000-4000-8000-000000000003');
create temp table email_offer as select jsonb_build_object('id','c4650000-0000-4000-8000-000000000030','version','source-v1','source','synthetic-manual-fixture','clinicId','c4650000-0000-4000-8000-000000000010','mode','clinic','startsAt',now()+interval '1 day','endsAt',now()+interval '1 day 1 hour','timezone','Asia/Yerevan','clinicAddress','Synthetic clinic address','preparation','Synthetic preparation only','preparationVersion','synthetic-v1','coveredTestIds',jsonb_build_array('synthetic-lab'),'followUps',jsonb_build_array(jsonb_build_object('testId','synthetic-clinic','owner','Synthetic operator','action','Synthetic follow-up','reference','synthetic-reference')),'reservationContract',jsonb_build_object('version','manual-v1','reference','synthetic-shared-capacity')) offer;
grant select on email_offer to service_role;
set local role service_role;
select public.register_manual_booking_offer('c4650000-0000-4000-8000-000000000003',offer,1,now()+interval '30 minutes')from email_offer;

reset role;
create temp table compat_manual as select jsonb_build_object('startsAt',now()+interval '10 days','timezone','Asia/Yerevan','mode','clinic','location','Synthetic preference') terms,
 '[{"id":"synthetic-lab","title":"Synthetic lab","method":"lab"}]'::jsonb requirements;
grant select on compat_manual to service_role;
set local role service_role;
select public.create_patient_test_request(member,'c4650000-0000-4000-8000-000000000040',program->>'sourceToken',terms,requirements,'synthetic-engine-v1') from email_ctx,compat_manual;
select public.command_patient_test_request(member,member,false,'c4650000-0000-4000-8000-000000000040',0,'c4650000-0000-4000-8000-000000000041','cancel','{}')from email_ctx;
select public.select_booking_appointment(command,member,member,command,(offer->>'id')::uuid,offer->>'version',p_sender_email=>'noreon@example.invalid',p_template_version=>'synthetic-approved-v1',p_subject=>'Synthetic schedule',p_text_content=>'Synthetic approved content only')from email_ctx,email_offer;
-- Exact old request replay is supported despite newer pilot history.
select public.create_patient_test_request(member,'c4650000-0000-4000-8000-000000000040',program->>'sourceToken',terms,requirements,'synthetic-engine-v1')from email_ctx,compat_manual;
select pg_temp.email_reject(format('select public.create_patient_test_request(%L,%L,%L,%L,%L,%L)',member,'c4650000-0000-4000-8000-000000000042',program->>'sourceToken',terms,requirements,'synthetic-engine-v1'),'40001')from email_ctx,compat_manual;
reset role;
update public.booking_appointments set requirements_token='old-requirements-token',status='unknown'where member_id='c4650000-0000-4000-8000-000000000001';
set local role service_role;
select pg_temp.email_reject(format('select public.create_patient_test_request(%L,%L,%L,%L,%L,%L)',member,'c4650000-0000-4000-8000-000000000043',program->>'sourceToken',terms,requirements,'synthetic-engine-v1'),'40001')from email_ctx,compat_manual;
reset role;
select pg_temp.email_assert((select count(*)=1 from public.patient_test_requests where user_id='c4650000-0000-4000-8000-000000000001'),'Pilot conflicts roll back fresh legacy requests');
select pg_temp.email_assert((select count(*)=2 from public.patient_test_request_events where request_id='c4650000-0000-4000-8000-000000000040'),'Only original create and cancel events');
insert into public.booking_legacy_conversions(legacy_id,appointment_id,actor_id,agreement_source)values('c4650000-0000-4000-8000-000000000040','c4650000-0000-4000-8000-000000000020','c4650000-0000-4000-8000-000000000001','Synthetic SQL conversion fence only');
set local role service_role;
select pg_temp.email_reject(format('select public.create_patient_test_request(%L,%L,%L,%L,%L,%L)',member,'c4650000-0000-4000-8000-000000000040',program->>'sourceToken',terms,requirements,'synthetic-engine-v1'),'42501')from email_ctx,compat_manual;
select pg_temp.email_reject($q$select public.command_patient_test_request('c4650000-0000-4000-8000-000000000001','c4650000-0000-4000-8000-000000000001',false,'c4650000-0000-4000-8000-000000000040',1,gen_random_uuid(),'cancel','{}')$q$,'42501');
reset role;
select pg_temp.email_assert(not has_function_privilege('authenticated','public.create_patient_test_request(uuid,uuid,text,jsonb,jsonb,text)','EXECUTE')and not has_function_privilege('anon','public.create_patient_test_request(uuid,uuid,text,jsonb,jsonb,text)','EXECUTE'),'Public API roles cannot call service creator');
select pg_temp.email_assert(not has_function_privilege('service_role','public._legacy_create_patient_test_request(uuid,uuid,text,jsonb,jsonb,text)','EXECUTE'),'Private delegate not callable by service');
rollback;
