-- Blood pressure flow storage: the new kinds, the episode window, the zone columns, member access. Synthetic, rolled back.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
insert into auth.users(id,email)values('b0000000-0000-4000-8000-000000000001','bp-flow@example.test'),('b0000000-0000-4000-8000-000000000002','bp-other@example.test');
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at,created_at)values
 ('b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000001',150,95,now()-interval '30 minutes',now()-interval '30 minutes'),
 ('b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000002',166,98,now()-interval '5 minutes',now()-interval '5 minutes'),
 ('b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003',164,96,now(),now()),
 ('b0000000-0000-4000-8000-000000000002','b1000000-0000-4000-8000-000000000004',200,100,now(),now());
select pg_temp.ok(jsonb_array_length(public.zoe_bp_episode('b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003',10)->'readings')=2,'The episode is the last 10 minutes, this member only');
select pg_temp.ok((public.zoe_bp_episode('b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000003',10)->'readings'->0->>'sbp')='166','Oldest first');
select pg_temp.ok((public.zoe_bp_episode('b0000000-0000-4000-8000-000000000001','b1000000-0000-4000-8000-000000000004',10)->>'code')='not_found','Another member''s submission is not found');
select pg_temp.ok((public.zoe_bp_reading_zone('b0000000-0000-4000-8000-000000000002',(select id from public.patient_measurements where submission_id='b1000000-0000-4000-8000-000000000003'),'yellow','v1')->>'code')='not_found','A zone is only written on the member''s own reading');
select pg_temp.ok((public.zoe_bp_reading_zone('b0000000-0000-4000-8000-000000000001',(select id from public.patient_measurements where submission_id='b1000000-0000-4000-8000-000000000003'),'purple','v1')->>'code')='invalid','Only the four zones');
select pg_temp.ok((public.zoe_bp_reading_zone('b0000000-0000-4000-8000-000000000001',(select id from public.patient_measurements where submission_id='b1000000-0000-4000-8000-000000000003'),'yellow','v1')->>'ok')='true','Zone stored');
select pg_temp.ok((select zone='yellow'and zone_rule_version='v1'and entry_source='patient_text_entry'and source='manual'from public.patient_measurements where submission_id='b1000000-0000-4000-8000-000000000003'),'Zone, version and source tag stored; source stays manual');
select pg_temp.ok(public.zoe_member_clinic_hours('b0000000-0000-4000-8000-000000000002')='[]'::jsonb,'No doctor, no hours');
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_bp_episode(uuid,uuid,integer)','execute'),'Members cannot call the episode read');
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_bp_reading_zone(uuid,uuid,text,text)','execute'),'Members cannot write a zone');
select pg_temp.ok(not has_function_privilege('anon','public.zoe_member_clinic_hours(uuid)','execute'),'Clinic hours are service only');
select pg_temp.ok(pg_get_constraintdef((select oid from pg_constraint where conname='zoe_chat_cards_kind_check'))like'%red_flags%','The new kinds are allowed');

-- BP4-R1: completed answers are durable work even if care-alert raising was unavailable.
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot,state,outcome,created_at)values
 ('b2000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000001','red_flags','chip',
  '{"v":1,"episodeId":"episode","readingId":null,"readings":[{"sbp":170,"dbp":105}]}','done',
  jsonb_build_object('a:chest_pain',jsonb_build_object('answer',true,'zone','red','alerted',false,'requestId','b4000000-0000-4000-8000-000000000001','text','Synthetic answer','doneAt',clock_timestamp()-interval '1 hour','ruleVersion','zones-v1-test')),clock_timestamp()-interval '2 hours');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
insert into public.care_alert_settings(enabled)values(false)on conflict(singleton)do update set enabled=false;
select pg_temp.ok(public.care_alert_bp_flags_retry(20)->>'raised'='0','Off: card remains pending');
select pg_temp.ok((select not outcome?'alert'and state='done'from public.zoe_chat_cards where id='b2000000-0000-4000-8000-000000000001'),'Failure leaves the completed 103 answer intact');
update public.care_alert_settings set enabled=true;
select pg_temp.ok(public.care_alert_bp_flags_retry(20)->>'raised'='1','The ordinary sweep recovers the alert without an answer replay');
select pg_temp.ok(public.care_alert_bp_flags_retry(20)->>'raised'='0','A second sweep does not repeat the alert');
select pg_temp.ok((select count(*)=1 and max(occurrences)=1 from public.care_alerts where member_id='b0000000-0000-4000-8000-000000000001'and source='zoe'),'Exactly one alert occurrence');
select pg_temp.ok((select outcome#>>'{alert,alerted}'='true'and outcome#>>'{a:chest_pain,alerted}'='false'from public.zoe_chat_cards where id='b2000000-0000-4000-8000-000000000001'),'Recovery appends success without rewriting the answer');
select pg_temp.ok(exists(select 1 from pg_indexes where indexname='zoe_bp_alert_retry'and indexdef like'%WHERE%'),'Sweep has a partial index');

-- BP4-R6: completion does not imply delivery; only the original message request may be acknowledged.
select pg_temp.ok(jsonb_array_length(public.zoe_bp_messages_pending('b0000000-0000-4000-8000-000000000001',20))=1,'Completed red answer still needs conversation delivery');
select pg_temp.ok(jsonb_array_length(public.zoe_bp_messages_pending('b0000000-0000-4000-8000-000000000002',20))=0,'Pending delivery is scoped to this member');
select pg_temp.ok(public.zoe_bp_delivery_record('b0000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002')->>'ok'='false','A different request cannot acknowledge delivery');
select pg_temp.ok(public.zoe_bp_delivery_record('b0000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001')->>'ok'='true','Delivery success is append-only on a done card');
select pg_temp.ok(public.zoe_bp_delivery_record('b0000000-0000-4000-8000-000000000001','b2000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000001')->>'ok'='true','Delivery acknowledgement replays');
select pg_temp.ok(public.zoe_bp_messages_pending('b0000000-0000-4000-8000-000000000001',20)='[]'::jsonb,'Delivered cards leave the retry index');

-- BP4-R2: SQL conflict returns the original receipt; the higher zone uses its own source reference.
insert into auth.users(id,email)values('b0000000-0000-4000-8000-000000000003','bp-doctor@example.test');
insert into public.workspace_clinics(id,name)values('b0000000-0000-4000-8000-000000000020','Synthetic BP clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('b0000000-0000-4000-8000-000000000003','doctor','Synthetic BP doctor','b0000000-0000-4000-8000-000000000020');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000003'),('b0000000-0000-4000-8000-000000000002',null);
create temp table bp_receipts(k text primary key,v jsonb);
insert into bp_receipts values('yellow',public.care_queue_raise('b0000000-0000-4000-8000-000000000001','physician','yellow','bp_doctor_48h','zones-v1-test','cleared',null,'{}',clock_timestamp()+interval '48 hours','episode:yellow'));
insert into bp_receipts values('conflict',public.care_queue_raise('b0000000-0000-4000-8000-000000000001','physician','orange','bp_same_day','zones-v1-test','cleared',null,'{}',clock_timestamp()+interval '4 hours','episode:yellow'));
select pg_temp.ok((select v#>>'{task,zone}'='yellow'and v->>'replayed'='true'from bp_receipts where k='conflict'),'SQL replay really returns the old zone');
select pg_temp.ok((select v#>>'{task,slaDeadline}'from bp_receipts where k='yellow')=(select v#>>'{task,slaDeadline}'from bp_receipts where k='conflict'),'SQL replay really returns the old deadline');
insert into bp_receipts values('orange',public.care_queue_raise('b0000000-0000-4000-8000-000000000001','physician','orange','bp_same_day','zones-v1-test','cleared',null,'{}',clock_timestamp()+interval '4 hours','episode:orange'));
select pg_temp.ok((select v#>>'{task,zone}'='orange'and v->>'replayed'='false'from bp_receipts where k='orange'),'Higher zone creates the required urgent task');
select pg_temp.ok((select count(*)=2 from public.care_queue_tasks where member_id='b0000000-0000-4000-8000-000000000001'and queue='physician'),'Both stored zones remain traceable');

-- BP4-R7: an emergency survives ordinary paging and only explicit existing clear paths close it.
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,app_chat_enabled,zoe_chat_actions_enabled)values(true,'bp-flow-test',600,600,600,10,true,true)
 on conflict(singleton)do update set app_chat_enabled=true,zoe_chat_actions_enabled=true;
insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot)
 select 'b0000000-0000-4000-8000-000000000001',gen_random_uuid(),'bp','chip','{"v":1,"week":null}'::jsonb from generate_series(1,45);
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.ok(jsonb_array_length(public.zoe_chat_cards_member()->'cards')=40,'Ordinary paging remains bounded');
select pg_temp.ok(jsonb_array_length(public.zoe_bp_open_emergencies()->'cards')=1,'Separate emergency read survives 45 newer cards');
select pg_temp.ok(jsonb_array_length(public.zoe_bp_open_emergencies()->'cards')=1,'Another load/device reads the same open emergency');
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.ok(public.zoe_bp_open_emergencies()->'cards'='[]'::jsonb,'Another member cannot see it');
-- Existing doctor clear table is written by the authorized doctor-clear function. Seed that outcome here.
insert into public.conversations(id,member_id)values('b5000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001');
insert into public.zoe_urgent_clears(conversation_id,member_id,cleared_by,opened_by,window_started_at)
 values('b5000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000002','rule',clock_timestamp()-interval '2 hours');
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select pg_temp.ok(public.zoe_bp_open_emergencies()->'cards'='[]'::jsonb,'An existing doctor clear closes the emergency');
-- A later red answer can open a new emergency, and the existing member-clear audit closes it.
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot,state,outcome)
 values('b2000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000001','b3000000-0000-4000-8000-000000000002','red_flags','chip',
 '{"v":1,"episodeId":"later","readingId":null,"readings":[{"sbp":170,"dbp":105}]}','done',jsonb_build_object('a:chest_pain',jsonb_build_object('answer',true,'alerted',false,'requestId','b4000000-0000-4000-8000-000000000002','text','Synthetic later answer','doneAt',clock_timestamp())));
select pg_temp.ok(jsonb_array_length(public.zoe_bp_open_emergencies()->'cards')=1,'New red answer after a clear opens 103 again');
insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
 values('b5000000-0000-4000-8000-000000000001','b0000000-0000-4000-8000-000000000001','zoe.member_cleared_urgent','{}');
select pg_temp.ok(public.zoe_bp_open_emergencies()->'cards'='[]'::jsonb,'The existing member-clear audit closes the new outcome');
select pg_temp.ok(not has_function_privilege('authenticated','public.care_alert_bp_flags_retry(integer)','execute'),'Alert recovery is service only');
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_bp_messages_pending(uuid,integer)','execute'),'Pending delivery is service only');
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_bp_delivery_record(uuid,uuid,uuid)','execute'),'Delivery recording is service only');
select pg_temp.ok(not has_function_privilege('anon','public.zoe_bp_open_emergencies()','execute'),'Anonymous emergency reads denied');
-- A recovered card's server-verified snapshot stamps the measurement in the existing insert trigger.
insert into public.zoe_chat_cards(member_id,request_id,kind,source,source_seq,snapshot,claims)
 values('b0000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000001','bp','typed',1,
 '{"v":1,"week":null,"typed":{"systolic":145,"diastolic":92,"pulse":null,"measuredAt":"2026-11-02T00:00:00Z","entrySource":"patient_voice_confirmed"}}',
 '{"bp":{"op":"b9000000-0000-4000-8000-000000000002","payload":{}}}');
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)
 values('b0000000-0000-4000-8000-000000000001','b9000000-0000-4000-8000-000000000002',145,92,'2026-11-02T00:00:00Z');
select pg_temp.ok((select entry_source='patient_voice_confirmed'from public.patient_measurements where submission_id='b9000000-0000-4000-8000-000000000002'),'Recovered voice snapshot survives measurement persistence');

-- PR8-01: SAMS uses the same durable machinery and its original identities. A plain yes is not red.
-- Drain the preceding BP fixture, then use a separate member so source-level alert coalescing cannot mask duplicates.
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.care_alert_bp_flags_retry(50);
insert into auth.users(id,email)values('b0000000-0000-4000-8000-000000000004','sams-flow@example.test');
insert into public.patient_clinical_cases(user_id)values('b0000000-0000-4000-8000-000000000004');
insert into public.conversations(id,member_id)values('b5000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000004');
insert into public.zoe_chat_cards(id,member_id,request_id,kind,source,snapshot,state,outcome,created_at)values
 ('b2000000-0000-4000-8000-000000000011','b0000000-0000-4000-8000-000000000004',gen_random_uuid(),'sams','chip',
  '{"v":1,"episodeId":"b6000000-0000-4000-8000-000000000011"}','done',
  jsonb_build_object('a:musclepain',jsonb_build_object('answer',true),
   'a:darkurine',jsonb_build_object('answer',true,'zone','red','alerted',false,'requestId','b4000000-0000-4000-8000-000000000011','text','Synthetic SAMS answer','doneAt',clock_timestamp(),'ruleVersion','zones-v1-sams-test')),clock_timestamp()-interval '1 hour'),
 ('b2000000-0000-4000-8000-000000000012','b0000000-0000-4000-8000-000000000004',gen_random_uuid(),'sams','chip',
  '{"v":1,"episodeId":"b6000000-0000-4000-8000-000000000012"}','done',
  '{"a:musclepain":{"answer":true},"a:rightupperpain":{"answer":false,"flow":{"zone":"orange"}}}',clock_timestamp()-interval '1 hour');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
update public.care_alert_settings set enabled=false where singleton;
select pg_temp.ok(public.care_alert_bp_flags_retry(50)->>'raised'='0','SAMS alert outage leaves durable work');
select pg_temp.ok((select state='done'and not outcome?'alert'from public.zoe_chat_cards where id='b2000000-0000-4000-8000-000000000011'),'Red answer survives alert failure');
update public.care_alert_settings set enabled=true where singleton;
select pg_temp.ok(public.care_alert_bp_flags_retry(50)->>'raised'='1','Sweep recovers the red SAMS alert');
select pg_temp.ok(public.care_alert_bp_flags_retry(50)->>'raised'='0','Second sweep leaves one SAMS alert');
select pg_temp.ok((select count(*)=1 from public.care_alert_screenings where source='zoe'and source_ref='sams:b6000000-0000-4000-8000-000000000011'and rule_version='zones-v1-sams-test'),'SAMS keeps its original episode source and rule version');
select pg_temp.ok((select count(*)=1 and max(occurrences)=1 from public.care_alerts where member_id='b0000000-0000-4000-8000-000000000004'and reason_code='sams_red'),'One SAMS alert, one occurrence');
select pg_temp.ok((select outcome#>>'{alert,alerted}'='true'and outcome#>>'{a:darkurine,alerted}'='false'from public.zoe_chat_cards where id='b2000000-0000-4000-8000-000000000011'),'Recovery appends the alert without rewriting the answer');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(public.zoe_bp_messages_pending('b0000000-0000-4000-8000-000000000004',50))k where k->>'id'='b2000000-0000-4000-8000-000000000011'),'Failed SAMS message is pending on reload');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.zoe_bp_messages_pending('b0000000-0000-4000-8000-000000000004',50))k where k->>'id'='b2000000-0000-4000-8000-000000000012'),'Orange muscle answers are not emergency messages');
select pg_temp.ok(public.zoe_bp_delivery_record('b0000000-0000-4000-8000-000000000002','b2000000-0000-4000-8000-000000000011','b4000000-0000-4000-8000-000000000011')->>'ok'='false','Another member cannot acknowledge SAMS');
select pg_temp.ok(public.zoe_bp_delivery_record('b0000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000011',gen_random_uuid())->>'ok'='false','A new message identity cannot acknowledge SAMS');
select pg_temp.ok(public.zoe_bp_delivery_record('b0000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000011','b4000000-0000-4000-8000-000000000011')->>'ok'='true','Original SAMS message identity is acknowledged');
select pg_temp.ok(public.zoe_bp_delivery_record('b0000000-0000-4000-8000-000000000004','b2000000-0000-4000-8000-000000000011','b4000000-0000-4000-8000-000000000011')->>'ok'='true','SAMS delivery acknowledgement replays');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.zoe_bp_messages_pending('b0000000-0000-4000-8000-000000000004',50))k where k->>'id'='b2000000-0000-4000-8000-000000000011'),'Delivered SAMS leaves pending retry');
insert into public.zoe_chat_cards(member_id,request_id,kind,source,snapshot)
 select 'b0000000-0000-4000-8000-000000000004',gen_random_uuid(),'bp','chip','{"v":1,"week":null}'::jsonb from generate_series(1,45);
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(public.zoe_chat_cards_member()->'cards')k where k->>'id'='b2000000-0000-4000-8000-000000000011'),'SAMS is beyond the newest 40 cards');
select pg_temp.ok(jsonb_array_length(public.zoe_bp_open_emergencies()->'cards')=1,'103 survives 45 newer cards and successful delivery');
select pg_temp.ok(public.zoe_bp_open_emergencies()#>>'{cards,0,id}'='b2000000-0000-4000-8000-000000000011','Reload returns the original SAMS emergency');
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
select pg_temp.ok(public.zoe_bp_open_emergencies()->'cards'='[]'::jsonb,'SAMS emergency read is member-scoped');
insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
 values('b5000000-0000-4000-8000-000000000002','b0000000-0000-4000-8000-000000000004','zoe.member_cleared_urgent','{}');
select set_config('request.jwt.claims','{"sub":"b0000000-0000-4000-8000-000000000004","role":"authenticated"}',true);
select pg_temp.ok(public.zoe_bp_open_emergencies()->'cards'='[]'::jsonb,'Only an explicit clear closes the SAMS emergency');
rollback;
