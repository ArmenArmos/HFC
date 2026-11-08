-- Zoe urgent care alert (20261019222000; Fable FB-01 on #360): every urgent route raises a care-team alert for the member's
-- doctor; a refusal of 103 (S100) is recorded as an automatic forward (zoe_runs.forward, the zoe.forward audit) and keeps its
-- own reason on the alert; self-harm likewise; health on an urgent route is an emergency only; a reason with digits is valid;
-- with care alerts off nothing is raised and the member still gets the text; a failed raise is retried once by the sweep's
-- care_alert_zoe_urgent_retry. Rolled back. Synthetic fixtures only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.send(m text,sid text,rid text,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',rid,'text',txt));reset role;return j;end$$;
create function pg_temp.claim()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;return j;end$$;
create function pg_temp.run_for(m uuid)returns uuid language sql as $$select (x->>'runId')::uuid from jsonb_array_elements(pg_temp.claim())x where (x->>'memberId')::uuid=m$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
-- An urgent finish as the worker sends it: the fixed text, the urgent match event with its RF ids, and the health record when given.
create function pg_temp.urgent(reason text,flags text,health jsonb default null,outcome text default 'discarded')returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'reason',reason,'summary','Synthetic summary for the doctor.','answer','Synthetic urgent text. Call 103.','language','en',
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',0,'outputTokens',0),'costUsd',0,'latencyMs',5,
  'provider','none','model','none','configVersion','zoe-urgent-alert-check','tier','none','tierReason','urgent','fallbackUsed',false,
  'events',jsonb_build_array(jsonb_build_object('name','zoe.urgent_match','outcome','escalate','reason','urgent_words_matched','rule','zoe.urgent_staging_placeholder','ruleVersion','check','actor','system',
   'attributes',jsonb_build_object('noreon.zoe.urgent.red_flags',flags))),'health',health))
$$;
create function pg_temp.h(reason text,fwd text default 'auto',urgency text default 'emergency')returns jsonb language sql as $$
 select jsonb_build_object('urgency',urgency,'modelUrgency','none','forward',fwd,'forwardReason',reason)$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;
create function pg_temp.k(key text)returns uuid language sql as $$select (v#>>'{}')::uuid from kv where k=key$$;
-- One member message and its claimed run.
create function pg_temp.turn(key text,m text,sid text,rid text,txt text)returns uuid language plpgsql as $$declare run uuid;begin
 perform pg_temp.send(m,sid,rid,txt);run:=pg_temp.run_for(m::uuid);insert into kv values(key,to_jsonb(run));return run;end$$;
create function pg_temp.alert(m uuid)returns public.care_alerts language sql as $$select * from public.care_alerts where member_id=m and source='zoe'and state<>'resolved'$$;

-- A, B, C: app members (EN) of doctor D.
insert into auth.users(id,phone,phone_confirmed_at)values('e1840000-0000-4000-8000-000000000001','37499084801',now()),('e1840000-0000-4000-8000-000000000003','37499084803',now()),
 ('e1840000-0000-4000-8000-000000000005','37499084805',now()),('e1840000-0000-4000-8000-000000000002','37499084802',now());
insert into public.workspace_clinics(id,name)values('e1840000-0000-4000-8000-000000000004','Synthetic alert clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('e1840000-0000-4000-8000-000000000002','doctor','Dr Synthetic Alert Doctor','e1840000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)values('e1840000-0000-4000-8000-000000000011','e1840000-0000-4000-8000-000000000001',now(),now()),
 ('e1840000-0000-4000-8000-000000000013','e1840000-0000-4000-8000-000000000003',now(),now()),('e1840000-0000-4000-8000-000000000015','e1840000-0000-4000-8000-000000000005',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)select x::uuid,'e1840000-0000-4000-8000-000000000002'
 from unnest(array['e1840000-0000-4000-8000-000000000001','e1840000-0000-4000-8000-000000000003','e1840000-0000-4000-8000-000000000005'])x;
update public.profiles set locale='en',display_name='Synthetic Alert Member'where id in('e1840000-0000-4000-8000-000000000001','e1840000-0000-4000-8000-000000000003','e1840000-0000-4000-8000-000000000005');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-zua',3600,600,60,40,false,true,true);
insert into public.zoe_consents(member_id,kind,granted,wording_version)select x::uuid,'zoe_reads_messages',true,'zoe-consent-draft-1'
 from unnest(array['e1840000-0000-4000-8000-000000000001','e1840000-0000-4000-8000-000000000003','e1840000-0000-4000-8000-000000000005'])x;
update public.system_message_templates set approved=true where template_id in('zoe.answer','zoe.urgent');
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
insert into public.care_alert_settings(enabled)values(true);

-- 1. The plain urgent route: an alert for the assigned doctor, reason zoe_urgent_route, the RF ids from the urgent match.
select pg_temp.turn('r1','e1840000-0000-4000-8000-000000000001','e1840000-0000-4000-8000-000000000011','e1840000-0000-4000-8000-0000000000a1','Synthetic urgent words one');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r1'),pg_temp.urgent('urgent_route_no_model_call','RF-01'))->>'outcome')='discarded','Urgent route: finished discarded');
select pg_temp.ok((select reason_code='zoe_urgent_route'and red_flags='{RF-01}'and doctor_id='e1840000-0000-4000-8000-000000000002'and state='open'and occurrences=1
 from pg_temp.alert('e1840000-0000-4000-8000-000000000001')),'Urgent route: a care alert for the doctor (RF-01)');
select pg_temp.ok(exists(select 1 from public.care_alert_screenings where source='zoe'and source_ref='urgent:'||pg_temp.k('r1')::text and outcome='escalate'),'Urgent route: screened once per run');
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=pg_temp.k('r1')and kind='urgent'),'Urgent route: the member still gets the text');
select pg_temp.ok((select forward is null from public.zoe_runs where id=pg_temp.k('r1')),'Urgent route without health: no forward recorded');
-- A replayed finish neither repeats the alert nor fails.
select pg_temp.ok((pg_temp.finish(pg_temp.k('r1'),pg_temp.urgent('urgent_route_no_model_call','RF-01'))->>'replayed')::boolean,'Replay: replayed');
select pg_temp.ok((select occurrences=1 from pg_temp.alert('e1840000-0000-4000-8000-000000000001')),'Replay: no second occurrence');

-- 2. A refusal of 103 in the window (S100): recorded as an automatic forward, audited, and the alert repeats with the refusal as its reason.
select pg_temp.turn('r2','e1840000-0000-4000-8000-000000000001','e1840000-0000-4000-8000-000000000011','e1840000-0000-4000-8000-0000000000a2','Synthetic refusal two');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r2'),pg_temp.urgent('urgent_in_window_no_model_call','none',pg_temp.h('refused_103')))->>'outcome')='discarded','Refusal: finished discarded');
select pg_temp.ok((select forward='auto'and forward_reason='refused_103'from public.zoe_runs where id=pg_temp.k('r2')),'Refusal: the automatic forward is recorded on the run');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='zoe.forward'and detail->>'runId'=pg_temp.k('r2')::text and detail->>'reason'='refused_103'and detail->>'forward'='auto'),'Refusal: zoe.forward audited');
select pg_temp.ok((select reason_code='zoe_refused_103'and occurrences=2 and state='open'and red_flags='{RF-01}'from pg_temp.alert('e1840000-0000-4000-8000-000000000001')),'Refusal: the live alert repeats and now says refused 103');
select pg_temp.ok(exists(select 1 from public.care_alert_audit au join public.care_alerts a on a.id=au.alert_id where a.member_id='e1840000-0000-4000-8000-000000000001'
 and au.kind='repeated'and au.detail->>'reason'='zoe_refused_103'),'Refusal: the repeat is in the alert audit');
-- An acknowledged alert reopens on the refusal.
update public.care_alerts set state='acknowledged',acknowledged_at=now(),acknowledged_by='e1840000-0000-4000-8000-000000000002'where member_id='e1840000-0000-4000-8000-000000000001';
select pg_temp.turn('r3','e1840000-0000-4000-8000-000000000001','e1840000-0000-4000-8000-000000000011','e1840000-0000-4000-8000-0000000000a3','Synthetic plain repeat three');
select pg_temp.finish(pg_temp.k('r3'),pg_temp.urgent('urgent_in_window_no_model_call','none'));
select pg_temp.ok((select reason_code='zoe_refused_103'and occurrences=3 and state='open'from pg_temp.alert('e1840000-0000-4000-8000-000000000001')),'A later plain urgent run reopens the alert and keeps the refusal reason');

-- 3. Self-harm (crisis text): reason zoe_self_harm, never replaced by a later refusal.
select pg_temp.turn('r4','e1840000-0000-4000-8000-000000000003','e1840000-0000-4000-8000-000000000013','e1840000-0000-4000-8000-0000000000b1','Synthetic crisis words');
select pg_temp.finish(pg_temp.k('r4'),pg_temp.urgent('urgent_route_no_model_call','none',pg_temp.h('self_harm')));
select pg_temp.ok((select reason_code='zoe_self_harm'and red_flags='{}'from pg_temp.alert('e1840000-0000-4000-8000-000000000003')),'Self-harm: an alert with its reason, no RF id');
select pg_temp.ok((select forward='auto'and forward_reason='self_harm'from public.zoe_runs where id=pg_temp.k('r4')),'Self-harm: the forward recorded');
select pg_temp.turn('r5','e1840000-0000-4000-8000-000000000003','e1840000-0000-4000-8000-000000000013','e1840000-0000-4000-8000-0000000000b2','Synthetic refusal after crisis');
select pg_temp.finish(pg_temp.k('r5'),pg_temp.urgent('urgent_in_window_no_model_call','none',pg_temp.h('refused_103')));
select pg_temp.ok((select reason_code='zoe_self_harm'and occurrences=2 from pg_temp.alert('e1840000-0000-4000-8000-000000000003')),'Self-harm stays the alert reason after a refusal');

-- 4. Invalid: a non-emergency on the urgent route. (refused_103 itself is a valid reason: [a-z_] used to reject it.)
select pg_temp.turn('r6','e1840000-0000-4000-8000-000000000003','e1840000-0000-4000-8000-000000000013','e1840000-0000-4000-8000-0000000000b3','Synthetic message six');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r6'),pg_temp.urgent('urgent_in_window_no_model_call','none',pg_temp.h('refused_103','auto','same_day')))->>'code')='invalid','An urgent route below emergency is invalid');
select pg_temp.ok((select state='started'from public.zoe_runs where id=pg_temp.k('r6')),'Invalid: the run is not finished');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r6'),pg_temp.urgent('health_answer_blocked_by_guard','none',pg_temp.h('refused_103'),'summary_only')-'answer')->>'outcome')='summary_only','A held answer may carry refused_103 (digits in a reason are valid)');

-- 5. Care alerts off: no alert, no screening; the member still gets the text and the refusal is still recorded.
update public.care_alert_settings set enabled=false;
select pg_temp.turn('r7','e1840000-0000-4000-8000-000000000005','e1840000-0000-4000-8000-000000000015','e1840000-0000-4000-8000-0000000000c1','Synthetic refusal with alerts off');
select pg_temp.finish(pg_temp.k('r7'),pg_temp.urgent('urgent_in_window_no_model_call','RF-02',pg_temp.h('refused_103')));
select pg_temp.ok(not exists(select 1 from public.care_alerts where member_id='e1840000-0000-4000-8000-000000000005')
 and not exists(select 1 from public.care_alert_screenings where source_ref='urgent:'||pg_temp.k('r7')::text),'Alerts off: nothing raised or screened');
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=pg_temp.k('r7')and kind='urgent')
 and(select forward_reason='refused_103'from public.zoe_runs where id=pg_temp.k('r7')),'Alerts off: the text is sent and the refusal recorded');

-- 6. Astra Z366-02: a failed raise keeps the member's text and the run's record, is journalled, and the sweep's retry raises it once.
update public.care_alert_settings set enabled=true;
create function public._zua_test_fail()returns trigger language plpgsql as $$begin
 if current_setting('noreon.zua_fail',true)='on'then raise exception 'synthetic alert failure';end if;return new;end$$;
create trigger zua_test_fail before insert on public.care_alert_screenings for each row execute function public._zua_test_fail();
create function pg_temp.retry()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.care_alert_zoe_urgent_retry(20);reset role;return j;end$$;
select set_config('noreon.zua_fail','on',true);
select pg_temp.turn('r8','e1840000-0000-4000-8000-000000000005','e1840000-0000-4000-8000-000000000015','e1840000-0000-4000-8000-0000000000c2','Synthetic refusal, alert fails');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r8'),pg_temp.urgent('urgent_in_window_no_model_call','RF-02',pg_temp.h('refused_103')))->>'outcome')='discarded','Failure: the run still finishes');
select pg_temp.ok((select count(*)=1 from public.zoe_member_answers where run_id=pg_temp.k('r8')and kind='urgent'),'Failure: the member still gets the text');
select pg_temp.ok((select forward_reason='refused_103'from public.zoe_runs where id=pg_temp.k('r8')),'Failure: the refusal is still recorded');
select pg_temp.ok(not exists(select 1 from public.care_alerts where member_id='e1840000-0000-4000-8000-000000000005'),'Failure: no alert yet');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='care_alert.raise_failed'and subject_kind='zoe_run'and subject_id=pg_temp.k('r8')::text
 and attributes->>'noreon.care_alert.reason'='zoe_refused_103'),'Failure: journalled for the retry');
select pg_temp.ok((pg_temp.retry()->>'failed')::integer=1,'Retry while still failing: counted as failed, nothing raised');
select set_config('noreon.zua_fail','off',true);
select pg_temp.ok((pg_temp.retry()->>'raised')::integer=1,'Retry: raised once');
select pg_temp.ok((select reason_code='zoe_refused_103'and red_flags='{RF-02}'and occurrences=1 from pg_temp.alert('e1840000-0000-4000-8000-000000000005')),'Retry: one alert with the refusal and RF-02');
select pg_temp.ok((pg_temp.retry()->>'raised')::integer=0,'Retry again: nothing more');
select pg_temp.ok((select count(*)=1 from public.zoe_member_answers where run_id=pg_temp.k('r8')),'Retry: no duplicate answer');
select pg_temp.ok((select occurrences=1 from pg_temp.alert('e1840000-0000-4000-8000-000000000005')),'Retry: no duplicate alert');
-- Round 2: retry work never expires. A failure journalled three days ago (the sweep was down) is still raised, once, with its
-- journalled reason and RF ids; the run's text is not repeated.
update public.care_alert_settings set enabled=false;
select pg_temp.turn('r9','e1840000-0000-4000-8000-000000000003','e1840000-0000-4000-8000-000000000013','e1840000-0000-4000-8000-0000000000b9','Synthetic old refusal');
select pg_temp.finish(pg_temp.k('r9'),pg_temp.urgent('urgent_in_window_no_model_call','RF-01',pg_temp.h('refused_103')));
update public.care_alert_settings set enabled=true;
insert into public.conversation_trace_events(occurred_at,member_id,subject_kind,subject_id,step,name,outcome,reason_code,rule_id,rule_version,actor_kind,attributes)
 values(clock_timestamp()-interval '3 days','e1840000-0000-4000-8000-000000000003','zoe_run',pg_temp.k('r9')::text,'care_alert','care_alert.raise_failed','failed','zoe_urgent_alert_will_retry',
  'zoe.urgent_route','zoe-urgent-alert-check','system',jsonb_build_object('noreon.care_alert.source','zoe','noreon.care_alert.reason','zoe_refused_103','noreon.care_alert.red_flags','RF-01'));
select pg_temp.ok((pg_temp.retry()->>'raised')::integer=1,'Aged failure: raised');
select pg_temp.ok(exists(select 1 from public.care_alert_screenings where source='zoe'and source_ref='urgent:'||pg_temp.k('r9')::text and reason_code='zoe_refused_103'and red_flags='{RF-01}'),
 'Aged failure: screened with its journalled reason and RF ids');
select pg_temp.ok((select reason_code='zoe_self_harm'from pg_temp.alert('e1840000-0000-4000-8000-000000000003')),'Aged failure: merges into the live alert, self-harm kept');
select pg_temp.ok((pg_temp.retry()->>'raised')::integer=0 and(select count(*)=1 from public.zoe_member_answers where run_id=pg_temp.k('r9')),'Aged failure: once, no duplicate answer');

-- The retry is the service's alone.
select pg_temp.as_user('e1840000-0000-4000-8000-000000000005','e1840000-0000-4000-8000-000000000015');
set local role authenticated;
do $$begin perform public.care_alert_zoe_urgent_retry(5);raise exception 'FAIL: a member ran the retry';exception when insufficient_privilege then null;end$$;
reset role;

-- 5. A resolved alert never swallows a later urgent message (Armen's QA on 3 Nov; the integrator's report that an urgent message after a resolve raised nothing):
-- the doctor resolves the live alert, the member sends a new urgent message, and a NEW open alert is raised with its own reason; the resolved one stays resolved.
insert into auth.sessions(id,user_id,created_at,updated_at)values('e1840000-0000-4000-8000-000000000012','e1840000-0000-4000-8000-000000000002',now(),now());
insert into kv select 'al3',jsonb_build_object('id',a.id,'seq',a.state_seq)from pg_temp.alert('e1840000-0000-4000-8000-000000000003')a;
insert into kv select 'al1',jsonb_build_object('id',a.id,'seq',a.state_seq)from pg_temp.alert('e1840000-0000-4000-8000-000000000001')a;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
select pg_temp.as_staff('e1840000-0000-4000-8000-000000000002','e1840000-0000-4000-8000-000000000012');
set local role authenticated;
select pg_temp.ok(public.care_alert_resolve((v->>'id')::uuid,(v->>'seq')::bigint,'member_contacted','Synthetic reason')->>'changed'='true','Doctor resolves the self-harm alert')from kv where k='al3';
select pg_temp.ok(public.care_alert_resolve((v->>'id')::uuid,(v->>'seq')::bigint,'member_contacted','Synthetic reason')->>'changed'='true','Doctor resolves the urgent-route alert')from kv where k='al1';
reset role;
select pg_temp.ok(not exists(select 1 from public.care_alerts where member_id in('e1840000-0000-4000-8000-000000000003','e1840000-0000-4000-8000-000000000001')and source='zoe'and state<>'resolved'),'After the resolves: no live Zoe alert');
-- A new self-harm message after the resolve.
select pg_temp.turn('r10','e1840000-0000-4000-8000-000000000003','e1840000-0000-4000-8000-000000000013','e1840000-0000-4000-8000-0000000000e1','Synthetic crisis words after the resolve');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r10'),pg_temp.urgent('urgent_route_no_model_call','none',pg_temp.h('self_harm')))->>'outcome')='discarded','After a resolve: the urgent run finishes');
select pg_temp.ok((select reason_code='zoe_self_harm'and state='open'and occurrences=1 and id<>(select (v->>'id')::uuid from kv where k='al3')from pg_temp.alert('e1840000-0000-4000-8000-000000000003')),
 'After a resolve: a new open self-harm alert, occurrences 1, not the resolved row');
select pg_temp.ok((select count(*)=2 and count(*)filter(where state='resolved')=1 and count(*)filter(where state='open')=1 from public.care_alerts where member_id='e1840000-0000-4000-8000-000000000003'and source='zoe'),
 'After a resolve: the old alert stays resolved, one new open alert');
-- A new plain urgent message after the resolve.
select pg_temp.turn('r11','e1840000-0000-4000-8000-000000000001','e1840000-0000-4000-8000-000000000011','e1840000-0000-4000-8000-0000000000e2','Synthetic urgent words after the resolve');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r11'),pg_temp.urgent('urgent_route_no_model_call','RF-01'))->>'outcome')='discarded','After a resolve: the plain urgent run finishes');
select pg_temp.ok((select reason_code='zoe_urgent_route'and state='open'and occurrences=1 and red_flags='{RF-01}'and id<>(select (v->>'id')::uuid from kv where k='al1')from pg_temp.alert('e1840000-0000-4000-8000-000000000001')),
 'After a resolve: a new open urgent-route alert with its red flag');
select pg_temp.ok(exists(select 1 from public.care_alert_screenings where source='zoe'and source_ref='urgent:'||pg_temp.k('r11')::text and outcome='escalate'),'After a resolve: the new run is screened');

select 'zoe urgent care alert checks passed' as result;
rollback;
