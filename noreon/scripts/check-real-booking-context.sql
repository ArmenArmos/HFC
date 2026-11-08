\set ON_ERROR_STOP on
begin;
create function pg_temp.assert_context(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'TEST %',label;end if;end$$;
create function pg_temp.context_conflict(command text) returns void language plpgsql as $$begin begin execute command;exception when serialization_failure then return;end;raise exception 'TEST expected context conflict';end$$;
insert into auth.users(id,phone,phone_confirmed_at) values ('83000000-0000-4000-8000-000000000001','37499000831',now()),('83000000-0000-4000-8000-000000000002',null,null);
update public.profiles set display_name='Synthetic original name',birth_date='1980-01-01',biological_sex='female' where id='83000000-0000-4000-8000-000000000001';
insert into public.patient_consents(user_id,version) values('83000000-0000-4000-8000-000000000001','patient-pilot-v1');
insert into public.patient_assessments(user_id,completed_at) values('83000000-0000-4000-8000-000000000001',now());
insert into public.workspace_staff(user_id,role,display_name) values('83000000-0000-4000-8000-000000000002','admin','Synthetic coordinator');
create temp table c as select '83000000-0000-4000-8000-000000000001'::uuid uid,'83000000-0000-4000-8000-000000000002'::uuid actor,'83000000-0000-4000-8000-000000000003'::uuid rid,
 public.patient_test_context('83000000-0000-4000-8000-000000000001')->>'token' source,
 jsonb_build_object('startsAt',now()+interval '10 days','endsAt',now()+interval '10 days 1 hour','timezone','Asia/Yerevan','mode','clinic','location','Synthetic clinic') terms,
 '[{"id":"lipid-panel","title":"Lipid panel","method":"lab"}]'::jsonb tests;
-- Privileged historical fixture; public replay/context checks remain below.
select public._legacy_create_patient_test_request(uid,rid,source,terms,tests,'test-engine') from c;
-- A normal reading and a cosmetic name edit must not retire an otherwise identical request.
update public.profiles set display_name='Synthetic corrected name' where id=(select uid from c);
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at) select uid,gen_random_uuid(),120,80,now() from c;
select pg_temp.assert_context((select not (public.patient_test_request_dto(r)->>'contextStale')::boolean from public.patient_test_requests r where id=(select rid from c)),'normal measurement and display name keep requirements fresh');
select pg_temp.context_conflict(format('select public.create_patient_test_request(%L,%L,%L,%L,%L,''test-engine'')',uid,rid,source,terms,tests)) from c;
select pg_temp.assert_context((select count(*)=1 from public.patient_test_requests where user_id=(select uid from c)),'stale create source creates no phantom request');
select public.create_patient_test_request(uid,rid,public.patient_test_context(uid)->>'token',terms,tests,'test-engine') from c;
select pg_temp.assert_context((select count(*)=1 from public.patient_test_requests where user_id=(select uid from c)),'same create with refreshed source replays existing request');
-- Safety snapshot still changes; using pre-reading engine evidence must conflict.
create temp table input as select jsonb_build_object('provider','Synthetic provider','terms',terms,'obtainedAt',now(),'channel','phone','source','Synthetic only','preparation','Synthetic preparation','engine',jsonb_build_object('version','test-engine','tests',tests,'sourceToken',source)) value from c;
select pg_temp.context_conflict(format('select public.command_patient_test_request(%L,%L,true,%L,0,gen_random_uuid(),''confirm'',%L)',uid,actor,rid,value)) from c,input;
update input set value=jsonb_set(value,'{engine,sourceToken}',to_jsonb(public.patient_test_context((select uid from c))->>'token'));
select public.command_patient_test_request(uid,actor,true,rid,0,'83000000-0000-4000-8000-000000000004','confirm',value) from c,input;
-- Retry may refresh its safety token without becoming a different logical command.
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at) select uid,gen_random_uuid(),121,81,now() from c;
select pg_temp.context_conflict(format('select public.command_patient_test_request(%L,%L,false,%L,1,gen_random_uuid(),''accept'',%L)',uid,uid,rid,jsonb_build_object('engine',value->'engine'))) from c,input;
update input set value=jsonb_set(value,'{engine,sourceToken}',to_jsonb(public.patient_test_context((select uid from c))->>'token'));
select public.command_patient_test_request(uid,actor,true,rid,0,'83000000-0000-4000-8000-000000000004','confirm',value) from c,input;
select public.command_patient_test_request(uid,uid,false,rid,1,gen_random_uuid(),'accept',jsonb_build_object('engine',value->'engine')) from c,input;
select pg_temp.assert_context((select revision=2 and status='confirmed' from public.patient_test_requests where id=(select rid from c)),'fresh engine continues confirmation and acceptance after normal readings');
-- A refreshed safety token does not override changed assessment/profile/consent identity.
savepoint identity_change;
update public.profiles set birth_date='1981-01-01' where id=(select uid from c);
update input set value=jsonb_set(value,'{engine,sourceToken}',to_jsonb(public.patient_test_context((select uid from c))->>'token'));
select pg_temp.context_conflict(format('select public.command_patient_test_request(%L,%L,true,%L,2,gen_random_uuid(),''confirm'',%L)',uid,actor,rid,value)) from c,input;
rollback to identity_change;
savepoint sex_change;
update public.profiles set biological_sex='male' where id=(select uid from c);
update input set value=jsonb_set(value,'{engine,sourceToken}',to_jsonb(public.patient_test_context((select uid from c))->>'token'));
select pg_temp.context_conflict(format('select public.command_patient_test_request(%L,%L,true,%L,2,gen_random_uuid(),''confirm'',%L)',uid,actor,rid,value)) from c,input;
rollback to sex_change;
savepoint assessment_change;
update public.patient_assessments set revision=revision+1 where user_id=(select uid from c);
update input set value=jsonb_set(value,'{engine,sourceToken}',to_jsonb(public.patient_test_context((select uid from c))->>'token'));
select pg_temp.context_conflict(format('select public.command_patient_test_request(%L,%L,true,%L,2,gen_random_uuid(),''confirm'',%L)',uid,actor,rid,value)) from c,input;
rollback to assessment_change;
savepoint consent_change;
delete from public.patient_consents where user_id=(select uid from c);
update input set value=jsonb_set(value,'{engine,sourceToken}',to_jsonb(public.patient_test_context((select uid from c))->>'token'));
select pg_temp.context_conflict(format('select public.command_patient_test_request(%L,%L,true,%L,2,gen_random_uuid(),''confirm'',%L)',uid,actor,rid,value)) from c,input;
rollback to consent_change;
-- Changed source after trusted engine derivation must reject even before identical-command replay.
savepoint crisis_change;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at) select uid,gen_random_uuid(),190,120,now() from c;
select pg_temp.context_conflict(format('select public.command_patient_test_request(%L,%L,true,%L,0,''83000000-0000-4000-8000-000000000004'',''confirm'',%L)',uid,actor,rid,value)) from c,input;
select pg_temp.context_conflict(format('select public.command_patient_test_request(%L,%L,false,%L,2,gen_random_uuid(),''accept'',%L)',uid,uid,rid,jsonb_build_object('engine',value->'engine'))) from c,input;
rollback to crisis_change;
-- Legacy tokens keep their original full-context semantics and are never rebaselined.
savepoint legacy;
update public.patient_test_requests set context_token=(select source from c) where id=(select rid from c);
select pg_temp.assert_context((select (public.patient_test_request_dto(r)->>'contextStale')::boolean and context_token=(select source from c) from public.patient_test_requests r where id=(select rid from c)),'legacy provenance stays stale after prior source change');
rollback to legacy;
-- Fresh replacement C must clear the prior acceptance of B before any provider outcome.
update input set value=value||'{"replacesExisting":true}';
select public.command_patient_test_request(uid,actor,true,rid,2,gen_random_uuid(),'confirm',value) from c,input;
select public.command_patient_test_request(uid,uid,false,rid,3,'83000000-0000-4000-8000-000000000005','accept',jsonb_build_object('engine',value->'engine')) from c,input;
select public.command_patient_test_request(uid,actor,true,rid,4,gen_random_uuid(),'confirm',jsonb_set(value,'{terms,location}','"Synthetic replacement C"')) from c,input;
select pg_temp.assert_context((select pending_change is null and status='provider-proposed' and current_arrangement is not null from public.patient_test_requests where id=(select rid from c)),'new proposal clears old acceptance while retaining current arrangement');
-- Replay of B's acceptance may return its historical result but must not accept C.
select public.command_patient_test_request(uid,uid,false,rid,3,'83000000-0000-4000-8000-000000000005','accept',jsonb_build_object('engine',value->'engine')) from c,input;
select pg_temp.assert_context((select pending_change is null and revision=5 from public.patient_test_requests where id=(select rid from c)),'old acceptance replay cannot accept new proposal');
do $$begin
 begin perform public.command_patient_test_request(uid,actor,true,rid,5,gen_random_uuid(),'change-outcome',value||'{"outcome":"accepted"}') from c,input;
 exception when raise_exception then return;end;
 raise exception 'TEST provider outcome accepted C without current member acceptance';
end$$;
select public.command_patient_test_request(uid,uid,false,rid,5,gen_random_uuid(),'accept',jsonb_build_object('engine',value->'engine')) from c,input;
select public.command_patient_test_request(uid,actor,true,rid,6,gen_random_uuid(),'change-outcome',value||'{"outcome":"accepted"}') from c,input;
select pg_temp.assert_context((select status='confirmed' and revision=7 and current_arrangement#>>'{terms,location}'='Synthetic replacement C' from public.patient_test_requests where id=(select rid from c)),'new acceptance and actual outcome promote only C');
rollback;
