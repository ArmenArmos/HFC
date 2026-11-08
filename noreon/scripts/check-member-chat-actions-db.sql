-- Member chat database contract. No server/browser/HTTP providers are needed.
-- Verify discovers this file in run-checks.mjs --sql after migration replay.
-- Each case uses the adapter's actual database role, named arguments and JSON shape.
-- Fixtures alone use postgres; no production privileges or policies are changed.
\set ON_ERROR_STOP on
begin;
set local statement_timeout = '15s';

-- KNOWN REFUSALS LEDGER: real product defects, each awaiting its own fix PR.
-- This is a ratchet, not a skip list: SQLSTATE AND message must still match.
-- A successful call fails with "known refusal fixed: remove it from the ledger".
-- Keep covers markers on the actual calls below, never on these ledger rows.
create temp table chat_known_refusals(
 action text primary key, expected_state text not null, error_fragment text not null,
 callers text not null, effect text not null
);
-- Empty after #732. The synthetic entry below still exercises every ratchet branch.
grant select on chat_known_refusals to authenticated,service_role;

create function pg_temp.ok(value boolean,label text) returns void language plpgsql as $$
begin if value is distinct from true then raise exception 'member chat action %: effect missing',label;end if;end$$;
create function pg_temp.check_constraints(label text) returns void language plpgsql as $$
begin
 execute 'set constraints all immediate';
 -- Every deferrable FK in the migrations is initially deferred. Flush pending
 -- checks, then restore that timing: booking RPCs write cyclic FK rows in order.
 -- Leaving ALL IMMEDIATE here changes later calls in this shared transaction.
 execute 'set constraints all deferred';
exception when others then
 raise exception using errcode=sqlstate,message=format('member chat action %s deferred constraint refused [%s]: %s',label,sqlstate,sqlerrm);
end$$;
create function pg_temp.id(n integer) returns uuid language sql immutable as $$
 select ('ac710000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid
$$;
create function pg_temp.chat_call(label text,command text,expected jsonb default null) returns jsonb
language plpgsql security invoker as $$
declare result jsonb;
begin
 perform pg_temp.assert_identity();
 begin execute command into result;
 exception when others then
  raise exception using errcode=sqlstate,message=format('member chat action %s refused [%s]: %s',label,sqlstate,sqlerrm);
 end;
 if expected is not null and (result @> expected) is distinct from true then
  raise exception 'member chat action % refused: expected %, received %',label,expected,result;
 end if;
 return result;
end$$;
create function pg_temp.known_refusal(action_name text,label text,command text) returns void
language plpgsql security invoker as $$
declare refusal pg_temp.chat_known_refusals; result jsonb;
begin
 perform pg_temp.assert_identity();
 select * into refusal from pg_temp.chat_known_refusals where action=action_name;
 if not found then raise exception 'Unlisted known refusal: %',action_name;end if;
 begin execute command into result;
 exception when others then
  if sqlstate=refusal.expected_state and strpos(sqlerrm,refusal.error_fragment)>0 then
   raise notice 'member chat action %: known refusal % [%]',label,action_name,sqlstate;
   return;
  end if;
  raise exception using errcode=sqlstate,message=format('member chat action %s refused [%s]: %s',label,sqlstate,sqlerrm);
 end;
 raise exception 'known refusal fixed: remove it from the ledger: % (%)',action_name,label;
end$$;
-- One normalized identity per transition. Keep RESET ROLE inside these helpers;
-- fixture reads/writes clear claims too, rather than retaining the preceding JWT.
create function pg_temp.assert_identity() returns void language plpgsql as $$
declare expected_role text:=nullif(current_setting('test.chat_expected_role',true),'');
 expected_uid uuid:=nullif(current_setting('test.chat_expected_uid',true),'')::uuid;
begin
 perform pg_temp.ok(auth.role() is not distinct from expected_role
  and auth.uid() is not distinct from expected_uid
  and (expected_role is null or current_user=expected_role),
  'effective JWT role/uid match the selected identity');
end$$;
create function pg_temp.as_fixture() returns void language plpgsql as $$
begin
 reset role;
 perform set_config('request.jwt.claim.sub','',true);
 perform set_config('request.jwt.claim.role','',true);
 perform set_config('request.jwt.claims','{}',true);
 perform set_config('test.chat_expected_role','',true);
 perform set_config('test.chat_expected_uid','',true);
 perform pg_temp.assert_identity();
end$$;
create function pg_temp.as_member(member uuid default pg_temp.id(1),member_session uuid default pg_temp.id(101)) returns void language plpgsql as $$
begin
 perform pg_temp.ok(member is not null,'authenticated identity needs a member id');
 perform pg_temp.as_fixture();
 perform set_config('request.jwt.claims',jsonb_strip_nulls(jsonb_build_object('sub',member,'role','authenticated',
  'session_id',member_session,'amr',jsonb_build_array(jsonb_build_object('method','password')),'exp',4102444800))::text,true);
 perform set_config('test.chat_expected_role','authenticated',true);
 perform set_config('test.chat_expected_uid',member::text,true);
 set local role authenticated;
 perform pg_temp.assert_identity();
end$$;
create function pg_temp.as_service() returns void language plpgsql as $$
begin
 perform pg_temp.as_fixture();
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 perform set_config('test.chat_expected_role','service_role',true);
 set local role service_role;
 perform pg_temp.assert_identity();
end$$;
grant execute on function pg_temp.ok(boolean,text),pg_temp.id(integer),pg_temp.chat_call(text,text,jsonb),pg_temp.known_refusal(text,text,text),pg_temp.assert_identity(),pg_temp.as_fixture(),pg_temp.as_member(uuid,uuid),pg_temp.as_service() to authenticated,service_role;
select pg_temp.as_fixture();
create temp table chat_results(label text primary key,value jsonb);
grant all on chat_results to authenticated,service_role;

-- Fictional, lane-specific fixture. Suppress fixture-only notification/publication triggers,
-- as the existing SQL checks do. Every referenced parent is seeded, including publication
-- actor, plan/version, live auth session and clinical assignment. Action triggers stay ON.
set local session_replication_role=replica;
insert into auth.users(id,phone,phone_confirmed_at) values
 (pg_temp.id(1),'99971000001',now()),(pg_temp.id(2),'99971000002',now()),(pg_temp.id(7),'99971000007',now());
insert into auth.sessions(id,user_id,created_at,updated_at) values(pg_temp.id(101),pg_temp.id(1),now(),now()),(pg_temp.id(107),pg_temp.id(7),now(),now());
insert into public.profiles(id,display_name,birth_date,biological_sex,locale,ui_locale) values
 (pg_temp.id(1),'Fictional chat member','1970-01-01','female','en','en'),
 (pg_temp.id(2),'Fictional chat doctor','1970-01-01','male','en','en');
insert into public.workspace_clinics(id,name,address) values(pg_temp.id(10),'Fictional chat clinic','Fictional address');
insert into public.workspace_staff(user_id,role,display_name,clinic_id) values(pg_temp.id(2),'doctor','Fictional chat doctor',pg_temp.id(10)),(pg_temp.id(7),'nurse','Fictional chat nurse',pg_temp.id(10));
insert into public.patient_consents(user_id,version) values(pg_temp.id(1),'patient-pilot-v1');
insert into public.patient_assessments(id,user_id,answers,completed_at) values(pg_temp.id(5),pg_temp.id(1),'{}',now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id) values(pg_temp.id(1),pg_temp.id(2),pg_temp.id(7));
insert into public.patient_care_plans(id,user_id,clinician,instructions,published_at,active) values
 (pg_temp.id(3),pg_temp.id(1),'Fictional chat doctor','Fictional published instructions',now()-interval '2 days',true);
insert into public.patient_clinical_publications(user_id,plan_id,request_id,actor_id,case_revision,evidence_token,evidence,review,draft,published_at) values
 (pg_temp.id(1),pg_temp.id(3),pg_temp.id(6),pg_temp.id(2),0,'fictional-chat','{}','{}','{}',now()-interval '2 days');
insert into public.patient_care_plan_versions(plan_id,user_id,version) values(pg_temp.id(3),pg_temp.id(1),1);
insert into public.patient_care_medications(id,user_id,plan_id,name,dose,instructions,times,start_date,effective_at) values
 (pg_temp.id(4),pg_temp.id(1),pg_temp.id(3),'Fixture medicine','1 tablet','Fictional instructions',array['00:00'::time],current_date-3,now()-interval '2 days');
insert into public.patient_care_plan_medications(plan_id,medication_id,user_id) values(pg_temp.id(3),pg_temp.id(4),pg_temp.id(1));
insert into public.conversations(id,member_id) values(pg_temp.id(20),pg_temp.id(1));
insert into public.member_preferences(user_id) values(pg_temp.id(1));
insert into public.member_medicines(id,user_id,name,dose,times,started_on) values
 (pg_temp.id(40),pg_temp.id(1),'Fictional own medicine','1 tablet',array['00:00'::time],current_date-3);
insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256,auto_read_allowed,uploader_role) values
 (pg_temp.id(30),pg_temp.id(1),pg_temp.id(1)::text||'/fictional.pdf','fictional.pdf','application/pdf',100,repeat('a',64),false,'member');
insert into public.patient_care_tests(id,user_id,title,status,ordered_by,ordered_at,source,source_label)
 values(pg_temp.id(160),pg_temp.id(1),'Fictional blood test','ordered','Fictional chat doctor',now()-interval '1 day','laboratory','Fictional laboratory');
insert into public.patient_care_results(id,user_id,test_id,marker,value,unit,collected_at,received_at,source,source_label,reviewed_at,reviewed_by)
 values(pg_temp.id(161),pg_temp.id(1),pg_temp.id(160),'LDL',3.1,'mmol/L',now()-interval '1 day',now()-interval '23 hours','laboratory','Fictional laboratory',now()-interval '22 hours','Fictional chat doctor');
insert into public.patient_measurements(id,user_id,submission_id,systolic,diastolic,pulse,measured_at)values(pg_temp.id(170),pg_temp.id(1),pg_temp.id(171),125,80,70,now()-interval '1 hour');
reset session_replication_role;
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,app_chat_enabled,zoe_chat_actions_enabled)
 values(true,'member-chat-db-check',600,600,600,100,true,true)
 on conflict(singleton)do update set app_chat_enabled=true,zoe_chat_actions_enabled=true,intake_max_messages=100;
insert into public.zoe_settings(singleton,consent_collection_enabled,consent_wording_version)
 values(true,true,'zoe-consent-draft-2') on conflict(singleton)do update set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-2';
update public.member_medicine_settings set enabled=true,asks=true where singleton;
update public.bp_week_settings set enabled=true,member_can_start=true where singleton;
update public.doctor_completion_capabilities set enabled=true where singleton;

select pg_temp.as_member();
-- covers: rpc:zoe_consent_accept_shown
select pg_temp.chat_call('consent / Agree and turn on',$q$select public.zoe_consent_accept_shown(p_wording_version=>'zoe-consent-draft-2',p_text_hash=>repeat('a',64))$q$,'{"ok":true}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.zoe_consents where member_id=pg_temp.id(1) and granted and text_hash=repeat('a',64)),'consent receipt');

-- The failure wrapper is SECURITY INVOKER. Prove CHECK and missing EXECUTE refusals
-- really propagate with the action name and SQLSTATE, using actual production calls.
savepoint refusal_self_test;
-- Synthetic ledger entry is rolled back with this self-test, never a product exemption.
insert into chat_known_refusals values('self_test','23514','Choose how to contact you','self-test','self-test');
select pg_temp.as_member();
do $$
declare detected boolean:=false;
begin
 begin
-- covers: rpc:member_profile_card_save
  perform pg_temp.chat_call('self-test CHECK',$q$select to_jsonb(public.member_profile_card_save(p_channel=>'fax',p_caregiver=>null))$q$);
 exception when check_violation then
  detected:=sqlerrm like 'member chat action self-test CHECK refused [23514]: %';
 end;
 perform pg_temp.ok(detected,'self-test detects CHECK 23514');
 detected:=false;
 begin
-- covers: rpc:zoe_chat_card_post
  perform pg_temp.chat_call('self-test grant',$q$select public.zoe_chat_card_post(p_member=>pg_temp.id(1),p_request=>pg_temp.id(90),p_kind=>'bp',p_source=>'chip',p_source_seq=>null,p_snapshot=>'{"v":1,"week":null}')$q$);
 exception when insufficient_privilege then
  detected:=sqlerrm like 'member chat action self-test grant refused [42501]: %';
 end;
 perform pg_temp.ok(detected,'self-test detects missing EXECUTE 42501');
 -- The ratchet accepts the exact refusal, rejects a different state/message,
 -- rejects an unlisted entry, and fails when the same known call succeeds.
 perform pg_temp.known_refusal('self_test','self-test known CHECK',$q$select to_jsonb(public.member_profile_card_save(p_channel=>'fax',p_caregiver=>null))$q$);
 detected:=false;
 begin
  perform pg_temp.known_refusal('self_test','self-test wrong state',$q$select public.zoe_chat_card_post(p_member=>pg_temp.id(1),p_request=>pg_temp.id(90),p_kind=>'bp',p_source=>'chip',p_source_seq=>null,p_snapshot=>'{"v":1,"week":null}')$q$);
 exception when insufficient_privilege then detected:=sqlerrm like '%refused [42501]: %';end;
 perform pg_temp.ok(detected,'self-test known refusal rejects different SQLSTATE');
 detected:=false;
 begin
  perform pg_temp.known_refusal('self_test','self-test wrong message',$q$select to_jsonb(public.member_profile_card_save(p_channel=>'text',p_caregiver=>'{}'))$q$);
 exception when check_violation then detected:=sqlerrm like '%refused [23514]: Check the contact details';end;
 perform pg_temp.ok(detected,'self-test known refusal rejects different message');
 detected:=false;
 begin
  perform pg_temp.known_refusal('unlisted','self-test unlisted','select null::jsonb');
 exception when raise_exception then detected:=sqlerrm='Unlisted known refusal: unlisted';end;
 perform pg_temp.ok(detected,'self-test known refusal rejects unlisted action');
 detected:=false;
 begin
  perform pg_temp.known_refusal('self_test','self-test fixed',$q$select to_jsonb(public.member_profile_card_save(p_channel=>'text',p_caregiver=>null))$q$);
 exception when raise_exception then detected:=sqlerrm like 'known refusal fixed: remove it from the ledger: self_test (%)';end;
 perform pg_temp.ok(detected,'self-test known refusal fails on success');
end$$;
select pg_temp.as_fixture();
select pg_temp.check_constraints('refusal_self_test');
rollback to refusal_self_test;
select pg_temp.ok(not exists(select 1 from chat_known_refusals),'empty known-refusal ledger after self-test rollback');

-- Profile card is a member-session RPC, unlike the account demographics write.
select pg_temp.as_member();
-- covers: rpc:member_profile_card_save
select pg_temp.chat_call('profile / save contact',$q$select to_jsonb(public.member_profile_card_save(p_channel=>'text',p_caregiver=>'{"name":"Fictional friend","phone":"+99971000003"}'))$q$);
select pg_temp.ok((select preferred_channel='text' from public.member_preferences),'profile contact saved through RLS');
select pg_temp.as_fixture();

-- Questionnaire drafts and completion use the service writer, including sourced V3
-- answers. Unknown is preserved as a string, never transcribed to a normal value.
savepoint questionnaire;
select pg_temp.as_service();
-- covers: rpc:save_patient_assessment
select pg_temp.chat_call('questionnaire / save answer',$q$select to_jsonb(public.save_patient_assessment(p_user_id=>pg_temp.id(1),p_expected_revision=>0,p_answers=>jsonb_build_object('q2.height',jsonb_build_object('fieldId','q2.height','value','UNKNOWN','source','manual','answeredAt',now())),p_complete=>false,p_urgent_rule=>null))$q$,'1');
-- covers: rpc:save_patient_assessment_sourced
select pg_temp.chat_call('questionnaire / sourced answer',$q$select to_jsonb(public.save_patient_assessment_sourced(p_user_id=>pg_temp.id(1),p_expected_revision=>1,p_answers=>jsonb_build_object('q2.height',jsonb_build_object('fieldId','q2.height','value','UNKNOWN','source','manual','answeredAt',now())),p_complete=>false,p_urgent_rule=>null,p_sources=>'{"q2.height":"patient_reported_anamnesis"}'))$q$,'2');
-- covers: rpc:save_patient_assessment_sourced
select pg_temp.chat_call('questionnaire / complete',$q$select to_jsonb(public.save_patient_assessment_sourced(p_user_id=>pg_temp.id(1),p_expected_revision=>2,p_answers=>jsonb_build_object('q2.height',jsonb_build_object('fieldId','q2.height','value','UNKNOWN','source','manual','answeredAt',now())),p_complete=>true,p_urgent_rule=>null,p_sources=>'{}'))$q$,'3');
select pg_temp.as_fixture();
select pg_temp.ok((select completed_at is not null and answers#>>'{q2.height,value}'='UNKNOWN' and answer_sources->>'q2.height'='patient_reported_anamnesis' from public.patient_assessments where user_id=pg_temp.id(1)),'questionnaire persisted');
select pg_temp.as_member();
-- covers: rpc:enroll_patient_clinical_case
select pg_temp.chat_call('questionnaire / enrol after completion',$q$select to_jsonb(public.enroll_patient_clinical_case())$q$,to_jsonb(pg_temp.id(1)));
select pg_temp.as_fixture();
select pg_temp.check_constraints('questionnaire');
rollback to questionnaire;

-- Standalone BP: the production adapter inserts with its service writer.
savepoint bp_entry;
select pg_temp.as_service();
-- covers: table:patient_measurements:insert
select pg_temp.chat_call('bp / confirm typed reading',$q$with saved as(insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at)values(pg_temp.id(1),pg_temp.id(50),125,80,70,now()-interval '1 minute')returning *)select to_jsonb(saved) from saved$q$,'{"systolic":125,"diastolic":80}');
select pg_temp.chat_call('bp / confirm photo reading',$q$with saved as(insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at,entry_source)values(pg_temp.id(1),pg_temp.id(51),126,81,null,now()-interval '1 minute','patient_photo_confirmed')returning *)select to_jsonb(saved)from saved$q$,'{"entry_source":"patient_photo_confirmed"}');
select pg_temp.as_fixture();
select pg_temp.as_member();
-- covers: rpc:member_bp_recent
select pg_temp.ok(jsonb_array_length(pg_temp.chat_call('bp / after-save recent readings',$q$select public.member_bp_recent(p_member=>null)$q$))>=2,'recent BP visible to member');
select pg_temp.as_fixture();
select pg_temp.check_constraints('bp_entry');
rollback to bp_entry;

-- BP week calls retain the form's named arguments and member authorization.
savepoint bp_week;
select pg_temp.as_member();
-- covers: rpc:bp_week_start
insert into chat_results values('week',pg_temp.chat_call('bp week / start',$q$select public.bp_week_start(p_member=>null,p_starts_on=>(now()at time zone 'Asia/Yerevan')::date,p_morning=>'08:00',p_evening=>'20:00')$q$,'{"status":"started"}'));
select pg_temp.as_fixture();
-- The start result may omit the week id; fixture identity comes from its persisted row.
insert into chat_results select 'week-id',to_jsonb(id)from public.bp_weeks where member_id=pg_temp.id(1)and stopped_at is null;
select pg_temp.as_member();
-- covers: rpc:bp_week_record
select pg_temp.chat_call('bp week / confirm reading',$q$select public.bp_week_record(p_week=>(select(value#>>'{}')::uuid from chat_results where label='week-id'),p_slot=>'morning',p_submission=>pg_temp.id(52),p_systolic=>125,p_diastolic=>80,p_pulse=>70,p_measured_at=>now()-interval '1 second')$q$,'{"status":"saved"}');
-- covers: rpc:bp_week_record_sourced
select pg_temp.chat_call('bp week / confirm photo reading',$q$select public.bp_week_record_sourced(p_week=>(select(value#>>'{}')::uuid from chat_results where label='week-id'),p_slot=>'morning',p_submission=>pg_temp.id(53),p_systolic=>126,p_diastolic=>81,p_pulse=>null,p_measured_at=>now()-interval '1 second',p_entry_source=>'patient_photo_confirmed')$q$,'{"status":"saved"}');
-- covers: rpc:bp_week_set_reminders
select pg_temp.chat_call('bp week / reminders',$q$select public.bp_week_set_reminders(p_week=>(select(value#>>'{}')::uuid from chat_results where label='week-id'),p_on=>false)$q$,'{"status":"saved"}');
-- covers: rpc:bp_week_member_read
select pg_temp.chat_call('bp week / read',$q$select public.bp_week_member_read()$q$,'{"enabled":true}');
-- covers: rpc:bp_week_stop
select pg_temp.chat_call('bp week / stop',$q$select public.bp_week_stop(p_week=>(select(value#>>'{}')::uuid from chat_results where label='week-id'),p_reason=>null)$q$,'{"status":"stopped"}');
select pg_temp.as_fixture();
select pg_temp.ok((select count(*)=2 from public.bp_week_readings where member_id=pg_temp.id(1)),'BP week readings linked');
select pg_temp.check_constraints('bp_week');
rollback to bp_week;

-- Own medicine buttons, including both schedule-edit argument shapes.
savepoint own_medicines;
select pg_temp.as_member();
-- covers: rpc:member_medicine_add
select pg_temp.chat_call('medicines / add',$q$select public.member_medicine_add(p_name=>'Fictional added medicine',p_dose=>'1 tablet',p_times=>array['08:00'::time],p_request_id=>pg_temp.id(41))$q$,'{"status":"added"}');
-- covers: rpc:member_medicines_read
select pg_temp.chat_call('medicines / read own',$q$select public.member_medicines_read()$q$,'{"enabled":true}');
-- covers: rpc:member_medicine_dose_report
select pg_temp.chat_call('dose / taken',$q$select public.member_medicine_dose_report(p_medicine=>pg_temp.id(40),p_due_at=>((now()at time zone 'Asia/Yerevan')::date-1+time '00:00')at time zone 'Asia/Yerevan',p_status=>'taken',p_expected_revision=>0)$q$,'{"status":"saved"}');
-- covers: rpc:member_medicine_details_read
select pg_temp.ok(jsonb_array_length(pg_temp.chat_call('medicines / review read',$q$select public.member_medicine_details_read()$q$))=2,'two own medicine rows');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.member_medicine_doses where medicine_id=pg_temp.id(40)and status='taken'),'dose stored');
select pg_temp.check_constraints('own_medicines');
rollback to own_medicines;
savepoint medicine_edit;
select pg_temp.as_member();
-- covers: rpc:member_medicine_update
select pg_temp.chat_call('medicines / edit dose',$q$select public.member_medicine_update(p_id=>pg_temp.id(40),p_dose=>'2 tablets',p_times=>array['09:00'::time])$q$,'{"status":"saved"}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.member_medicines where user_id=pg_temp.id(1)and stopped_at is null and dose='2 tablets'and times=array['09:00'::time]),'edited medicine persisted');
select pg_temp.check_constraints('medicine_edit');
rollback to medicine_edit;
savepoint medicine_times;
select pg_temp.as_member();
-- covers: rpc:member_medicine_update_times
select pg_temp.chat_call('medicines / change times',$q$select public.member_medicine_update_times(p_id=>pg_temp.id(40),p_expected_dose=>'1 tablet',p_times=>array['09:30'::time])$q$,'{"status":"saved"}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.member_medicines where user_id=pg_temp.id(1)and stopped_at is null and dose='1 tablet'and times=array['09:30'::time]),'times persisted');
select pg_temp.check_constraints('medicine_times');
rollback to medicine_times;
savepoint medicine_stop;
select pg_temp.as_member();
-- covers: rpc:member_medicine_stop
select pg_temp.chat_call('medicines / stop',$q$select public.member_medicine_stop(p_id=>pg_temp.id(40))$q$,'{"status":"stopped"}');
select pg_temp.as_fixture();
select pg_temp.ok((select stopped_at is not null from public.member_medicines where id=pg_temp.id(40)),'medicine stopped');
select pg_temp.check_constraints('medicine_stop');
rollback to medicine_stop;
savepoint medicine_restore;
-- The restore button is offered for a reviewed stopped course, not a legacy stop.
update public.member_medicines set status='course_stopped',stop_reason='values_normal',stopped_at=now(),provenance='patient_text_entry'where id=pg_temp.id(40);
select pg_temp.as_member();
-- covers: rpc:member_medicine_restore
select pg_temp.chat_call('medicines / restore course',$q$select public.member_medicine_restore(p_id=>pg_temp.id(40))$q$,'{"status":"saved"}');
select pg_temp.as_fixture();
select pg_temp.ok((select stopped_at is null and status is null from public.member_medicines where id=pg_temp.id(40)),'course restored');
select pg_temp.check_constraints('medicine_restore');
rollback to medicine_restore;

-- Each reason gets its own open ask; no branch is allowed to pass as closed/disabled.
savepoint asks;
insert into public.member_medicine_asks(id,user_id,source,medicine_id,due_at,trigger,expires_at)
 select pg_temp.id(60+n),pg_temp.id(1),'self',pg_temp.id(40),now()-make_interval(days=>n),'skipped',now()+interval '1 day'from generate_series(1,6)n;
select pg_temp.as_member();
-- covers: rpc:member_medicine_asks_read
select pg_temp.chat_call('ask / read',$q$select public.member_medicine_asks_read()$q$,'{"enabled":true}');
-- covers: rpc:member_medicine_ask_mine
select pg_temp.ok(pg_temp.chat_call('ask / one',$q$select public.member_medicine_ask_mine(p_ask=>pg_temp.id(61))$q$)is not null,'own ask visible');
do $$declare reason text;n integer:=0;begin
 foreach reason in array array['forgot','side_effect','cost_or_availability','ran_out','decided_to_stop']loop
  n:=n+1;
-- covers: rpc:member_medicine_ask_answer
  perform pg_temp.chat_call('ask / '||reason,format('select public.member_medicine_ask_answer(p_ask=>%L,p_reason=>%L)',pg_temp.id(60+n),reason),'{"status":"answered"}');
 end loop;
end$$;
-- covers: rpc:member_medicine_ask_care_team
select pg_temp.chat_call('ask / refill care team',$q$select public.member_medicine_ask_care_team(p_ask=>pg_temp.id(64))$q$,'{"status":"sent"}');
-- covers: rpc:member_medicine_ask_dismiss
select pg_temp.chat_call('ask / keep medicine',$q$select public.member_medicine_ask_dismiss(p_ask=>pg_temp.id(66))$q$,'{"status":"closed"}');
select pg_temp.as_fixture();
select pg_temp.ok((select count(*)=5 from public.member_medicine_asks where user_id=pg_temp.id(1)and state='answered'),'ask reasons stored');
select pg_temp.ok((select count(*)=3 from public.member_medicine_concerns where user_id=pg_temp.id(1)),'side effect, stop and refill concerns created');
select pg_temp.check_constraints('asks');
rollback to asks;

-- Mild side effect routes to the assigned nurse, never to an unowned queue.
savepoint nurse_side_effect;
update public.nurse_chat_settings set enabled=true where singleton;
select pg_temp.as_member();
-- covers: rpc:member_side_effect_nurse_task
select pg_temp.chat_call('side effect / nurse follow-up',$q$select public.member_side_effect_nurse_task(p_what=>'dizziness',p_request_id=>pg_temp.id(70))$q$,'{"status":"created"}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.patient_coordination_tasks where patient_case_id=pg_temp.id(1)and owner_id=pg_temp.id(7)),'side-effect task assigned');
select pg_temp.check_constraints('nurse_side_effect');
rollback to nurse_side_effect;

-- Document details, default/explicit reads and questions use member authorization.
savepoint document_details;
select pg_temp.as_member();
-- covers: rpc:zoe_v3_document_read
select pg_temp.chat_call('document / open newest',$q$select public.zoe_v3_document_read()$q$,jsonb_build_object('document',jsonb_build_object('id',pg_temp.id(30))));
-- covers: rpc:zoe_v3_document_read
select pg_temp.chat_call('document / open selected',$q$select public.zoe_v3_document_read(p_document=>pg_temp.id(30))$q$,jsonb_build_object('document',jsonb_build_object('id',pg_temp.id(30))));
-- covers: rpc:zoe_v3_document_details
select pg_temp.chat_call('document / save details',$q$select to_jsonb(public.zoe_v3_document_details(p_document=>pg_temp.id(30),p_type=>'lab',p_study_date=>current_date-1))$q$,'true');
select pg_temp.as_fixture();
select pg_temp.ok((select doc_type='lab'and study_date=current_date-1 from public.member_reported_documents where id=pg_temp.id(30)),'document metadata saved');
select pg_temp.check_constraints('document_details');
rollback to document_details;

-- Ordinary card sends (side effect, red answers, symptoms, visit request, questions)
-- all reach this member-session receive. No provider is called or message dispatched.
savepoint card_message;
select pg_temp.as_member();
-- covers: rpc:conversation_receive
select pg_temp.chat_call('message / send to doctor',$q$select public.conversation_receive(p_command=>jsonb_build_object('requestId',pg_temp.id(80),'text','Fictional questions for the care team'),p_to_doctor=>true)$q$,'{"ok":true}');
-- covers: rpc:conversation_receive
select pg_temp.chat_call('message / confirmed voice receipt',$q$select public.conversation_receive(p_command=>jsonb_build_object('requestId',pg_temp.id(81),'text','Fictional dictated message'),p_to_doctor=>false,p_voice_receipt=>repeat('a',64))$q$,'{"ok":true}');
-- covers: rpc:conversation_member_thread
select pg_temp.chat_call('message / read thread',$q$select public.conversation_member_thread()$q$,'{"ok":true}');
-- covers: rpc:conversation_member_voice_receipt
select pg_temp.ok(pg_temp.chat_call('bp / read typed message provenance',$q$select public.conversation_member_voice_receipt(p_seq=>2)$q$)is not null,'voice receipt exists');
-- covers: rpc:conversation_member_new_topic
select pg_temp.chat_call('message / new question',$q$select public.conversation_member_new_topic()$q$,'{"ok":true}');
-- covers: rpc:zoe_v3_consult_questions_save
select pg_temp.chat_call('consult / save questions',$q$select to_jsonb(public.zoe_v3_consult_questions_save(p_request=>pg_temp.id(80),p_appointment=>null,p_groups=>'[{"label":"symptoms","text":"Fictional symptom question"},{"label":"results","text":"Fictional results question"}]'))$q$,'true');
-- covers: rpc:zoe_v3_consult_questions_sent
select pg_temp.chat_call('consult / record sent',$q$select to_jsonb(public.zoe_v3_consult_questions_sent(p_request=>pg_temp.id(80)))$q$,'true');
select pg_temp.as_fixture();
select pg_temp.ok((select count(*)=2 and bool_and(sent_at is not null)from public.consult_questions where member_id=pg_temp.id(1)),'consult questions persisted as sent');
select pg_temp.ok((select count(*)=2 from public.conversation_messages where conversation_id=pg_temp.id(20)),'two card messages persisted');
-- A migration-only replay has no settings row: UPDATE alone leaves alerts off.
insert into public.care_alert_settings(singleton,enabled)values(true,true)
 on conflict(singleton)do update set enabled=true;
insert into chat_results select 'message-to-screen',to_jsonb(id)from public.conversation_messages where conversation_id=pg_temp.id(20)and request_id=pg_temp.id(80);
-- Pending means unscreened within one day. p_with_text=false hides the body,
-- not the row; these are member text messages saved through conversation_receive.
insert into chat_results select 'messages-pending-expected',jsonb_agg(jsonb_build_object('messageId',id,'memberId',author_id,'text',null))
 from public.conversation_messages where conversation_id=pg_temp.id(20);
select pg_temp.as_service();
-- covers: rpc:care_alert_messages_pending
select pg_temp.ok(jsonb_array_length(pg_temp.chat_call('message / pending care screening',$q$select public.care_alert_messages_pending(p_limit=>20,p_with_text=>false)$q$,
 (select value from chat_results where label='messages-pending-expected')))=2,'both new messages await screening without text');
-- covers: rpc:care_alert_screen
select pg_temp.chat_call('message / journal unsigned-lexicon screen',$q$select public.care_alert_screen(p_member=>pg_temp.id(1),p_source=>'message',p_source_ref=>(select value#>>'{}'from chat_results where label='message-to-screen'),p_outcome=>'skipped',p_reason=>'lexicon_awaiting_s1_signoff',p_red_flags=>array[]::text[],p_rule=>'care_alert.urgent_lexicon',p_rule_version=>'s1-unsigned-0')$q$,'{"ok":true,"outcome":"skipped"}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.care_alert_screenings where member_id=pg_temp.id(1)and source='message'and outcome='skipped'),'message screening persisted');
select pg_temp.check_constraints('card_message');
rollback to card_message;

-- Logistics, adherence and safety tasks raised by buttons. Keep each independent,
-- so an emergency alert cannot hold a later otherwise-valid booking action.
savepoint care_tasks;
select pg_temp.as_service();
do $$declare reason text;begin
 foreach reason in array array['fasting_failed','lab_reschedule','lab_booking_needed','missing_baseline_labs','medicine_access_help']loop
-- covers: rpc:care_queue_raise
  perform pg_temp.chat_call('admin task / '||reason,format($q$select public.care_queue_raise(
   p_member=>pg_temp.id(1),p_queue=>'admin',p_zone=>null,p_reason=>%L,p_rule_version=>'zones-v1-2026-11-02',
   p_red_flags=>null,p_action=>%L,p_summary=>'{}',p_sla=>null,p_source_ref=>%L)$q$,
   reason,case when reason in('fasting_failed','lab_reschedule')then 'rebook'else 'book'end,'chat-check:'||reason),'{"ok":true}');
 end loop;
-- covers: rpc:care_queue_raise
 perform pg_temp.chat_call('SAMS / physician follow-up',$q$select public.care_queue_raise(
  p_member=>pg_temp.id(1),p_queue=>'physician',p_zone=>'orange',p_reason=>'sams_sign_without_muscle',p_rule_version=>'zones-v1-2026-11-02',
  p_red_flags=>'cleared',p_action=>null,p_summary=>'{"sams":{"darkUrine":true}}',p_sla=>now()+interval '24 hours',p_source_ref=>'chat-check:sams')$q$,'{"ok":true}');
end$$;
-- covers: rpc:zoe_v3_adherence_context
select pg_temp.ok(pg_temp.chat_call('dose / adherence context',$q$select public.zoe_v3_adherence_context(p_member=>pg_temp.id(1))$q$)?&array['episodes','stops'],'adherence context returned');
-- covers: rpc:zoe_chat_action_trace
select pg_temp.chat_call('visit request / unavailable-step trace',$q$select public.zoe_chat_action_trace(p_member=>pg_temp.id(1),p_name=>'zoe.visit_request',p_outcome=>'block',p_reason=>'task_unavailable',p_rule=>'zoe.visit_request',p_rule_version=>'visit-request-2026-11-04',p_attributes=>jsonb_build_object('noreon.card_id',pg_temp.id(90),'noreon.operation_id',pg_temp.id(91),'step','task'))$q$,'{"ok":true}');
select pg_temp.as_fixture();
-- The trace journal is deliberately not readable by service_role. Inspect as postgres.
select pg_temp.ok((select count(*)=1 from public.conversation_trace_events
 where member_id=pg_temp.id(1) and conversation_id=pg_temp.id(20) and subject_kind='zoe_decision'
 and step='zoe' and name='zoe.visit_request' and outcome='block' and reason_code='task_unavailable'
 and rule_id='zoe.visit_request' and rule_version='visit-request-2026-11-04' and actor_kind='system' and actor_id is null
 and attributes=jsonb_build_object('noreon.card_id',pg_temp.id(90),'noreon.operation_id',pg_temp.id(91),'step','task')),
 'visit request unavailable-step trace persisted');
select pg_temp.ok((select count(*)=6 from public.care_queue_tasks where member_id=pg_temp.id(1)),'logistics and clinical tasks exist');
select pg_temp.as_member();
-- covers: rpc:care_queue_member_tasks
select pg_temp.ok(pg_temp.chat_call('tasks / member receipt',$q$select public.care_queue_member_tasks()$q$)is not null,'task receipt available');
select pg_temp.as_fixture();
select pg_temp.check_constraints('care_tasks');
rollback to care_tasks;
savepoint safety_alert;
-- The prior savepoint rolled its settings fixture back too.
insert into public.care_alert_settings(singleton,enabled)values(true,true)
 on conflict(singleton)do update set enabled=true;
select pg_temp.as_service();
-- covers: rpc:care_alert_screen
select pg_temp.chat_call('red flag / raise care alert',$q$select public.care_alert_screen(p_member=>pg_temp.id(1),p_source=>'zoe',p_source_ref=>'bp-flag:chat-check',p_outcome=>'escalate',p_reason=>'bp_red_flag_answered',p_red_flags=>array['RF-01'],p_rule=>'zoe.bp_red_flags',p_rule_version=>'zones-v1-2026-11-02')$q$,'{"ok":true}');
-- covers: rpc:care_alert_screen
select pg_temp.chat_call('SAMS / emergency alert',$q$select public.care_alert_screen(p_member=>pg_temp.id(1),p_source=>'zoe',p_source_ref=>'sams:chat-check',p_outcome=>'escalate',p_reason=>'sams_red',p_red_flags=>array[]::text[],p_rule=>'zoe.sams',p_rule_version=>'zones-v1-2026-11-02')$q$,'{"ok":true}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.care_alerts where member_id=pg_temp.id(1)),'emergency alert exists');
select pg_temp.check_constraints('safety_alert');
rollback to safety_alert;

-- A real posted card stays available for the member-session table/RPC reads.
select pg_temp.as_service();
-- covers: rpc:zoe_chat_card_post
insert into chat_results values('baseline-card',pg_temp.chat_call('message / post readable card',$q$select public.zoe_chat_card_post(p_member=>pg_temp.id(1),p_request=>pg_temp.id(21),p_kind=>'message',p_source=>'chip',p_source_seq=>null,p_snapshot=>'{"v":1}')$q$,'{"ok":true}'));
select pg_temp.as_fixture();
-- All member snapshot reads execute with RLS, never as the fixture owner.
select pg_temp.as_member();
select pg_temp.ok((select count(*)=1 from public.profiles),'profile RLS shows only the member');
-- covers: rpc:zoe_chat_cards_member
select pg_temp.chat_call('cards / member read',$q$select public.zoe_chat_cards_member()$q$,'{"enabled":true}');
-- covers: rpc:patient_current_published_clinical_review
select pg_temp.ok(pg_temp.chat_call('results / current publication',$q$select public.patient_current_published_clinical_review()$q$)is not null,'current publication visible');
-- covers: rpc:patient_published_clinical_reviews
select pg_temp.ok(jsonb_array_length(pg_temp.chat_call('menu / previous plans',$q$select public.patient_published_clinical_reviews()$q$))=1,'one plan publication');
-- covers: rpc:patient_care_plan_versions
select pg_temp.ok(jsonb_array_length(pg_temp.chat_call('plan / version history',$q$select public.patient_care_plan_versions()$q$)->'versions')=1,'one plan version');
-- covers: rpc:patient_care_plan_regimens
select pg_temp.chat_call('plan / regimen history',$q$select public.patient_care_plan_regimens()$q$);
-- covers: rpc:zoe_v3_plan_state
select pg_temp.chat_call('plan / teach-back state',$q$select public.zoe_v3_plan_state()$q$,jsonb_build_object('planId',pg_temp.id(3)));
-- covers: rpc:patient_released_documents
select pg_temp.chat_call('results / released documents',$q$select public.patient_released_documents()$q$);
-- covers: rpc:member_ldl_read
select pg_temp.chat_call('ldl / pathway',$q$select public.member_ldl_read()$q$);
-- covers: rpc:patient_plan_preparing
select pg_temp.chat_call('next step / preparation status',$q$select to_jsonb(public.patient_plan_preparing())$q$,'false');
-- covers: rpc:patient_test_booking_context
select pg_temp.ok(pg_temp.chat_call('tests / booking context',$q$select public.patient_test_booking_context()$q$)?'token','tests context token');
-- covers: rpc:pilot_catalog_member
select pg_temp.chat_call('tests / pricing catalogue',$q$select public.pilot_catalog_member()$q$);
-- covers: rpc:pilot_member_payments
select pg_temp.chat_call('visit / payment status',$q$select public.pilot_member_payments()$q$);
-- covers: rpc:member_clinic_measurements
select pg_temp.chat_call('menu / clinic history',$q$select public.member_clinic_measurements()$q$);
-- covers: rpc:member_upload_ai_overview
select pg_temp.chat_call('menu / earlier upload overview',$q$select public.member_upload_ai_overview()$q$);
-- covers: rpc:member_upload_results
select pg_temp.chat_call('tests / uploaded results',$q$select public.member_upload_results()$q$);
-- covers: rpc:member_safety_status
select pg_temp.chat_call('menu / exercise guidance',$q$select public.member_safety_status()$q$);
-- covers: rpc:zoe_symptom_intake_member
select pg_temp.chat_call('symptom gate / intake status',$q$select public.zoe_symptom_intake_member()$q$,'{"ok":true}');
-- covers: rpc:telegram_link_status
select pg_temp.chat_call('account / message channel',$q$select public.telegram_link_status()$q$,'{"ok":true}');
-- covers: table:zoe_chat_cards:select
select pg_temp.chat_call('cards / own row by id',$q$select to_jsonb(k)from(select id,request_id,kind,source,source_seq,snapshot,state,outcome,claims,created_at from public.zoe_chat_cards where id=(select(value#>>'{card,id}')::uuid from chat_results where label='baseline-card'))k$q$,'{"kind":"message","source":"chip"}');
-- covers: table:patient_measurements:select
select pg_temp.chat_call('bp / latest member reading',$q$select to_jsonb(m)from(select systolic,diastolic,pulse,measured_at,entry_source from public.patient_measurements order by measured_at desc limit 1)m$q$,'{"systolic":125,"diastolic":80}');
-- covers: table:profiles:select
select pg_temp.chat_call('account / own profile',$q$select to_jsonb(p)from public.profiles p$q$,jsonb_build_object('id',pg_temp.id(1)));
-- covers: table:patient_assessments:select
select pg_temp.chat_call('questionnaire / own assessment',$q$select to_jsonb(a)from public.patient_assessments a$q$,jsonb_build_object('id',pg_temp.id(5)));
-- covers: table:patient_consents:select
select pg_temp.chat_call('questionnaire / pilot consent',$q$select to_jsonb(c)from(select version from public.patient_consents where version='patient-pilot-v1')c$q$,'{"version":"patient-pilot-v1"}');
-- covers: table:member_preferences:select
select pg_temp.chat_call('profile / saved preferences',$q$select to_jsonb(p)from(select text_size,preferred_channel,caregiver_contact from public.member_preferences)p$q$,'{"preferred_channel":"text"}');
-- covers: table:member_reported_documents:select
select pg_temp.chat_call('documents / own list',$q$select to_jsonb(d)from(select id,file_name,mime,size_bytes,result_date,created_at from public.member_reported_documents)d$q$,jsonb_build_object('id',pg_temp.id(30)));
-- covers: table:patient_care_medications:select
select pg_temp.chat_call('medicines / published rows',$q$select to_jsonb(m)from public.patient_care_medications m$q$,jsonb_build_object('id',pg_temp.id(4)));
-- covers: table:patient_care_plan_medications:select
select pg_temp.chat_call('plan / medicine membership',$q$select to_jsonb(m)from public.patient_care_plan_medications m$q$,jsonb_build_object('plan_id',pg_temp.id(3),'medication_id',pg_temp.id(4)));
-- covers: table:patient_care_tests:select
select pg_temp.chat_call('tests / ordered rows',$q$select coalesce(jsonb_agg(t),'[]')from public.patient_care_tests t$q$);
-- covers: table:patient_care_results:select
select pg_temp.chat_call('results / reviewed rows',$q$select coalesce(jsonb_agg(r),'[]')from public.patient_care_results r where reviewed_at is not null and reviewed_by is not null$q$);
-- covers: table:patient_care_appointments:select
select pg_temp.chat_call('visit / care appointment history',$q$select coalesce(jsonb_agg(a),'[]')from public.patient_care_appointments a$q$);
-- covers: table:patient_dose_events:select
select pg_temp.chat_call('dose / current events',$q$select coalesce(jsonb_agg(d),'[]')from public.patient_dose_events d$q$);
-- covers: table:patient_dose_event_history:select
select pg_temp.chat_call('dose / event history',$q$select coalesce(jsonb_agg(d),'[]')from public.patient_dose_event_history d$q$);
select pg_temp.as_fixture();

-- Member-chat feature action dependencies. Included inside the root test transaction.
-- Requires root auth/profiles for ac710000-0000-4000-8000-000000000001 (verified
-- member) and ...002 (doctor), a completed/non-urgent assessment, pilot consent,
-- a current active published care plan, pg_temp.chat_call and pg_temp.ok.
-- SQL covers persistence boundaries, not deployment flags, TS validation or provider IO.
-- All feature-specific fixtures are isolated by ac71f000 UUIDs and savepoints.
-- Latest inspected definitions: profile/locale 20261022105009; reminder preferences
-- 20261010072914; earlier value 20261017155812; lesson progress 20261020083007;
-- acknowledge plan 20261008074828; text preference 20261017185155;
-- Zoe consent 20261019211953; select/cancel 20261017204237;
-- claim 20261017111652; record receipt 20261016000442; apply receipt
-- 20261016181417; recover command 20261016003952; lab appointment 20261104140100;
-- proposal answer 20261021070106; create legacy 20261018202609 delegating to
-- _legacy_create_patient_test_request from 20261014220153; legacy command wrapper
-- 20261017123453 delegating to _legacy_command_patient_test_request 20261029114200.
-- Fixtures retain FK/check/trigger enforcement: capacity -> offer; service calls
-- produce reservation -> appointment -> notice (deferred cyclic FKs), version,
-- command and event. Clinic acceptance fixture advances pending portal notice to
-- accepted, then fills current arrangement; no session_replication_role bypass.
-- Inspected guards: verified member, completed/nonurgent assessment + pilot consent,
-- clinical source/requirements freshness, unique member requirements, same clinic
-- rescheduling, future/live offers, held capacity, coverage, clinic address, portal
-- switch/channel, attended-visit refusal, revision CAS, command replay identity,
-- open proposal revision; reminder six-key/time/revision validation; profile age,
-- sex, locale, consent/answer whitelist/revision validation; earlier value numeric,
-- units/date/500-row cap; lesson member-only/ID/200-row cap; plan ownership/publication.


savepoint chat_account_features;
select pg_temp.as_fixture();
create temp table chat_feature_revision as
 select revision, coalesce(p.ui_locale,p.locale) locale,p.birth_date,p.biological_sex
 from public.patient_assessments a join public.profiles p on p.id=a.user_id
 where a.user_id='ac710000-0000-4000-8000-000000000001';
grant select on chat_feature_revision to service_role,authenticated;
select pg_temp.as_service();
-- covers: rpc:save_patient_profile
select pg_temp.chat_call('account.profile',format($q$select to_jsonb(public.save_patient_profile(
 p_user_id=>'ac710000-0000-4000-8000-000000000001',p_name=>'Chat feature member',
 p_birth_date=>%L::date,p_sex=>%L,p_locale=>%L,p_consent_version=>'patient-pilot-v1',
 p_answers=>%L::jsonb,p_expected_revision=>%s,p_urgent_rule=>null))$q$,
 birth_date,biological_sex,locale,
 jsonb_build_object('q1.age',jsonb_build_object('fieldId','q1.age','value',extract(year from age(timezone('Asia/Yerevan',now())::date,birth_date))::int,'source','manual','answeredAt',now()),'q1.sex',jsonb_build_object('fieldId','q1.sex','value',biological_sex,'source','manual','answeredAt',now())),revision)) from chat_feature_revision;
select pg_temp.as_fixture();
select pg_temp.ok((select p.display_name='Chat feature member' and a.revision=r.revision+1 and a.answers#>>'{q1.sex,value}'=r.biological_sex
 from public.profiles p join public.patient_assessments a on a.user_id=p.id cross join chat_feature_revision r
 where p.id='ac710000-0000-4000-8000-000000000001'),'profile changed and revision incremented');
select pg_temp.as_member();
-- covers: rpc:save_patient_locale
select pg_temp.chat_call('account.language',format($q$select to_jsonb(public.save_patient_locale(
 p_locale=>'ru',p_expected_locale=>%L,p_expected_revision=>%s))$q$,locale,revision+1)) from chat_feature_revision;
-- covers: table:profiles:select
select pg_temp.chat_call('account.language.read',$q$select to_jsonb(p) from public.profiles p where id='ac710000-0000-4000-8000-000000000001'$q$,'{"ui_locale":"ru"}');
-- covers: rpc:save_patient_reminder_preferences
select pg_temp.chat_call('account.reminders',format($q$select to_jsonb(public.save_patient_reminder_preferences(
 p_preferences=>'{"medicationEnabled":true,"medicationOffsetMinutes":15,"bpEnabled":true,"bpTimes":["08:00","20:00"],"quietStart":"22:00","quietEnd":"07:00"}'::jsonb,
 p_expected_revision=>%s))$q$,coalesce((select revision from public.patient_reminder_preferences),0)));
-- covers: table:patient_reminder_preferences:select
select pg_temp.chat_call('account.reminders.read',$q$select to_jsonb(p) from(select revision,preferences from public.patient_reminder_preferences)p$q$,
 '{"preferences":{"medicationEnabled":true,"medicationOffsetMinutes":15,"bpEnabled":true,"bpTimes":["08:00","20:00"],"quietStart":"22:00","quietEnd":"07:00"}}');
-- covers: rpc:save_member_preferences
select pg_temp.chat_call('account.text_size',$q$select public.save_member_preferences(p_text_size=>'xlarge')$q$,'{"textSize":"xlarge"}');
-- covers: rpc:member_contact_status
select pg_temp.chat_call('account.text_size.read',$q$select public.member_contact_status()$q$,'{"textSize":"xlarge"}');
select pg_temp.as_fixture();
select pg_temp.ok((select ui_locale='ru' from public.profiles where id='ac710000-0000-4000-8000-000000000001'),'locale stored Russian screen preference');
select pg_temp.ok((select text_size='xlarge' from public.member_preferences where user_id='ac710000-0000-4000-8000-000000000001'),'text size persisted');
select pg_temp.check_constraints('chat_account_features');
rollback to chat_account_features;

savepoint chat_everyday_features;
select pg_temp.as_member();
-- covers: rpc:member_reported_value_add
select pg_temp.chat_call('everyday.earlier',$q$select to_jsonb(public.member_reported_value_add(
 p_measure=>'ldl_c',p_value=>3.1,p_value2=>null,p_unit=>'mmol/L',p_measured_on=>(now() at time zone 'Asia/Yerevan')::date-30))$q$);
-- covers: table:member_reported_values:select
select pg_temp.chat_call('everyday.earlier.read',$q$select to_jsonb(v) from(select id,source,measure,value,value2,unit,measured_on,created_at from public.member_reported_values)v
 where measure='ldl_c' and value=3.1 and measured_on=(now() at time zone 'Asia/Yerevan')::date-30 order by created_at desc limit 1$q$,
 '{"measure":"ldl_c","value":3.1,"unit":"mmol/L","source":"member-reported"}');
-- bp-numbers is a real catalogue ID, currently draft: app requires draft visibility enabled.
-- covers: rpc:member_lesson_done_set
select pg_temp.chat_call('everyday.lesson.done',$q$select public.member_lesson_done_set(p_lesson=>'bp-numbers',p_done=>true)$q$,'{"status":"saved"}');
-- covers: rpc:member_lessons_read
select pg_temp.chat_call('everyday.lesson.read',$q$select public.member_lessons_read()$q$,'{"done":[{"lessonId":"bp-numbers"}]}');
-- covers: rpc:member_lesson_done_set
select pg_temp.chat_call('everyday.lesson.undo',$q$select public.member_lesson_done_set(p_lesson=>'bp-numbers',p_done=>false)$q$,'{"status":"saved"}');
-- covers: rpc:member_lessons_read
select pg_temp.ok(not (pg_temp.chat_call('everyday.lesson.undo.read',$q$select public.member_lessons_read()$q$)->'done' @> '[{"lessonId":"bp-numbers"}]'::jsonb),'lesson undo removed progress');
-- covers: table:patient_care_plans:select
select pg_temp.chat_call('everyday.plan.read',$q$select to_jsonb(p) from public.patient_care_plans p where active and published_at<=now()$q$);
-- covers: rpc:acknowledge_patient_plan
select pg_temp.chat_call('everyday.plan_ack',format('select null::jsonb from public.acknowledge_patient_plan(p_plan_id=>%L::uuid)',id))
 from public.patient_care_plans where active and published_at<=now();
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.patient_care_plans where user_id='ac710000-0000-4000-8000-000000000001' and active and acknowledged_at is not null),'current plan acknowledged');
select pg_temp.check_constraints('chat_everyday_features');
rollback to chat_everyday_features;

savepoint chat_booking_features;
select pg_temp.as_fixture();
insert into public.workspace_clinics(id,name,address)values('ac71f000-0000-4000-8000-000000000010','Chat fixture clinic','Chat fixture clinic address');
insert into public.clinic_portal_memberships(id,user_id,clinic_id,display_name,role)
 values('ac71f000-0000-4000-8000-000000000011','ac710000-0000-4000-8000-000000000007','ac71f000-0000-4000-8000-000000000010','Chat fixture clinic operator','admin');
update public.clinic_scheduling_capabilities set enabled=true;
-- Trusted fixture program deliberately tests logistics, not the TypeScript clinical engine.
create temp table chat_booking_context as select 'ac710000-0000-4000-8000-000000000001'::uuid member,
 'ac71f000-0000-4000-8000-000000000020'::uuid seal,
 jsonb_build_object('memberId','ac710000-0000-4000-8000-000000000001','sourceToken',c->>'token','requirementsToken',c->>'requirementsToken',
 'engineVersion','NRN-CLIN-ALG-001','items',jsonb_build_array(jsonb_build_object('id','chat-lab','title','Chat fixture test','method','lab','preparation','Fixture preparation','source','fixture'))) program
-- covers: rpc:patient_test_context
 from(select public.patient_test_context('ac710000-0000-4000-8000-000000000001') c)s;
grant select on chat_booking_context to service_role,authenticated;
-- Configure real clinic hours as its signed-in admin, then use the same top-up
-- and offer-read path as appointment-runtime.ts. Do not invent slot IDs/versions.
select pg_temp.as_member(pg_temp.id(7),pg_temp.id(107));
select pg_temp.chat_call('booking.fixture.hours',$q$select public.clinic_schedule_settings_save(
 p_clinic=>'ac71f000-0000-4000-8000-000000000010',p_settings=>jsonb_build_object(
 'expectedRevision',0,'active',true,'slotMinutes',30,'capacity',3,'coveredTestIds',jsonb_build_array('chat-lab'),
 'followUpTestIds','[]'::jsonb,'preparation','Fixture preparation',
 'hours',(select jsonb_agg(jsonb_build_object('weekday',d,'opens','09:00','closes','09:30'))from generate_series(1,7)d)))$q$,'{"status":"saved"}');
select pg_temp.as_fixture();
select pg_temp.as_service();
-- covers: rpc:clinic_schedule_top_up
select pg_temp.chat_call('booking / refresh scheduled capacity',$q$select to_jsonb(public.clinic_schedule_top_up())$q$,'0');
-- covers: rpc:booking_program_source
select pg_temp.chat_call('booking.source',$q$select public.booking_program_source(p_member=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001')$q$);
-- covers: rpc:register_booking_program
select pg_temp.chat_call('booking.register_program',format('select public.register_booking_program(p_id=>%L,p_member=>%L,p_actor=>%L,p_program=>%L::jsonb)',seal,member,member,program))from chat_booking_context;
-- covers: rpc:booking_pilot_offers
insert into chat_results(label,value)select 'booking.offers',pg_temp.chat_call('booking.offers',
 format('select public.booking_pilot_offers(p_member=>%L,p_actor=>%L,p_program_id=>%L)',member,member,seal))from chat_booking_context;
select pg_temp.as_fixture();
create temp table chat_booking_slots as
 select row_number()over(order by p.starts_at,o.id)::integer n,o.id offer_id,o.version,p.key capacity_key
 from chat_results r cross join lateral jsonb_array_elements(r.value) offered
 join public.booking_offer_snapshots o on o.id=(offered#>>'{offer,id}')::uuid and o.version=offered#>>'{offer,version}'
 join public.booking_manual_capacity p on p.key=o.capacity_key
 where r.label='booking.offers'and p.clinic_id='ac71f000-0000-4000-8000-000000000010'and p.starts_at>now()+interval '1 day'
 order by p.starts_at,o.id limit 2;
grant select on chat_booking_slots to service_role;
select pg_temp.ok((select count(*)=2 from chat_booking_slots),'two generated future slots offered');
-- The production FK intentionally permits reservation -> appointment -> notice
-- in one RPC (20261016000442:21,26,27,35; latest select 20261017204237:247-268).
-- Regression: a successful constraint flush must not poison the following first
-- booking with 23503 booking_manual_reservations_appointment_id_fkey. These null
-- appointment/revision arguments match appointment-runtime.ts:181-184.
select pg_temp.ok((select condeferrable and condeferred from pg_constraint
 where conrelid='public.booking_manual_reservations'::regclass and conname='booking_manual_reservations_appointment_id_fkey'),
 'reservation appointment FK is initially deferred');
select pg_temp.check_constraints('before first booking');
select pg_temp.as_service();
-- covers: rpc:select_booking_appointment
select pg_temp.chat_call('booking.select',$q$select public.select_booking_appointment(
 p_command_id=>'ac71f000-0000-4000-8000-000000000040',p_member=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',
 p_program_id=>'ac71f000-0000-4000-8000-000000000020',p_offer_id=>(select offer_id from chat_booking_slots where n=1),p_offer_version=>(select version from chat_booking_slots where n=1),
 p_home_address=>null,p_appointment_id=>null,p_revision=>null,p_agreement_source=>null,p_sender_email=>null,p_template_version=>null,p_subject=>null,p_text_content=>null)$q$,
 '{"id":"ac71f000-0000-4000-8000-000000000040","status":"notification-pending","revision":0}');
select pg_temp.as_fixture();
select pg_temp.check_constraints('booking.select');
select pg_temp.ok(exists(select 1 from public.booking_manual_reservations where id='ac71f000-0000-4000-8000-000000000040' and state='held'),'selected slot held');
-- Simulate clinic acceptance as fixture setup; no clinic/provider command or external send.
update public.booking_scheduling_notices set state='accepted'where id='ac71f000-0000-4000-8000-000000000040';
update public.booking_appointments set status='confirmed',current_arrangement=proposed_arrangement,current_reservation_id=proposed_reservation_id,current_program='[{"id":"chat-lab","title":"Chat fixture test","method":"lab","preparation":"Fixture preparation"}]'
 where id='ac71f000-0000-4000-8000-000000000040';
select pg_temp.as_member();
-- covers: rpc:zoe_v3_lab_appointment
select pg_temp.chat_call('booking.lab_appointment.read',$q$select public.zoe_v3_lab_appointment(p_appointment=>'ac71f000-0000-4000-8000-000000000040')$q$,
 '{"v":1,"appointmentId":"ac71f000-0000-4000-8000-000000000040","revision":0,"preparation":"Fixture preparation"}');
select pg_temp.as_fixture();
savepoint chat_booking_confirmed;
select pg_temp.as_service();
-- covers: rpc:select_booking_appointment
select pg_temp.chat_call('booking.change',$q$select public.select_booking_appointment(
 p_command_id=>'ac71f000-0000-4000-8000-000000000041',p_member=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',
 p_program_id=>'ac71f000-0000-4000-8000-000000000020',p_offer_id=>(select offer_id from chat_booking_slots where n=2),p_offer_version=>(select version from chat_booking_slots where n=2),
 p_home_address=>null,p_appointment_id=>'ac71f000-0000-4000-8000-000000000040',p_revision=>0,p_agreement_source=>null,p_sender_email=>null,p_template_version=>null,p_subject=>null,p_text_content=>null)$q$,
 '{"id":"ac71f000-0000-4000-8000-000000000040","status":"notification-pending","revision":1}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.booking_appointments where id='ac71f000-0000-4000-8000-000000000040' and current_reservation_id='ac71f000-0000-4000-8000-000000000040' and proposed_reservation_id='ac71f000-0000-4000-8000-000000000041'),'change preserves confirmed slot until clinic response');
select pg_temp.check_constraints('chat_booking_confirmed');
rollback to chat_booking_confirmed;
select pg_temp.as_service();
-- covers: rpc:booking_portal_cancel
select pg_temp.chat_call('booking.cancel',$q$select public.booking_portal_cancel(p_command=>'ac71f000-0000-4000-8000-000000000042',
 p_member=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',p_appointment=>'ac71f000-0000-4000-8000-000000000040',p_revision=>0,p_agreement_source=>null)$q$,'{"status":"cancelled","revision":1}');
select pg_temp.as_fixture();
select pg_temp.ok(not exists(select 1 from public.booking_manual_reservations where appointment_id='ac71f000-0000-4000-8000-000000000040' and state='held'),'cancellation releases reservation');
select pg_temp.check_constraints('chat_booking_confirmed');
rollback to chat_booking_confirmed;
insert into public.clinic_booking_proposals(id,clinic_id,appointment_id,appointment_revision,capacity_key,starts_at,ends_at,actor_id,membership_id)
 select 'ac71f000-0000-4000-8000-000000000050','ac71f000-0000-4000-8000-000000000010','ac71f000-0000-4000-8000-000000000040',0,key,starts_at,ends_at,
 'ac710000-0000-4000-8000-000000000007','ac71f000-0000-4000-8000-000000000011'from public.booking_manual_capacity where key=(select capacity_key from chat_booking_slots where n=2);
savepoint chat_booking_proposal;
select pg_temp.as_service();
-- #731 keeps the signatures but uses a proposal-specific receipt and the claim's
-- command id. Reconcile before recording to cover the poll/receipt ordering.
do $$
declare m uuid:=pg_temp.id(1); k uuid; r jsonb; saved jsonb;
 proposal uuid:='ac71f000-0000-4000-8000-000000000050'; op uuid:='ac71f000-0000-4000-8000-000000000051'; item text;
begin
 item:='accepted:'||proposal::text;
-- covers: rpc:zoe_living_visit_sync
 r:=pg_temp.chat_call('booking.proposal.card',format('select public.zoe_living_visit_sync(p_member=>%L)',m),'{"ok":true,"card":{"kind":"visit","snapshot":{"available":true}}}');
 k:=(r#>>'{card,id}')::uuid;
 perform pg_temp.ok(r#>>'{card,snapshot,proposal,proposalId}'=proposal::text,'living card shows current proposal');
-- covers: rpc:zoe_chat_card_claim
 perform pg_temp.chat_call('booking.proposal.claim',format('select public.zoe_chat_card_claim(p_member=>%L,p_card=>%L,p_item=>%L,p_op=>%L,p_payload=>%L)',m,k,item,op,jsonb_build_object('proposalId',proposal)),'{"ok":true,"won":true}');
-- covers: rpc:booking_portal_proposal_answer
 perform pg_temp.chat_call('booking.proposal.accept',$q$select public.booking_portal_proposal_answer(p_command=>'ac71f000-0000-4000-8000-000000000051',
 p_member=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',p_proposal=>'ac71f000-0000-4000-8000-000000000050',p_accept=>true)$q$,'{"status":"confirmed","revision":1}');
-- covers: rpc:zoe_living_visit_sync
 r:=pg_temp.chat_call('booking.proposal.reconcile before receipt',format('select public.zoe_living_visit_sync(p_member=>%L)',m),'{"ok":true,"card":{"snapshot":{"proposal":null}}}');
 perform pg_temp.ok(r#>>'{card,id}'=k::text,'proposal reconciliation keeps the same card');
-- covers: rpc:zoe_chat_card_record
 r:=pg_temp.chat_call('booking.proposal.receipt',format('select public.zoe_chat_card_record(p_member=>%L,p_card=>%L,p_item=>%L,p_value=>%L,p_close=>true)',m,k,item,jsonb_build_object('proposalId',proposal,'commandId',op)),'{"ok":true,"replayed":false,"card":{"state":"done"}}');
 perform pg_temp.ok(r#>>array['card','outcome',item,'proposalId']=proposal::text
  and r#>>array['card','outcome',item,'commandId']=op::text and r#>>array['card','outcome',item,'doneAt']is not null,'proposal receipt retains proposal, command and action time');
 saved:=r->'card';
-- covers: rpc:zoe_chat_card_record
 r:=pg_temp.chat_call('booking.proposal.receipt replay',format('select public.zoe_chat_card_record(p_member=>%L,p_card=>%L,p_item=>%L,p_value=>%L,p_close=>true)',m,k,item,jsonb_build_object('proposalId',proposal,'commandId',op)),'{"ok":true,"replayed":true}');
 perform pg_temp.ok(r->'card'=saved,'proposal receipt replays without rewriting outcomes');
end$$;
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.clinic_booking_proposals where id='ac71f000-0000-4000-8000-000000000050'and state='accepted'),'proposal accepted durably');
select pg_temp.ok(exists(select 1 from public.booking_appointments where id='ac71f000-0000-4000-8000-000000000040'and current_reservation_id='ac71f000-0000-4000-8000-000000000051'),'accepted proposal replaces reservation');
select pg_temp.check_constraints('chat_booking_proposal');
rollback to chat_booking_proposal;
select pg_temp.as_service();
-- covers: rpc:booking_portal_proposal_answer
select pg_temp.chat_call('booking.proposal.decline',$q$select public.booking_portal_proposal_answer(p_command=>'ac71f000-0000-4000-8000-000000000052',
 p_member=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',p_proposal=>'ac71f000-0000-4000-8000-000000000050',p_accept=>false)$q$,'{"status":"confirmed","revision":0}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.clinic_booking_proposals where id='ac71f000-0000-4000-8000-000000000050'and state='rejected'),'proposal rejected durably');
select pg_temp.as_member();
-- covers: rpc:booking_pilot_workspace
select pg_temp.chat_call('booking.workspace',$q$select public.booking_pilot_workspace(p_member=>'ac710000-0000-4000-8000-000000000001')$q$,'{"appointments":[{"id":"ac71f000-0000-4000-8000-000000000040"}]}');
-- covers: rpc:booking_pilot_workspace_details
select pg_temp.chat_call('booking.workspace.details',$q$select public.booking_pilot_workspace_details(p_member=>'ac710000-0000-4000-8000-000000000001')$q$);
-- covers: rpc:booking_portal_details
select pg_temp.chat_call('booking.portal.details',$q$select public.booking_portal_details(p_member=>'ac710000-0000-4000-8000-000000000001')$q$,'{"enabled":true}');
-- covers: rpc:booking_pilot_programme_state
select pg_temp.chat_call('booking.programme.state',$q$select public.booking_pilot_programme_state(p_member=>'ac710000-0000-4000-8000-000000000001')$q$);
select pg_temp.as_fixture();
select pg_temp.check_constraints('chat_booking_confirmed');
rollback to chat_booking_confirmed;
-- Email branch uses its own trusted capacity, with real notice/attempt/receipt writes.
-- No provider is contacted: this is a synthetic provider acceptance receipt.
update public.workspace_clinics set scheduling_email='clinic@example.invalid'where id='ac71f000-0000-4000-8000-000000000010';
update public.workspace_scheduling_settings set copy_email='copy@example.invalid',revision=revision+1;
insert into public.booking_manual_capacity(key,source,reference,clinic_id,starts_at,ends_at,capacity,valid_until,created_by)
 values('chat-fixture-email','manual','chat-fixture-email','ac71f000-0000-4000-8000-000000000010',now()+interval '4 days',now()+interval '4 days 30 minutes',3,now()+interval '1 hour','ac710000-0000-4000-8000-000000000002');
insert into public.booking_offer_snapshots(id,version,capacity_key,offer,created_by)
 select 'ac71f000-0000-4000-8000-000000000034','chat-v1','chat-fixture-email',
 offer||jsonb_build_object('id','ac71f000-0000-4000-8000-000000000034','version','chat-v1','preparationVersion','chat-v1','source','manual','startsAt',now()+interval '4 days','endsAt',now()+interval '4 days 30 minutes',
 'reservationContract',jsonb_build_object('version','manual-v1','reference','chat-fixture-email')),'ac710000-0000-4000-8000-000000000002'
 from public.booking_offer_snapshots where (id,version)=(select offer_id,version from chat_booking_slots where n=1);
select pg_temp.as_service();
-- covers: rpc:select_booking_appointment
select pg_temp.chat_call('booking.email.change',$q$select public.select_booking_appointment(
 p_command_id=>'ac71f000-0000-4000-8000-000000000070',p_member=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',
 p_program_id=>'ac71f000-0000-4000-8000-000000000020',p_offer_id=>'ac71f000-0000-4000-8000-000000000034',p_offer_version=>'chat-v1',
 p_home_address=>null,p_appointment_id=>'ac71f000-0000-4000-8000-000000000040',p_revision=>0,p_agreement_source=>null,
 p_sender_email=>'noreon@example.invalid',p_template_version=>'chat-approved-v1',p_subject=>'Synthetic change',p_text_content=>'Synthetic approved change')$q$,'{"status":"notification-pending","revision":1}');
-- covers: rpc:recover_booking_command
select pg_temp.chat_call('booking.email.recover',$q$select public.recover_booking_command(p_command=>'ac71f000-0000-4000-8000-000000000070',
 p_member=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',
 p_selection=>'{"offerId":"ac71f000-0000-4000-8000-000000000034","offerVersion":"chat-v1","homeAddress":null,"appointmentId":"ac71f000-0000-4000-8000-000000000040","revision":0,"agreementSource":null,"legacyId":null}'::jsonb)$q$,'{"status":"notification-pending","revision":1}');
-- covers: rpc:claim_booking_notice
select set_config('test.chat_feature_envelope',pg_temp.chat_call('booking.email.claim',$q$select public.claim_booking_notice(
 p_notice=>'ac71f000-0000-4000-8000-000000000070',p_attempt=>'ac71f000-0000-4000-8000-000000000071',p_generation=>1,p_lease_until=>now()+interval '5 minutes',
 p_engine=>'NRN-CLIN-ALG-001',p_sender=>'noreon@example.invalid',p_template=>'chat-approved-v1')$q$,'{"noticeId":"ac71f000-0000-4000-8000-000000000070","generation":1}')::text,true);
-- covers: rpc:record_booking_notice_receipt
select pg_temp.chat_call('booking.email.receipt',format($q$select to_jsonb(public.record_booking_notice_receipt(
 p_notice=>'ac71f000-0000-4000-8000-000000000070',p_attempt=>'ac71f000-0000-4000-8000-000000000071',p_generation=>1,p_hash=>%L,
 p_outcome=>'accepted',p_reference=>'synthetic-chat-change',p_accepted_roles=>'{"clinic":"clinic@example.invalid","copy":"copy@example.invalid"}'::jsonb))$q$,
 current_setting('test.chat_feature_envelope')::jsonb->>'envelopeHash'),'true'::jsonb);
-- covers: rpc:apply_booking_notice_receipt
select pg_temp.chat_call('booking.email.apply',$q$select public.apply_booking_notice_receipt(p_notice=>'ac71f000-0000-4000-8000-000000000070',
 p_attempt=>'ac71f000-0000-4000-8000-000000000071',p_engine=>'NRN-CLIN-ALG-001',p_sender=>'noreon@example.invalid',p_template=>'chat-approved-v1')$q$,'{"status":"confirmed","revision":1}');
-- covers: rpc:cancel_booking_appointment
select pg_temp.chat_call('booking.email.cancel',$q$select public.cancel_booking_appointment(p_command_id=>'ac71f000-0000-4000-8000-000000000072',
 p_member=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',p_appointment_id=>'ac71f000-0000-4000-8000-000000000040',
 p_revision=>1,p_agreement_source=>null,p_sender_email=>'noreon@example.invalid',p_template_version=>'chat-approved-v1',p_subject=>'Synthetic cancellation',p_text_content=>'Synthetic approved cancellation')$q$,'{"status":"notification-pending","revision":2}');
-- covers: rpc:claim_booking_notice
select set_config('test.chat_feature_cancel_envelope',pg_temp.chat_call('booking.email.cancel.claim',$q$select public.claim_booking_notice(
 p_notice=>'ac71f000-0000-4000-8000-000000000072',p_attempt=>'ac71f000-0000-4000-8000-000000000073',p_generation=>1,p_lease_until=>now()+interval '5 minutes',
 p_engine=>'NRN-CLIN-ALG-001',p_sender=>'noreon@example.invalid',p_template=>'chat-approved-v1')$q$,'{"noticeId":"ac71f000-0000-4000-8000-000000000072","generation":1}')::text,true);
-- covers: rpc:record_booking_notice_receipt
select pg_temp.chat_call('booking.email.cancel.receipt',format($q$select to_jsonb(public.record_booking_notice_receipt(
 p_notice=>'ac71f000-0000-4000-8000-000000000072',p_attempt=>'ac71f000-0000-4000-8000-000000000073',p_generation=>1,p_hash=>%L,
 p_outcome=>'accepted',p_reference=>'synthetic-chat-cancel',p_accepted_roles=>'{"clinic":"clinic@example.invalid","copy":"copy@example.invalid"}'::jsonb))$q$,
 current_setting('test.chat_feature_cancel_envelope')::jsonb->>'envelopeHash'),'true'::jsonb);
-- covers: rpc:apply_booking_notice_receipt
select pg_temp.chat_call('booking.email.cancel.apply',$q$select public.apply_booking_notice_receipt(p_notice=>'ac71f000-0000-4000-8000-000000000072',
 p_attempt=>'ac71f000-0000-4000-8000-000000000073',p_engine=>'NRN-CLIN-ALG-001',p_sender=>'noreon@example.invalid',p_template=>'chat-approved-v1')$q$,'{"status":"cancelled","revision":2}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.booking_notice_attempts where id='ac71f000-0000-4000-8000-000000000073' and applied_at is not null),'email cancellation receipt applied');
select pg_temp.ok(not exists(select 1 from public.booking_manual_reservations where appointment_id='ac71f000-0000-4000-8000-000000000040' and state='held'),'accepted email cancellation releases all holds');
select pg_temp.check_constraints('chat_booking_features');
rollback to chat_booking_features;

savepoint chat_legacy_booking_features;
select pg_temp.as_fixture();
-- covers: rpc:patient_test_context
create temp table chat_legacy_context as select public.patient_test_context('ac710000-0000-4000-8000-000000000001') c;
grant select on chat_legacy_context to service_role;
select pg_temp.as_service();
-- covers: rpc:create_patient_test_request
select pg_temp.chat_call('booking.legacy.create',format($q$select public.create_patient_test_request(
 p_user_id=>'ac710000-0000-4000-8000-000000000001',p_request_id=>'ac71f000-0000-4000-8000-000000000060',p_context_token=>%L,
 p_terms=>%L::jsonb,p_requirements=>'[{"id":"chat-lab","title":"Chat fixture test","method":"lab"}]'::jsonb,p_algorithm_version=>'NRN-CLIN-ALG-001')$q$,
 c->>'token',jsonb_build_object('startsAt',now()+interval '3 days','timezone','Asia/Yerevan','mode','home','location','Chat fixture home address')),
 '{"id":"ac71f000-0000-4000-8000-000000000060","status":"requested","revision":0}')from chat_legacy_context;
select pg_temp.as_fixture();
savepoint legacy_requested;
-- Fixture of the provider's future proposal, including its retained source terms.
update public.patient_test_requests set status='provider-proposed',proposal=jsonb_build_object(
 'provider','Fictional provider','terms',jsonb_build_object('startsAt',now()+interval '3 days','endsAt',now()+interval '3 days 30 minutes','timezone','Asia/Yerevan','mode','home','location','Fictional home address'),
 'obtainedAt',now(),'channel','phone','source','Fictional provider confirmation','preparation','Fictional preparation','recordedBy','Fictional chat doctor','recordedAt',now(),'replacesExisting',false)
 where id='ac71f000-0000-4000-8000-000000000060';
update chat_legacy_context set c=public.patient_test_context('ac710000-0000-4000-8000-000000000001');
select pg_temp.as_service();
-- covers: rpc:command_patient_test_request
select pg_temp.chat_call('booking.legacy.accept',format($q$select public.command_patient_test_request(p_user_id=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',p_staff=>false,p_id=>'ac71f000-0000-4000-8000-000000000060',p_revision=>0,p_command_id=>'ac71f000-0000-4000-8000-000000000062',p_operation=>'accept',p_input=>%L::jsonb)$q$,
 jsonb_build_object('engine',jsonb_build_object('sourceToken',c->>'token','version','NRN-CLIN-ALG-001','tests','[{"id":"chat-lab","title":"Chat fixture test","method":"lab"}]'::jsonb))),'{"status":"confirmed","revision":1}')from chat_legacy_context;
-- covers: rpc:command_patient_test_request
select pg_temp.chat_call('booking.legacy.request_change',$q$select public.command_patient_test_request(p_user_id=>'ac710000-0000-4000-8000-000000000001',p_actor=>'ac710000-0000-4000-8000-000000000001',p_staff=>false,p_id=>'ac71f000-0000-4000-8000-000000000060',p_revision=>1,p_command_id=>'ac71f000-0000-4000-8000-000000000063',p_operation=>'request-change',p_input=>jsonb_build_object('terms',jsonb_build_object('startsAt',now()+interval '4 days','timezone','Asia/Yerevan','mode','home','location','Fictional home address')))$q$,'{"status":"change-pending","revision":2}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.patient_test_requests where id='ac71f000-0000-4000-8000-000000000060'and current_arrangement is not null and pending_change->>'kind'='reschedule'),'legacy acceptance and time-change persisted');
select pg_temp.check_constraints('legacy_requested');
rollback to legacy_requested;
select pg_temp.as_service();
-- covers: rpc:command_patient_test_request
select pg_temp.chat_call('booking.legacy.cancel',$q$select public.command_patient_test_request(p_user_id=>'ac710000-0000-4000-8000-000000000001',
 p_actor=>'ac710000-0000-4000-8000-000000000001',p_staff=>false,p_id=>'ac71f000-0000-4000-8000-000000000060',p_revision=>0,
 p_command_id=>'ac71f000-0000-4000-8000-000000000061',p_operation=>'cancel',p_input=>'{}'::jsonb)$q$,'{"status":"cancelled","revision":1}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.patient_test_requests where id='ac71f000-0000-4000-8000-000000000060'and status='cancelled'and revision=1),'legacy cancellation persisted');
select pg_temp.as_member();
-- covers: rpc:patient_test_booking_requests
select pg_temp.chat_call('booking.legacy.read',$q$select public.patient_test_booking_requests(p_user_id=>'ac710000-0000-4000-8000-000000000001')$q$,'[{"id":"ac71f000-0000-4000-8000-000000000060","status":"cancelled"}]');
select pg_temp.as_fixture();
select pg_temp.check_constraints('chat_legacy_booking_features');
rollback to chat_legacy_booking_features;

savepoint chat_account_zoe_consents;
select pg_temp.as_fixture();
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-2';
select pg_temp.as_member();
-- Establish withdrawals before testing grants, even if the root fixture already grants consent.
-- covers: rpc:zoe_consent_set
select pg_temp.chat_call('account.zoe.messages.withdraw',$q$select public.zoe_consent_set(p_kind=>'zoe_reads_messages',p_granted=>false,p_wording_version=>'zoe-consent-draft-2',p_source=>'settings')$q$,'{"ok":true,"readsMessages":false}');
-- covers: rpc:zoe_consent_set
select pg_temp.chat_call('account.zoe.messages.grant',$q$select public.zoe_consent_set(p_kind=>'zoe_reads_messages',p_granted=>true,p_wording_version=>'zoe-consent-draft-2',p_source=>'settings')$q$,'{"ok":true,"changed":true,"readsMessages":true}');
-- covers: rpc:zoe_consent_set
select pg_temp.chat_call('account.zoe.scheduled.withdraw',$q$select public.zoe_consent_set(p_kind=>'zoe_scheduled_questions',p_granted=>false,p_wording_version=>'zoe-consent-draft-2',p_source=>'settings')$q$,'{"ok":true,"scheduledQuestions":false}');
-- covers: rpc:zoe_consent_set
select pg_temp.chat_call('account.zoe.scheduled.grant',$q$select public.zoe_consent_set(p_kind=>'zoe_scheduled_questions',p_granted=>true,p_wording_version=>'zoe-consent-draft-2',p_source=>'settings')$q$,'{"ok":true,"changed":true,"scheduledQuestions":true}');
-- covers: rpc:zoe_consent_status
select pg_temp.chat_call('account.zoe.read',$q$select public.zoe_consent_status()$q$,'{"ok":true,"readsMessages":true,"scheduledQuestions":true}');
-- covers: rpc:zoe_consent_prompt
select pg_temp.chat_call('account.zoe.prompt',$q$select public.zoe_consent_prompt()$q$,'{"ok":true,"wordingVersion":"zoe-consent-draft-2"}');
select pg_temp.as_fixture();
select pg_temp.ok((select granted from public.zoe_consents where member_id='ac710000-0000-4000-8000-000000000001'and kind='zoe_reads_messages'order by id desc limit 1),'latest reading consent granted');
select pg_temp.ok((select granted from public.zoe_consents where member_id='ac710000-0000-4000-8000-000000000001'and kind='zoe_scheduled_questions'order by id desc limit 1),'latest scheduled consent granted');
select pg_temp.check_constraints('chat_account_zoe_consents');
rollback to chat_account_zoe_consents;
-- card-kind:dose
-- card-kind:bp
-- card-kind:results
-- card-kind:plan
-- card-kind:visit
-- card-kind:side_effect
-- card-kind:message
-- card-kind:ldl
-- card-kind:ask
-- card-kind:menu
-- card-kind:medicines
-- card-kind:account
-- card-kind:repeat
-- card-kind:red_flags
-- card-kind:profile
-- card-kind:document
-- card-kind:prep
-- card-kind:fasting
-- card-kind:symptom_gate
-- card-kind:consult_questions
-- card-kind:sams
-- card-kind:next_step
-- card-kind:tests_needed
-- card-kind:review
-- App chat cards. Root fixture: member ...001, published plan ...003, medication ...004.
-- Medication is named Fixture medicine, dose 1 tablet, scheduled at 00:00 Yerevan,
-- active since before today's midnight. Feature/consent/eligible care-team fixtures belong to the caller.
-- Each savepoint rolls its own cards back, keeping the real 40/hour limit in force.
create temp table chat_card_snapshots(kind text primary key,snapshot jsonb not null);
insert into chat_card_snapshots(kind,snapshot)values
  ('dose','{"v":1,"enabled":true,"date":"2026-11-07","slots":[]}'::jsonb),
  ('bp','{"v":1,"week":null,"latest":null}'::jsonb),
  ('results','{"v":1,"available":false,"publishedAt":null,"rows":[],"more":0}'::jsonb),
  ('plan','{"v":1,"available":false,"plan":null}'::jsonb),
  ('visit','{"v":1,"available":false,"next":null,"proposal":null,"attention":false}'::jsonb),
  ('side_effect','{"v":1}'::jsonb),('message','{"v":1}'::jsonb),
  ('ldl','{"v":1,"data":null}'::jsonb),
  ('ask','{"v":1,"askId":"ac710000-0000-4000-8000-000000000004","name":"Fixture medicine","dueAt":"2026-11-07T00:00:00Z","trigger":"missed"}'::jsonb),
  ('menu','{"v":1,"kinds":["dose","bp","results","plan","visit","message"]}'::jsonb),
  ('medicines',jsonb_build_object('v',1,'token',repeat('0',64))),
  ('account',jsonb_build_object('v',1,'token',repeat('0',64))),
  ('repeat','{"v":1,"episodeId":"fixture-bp","first":{"systolic":150,"diastolic":95}}'::jsonb),
  ('red_flags','{"v":1,"episodeId":"fixture-bp","readingId":null,"readings":[{"sbp":150,"dbp":95}]}'::jsonb),
  ('profile','{"v":1,"wake":"07:00","sleep":"22:00"}'::jsonb),
  ('document','{"v":1,"document":null}'::jsonb),
  ('prep','{"v":1,"appointmentId":"ac710000-0000-4000-8000-000000000005","revision":1,"startsAt":"2026-11-08T08:00:00+04:00","location":"Fixture clinic","preparation":"Fixture preparation"}'::jsonb),
  ('fasting','{"v":1,"appointmentId":"ac710000-0000-4000-8000-000000000005","revision":1,"startsAt":"2026-11-08T08:00:00+04:00","location":"Fixture clinic","preparation":"Fixture preparation"}'::jsonb),
  ('symptom_gate','{"v":1}'::jsonb),
  ('consult_questions','{"v":1,"appointmentId":null,"groups":[{"label":"symptoms","text":"Fixture question"},{"label":"medicines","text":""}]}'::jsonb),
  ('sams','{"v":1,"episodeId":"ac710000-0000-4000-8000-000000000005"}'::jsonb),
  ('next_step','{"v":1,"stage":"fixture-tests","title":{"en":"Next step","hy":"Next step","ru":"Next step"},"detail":{"en":"Tests","hy":"Tests","ru":"Tests"},"button":{"en":"See tests","hy":"See tests","ru":"See tests"},"target":"tests_needed","doctorInLoop":false}'::jsonb),
  ('tests_needed','{"v":1,"available":true,"rows":[{"id":"ldl","title":"LDL","method":"lab","fresh":false}]}'::jsonb),
  ('review','{"v":1}'::jsonb);
grant select on chat_card_snapshots to service_role;
update chat_card_snapshots set snapshot=jsonb_set(snapshot,'{date}',to_jsonb((now()at time zone 'Asia/Yerevan')::date::text))where kind='dose';
update chat_card_snapshots set snapshot=jsonb_set(snapshot,'{startsAt}',to_jsonb(now()+interval '1 day'))where kind in('prep','fasting');
savepoint card_kind_cases;
select pg_temp.as_service();
do $$
declare m uuid:='ac710000-0000-4000-8000-000000000001'; v record; r jsonb; first_card uuid; req uuid;
begin
 for v in select * from chat_card_snapshots loop
  req:=gen_random_uuid();
-- covers: rpc:zoe_chat_card_post
  r:=pg_temp.chat_call('post '||v.kind,format('select public.zoe_chat_card_post(%L::uuid,%L::uuid,%L,''chip'',null,%L::jsonb)',m,req,v.kind,v.snapshot),'{"ok":true,"replayed":false}');
  perform pg_temp.ok(r#>>'{card,kind}'=v.kind and r#>'{card,snapshot}'=v.snapshot,'posted snapshot '||v.kind);
  if v.kind='message' then first_card:=(r#>>'{card,id}')::uuid;end if;
 end loop;
-- covers: rpc:zoe_chat_card_claim
 r:=pg_temp.chat_call('claim message send',format('select public.zoe_chat_card_claim(%L,%L,''sent:00000000000000000000000000000000'',%L,''{"text":"Fixture logistics question"}'')',m,first_card,gen_random_uuid()),'{"ok":true,"won":true}');
 perform pg_temp.ok(r->>'attempt' is not null,'send claim acquired lease');
-- covers: rpc:zoe_chat_card_record
 perform pg_temp.chat_call('record message send',format('select public.zoe_chat_card_record(%L,%L,''sent:00000000000000000000000000000000'',jsonb_build_object(''requestId'',''ac710000-0000-4000-8000-000000000080''),true)',m,first_card),'{"ok":true,"card":{"state":"done"}}');
-- covers: rpc:zoe_chat_card_release
 perform pg_temp.chat_call('release message send lease',format('select public.zoe_chat_card_release(%L,%L,%L)',m,first_card,r->>'attempt'),'{"ok":true}');
end$$;
select pg_temp.as_fixture();
select pg_temp.ok(not exists(select 1 from public.zoe_chat_cards where member_id='ac710000-0000-4000-8000-000000000001' and send_attempts<>'{}'::jsonb),'message send lease removed');
select pg_temp.check_constraints('card_kind_cases');
rollback to card_kind_cases;

savepoint card_continuation_cases;
select pg_temp.as_service();
do $$
declare m uuid:='ac710000-0000-4000-8000-000000000001'; r jsonb; k uuid; target uuid; req uuid:=gen_random_uuid(); prior uuid; snap jsonb;
begin
 snap:='{"v":1,"stage":"fixture-tests","title":{"en":"Next step","hy":"Next step","ru":"Next step"},"detail":{"en":"Tests","hy":"Tests","ru":"Tests"},"button":{"en":"See tests","hy":"See tests","ru":"See tests"},"target":"tests_needed","doctorInLoop":false}';
-- covers: rpc:zoe_v3_next_step_sync
 r:=pg_temp.chat_call('next step sync',format('select public.zoe_v3_next_step_sync(%L,%L,null,clock_timestamp(),%L)',m,req,snap),'{"ok":true,"replayed":false}'); k:=(r#>>'{card,id}')::uuid;
-- covers: rpc:zoe_v3_next_step_follow
 r:=pg_temp.chat_call('next step follow tests',format('select public.zoe_v3_next_step_follow(%L,%L,%L,''tests_needed'',''{"v":1,"available":true,"rows":[]}'')',m,k,gen_random_uuid()),'{"ok":true,"card":{"state":"done"},"next":{"kind":"tests_needed"}}'); target:=(r#>>'{next,id}')::uuid;
-- covers: rpc:zoe_v3_next_step_follow
 r:=pg_temp.chat_call('tests follow visit',format('select public.zoe_v3_next_step_follow(%L,%L,%L,''visit'',''{"v":1,"available":false,"next":null,"proposal":null,"attention":false}'')',m,target,gen_random_uuid()),'{"ok":true,"next":{"kind":"visit"}}');
-- covers: rpc:zoe_v3_next_step_sync
 r:=pg_temp.chat_call('next step sync replay recovers chain',format('select public.zoe_v3_next_step_sync(%L,%L,%L,clock_timestamp(),%L)',m,req,k,snap),'{"ok":true,"replayed":true}');
 perform pg_temp.ok(jsonb_array_length(r->'cards')=2,'next step recovered two target cards');
 prior:=k; snap:=jsonb_set(snap,'{stage}','"fixture-visit"');
-- covers: rpc:zoe_v3_next_step_sync
 r:=pg_temp.chat_call('next step sync replacement',format('select public.zoe_v3_next_step_sync(%L,%L,%L,clock_timestamp(),%L)',m,gen_random_uuid(),prior,snap),'{"ok":true}');k:=(r#>>'{card,id}')::uuid;
-- covers: rpc:zoe_v3_next_step_follow_living
 r:=pg_temp.chat_call('living next step opens visit',format('select public.zoe_v3_next_step_follow_living(%L,%L,%L,''visit'',''{"v":1,"available":false,"next":null,"proposal":null,"attention":false}'')',m,k,gen_random_uuid()),'{"ok":true,"next":{"kind":"visit"}}');
 -- A confirmed chat visit request is an actual living source with no clinic/provider fixture.
 target:=(r#>>'{next,id}')::uuid;
-- covers: rpc:zoe_chat_card_claim
 perform pg_temp.chat_call('claim visit request receipt',format('select public.zoe_chat_card_claim(%L,%L,''booking'',%L,''{}'')',m,target,gen_random_uuid()),'{"ok":true}');
-- covers: rpc:zoe_chat_card_record
 perform pg_temp.chat_call('record visit request receipt',format('select public.zoe_chat_card_record(%L,%L,''booking'',jsonb_build_object(''kind'',''visit_request'',''doneAt'',clock_timestamp()),false)',m,target),'{"ok":true}');
-- covers: rpc:zoe_living_visit_sync
 r:=pg_temp.chat_call('living visit sync request',format('select public.zoe_living_visit_sync(%L)',m),'{"ok":true,"card":{"kind":"visit","snapshot":{"living":{"source":"request","status":"awaiting","revision":1}}}}');
-- covers: table:voice_settings:select
 perform pg_temp.chat_call('voice / settings row',$q$select to_jsonb(v)from(select enabled,stt_model,stt_urgent_model,tts_model,tts_voice,tts_instructions,version from public.voice_settings where id)v$q$,'{"enabled":true,"stt_model":"google/gemini-2.5-pro"}');
 perform pg_temp.ok(r#>>'{card,id}'=target::text,'living sync reuses recorded request card');
-- covers: rpc:zoe_living_visit_sync
 perform pg_temp.chat_call('living visit replay stable revision',format('select public.zoe_living_visit_sync(%L)',m),'{"ok":true,"card":{"snapshot":{"living":{"revision":1}}}}');
end$$;
select pg_temp.as_fixture();
select pg_temp.check_constraints('card_continuation_cases');
rollback to card_continuation_cases;

savepoint card_plan_dose_cases;
select pg_temp.as_service();
do $$
declare m uuid:='ac710000-0000-4000-8000-000000000001'; p uuid:='ac710000-0000-4000-8000-000000000003'; med uuid:='ac710000-0000-4000-8000-000000000004'; r jsonb; k uuid; due_at timestamptz:=(timezone('Asia/Yerevan',now())::date::timestamp at time zone 'Asia/Yerevan'); reason text; snap jsonb;
begin
 snap:=jsonb_build_object('v',1,'available',true,'plan',jsonb_build_object('id',p,'version',1,'clinician','Fixture clinician','publishedAt',now()-interval '1 day','instructions','Fixture instructions','medicines','[]'::jsonb),
 'v3',jsonb_build_object('planId',p,'version',1,'teachBackConfirmedAt',null,'clinician','Fixture clinician','publishedAt',now()-interval '1 day','bp',null,'ldl',null,'lifestyle','Fixture instructions','followUp','','calendar','[]'::jsonb));
-- covers: rpc:zoe_chat_card_post
 r:=pg_temp.chat_call('post published plan',format('select public.zoe_chat_card_post(%L,%L,''plan'',''chip'',null,%L)',m,gen_random_uuid(),snap),'{"ok":true}');k:=(r#>>'{card,id}')::uuid;
-- covers: rpc:zoe_v3_plan_confirm
 perform pg_temp.chat_call('confirm published plan version',format('select public.zoe_v3_plan_confirm(%L,%L,%L)',m,k,gen_random_uuid()),'{"ok":true,"card":{"state":"done"}}');
-- covers: rpc:zoe_v3_plan_confirm
 perform pg_temp.chat_call('confirm plan replay',format('select public.zoe_v3_plan_confirm(%L,%L,%L)',m,k,gen_random_uuid()),'{"ok":true,"replayed":true}');
 snap:=jsonb_build_object('v',1,'v3',true,'enabled',true,'date',timezone('Asia/Yerevan',due_at)::date,'slots',jsonb_build_array(jsonb_build_object('medicineId',med,'planId',p,'name','Fixture medicine','dose','1 tablet','dueAt',due_at,'time','00:00','status','due','revision',0)));
-- covers: rpc:zoe_chat_card_post
 r:=pg_temp.chat_call('post due dose',format('select public.zoe_chat_card_post(%L,%L,''dose'',''chip'',null,%L)',m,gen_random_uuid(),snap),'{"ok":true}');k:=(r#>>'{card,id}')::uuid;
-- covers: rpc:zoe_v3_dose_record
 r:=pg_temp.chat_call('record skipped plan dose',format('select public.zoe_v3_dose_record(%L,%L,%L,%L,%L,''skipped'')',m,k,gen_random_uuid(),med,due_at),'{"ok":true,"card":{"state":"done"},"next":{"kind":"ask"}}');
-- covers: rpc:zoe_v3_dose_record
 perform pg_temp.chat_call('record dose replay',format('select public.zoe_v3_dose_record(%L,%L,%L,%L,%L,''skipped'')',m,k,gen_random_uuid(),med,due_at),'{"ok":true,"replayed":true}');
 k:=(r#>>'{next,id}')::uuid;
-- covers: rpc:zoe_v3_dose_reason
 perform pg_temp.chat_call('forgot dose moves reminder',format('select public.zoe_v3_dose_reason(%L,%L,%L,''forgot'',true)',m,k,gen_random_uuid()),'{"ok":true,"card":{"state":"done"}}');
 foreach reason in array array['values_normal','side_effect_or_fear','ran_out_or_cost'] loop
  snap:=jsonb_build_object('v',1,'v3',true,'askId',gen_random_uuid(),'name','Fixture medicine','dueAt',due_at,'trigger','skipped');
-- covers: rpc:zoe_chat_card_post
  r:=pg_temp.chat_call('post dose reason '||reason,format('select public.zoe_chat_card_post(%L,%L,''ask'',''chip'',null,%L)',m,gen_random_uuid(),snap),'{"ok":true}');k:=(r#>>'{card,id}')::uuid;
-- covers: rpc:zoe_v3_dose_reason
  r:=pg_temp.chat_call('dose reason '||reason,format('select public.zoe_v3_dose_reason(%L,%L,%L,%L,false)',m,k,gen_random_uuid(),reason),'{"ok":true,"card":{"state":"done"}}');
  if reason='side_effect_or_fear' then perform pg_temp.ok(r#>>'{next,kind}'='sams','side-effect reason opens safety questions');end if;
 end loop;
 -- A second current card may change that same slot using its fresh revision.
 snap:=jsonb_build_object('v',1,'v3',true,'enabled',true,'date',timezone('Asia/Yerevan',due_at)::date,'slots',jsonb_build_array(jsonb_build_object('medicineId',med,'planId',p,'name','Fixture medicine','dose','1 tablet','dueAt',due_at,'time','00:00','status','skipped','revision',1)));
-- covers: rpc:zoe_chat_card_post
 r:=pg_temp.chat_call('post current dose correction',format('select public.zoe_chat_card_post(%L,%L,''dose'',''chip'',null,%L)',m,gen_random_uuid(),snap),'{"ok":true}');k:=(r#>>'{card,id}')::uuid;
-- covers: rpc:zoe_v3_dose_record
 perform pg_temp.chat_call('record taken plan dose',format('select public.zoe_v3_dose_record(%L,%L,%L,%L,%L,''taken'')',m,k,gen_random_uuid(),med,due_at),'{"ok":true,"card":{"state":"done"}}');
end$$;
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.patient_dose_events where user_id='ac710000-0000-4000-8000-000000000001' and medication_id='ac710000-0000-4000-8000-000000000004' and status='taken' and revision=2),'dose actions persisted one slot at taken revision 2');
select pg_temp.ok(exists(select 1 from public.patient_reminder_preferences where user_id='ac710000-0000-4000-8000-000000000001' and preferences->>'medicationOffsetMinutes'='15'),'forgot dose persisted offset');
select pg_temp.ok(exists(select 1 from public.care_queue_tasks where member_id='ac710000-0000-4000-8000-000000000001' and reason_code='medicine_access_help'),'dose access reason created logistics task');
select pg_temp.check_constraints('card_plan_dose_cases');
rollback to card_plan_dose_cases;

savepoint card_medicine_save_cases;
select pg_temp.as_service();
do $$
declare m uuid:='ac710000-0000-4000-8000-000000000001'; r jsonb; k uuid; held jsonb;
begin
-- covers: rpc:zoe_chat_card_post
 r:=pg_temp.chat_call('post medicines review',format('select public.zoe_chat_card_post(%L,''ac710000-0000-4000-8000-000000000081'',''medicines'',''chip'',null,jsonb_build_object(''v'',1,''token'',repeat(''0'',64)))',m),'{"ok":true}'); k:=(r#>>'{card,id}')::uuid;
 held:='{"kind":"review","digest":"0000000000000000000000000000000000000000000000000000000000000000","changes":[],"added":[{"requestId":"ac710000-0000-4000-8000-000000000082","name":"Fixture self reported medicine","dose":"1 tablet","time":"09:00","status":"continuous","stopReason":null,"stopConfirmed":false}]}';
-- covers: rpc:zoe_chat_card_claim
 perform pg_temp.chat_call('claim medicines review',format('select public.zoe_chat_card_claim(%L,%L,''medicines'',%L,%L)',m,k,gen_random_uuid(),held),'{"ok":true}');
end$$;
select pg_temp.as_member();
do $$
declare k uuid; r jsonb; replay jsonb;
begin
 select id into strict k from public.zoe_chat_cards where request_id='ac710000-0000-4000-8000-000000000081';
-- covers: rpc:zoe_v3_medicines_save
 r:=pg_temp.chat_call('save medicines native list and receipt',format('select public.zoe_v3_medicines_save(%L)',k),'{"status":"saved","rows":[{"name":"Fixture self reported medicine","status":"continuous","added":true}]}');
-- covers: rpc:zoe_v3_medicines_save
 replay:=pg_temp.chat_call('medicines save replay',format('select public.zoe_v3_medicines_save(%L)',k),'{"status":"saved"}');
 perform pg_temp.ok(r=replay,'medicine save replays exact durable receipt');
end$$;
select pg_temp.as_fixture();
select pg_temp.ok((select count(*)=1 from public.member_medicines where user_id='ac710000-0000-4000-8000-000000000001' and request_id='ac710000-0000-4000-8000-000000000082'),'medicine save writes exactly one native row');
select pg_temp.check_constraints('card_medicine_save_cases');
rollback to card_medicine_save_cases;

savepoint card_bp_flow_cases;
select pg_temp.as_service();
do $$
declare m uuid:='ac710000-0000-4000-8000-000000000001'; r jsonb; reading uuid; k uuid; op uuid:=gen_random_uuid(); submission uuid:=gen_random_uuid(); answer_op uuid:=gen_random_uuid(); measured timestamptz:=now(); snap jsonb; ref text;
begin
 snap:=jsonb_build_object('v',1,'week',null,'typed',jsonb_build_object('systolic',150,'diastolic',95,'pulse',70,'measuredAt',measured,'entrySource','patient_voice_confirmed'));
-- covers: rpc:zoe_chat_card_post
 r:=pg_temp.chat_call('post confirmed BP voice card',format('select public.zoe_chat_card_post(%L,%L,''bp'',''chip'',null,%L)',m,gen_random_uuid(),snap),'{"ok":true}');k:=(r#>>'{card,id}')::uuid;
-- covers: rpc:zoe_chat_card_claim
 perform pg_temp.chat_call('claim BP reading',format('select public.zoe_chat_card_claim(%L,%L,''bp'',%L,jsonb_build_object(''systolic'',150,''diastolic'',95,''pulse'',70,''measuredAt'',%L::timestamptz))',m,k,submission,measured),'{"ok":true}');
 r:=pg_temp.chat_call('save BP reading via app measurement-store insert',format('with saved as (insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,pulse,measured_at) values(%L,%L,150,95,70,%L::timestamptz) returning id) select jsonb_build_object(''measurementId'',id) from saved',m,submission,measured));reading:=(r->>'measurementId')::uuid;
 perform pg_temp.ok(reading is not null,'voice BP app insert returned saved reading');
-- covers: rpc:zoe_chat_card_record
 perform pg_temp.chat_call('record BP card receipt',format('select public.zoe_chat_card_record(%L,%L,''bp'',jsonb_build_object(''systolic'',150,''diastolic'',95,''pulse'',70,''measuredAt'',%L::timestamptz,''entrySource'',''patient_voice_confirmed'',''submissionId'',%L),true)',m,k,measured,submission),'{"ok":true}');
-- covers: rpc:zoe_bp_episode
 r:=pg_temp.chat_call('BP episode lookup',format('select public.zoe_bp_episode(%L,%L,10)',m,submission),'{"ok":true}');
 perform pg_temp.ok(r->>'readingId'=reading::text and jsonb_array_length(r->'readings')>=1,'BP episode includes saved reading');
-- covers: rpc:zoe_bp_reading_zone
 perform pg_temp.chat_call('tag BP zone',format('select public.zoe_bp_reading_zone(%L,%L,''yellow'',''zones-v1-2026-11-02'')',m,reading),'{"ok":true}');
-- covers: rpc:zoe_member_clinic_hours
 r:=pg_temp.chat_call('BP member clinic hours',format('select public.zoe_member_clinic_hours(%L)',m));
 perform pg_temp.ok(jsonb_typeof(r)='array','BP clinic hours returned schedule array');
 ref:=reading::text;
-- covers: rpc:zoe_bp_staff_item
 r:=pg_temp.chat_call('BP durable staff item',format('select public.zoe_bp_staff_item(%L,%L,%L,%L,10)',m,ref,reading,submission),'{"ok":true}');
 perform pg_temp.ok(r->>'itemId' is not null,'BP episode linked durable staff item');
-- covers: rpc:zoe_bp_task_raise
 perform pg_temp.chat_call('BP task raise',format('select public.zoe_bp_task_raise(%L,''nurse'',''yellow'',''bp_yellow'',''zones-v1-2026-11-02'',''cleared'',null,''{"readings":[{"sbp":150,"dbp":95}]}''::jsonb,now()+interval ''72 hours'',%L,%L,%L,%L,10)',m,ref||':yellow',ref,reading,submission),'{"ok":true,"task":{"queue":"nurse","zone":"yellow"}}');
 -- A yes to the first emergency question is durable before delivery bookkeeping.
 snap:=jsonb_build_object('v',1,'episodeId',ref,'readingId',reading,'readings',jsonb_build_array(jsonb_build_object('sbp',150,'dbp',95)));
-- covers: rpc:zoe_chat_card_post
 r:=pg_temp.chat_call('post BP safety questions',format('select public.zoe_chat_card_post(%L,''ac710000-0000-4000-8000-000000000091'',''red_flags'',''chip'',null,%L)',m,snap),'{"ok":true}');k:=(r#>>'{card,id}')::uuid;
-- covers: rpc:zoe_chat_card_claim
 perform pg_temp.chat_call('claim BP safety answer',format('select public.zoe_chat_card_claim(%L,%L,''a:chest_pain'',%L,''{"answer":true,"locale":"en"}'')',m,k,answer_op),'{"ok":true}');
-- covers: rpc:zoe_chat_card_record
 perform pg_temp.chat_call('record BP safety answer',format('select public.zoe_chat_card_record(%L,%L,''a:chest_pain'',jsonb_build_object(''answer'',true,''zone'',''red'',''alerted'',false,''text'',''Fixture emergency message'',''ruleVersion'',''zones-v1-2026-11-02'',''requestId'',''ac710000-0000-4000-8000-000000000092'',''doneAt'',clock_timestamp()),true)',m,k),'{"ok":true}');
-- covers: rpc:zoe_bp_messages_pending
 r:=pg_temp.chat_call('BP pending emergency delivery',format('select public.zoe_bp_messages_pending(%L,20)',m));
 perform pg_temp.ok(exists(select 1 from jsonb_array_elements(r)x where x->>'id'=k::text),'pending BP delivery includes yes answer');
-- covers: rpc:zoe_bp_delivery_record
 perform pg_temp.chat_call('BP emergency delivered receipt',format('select public.zoe_bp_delivery_record(%L,%L,''ac710000-0000-4000-8000-000000000092'')',m,k),'{"ok":true}');
-- covers: rpc:zoe_bp_messages_pending
 r:=pg_temp.chat_call('BP delivery removed from pending',format('select public.zoe_bp_messages_pending(%L,20)',m));
 perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(r)x where x->>'id'=k::text),'delivered BP emergency absent from pending');
end$$;
select pg_temp.as_member();
do $$declare r jsonb;begin
-- covers: rpc:zoe_bp_open_emergencies
 r:=pg_temp.chat_call('member BP open emergencies','select public.zoe_bp_open_emergencies()');
 perform pg_temp.ok(exists(select 1 from jsonb_array_elements(r->'cards')x where x->>'requestId'='ac710000-0000-4000-8000-000000000091'),'delivered BP emergency remains open until explicit clear');
end$$;
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.patient_measurements where user_id='ac710000-0000-4000-8000-000000000001' and entry_source='patient_voice_confirmed' and zone='yellow' and zone_rule_version='zones-v1-2026-11-02'),'BP write preserved confirmed voice provenance and zone');
select pg_temp.check_constraints('card_bp_flow_cases');
rollback to card_bp_flow_cases;


savepoint legacy_plan_dose;
select pg_temp.as_member();
-- covers: rpc:report_patient_dose_versioned
-- The current validator accepts today's schedule (or the 15-minute midnight carry),
-- not an arbitrary dose from yesterday. This is the same due slot the app offers.
select pg_temp.chat_call('dose / legacy published plan report',$q$select to_jsonb(public.report_patient_dose_versioned(p_medication_id=>pg_temp.id(4),p_due_at=>((now()at time zone 'Asia/Yerevan')::date+time '00:00')at time zone 'Asia/Yerevan',p_status=>'taken',p_expected_revision=>0))$q$,'1');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.patient_dose_events where medication_id=pg_temp.id(4)and status='taken'and revision=1),'legacy plan dose stored');
select pg_temp.check_constraints('legacy_plan_dose');
rollback to legacy_plan_dose;
-- The next-step projection reads actual collected samples and their lab stages.
savepoint lab_stage_read;
insert into public.patient_care_visit_command_receipts(user_id,submission_id,actor_id,session_id,command,state,result)
 values(pg_temp.id(1),pg_temp.id(120),pg_temp.id(7),pg_temp.id(107),'{}','committed','{}');
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id)
 values(pg_temp.id(121),pg_temp.id(1),pg_temp.id(7),'Fictional chat nurse','nurse',pg_temp.id(10));
insert into public.patient_care_visit_entries(id,user_id,visit_id,submission_id,position,payload,observed_at,observed_instant,actor_id,actor_name,actor_role,clinic_id)
 values(pg_temp.id(122),pg_temp.id(1),pg_temp.id(121),pg_temp.id(120),1,
 jsonb_build_object('kind','collection','observedAt',now()-interval '1 hour','testId','cbc','outcome','collected'),
 (now()-interval '1 hour')::text,now()-interval '1 hour',pg_temp.id(7),'Fictional chat nurse','nurse',pg_temp.id(10));
insert into public.patient_care_lab_stages(user_id,collection_entry_id,stage,submission_id,occurred_at,actor_id,actor_name,actor_role,clinic_id)
 values(pg_temp.id(1),pg_temp.id(122),'at-lab',pg_temp.id(123),now()-interval '30 minutes',pg_temp.id(7),'Fictional chat nurse','nurse',pg_temp.id(10));
select pg_temp.as_member();
-- covers: rpc:patient_member_lab_stages
select pg_temp.chat_call('next step / lab stage',$q$select public.patient_member_lab_stages()$q$,
 '{"samples":[{"testId":"cbc","stages":[{"stage":"at-lab"}]}]}');
-- covers: rpc:patient_clinical_case_status
select pg_temp.chat_call('next step / clinical review status',$q$select public.patient_clinical_case_status()$q$);
-- covers: rpc:patient_member_nurse_visit
select pg_temp.chat_call('next step / nurse visit progress',$q$select public.patient_member_nurse_visit()$q$,'{"version":"nurse-visit-v1"}');
select pg_temp.as_fixture();
select pg_temp.check_constraints('lab_stage_read');
rollback to lab_stage_read;

-- Fresh review enrollment has no existing case, so creation cannot silently no-op.
savepoint fresh_enrollment;
insert into auth.users(id,phone,phone_confirmed_at)values(pg_temp.id(8),'99971000008',now());
update public.profiles set display_name='Fictional new member',birth_date='1970-01-01',biological_sex='female',locale='en'where id=pg_temp.id(8);
insert into public.patient_consents(user_id,version)values(pg_temp.id(8),'patient-pilot-v1');
insert into public.patient_assessments(user_id,answers,completed_at)values(pg_temp.id(8),'{}',now());
select pg_temp.as_member(pg_temp.id(8),null);
-- covers: rpc:enroll_patient_clinical_case
select pg_temp.chat_call('review / first enrollment',$q$select to_jsonb(public.enroll_patient_clinical_case())$q$,to_jsonb(pg_temp.id(8)));
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.patient_clinical_cases where user_id=pg_temp.id(8)),'new clinical case created');
select pg_temp.ok(exists(select 1 from public.patient_clinical_case_events where user_id=pg_temp.id(8)and kind='enrolled'),'new enrollment event recorded');
select pg_temp.check_constraints('fresh_enrollment');
rollback to fresh_enrollment;

-- Included in root rollback transaction. Root fixtures: member ...001, assigned
-- doctor ...002, clinic ...010 under ac710000-0000-4000-8000-000000000000.
-- No storage bytes are uploaded. A real storage metadata row satisfies the RPC's
-- bucket/name/size fence; returned URL target and audit persistence are tested.
-- Latest open RPC 20261017084011, attachment-current 20261016215605,
-- release lookup seq ordering 20261019080051; file guard 20261018161309.
-- Notice read latest 20261104174400; mark_seen 20261101212925.
-- All normal FK/check/trigger enforcement remains enabled.
savepoint chat_document_open;
select pg_temp.as_fixture();
update public.doctor_completion_capabilities set enabled=true;
insert into auth.users(id)values('ac71d000-0000-4000-8000-000000000001');
insert into auth.sessions(id,user_id,created_at,updated_at)
 values('ac71d000-0000-4000-8000-000000000002','ac71d000-0000-4000-8000-000000000001',now(),now());
insert into public.clinic_portal_memberships(id,user_id,clinic_id,display_name,role)
 values('ac71d000-0000-4000-8000-000000000003','ac71d000-0000-4000-8000-000000000001','ac710000-0000-4000-8000-000000000010','Synthetic clinic operator','admin');
insert into public.clinic_batches(id,clinic_id,name,uploader_id,uploader_name)
 values('ac71d000-0000-4000-8000-000000000010','ac710000-0000-4000-8000-000000000010','Synthetic released report batch','ac71d000-0000-4000-8000-000000000001','Synthetic clinic operator');
insert into public.clinic_batch_commands(actor_id,submission_id,session_id,clinic_id,batch_id,payload,state,result)
 values('ac71d000-0000-4000-8000-000000000001','ac71d000-0000-4000-8000-000000000011','ac71d000-0000-4000-8000-000000000002',
 'ac710000-0000-4000-8000-000000000010','ac71d000-0000-4000-8000-000000000010','{}','committed','{}');
insert into storage.objects(id,bucket_id,name,metadata)
 values('ac71d000-0000-4000-8000-000000000012','clinic-originals','chat-document-fixture/released.pdf','{"size":10,"mimetype":"application/pdf"}');
insert into public.clinic_batch_files(id,batch_id,logical_key,attempt_id,actor_id,session_id,amr,jwt_expires_at,membership_id,membership_revision,submission_id,
 name,mime,declared_size,expected_sha256,object_key,object_id,measured_size,sha256,state,execution)
 values('ac71d000-0000-4000-8000-000000000013','ac71d000-0000-4000-8000-000000000010','ac71d000-0000-4000-8000-000000000014','ac71d000-0000-4000-8000-000000000015',
 'ac71d000-0000-4000-8000-000000000001','ac71d000-0000-4000-8000-000000000002','[{"method":"password"}]',now()+interval '1 hour',
 'ac71d000-0000-4000-8000-000000000003',1,'ac71d000-0000-4000-8000-000000000011','Synthetic private clinic report.pdf','application/pdf',10,repeat('d',64),
 'chat-document-fixture/released.pdf','ac71d000-0000-4000-8000-000000000012',10,repeat('d',64),'stored','ended');
-- A legacy clinic-upload visit has no booking, per the live source/role constraint.
insert into public.patient_care_visits(id,user_id,actor_id,actor_name,actor_role,clinic_id,source)
 values('ac71d000-0000-4000-8000-000000000020','ac710000-0000-4000-8000-000000000001','ac71d000-0000-4000-8000-000000000001',
 'Synthetic clinic operator','clinic','ac710000-0000-4000-8000-000000000010','clinic-upload');
insert into public.clinic_result_attachments(id,file_id,clinic_id,user_id,visit_id,actor_kind,actor_id,submission_id)
 values('ac71d000-0000-4000-8000-000000000021','ac71d000-0000-4000-8000-000000000013','ac710000-0000-4000-8000-000000000010',
 'ac710000-0000-4000-8000-000000000001','ac71d000-0000-4000-8000-000000000020','clinic-admin','ac71d000-0000-4000-8000-000000000001','ac71d000-0000-4000-8000-000000000022');
insert into public.patient_document_release_events(id,user_id,file_id,attachment_id,kind,single_member_confirmed,actor_id,submission_id)
 values('ac71d000-0000-4000-8000-000000000023','ac710000-0000-4000-8000-000000000001','ac71d000-0000-4000-8000-000000000013',
 'ac71d000-0000-4000-8000-000000000021','released',true,'ac710000-0000-4000-8000-000000000002','ac71d000-0000-4000-8000-000000000024');
select pg_temp.as_member();
-- covers: rpc:patient_released_documents
select pg_temp.chat_call('results.released_documents',$q$select public.patient_released_documents()$q$,
 '{"version":"released-documents-v1","documents":[{"fileId":"ac71d000-0000-4000-8000-000000000013"}]}');
-- Real openMemberDocument boundary. This writes its own member-open audit row.
-- covers: rpc:patient_released_document_open
select pg_temp.chat_call('results.document.open',$q$select public.patient_released_document_open(p_file=>'ac71d000-0000-4000-8000-000000000013')$q$,
 '{"fileId":"ac71d000-0000-4000-8000-000000000013","bucket":"clinic-originals","objectKey":"chat-document-fixture/released.pdf","sha256":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd","sizeBytes":10}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.patient_document_opens where file_id='ac71d000-0000-4000-8000-000000000013'
 and attachment_id='ac71d000-0000-4000-8000-000000000021' and actor_id='ac710000-0000-4000-8000-000000000001' and actor_kind='member'
 and session_id='ac710000-0000-4000-8000-000000000101'),'released document open is audited for real member/session');
select pg_temp.check_constraints('chat_document_open');
rollback to chat_document_open;

savepoint chat_app_notice;
select pg_temp.as_fixture();
insert into public.member_notices(id,member_id,event_key,notice_group,template_id,outcome,reason,app_text,params)
 values('ac71d000-0000-4000-8000-000000000030','ac710000-0000-4000-8000-000000000001','chat.fixture:app-notice','care',
 'member.home_received','skipped','telegram_off','Your synthetic request was received.','{}');
select pg_temp.as_member();
-- covers: rpc:member_notices_read
select pg_temp.chat_call('chat.notice.read',$q$select public.member_notices_read()$q$,
 '{"notices":[{"id":"ac71d000-0000-4000-8000-000000000030","text":"Your synthetic request was received.","closed":false}]}');
-- covers: rpc:member_notices_mark_seen
select pg_temp.chat_call('chat.notice.mark_seen',$q$select public.member_notices_mark_seen(p_id=>'ac71d000-0000-4000-8000-000000000030')$q$,'{"ok":true}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.member_notice_seen s join public.member_notices n on n.member_id=s.member_id
 where n.id='ac71d000-0000-4000-8000-000000000030' and s.seen_at>=n.created_at),'app notice seen watermark persisted');
select pg_temp.check_constraints('chat_app_notice');
rollback to chat_app_notice;

savepoint upload_persistence;
select pg_temp.as_service();
-- covers: rpc:rate_limit_claim
select pg_temp.chat_call('document / upload admission',$q$select to_jsonb(public.rate_limit_claim(p_operation=>'member_upload',p_kinds=>array['source','user'],p_keys=>array[repeat('a',64),repeat('b',64)],p_modes=>array['take','take']))$q$,'0');
-- Storage bytes go through the Storage API. This exercises its following DB write
-- with the exact saved-not-read shape, after synthetic byte metadata is prepared.
-- covers: table:member_reported_documents:insert
select pg_temp.chat_call('document / save upload metadata',$q$with saved as(insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256,result_date,auto_read_allowed,uploader_role)
 values(pg_temp.id(131),pg_temp.id(1),pg_temp.id(1)::text||'/'||pg_temp.id(131)::text||'.pdf','fictional-new.pdf','application/pdf',100,repeat('c',64),current_date-1,false,'member')returning*)select to_jsonb(saved)from saved$q$,'{"auto_read_allowed":false,"uploader_role":"member"}');
-- Classic chat uses the same write without the V3 metadata fields.
-- covers: table:member_reported_documents:insert
select pg_temp.chat_call('document / save classic upload metadata',$q$with saved as(insert into public.member_reported_documents(id,user_id,object_path,file_name,mime,size_bytes,sha256,result_date)
 values(pg_temp.id(132),pg_temp.id(1),pg_temp.id(1)::text||'/'||pg_temp.id(132)::text||'.pdf','fictional-classic.pdf','application/pdf',100,repeat('d',64),null)returning*)select to_jsonb(saved)from saved$q$,'{"auto_read_allowed":true}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.member_reported_documents where id=pg_temp.id(131)),'upload metadata exists');
select pg_temp.check_constraints('upload_persistence');
rollback to upload_persistence;

-- Optional enrollment reply linking uses a real fictional binding. This only
-- persists local endpoint/outbox rows; no Telegram call or provider is invoked.
savepoint enrollment_replies;
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)
 values('noreon_chat_actions',97101,600,'chat-actions-synthetic')
 on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id,consent_version=excluded.consent_version;
insert into public.telegram_auth_bindings(id,auth_user_id,kind,principal_ref,account_ref,phone,address,generation)
 select pg_temp.id(140),pg_temp.id(1),'member','chat-actions-fictional',public._telegram_account_ref(s),'+99971000001','97101001',1 from public.telegram_channel_settings s;
select pg_temp.as_member();
-- covers: rpc:telegram_replies_auto_link
select pg_temp.chat_call('questionnaire / link enrolled replies',$q$select public.telegram_replies_auto_link(p_explicit=>false)$q$,'{"ok":true,"result":"linked"}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.conversation_endpoints where member_id=pg_temp.id(1)and adapter='telegram'and active),'enrollment reply endpoint exists');
insert into public.telegram_auth_messages(id,address,principal_ref,template_id,template_version,locale,body,state)
 values(pg_temp.id(141),'97101001','chat-actions-fictional','telegram.contact_ok',1,'en','Fictional sign-in link','held');
insert into public.telegram_signin_links(id,auth_user_id,binding_id,binding_generation,principal_ref,step,message_id,token_hash,state,armed_at,expires_at)
 values(pg_temp.id(142),pg_temp.id(1),pg_temp.id(140),1,'chat-actions-fictional','next_review',pg_temp.id(141),repeat('e',64),'armed',now(),now()+interval '10 minutes');
select pg_temp.as_service();
-- covers: rpc:telegram_signin_links_cancel
select pg_temp.chat_call('account / sign-out link cancellation',$q$select public.telegram_signin_links_cancel(p_user=>pg_temp.id(1))$q$,'{"ok":true,"cancelled":1}');
select pg_temp.as_fixture();
select pg_temp.ok((select state='cancelled'from public.telegram_signin_links where id=pg_temp.id(142)),'sign-out cancels armed link');
select pg_temp.ok(exists(select 1 from public.telegram_auth_audit where auth_user_id=pg_temp.id(1)and kind='signin_link.cancelled'and detail->>'reason'='sign_out'),'sign-out cancellation audited');
select pg_temp.check_constraints('enrollment_replies');
rollback to enrollment_replies;

savepoint push_subscription;
select pg_temp.as_member();
-- covers: rpc:member_push_subscribe
select pg_temp.chat_call('notifications / turn on',$q$select public.member_push_subscribe(p_endpoint=>'https://fcm.googleapis.com/fcm/send/chat-actions-fictional',p_p256dh=>'B'||repeat('A',86),p_auth=>repeat('B',21)||'A')$q$,'{"ok":true}');
select pg_temp.as_fixture();
select pg_temp.ok(exists(select 1 from public.member_push_subscriptions where member_id=pg_temp.id(1)and endpoint='https://fcm.googleapis.com/fcm/send/chat-actions-fictional'),'push subscription created');
select pg_temp.as_member();
-- covers: rpc:member_push_unsubscribe
select pg_temp.chat_call('notifications / turn off',$q$select public.member_push_unsubscribe(p_endpoint=>'https://fcm.googleapis.com/fcm/send/chat-actions-fictional')$q$,'{"ok":true}');
select pg_temp.as_fixture();
select pg_temp.ok(not exists(select 1 from public.member_push_subscriptions where member_id=pg_temp.id(1)and endpoint='https://fcm.googleapis.com/fcm/send/chat-actions-fictional'),'push subscription removed');
select pg_temp.check_constraints('push_subscription');
rollback to push_subscription;


-- Per-command persistence payloads, in addition to the feature writes above.
-- Keep these receipts below the live 40-card/hour limit; this savepoint resets it.
savepoint command_receipts;
select pg_temp.as_service();
do $$
declare v record;r jsonb;k uuid;op uuid;payload jsonb;receipt jsonb;
begin
 for v in select a.*,s.snapshot from(values
  ('account profile','account','account','{"kind":"profile","digest":"0000000000000000000000000000000000000000000000000000000000000000"}'::jsonb,'{"kind":"profile","ok":true}'::jsonb,true),
  ('account language','account','account','{"kind":"language","digest":"0000000000000000000000000000000000000000000000000000000000000000"}'::jsonb,'{"kind":"language","ok":true}'::jsonb,true),
  ('account reminders','account','account','{"kind":"reminders","digest":"0000000000000000000000000000000000000000000000000000000000000000"}'::jsonb,'{"kind":"reminders","ok":true}'::jsonb,true),
  ('booking select','visit','booking','{"kind":"select","fields":{"offerId":"ac71f000-0000-4000-8000-000000000032","offerVersion":"chat-v1","homeAddress":""}}'::jsonb,'{"kind":"select","ok":true,"code":"saved","dialog":true}'::jsonb,true),
  ('booking change','visit','booking','{"kind":"change","fields":{"offerId":"ac71f000-0000-4000-8000-000000000033","offerVersion":"chat-v1","homeAddress":"","appointmentId":"ac71f000-0000-4000-8000-000000000040","revision":"0","agreementSource":""}}'::jsonb,'{"kind":"change","ok":true,"code":"saved","dialog":true}'::jsonb,true),
  ('booking cancel','visit','booking','{"kind":"cancel","fields":{"appointmentId":"ac71f000-0000-4000-8000-000000000040","revision":"0","agreementSource":""}}'::jsonb,'{"kind":"cancel","ok":true,"code":"saved","dialog":true}'::jsonb,true),
  ('booking proposal','visit','booking','{"kind":"proposal","fields":{"proposalId":"ac71f000-0000-4000-8000-000000000050","accept":"true"}}'::jsonb,'{"kind":"proposal","ok":true,"code":"saved","dialog":true}'::jsonb,true),
  ('booking legacy','visit','booking','{"kind":"legacy","fields":{"operation":"cancel","id":"ac71f000-0000-4000-8000-000000000060","revision":"0"}}'::jsonb,'{"kind":"legacy","ok":true,"code":"saved","dialog":true}'::jsonb,true),
  ('visit preference','visit','booking','{"kind":"visit_request","day":"2026-11-09","window":"morning","note":"","locale":"en"}'::jsonb,'{"kind":"visit_request","day":"2026-11-09","window":"morning","note":"","locale":"en","requestId":"$op","ok":true,"dialog":true}'::jsonb,true),
  ('admin reschedule','visit','booking','{"kind":"admin_change"}'::jsonb,'{"kind":"admin_change","ok":true,"dialog":true}'::jsonb,true),
  ('medicine add','medicines','medicines','{"command":{"kind":"add","name":"Fictional medicine","dose":"1 tablet","times":["08:00"]}}'::jsonb,'{"kind":"add","status":"added"}'::jsonb,true),
  ('medicine edit','medicines','medicines','{"command":{"kind":"edit","id":"ac710000-0000-4000-8000-000000000040","dose":"1 tablet","times":["09:00"]}}'::jsonb,'{"kind":"edit","status":"saved"}'::jsonb,true),
  ('medicine times','medicines','medicines','{"command":{"kind":"times","id":"ac710000-0000-4000-8000-000000000040","times":["09:00"]}}'::jsonb,'{"kind":"times","status":"saved"}'::jsonb,true),
  ('medicine stop','medicines','medicines','{"command":{"kind":"stop","id":"ac710000-0000-4000-8000-000000000040"}}'::jsonb,'{"kind":"stop","status":"stopped"}'::jsonb,true),
  ('medicine reason','medicines','medicines','{"command":{"kind":"reason","askId":"ac710000-0000-4000-8000-000000000061","reason":"forgot"}}'::jsonb,'{"kind":"reason","status":"answered"}'::jsonb,true),
  ('medicine keep','medicines','medicines','{"command":{"kind":"keep","askId":"ac710000-0000-4000-8000-000000000061"}}'::jsonb,'{"kind":"keep","status":"closed"}'::jsonb,true),
  ('medicine refill','medicines','medicines','{"command":{"kind":"refill","askId":"ac710000-0000-4000-8000-000000000061"}}'::jsonb,'{"kind":"refill","status":"sent"}'::jsonb,true),
  ('medicine restoration receipt','medicines','medicines','{"kind":"restore","id":"ac710000-0000-4000-8000-000000000040"}'::jsonb,'{"kind":"review","status":"saved","rows":[{"name":"Fictional own medicine","status":"restored","stopReason":null,"added":false}]}'::jsonb,true),
  ('profile contact receipt','profile','profile','{"channel":"text","wake":"07:00","sleep":"22:00","caregiver":true,"proof":"0000000000000000000000000000000000000000000000000000000000000000"}'::jsonb,'{"channel":"text","wake":"07:00","sleep":"22:00","caregiver":true}'::jsonb,true),
  ('document details receipt','document','document','{"cardId":"$card","opId":"$op","docType":"lab","studyDate":"2026-11-06","medicineChangedSince":false}'::jsonb,'{"docType":"lab","studyDate":"2026-11-06","medicineChangedSince":false,"fresh":true}'::jsonb,true),
  ('lab read','prep','prep','{"cardId":"$card","opId":"$op","answer":"read"}'::jsonb,'{"answer":"read"}'::jsonb,true),
  ('lab fasting','fasting','fasting','{"cardId":"$card","opId":"$op","answer":"fasting"}'::jsonb,'{"answer":"fasting"}'::jsonb,true),
  ('lab ate','fasting','fasting','{"cardId":"$card","opId":"$op","answer":"ate"}'::jsonb,'{"answer":"ate"}'::jsonb,true),
  ('symptom acute','symptom_gate','symptom_gate','{"cardId":"$card","opId":"$op","choice":"acute","locale":"en"}'::jsonb,'{"choice":"acute","requestId":"$op","urgent":true}'::jsonb,true),
  ('symptom planned','symptom_gate','symptom_gate','{"cardId":"$card","opId":"$op","choice":"planned","locale":"en"}'::jsonb,'{"choice":"planned","requestId":"$op","urgent":false}'::jsonb,true),
  ('consult sent receipt','consult_questions','consult_questions','{"cardId":"$card","opId":"$op","locale":"en","groups":[{"label":"results","text":"Fictional question"}]}'::jsonb,'{"requestId":"$op","sent":true}'::jsonb,true),
  ('review receipt','review','review','{}'::jsonb,'{"saved":true}'::jsonb,true),
  ('everyday earlier','menu','everyday','{"view":"earlier","digest":"0000000000000000000000000000000000000000000000000000000000000000"}'::jsonb,'{"attempted":true}'::jsonb,false),
  ('everyday lessons','menu','everyday','{"view":"lessons","digest":"0000000000000000000000000000000000000000000000000000000000000000"}'::jsonb,'{"attempted":true}'::jsonb,false),
  ('everyday plan_ack','plan','everyday','{"view":"plan_ack","digest":"0000000000000000000000000000000000000000000000000000000000000000"}'::jsonb,'{"attempted":true}'::jsonb,false)
 )a(label,kind,item,payload,receipt,close_card)join chat_card_snapshots s using(kind)loop
-- covers: rpc:zoe_chat_card_post
  r:=pg_temp.chat_call(v.label||' / post',format('select public.zoe_chat_card_post(p_member=>%L,p_request=>%L,p_kind=>%L,p_source=>''chip'',p_source_seq=>null,p_snapshot=>%L)',pg_temp.id(1),gen_random_uuid(),v.kind,v.snapshot),'{"ok":true}');
  k:=(r#>>'{card,id}')::uuid;op:=gen_random_uuid();
  payload:=replace(replace(v.payload::text,'"$card"',to_jsonb(k)::text),'"$op"',to_jsonb(op)::text)::jsonb;
  receipt:=replace(v.receipt::text,'"$op"',to_jsonb(op)::text)::jsonb;
-- covers: rpc:zoe_chat_card_claim
  perform pg_temp.chat_call(v.label||' / claim',format('select public.zoe_chat_card_claim(p_member=>%L,p_card=>%L,p_item=>%L,p_op=>%L,p_payload=>%L)',pg_temp.id(1),k,v.item,op,payload),'{"ok":true,"won":true}');
-- covers: rpc:zoe_chat_card_record
  r:=pg_temp.chat_call(v.label||' / receipt',format('select public.zoe_chat_card_record(p_member=>%L,p_card=>%L,p_item=>%L,p_value=>%L,p_close=>%L)',pg_temp.id(1),k,v.item,receipt,v.close_card),'{"ok":true}');
  perform pg_temp.ok((r#>array['card','outcome',v.item])@>receipt,v.label||' persisted receipt');
  if v.item='everyday'then
-- covers: rpc:zoe_chat_card_claim
   perform pg_temp.chat_call(v.label||' / result claim',format('select public.zoe_chat_card_claim(p_member=>%L,p_card=>%L,p_item=>''everyday:result'',p_op=>%L,p_payload=>''{}'')',pg_temp.id(1),k,op),'{"ok":true}');
-- covers: rpc:zoe_chat_card_record
   perform pg_temp.chat_call(v.label||' / saved result',format('select public.zoe_chat_card_record(p_member=>%L,p_card=>%L,p_item=>''everyday:result'',p_value=>''{"status":"saved"}'',p_close=>true)',pg_temp.id(1),k),'{"ok":true,"card":{"state":"done"}}');
  end if;
 end loop;
end$$;
select pg_temp.as_fixture();
select pg_temp.check_constraints('command_receipts');
rollback to command_receipts;

-- Every BP and SAMS question uses its actual lowercase item key; both answers
-- must remain writable. Each card is independent of prior safety outcomes.
savepoint safety_answer_receipts;
select pg_temp.as_service();
do $$declare card_kind text;item text;answer boolean;r jsonb;k uuid;begin
 foreach card_kind in array array['red_flags','sams']loop
  foreach item in array (case when card_kind='red_flags'then array['chest_pain','dyspnea','neuro','headache_dizziness','faint']else array['musclepain','weakness','darkurine','fever','jaundice','rightupperpain']end) loop
   foreach answer in array array[false,true]loop
-- covers: rpc:zoe_chat_card_post
    r:=pg_temp.chat_call(card_kind||' '||item||' / post',format('select public.zoe_chat_card_post(%L,%L,%L,''chip'',null,%L)',pg_temp.id(1),gen_random_uuid(),card_kind,(select snapshot from chat_card_snapshots where chat_card_snapshots.kind=card_kind)),'{"ok":true}');k:=(r#>>'{card,id}')::uuid;
-- covers: rpc:zoe_chat_card_claim
    perform pg_temp.chat_call(card_kind||' '||item||' / answer',format('select public.zoe_chat_card_claim(%L,%L,%L,%L,%L)',pg_temp.id(1),k,'a:'||item,gen_random_uuid(),jsonb_build_object('answer',answer,'locale','en')),'{"ok":true}');
-- covers: rpc:zoe_chat_card_record
    perform pg_temp.chat_call(card_kind||' '||item||' / outcome',format('select public.zoe_chat_card_record(%L,%L,%L,%L,false)',pg_temp.id(1),k,'a:'||item,jsonb_build_object('answer',answer)),'{"ok":true}');
   end loop;
  end loop;
 end loop;
end$$;
select pg_temp.as_fixture();
select pg_temp.check_constraints('safety_answer_receipts');
rollback to safety_answer_receipts;

-- Definite refusals release their own medicine/profile claim so a corrected form can save.
-- #732 permits only the main unrecorded claim on an open card. Other claims and
-- outcomes stay intact; done cards and recorded items retain their immutability.
savepoint card_unclaim_cases;
select pg_temp.as_service();
do $$
declare m uuid:='ac710000-0000-4000-8000-000000000001'; kind text; r jsonb; k uuid; op uuid;
 before_release public.zoe_chat_cards; before_refusal public.zoe_chat_cards; detected boolean;
begin
 foreach kind in array array['medicines','profile'] loop
-- covers: rpc:zoe_chat_card_post
  r:=pg_temp.chat_call('post retryable '||kind,format('select public.zoe_chat_card_post(%L,%L,%L,''chip'',null,%L)',m,gen_random_uuid(),kind,case when kind='medicines' then jsonb_build_object('v',1,'token',repeat('0',64))else '{"v":1,"wake":"07:00","sleep":"22:00"}'::jsonb end),'{"ok":true}');k:=(r#>>'{card,id}')::uuid;op:=gen_random_uuid();
-- covers: rpc:zoe_chat_card_claim
  perform pg_temp.chat_call('claim retained item / '||kind,format('select public.zoe_chat_card_claim(%L,%L,''retained'',%L,''{}'')',m,k,gen_random_uuid()),'{"ok":true,"won":true}');
-- covers: rpc:zoe_chat_card_record
  perform pg_temp.chat_call('record retained item / '||kind,format('select public.zoe_chat_card_record(%L,%L,''retained'',''{"saved":true}'',false)',m,k),'{"ok":true}');
-- covers: rpc:zoe_chat_card_claim
  perform pg_temp.chat_call('claim retryable '||kind,format('select public.zoe_chat_card_claim(%L,%L,%L,%L,''{}'')',m,k,kind,op),'{"ok":true,"won":true}');
  select * into before_release from public.zoe_chat_cards where id=k;
-- covers: rpc:zoe_chat_card_unclaim
  perform pg_temp.chat_call('release failed-write claim / '||kind,format('select public.zoe_chat_card_unclaim(p_member=>%L,p_card=>%L,p_item=>%L,p_op=>%L)',m,k,kind,op),'{"ok":true}');
  perform pg_temp.ok((select claims=before_release.claims-before_release.kind and not claims?before_release.kind
   and outcome=before_release.outcome and snapshot=before_release.snapshot and send_attempts=before_release.send_attempts and state='open'
   from public.zoe_chat_cards where id=k),'unclaim removes only unfinished main claim / '||kind);
  op:=gen_random_uuid();
-- covers: rpc:zoe_chat_card_claim
  r:=pg_temp.chat_call('corrected claim wins / '||kind,format('select public.zoe_chat_card_claim(%L,%L,%L,%L,''{"corrected":true}'')',m,k,kind,op),'{"ok":true,"won":true}');
  perform pg_temp.ok(r#>>'{claim,op}'=op::text and r#>'{claim,payload}'='{"corrected":true}'::jsonb,'corrected '||kind||' payload retained');
  -- Close via another item while the main claim is unfinished. The RPC reaches
  -- the trigger, which must still reject removing that claim from a done card.
-- covers: rpc:zoe_chat_card_claim
  perform pg_temp.chat_call('claim closing item / '||kind,format('select public.zoe_chat_card_claim(%L,%L,''finished'',%L,''{}'')',m,k,gen_random_uuid()),'{"ok":true,"won":true}');
-- covers: rpc:zoe_chat_card_record
  perform pg_temp.chat_call('finish card / '||kind,format('select public.zoe_chat_card_record(%L,%L,''finished'',''{"saved":true}'',true)',m,k),'{"ok":true,"card":{"state":"done"}}');
  select * into before_refusal from public.zoe_chat_cards where id=k;
  detected:=false;
  perform pg_temp.assert_identity();
  begin
-- covers: rpc:zoe_chat_card_unclaim
   perform public.zoe_chat_card_unclaim(p_member=>m,p_card=>k,p_item=>kind,p_op=>op);
  exception when check_violation then detected:=sqlstate='23514' and sqlerrm='zoe_chat_cards rows are immutable';end;
  perform pg_temp.ok(detected,'done card refuses unfinished claim release / '||kind);
  -- A recorded item is refused by the RPC before the trigger runs, even with
  -- the original operation. Direct removal must still hit the immutable trigger.
-- covers: rpc:zoe_chat_card_unclaim
  perform pg_temp.chat_call('recorded item refuses release / '||kind,format('select public.zoe_chat_card_unclaim(%L,%L,''finished'',%L)',m,k,before_refusal.claims#>>'{finished,op}'),'{"ok":false}');
  detected:=false;
  begin
   update public.zoe_chat_cards set claims=claims-'finished' where id=k;
  exception when check_violation then detected:=sqlstate='23514' and sqlerrm='zoe_chat_cards rows are immutable';end;
  perform pg_temp.ok(detected,'recorded item remains immutable / '||kind);
  perform pg_temp.ok((select claims=before_refusal.claims and outcome=before_refusal.outcome and state='done'
   from public.zoe_chat_cards where id=k),'refused releases preserve claims and outcomes / '||kind);
 end loop;
end$$;
select pg_temp.as_fixture();
select pg_temp.check_constraints('card_unclaim_cases');
rollback to card_unclaim_cases;

rollback;
\echo 'member chat actions DB checks passed'
