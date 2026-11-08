-- Zoe symptom intake (20261018075343): the switch and its guard, the sheet registry, the claim's intake
-- part, the finish outcomes (question, ending, red flag), the care-team alert, the staff notice, expiry,
-- stale and invalid results, and who can read what (members only their own state, the assigned doctor
-- only their members, no direct table access). Rolled back. Synthetic fixtures only; no network or model.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_staff(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_zsi",9023,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_zsi",9023,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.bind(m uuid,kind text,u bigint)returns jsonb language sql as $$
 select public._telegram_auth_bind(m,kind,pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null)$$;
create function pg_temp.say(id text,u bigint,txt text)returns void language plpgsql as $$begin
 perform pg_temp.as_service();perform public.channel_inbox_commit(pg_temp.event(id,u,txt));perform pg_temp.drain();end$$;
create function pg_temp.send(m text,sid text,rid text,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',rid,'text',txt));reset role;return j;end$$;
create function pg_temp.thread(m text,sid text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_member_thread();reset role;return j;end$$;
create function pg_temp.claim()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;return j;end$$;
create function pg_temp.job(j jsonb,m uuid)returns jsonb language sql as $$select x from jsonb_array_elements(j)x where (x->>'memberId')::uuid=m$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
-- A finish result for an intake turn.
create function pg_temp.turn(outcome text,state text,answer text,intake_id text,source text default 'model',provider text default 'vercel.ai_gateway',flags jsonb default null,sheet text default 'headache',summary jsonb default '{"version":"zoe-symptom-summary-1","ending":"expired"}')returns jsonb language sql as $$
 select jsonb_build_object('outcome',outcome,'reason','intake_check','summary','Symptom intake (Headache, sheet v1 draft): synthetic','draft',null,'answer',answer,'language','en',
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',80),'costUsd',0,'latencyMs',800,
  'provider',provider,'model','anthropic/claude-opus-5.5','configVersion','zoe-symptom-intake-check','sealed',null,'tier','none','tierReason','symptom_intake','fallbackUsed',false,'events','[]'::jsonb,
  'intake',jsonb_build_object('id',intake_id,'sheetId',sheet,'sheetVersion',1,'startedSeq',1,'language','en','state',state,
   'record',jsonb_build_object('answers',jsonb_build_object('onset',jsonb_build_object('value','Synthetic since this morning','seq',1)),'asked','["onset"]'::jsonb,'turns',1,'redFlags','[]'::jsonb),
   'summary',case when sheet='none'then null else summary end,'answerSource',source,'alertRedFlags',flags))
$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

-- A: app member (EN); T: Telegram member; D: A and T's doctor; O: another doctor; X: admin.
insert into auth.users(id,phone,phone_confirmed_at)values('e1820000-0000-4000-8000-000000000001','37499082801',now()),('e1820000-0000-4000-8000-000000000003','37499082803',now()),
 ('e1820000-0000-4000-8000-000000000002','37499082802',now()),('e1820000-0000-4000-8000-000000000005',null,null),('e1820000-0000-4000-8000-000000000006',null,null);
insert into public.workspace_clinics(id,name)values('e1820000-0000-4000-8000-000000000004','Synthetic intake clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('e1820000-0000-4000-8000-000000000002','doctor','Synthetic Intake Doctor','e1820000-0000-4000-8000-000000000004'),
 ('e1820000-0000-4000-8000-000000000005','doctor','Synthetic Other Doctor','e1820000-0000-4000-8000-000000000004');
insert into public.workspace_staff(user_id,role,display_name)values('e1820000-0000-4000-8000-000000000006','admin','Synthetic Intake Admin');
insert into auth.sessions(id,user_id,created_at,updated_at)values('e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-000000000001',now(),now()),
 ('e1820000-0000-4000-8000-000000000012','e1820000-0000-4000-8000-000000000002',now(),now()),('e1820000-0000-4000-8000-000000000013','e1820000-0000-4000-8000-000000000003',now(),now()),
 ('e1820000-0000-4000-8000-000000000015','e1820000-0000-4000-8000-000000000005',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000002'),('e1820000-0000-4000-8000-000000000003','e1820000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='Intake Member A'where id='e1820000-0000-4000-8000-000000000001';
update public.profiles set locale='en',display_name='Intake Member T'where id='e1820000-0000-4000-8000-000000000003';
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('e1820000-0000-4000-8000-000000000001',gen_random_uuid(),152,94,now()-interval '2 hours');
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_zsi',9023,600,'consent-zsi');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-zsi',3600,600,60,20,false,true,true);
select public._telegram_replies_activate('e1820000-0000-4000-8000-000000000003',(pg_temp.bind('e1820000-0000-4000-8000-000000000003','member',8281)->>'bindingId')::uuid);
select pg_temp.bind('e1820000-0000-4000-8000-000000000002','staff',8282);
insert into public.staff_message_notice_settings(enabled)values(true);
insert into public.care_alert_settings(enabled)values(true);
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('e1820000-0000-4000-8000-000000000001','zoe_reads_messages',true,'zoe-consent-draft-1'),
 ('e1820000-0000-4000-8000-000000000003','zoe_reads_messages',true,'zoe-consent-draft-1');
update public.system_message_templates set approved=true where template_id='zoe.answer';

-- 1. Registry and defaults: eight DRAFT sheets; the switch is off by default.
select pg_temp.ok((select count(*)=8 and bool_and(status='draft'and signed_by is null)from public.zoe_symptom_sheets),'Eight sheets registered, all DRAFT');
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
select pg_temp.ok((select not symptom_intake_enabled from public.zoe_settings),'Intake off by default');
do $$begin begin update public.zoe_symptom_sheets set status='signed'where sheet_id='headache';raise exception 'FAIL: signed without signer';exception when check_violation then null;end;end$$;

-- 2. The switch guard.
do $$begin begin update public.zoe_settings set symptom_intake_enabled=true;raise exception 'FAIL: intake on without real calls';exception when check_violation then null;end;end$$;
update public.zoe_settings set staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-391',391,0,0,'e1820000-0000-4000-8000-000000000006'from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
do $$begin begin update public.zoe_settings set symptom_intake_enabled=true;raise exception 'FAIL: intake on without an intake eval';exception when check_violation then null;end;end$$;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-475+intake-82',475,1,1,'e1820000-0000-4000-8000-000000000006'from public.zoe_tier_config where tier='high';
do $$begin begin update public.zoe_settings set symptom_intake_enabled=true;raise exception 'FAIL: intake on with a failing intake eval';exception when check_violation then null;end;end$$;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-475+intake-82',475,0,3,'e1820000-0000-4000-8000-000000000006'from public.zoe_tier_config where tier='high';
update public.zoe_settings set symptom_intake_enabled=true;
select pg_temp.ok((select symptom_intake_enabled from public.zoe_settings),'Intake on: staging AI mode, real calls, passing high-tier intake eval');
do $$begin begin update public.zoe_settings set staging_ai_mode=false;raise exception 'FAIL: staging off under unsigned sheets';exception when check_violation then null;end;end$$;

-- 3. Claim: the intake part of the job.
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000a1','Synthetic I have a headache since this morning');
insert into kv values('j1',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
select pg_temp.ok((select v#>>'{intake,enabled}'='true'and v#>'{intake,active}'='null'::jsonb and jsonb_array_length(v#>'{intake,registered}')=8
 and v#>>'{intake,doctorName}'='Synthetic Intake Doctor'and v#>>'{intake,latestReading,systolic}'='152'and (v#>>'{intake,latestReading,minutesAgo}')::int between 110 and 130
 and v#>>'{intake,redFlagsAfterSeq}'='0'from kv where k='j1'),'Claim carries the switch, registry, no active intake, doctor name, latest reading');
insert into kv values('run1',(select v->'runId'from kv where k='j1'));

-- 4. A first question: the intake row, the text in the member's thread, never a draft.
insert into kv values('f1',pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run1'),pg_temp.turn('intake_asked','active','Synthetic opener. When did it start?',null)));
select pg_temp.ok((select v->>'outcome'='intake_asked'and v->>'intakeId'is not null from kv where k='f1'),'First question recorded');
insert into kv values('iid',(select v->'intakeId'from kv where k='f1'));
select pg_temp.ok((select state='active'and sheet_id='headache'and summary->>'ending'='expired'and record#>>'{answers,onset,value}'='Synthetic since this morning'from public.zoe_symptom_intakes where id=(select (v#>>'{}')::uuid from kv where k='iid')),'Active intake with its record and provisional summary');
select pg_temp.ok((select kind='intake'and provider='vercel.ai_gateway'from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='run1')),'The question is Zoe''s answer row, kind intake');
select pg_temp.ok((select v->'answers'->-1->>'text'='Synthetic opener. When did it start?'from(select pg_temp.thread('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011')v)x),'Member A sees the question in the app thread');
select pg_temp.ok(not exists(select 1 from public.conversation_drafts),'No doctor draft from an intake');

-- 5. The next claim hands the active intake back; stand-in model text is never sent.
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000a2','Synthetic at the front');
insert into kv values('j2',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
select pg_temp.ok((select v#>>'{intake,active,id}'=(select v#>>'{}'from kv where k='iid')and v#>>'{intake,active,sheetId}'='headache'and v#>>'{intake,active,record,answers,onset,value}'='Synthetic since this morning'from kv where k='j2'),'Active intake in the next job');
insert into kv values('f2',pg_temp.finish((select (v->>'runId')::uuid from kv where k='j2'),pg_temp.turn('intake_asked','active','Synthetic stand-in question?',(select v#>>'{}'from kv where k='iid'),'model','noreon.fake')));
select pg_temp.ok((select v->>'outcome'='intake_asked'and v->'answerId'='null'::jsonb from kv where k='f2')
 and (select reason_code='stand_in_answer_not_sent'from public.zoe_runs where id=(select (v->>'runId')::uuid from kv where k='j2')),'Stand-in model text: not sent');
select pg_temp.ok((select last_run_id=(select (v#>>'{}')::uuid from kv where k='run1')from public.zoe_symptom_intakes where id=(select (v#>>'{}')::uuid from kv where k='iid')),'Stand-in model turn: the record is not written');
-- The sheet's own wording is sent even with the stand-in configured.
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000a3','Synthetic about five');
insert into kv values('j3',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
insert into kv values('f3',pg_temp.finish((select (v->>'runId')::uuid from kv where k='j3'),pg_temp.turn('intake_asked','active','Synthetic sheet wording?',(select v#>>'{}'from kv where k='iid'),'sheet','noreon.fake')));
select pg_temp.ok((select v->>'answerId'is not null from kv where k='f3')
 and (select provider='noreon.rules'from public.zoe_member_answers where run_id=(select (v->>'runId')::uuid from kv where k='j3')),'Sheet wording sent, authored by the rules');

-- 6. Stale and invalid results change nothing.
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000a4','Synthetic no dizziness');
insert into kv values('j4',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000a5','Synthetic and no nausea');
select pg_temp.ok(pg_temp.finish((select (v->>'runId')::uuid from kv where k='j4'),pg_temp.turn('intake_asked','active','Synthetic stale question?',(select v#>>'{}'from kv where k='iid')))->>'outcome'='stale','A newer member message makes a question stale');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where body='Synthetic stale question?'),'Stale question not sent');
insert into kv values('j5',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
select pg_temp.ok(pg_temp.finish((select (v->>'runId')::uuid from kv where k='j5'),pg_temp.turn('intake_asked','active','x',(select v#>>'{}'from kv where k='iid'),'model','vercel.ai_gateway',null,'migraine'))->>'code'='invalid','An unregistered sheet is refused');
select pg_temp.ok(pg_temp.finish((select (v->>'runId')::uuid from kv where k='j5'),pg_temp.turn('intake_escalated','escalated','x',(select v#>>'{}'from kv where k='iid'),'fixed','noreon.rules','["RF-99"]'))->>'code'='invalid','A non-RF alert flag is refused');
select pg_temp.ok(pg_temp.finish((select (v->>'runId')::uuid from kv where k='j5'),pg_temp.turn('intake_completed','active','x',(select v#>>'{}'from kv where k='iid')))->>'code'='invalid','An ending must end the intake');
select pg_temp.ok(pg_temp.finish((select (v->>'runId')::uuid from kv where k='j5'),pg_temp.turn('answered','active','x',(select v#>>'{}'from kv where k='iid')))->>'code'='invalid','A non-intake outcome cannot carry an intake');

-- 7. An ending: the doctor's summary and one staff notice with no health details.
insert into kv values('f5',pg_temp.finish((select (v->>'runId')::uuid from kv where k='j5'),pg_temp.turn('intake_completed','stopped','Thank you. I''ve sent this to Dr. Synthetic Intake Doctor. Your care team will contact you. If it gets worse, call 103.',
 (select v#>>'{}'from kv where k='iid'),'fixed','vercel.ai_gateway',null,'headache','{"version":"zoe-symptom-summary-1","ending":"member_stopped"}')));
select pg_temp.ok((select v->>'outcome'='intake_completed'from kv where k='f5'),'Ending recorded');
select pg_temp.ok((select state='stopped'and ending='member_stopped'and finished_at is not null and summary->>'ending'='member_stopped'from public.zoe_symptom_intakes where id=(select (v#>>'{}')::uuid from kv where k='iid')),'Intake stopped with the doctor summary');
select pg_temp.ok((select count(*)=1 from public.zoe_symptom_intake_notices n join public.telegram_auth_messages m on m.id=n.telegram_message_id
 where n.intake_id=(select (v#>>'{}')::uuid from kv where k='iid')and n.recipient_id='e1820000-0000-4000-8000-000000000002'and m.template_id='zoe_intake.notice'
 and m.keyboard->>'url' like '%/staff/real/conversations/e1820000-0000-4000-8000-000000000001'and m.body !~* 'headache|front|synthetic since|dizz'),'One notice to the assigned doctor: fixed text, conversation link, no health details');
select pg_temp.ok((select state='queued'from public.telegram_auth_messages where template_id='zoe_intake.notice'),'Notice queued (held at claim while its wording is unapproved)');
select pg_temp.ok(not exists(select 1 from public.conversation_trace_events where attributes::text ~ 'Synthetic since|at the front|headache since'),'No member or answer text in any trace event');

-- 8. A red flag: urgent text, care-team alert (source zoe, RF ids), never stale, red-flag checking restarts after it.
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000a6','Synthetic headache again');
insert into kv values('j6',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
select pg_temp.ok((select v#>'{intake,active}'='null'::jsonb from kv where k='j6'),'The stopped intake is not active any more');
insert into kv values('f6',pg_temp.finish((select (v->>'runId')::uuid from kv where k='j6'),pg_temp.turn('intake_asked','active','Synthetic second opener?',null)));
insert into kv values('iid2',(select v->'intakeId'from kv where k='f6'));
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000a7','Synthetic now my arm is numb');
insert into kv values('j7',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
-- A newer message and doctor work before the finish: a red flag still goes out.
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000a8','Synthetic hello?');
update public.conversations set draft_epoch=draft_epoch+1 where member_id='e1820000-0000-4000-8000-000000000001';
insert into kv values('f7',pg_temp.finish((select (v->>'runId')::uuid from kv where k='j7'),pg_temp.turn('intake_escalated','escalated','Urgent care needed. Call 103 now. Do not wait for this service.',(select v#>>'{}'from kv where k='iid2'),'fixed','vercel.ai_gateway','["RF-04"]',
 'headache','{"version":"zoe-symptom-summary-1","ending":"red_flag"}')));
select pg_temp.ok((select v->>'outcome'='intake_escalated'from kv where k='f7'),'Red flag is never stale');
select pg_temp.ok((select kind='urgent'and provider='noreon.rules'and body like 'Urgent care needed.%'from public.zoe_member_answers where run_id=(select (v->>'runId')::uuid from kv where k='j7')),'Urgent text stored as Zoe''s answer (kind urgent)');
select pg_temp.ok((select state='escalated'and ending='red_flag'from public.zoe_symptom_intakes where id=(select (v#>>'{}')::uuid from kv where k='iid2')),'Intake escalated with the red-flag summary');
select pg_temp.ok((select source='zoe'and red_flags='{RF-04}'and reason_code='symptom_red_flag'and state='open'and doctor_id='e1820000-0000-4000-8000-000000000002'
 from public.care_alerts where member_id='e1820000-0000-4000-8000-000000000001'),'Care-team alert raised for the assigned doctor (RF-04)');
insert into kv values('j8',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
select pg_temp.ok((select (v#>>'{intake,redFlagsAfterSeq}')::int=(select message_seq from public.zoe_runs where id=(select (v->>'runId')::uuid from kv where k='j7'))from kv where k='j8'),'Red-flag checking restarts after the escalated message');
-- A red flag with no sheet (no intake row) still alerts, with an empty RF list.
insert into kv values('f8',pg_temp.finish((select (v->>'runId')::uuid from kv where k='j8'),pg_temp.turn('intake_escalated','escalated','Urgent care needed. Call 103 now. Do not wait for this service.',null,'fixed','noreon.rules','[]','none')));
select pg_temp.ok((select v->>'outcome'='intake_escalated'and v->'intakeId'='null'::jsonb from kv where k='f8'),'Red flag without a sheet: no intake row');
select pg_temp.ok((select occurrences=2 from public.care_alerts where member_id='e1820000-0000-4000-8000-000000000001'and state='open'),'The live alert counts the repeat');

-- 9. Telegram member: the question is queued on Telegram (zoe.answer); a red flag with the answer channel unapproved falls back to zoe.urgent.
select pg_temp.say('9101',8281,'Synthetic I feel dizzy');
insert into kv values('t1',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000003'));
insert into kv values('tf1',pg_temp.finish((select (v->>'runId')::uuid from kv where k='t1'),pg_temp.turn('intake_asked','active','Synthetic what does it feel like?',null,'model','vercel.ai_gateway',null,'dizziness')));
select pg_temp.ok((select a.system_message_id is not null and m.template_id='zoe.answer'and m.body='Zoe: Synthetic what does it feel like?'from public.zoe_member_answers a join public.system_messages m on m.id=a.system_message_id
 where a.run_id=(select (v->>'runId')::uuid from kv where k='t1')),'Telegram: the question is queued on the answer channel');
-- Template versions are immutable: a newer unapproved version withdraws the approval.
insert into public.system_message_templates(template_id,version,locale,body,free_body)values('zoe.answer',2,'en','Zoe direct answer (synthetic withdrawn version).',true),('zoe.answer',2,'hy','Zoe direct answer (synthetic withdrawn version).',true);
select pg_temp.say('9102',8281,'Synthetic I fainted');
insert into kv values('t2',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000003'));
insert into kv values('tf2',pg_temp.finish((select (v->>'runId')::uuid from kv where k='t2'),pg_temp.turn('intake_escalated','escalated','Urgent care needed. Call 103 now. Do not wait for this service.',(select v#>>'{intake,active,id}'from kv where k='t2'),'fixed','noreon.rules','["RF-02"]','dizziness','{"version":"zoe-symptom-summary-1","ending":"red_flag"}')));
select pg_temp.ok((select v->>'outcome'='intake_escalated'from kv where k='tf2')
 and exists(select 1 from public.system_messages where member_id='e1820000-0000-4000-8000-000000000003'and template_id='zoe.urgent'),'Telegram red flag with unapproved answer wording: the zoe.urgent template is queued');
select pg_temp.ok((select kind='urgent'from public.zoe_member_answers where run_id=(select (v->>'runId')::uuid from kv where k='t2')),'The urgent text is still in the thread');
-- With the answer wording unapproved, an ordinary question is not sent.
select pg_temp.say('9103',8281,'Synthetic dizzy again');
insert into kv values('t3',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000003'));
insert into kv values('tf3',pg_temp.finish((select (v->>'runId')::uuid from kv where k='t3'),pg_temp.turn('intake_asked','active','Synthetic unapproved?',null,'model','vercel.ai_gateway',null,'dizziness')));
select pg_temp.ok((select v->'answerId'='null'::jsonb from kv where k='tf3')
 and (select reason_code='intake_wording_unapproved'from public.zoe_runs where id=(select (v->>'runId')::uuid from kv where k='t3')),'Unapproved answer wording: question not sent');
insert into public.system_message_templates(template_id,version,locale,body,free_body,approved)values('zoe.answer',3,'en','Zoe direct answer (synthetic version 3).',true,true),('zoe.answer',3,'hy','Zoe direct answer (synthetic version 3).',true,true);

-- 10. Expiry: an idle active intake ends at the next claim; the doctor still gets the notice.
update public.zoe_symptom_intakes set updated_at=now()-interval '13 hours'where member_id='e1820000-0000-4000-8000-000000000003'and state='active';
select pg_temp.claim();
select pg_temp.ok((select state='expired'and ending='expired'and summary->>'ending'='expired'from public.zoe_symptom_intakes where member_id='e1820000-0000-4000-8000-000000000003'order by created_at desc limit 1),'Idle intake expired with its summary');
select pg_temp.ok(exists(select 1 from public.zoe_symptom_intake_notices n join public.zoe_symptom_intakes i on i.id=n.intake_id where i.member_id='e1820000-0000-4000-8000-000000000003'and i.state='expired'),'Expired intake: doctor notified');

-- 11. Who reads what.
-- No direct table access for anyone but the definer functions.
do $$begin perform pg_temp.as_user('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011');set local role authenticated;
 begin perform 1 from public.zoe_symptom_intakes;raise exception 'FAIL: member read intakes table';exception when insufficient_privilege then null;end;
 begin perform 1 from public.zoe_symptom_sheets;raise exception 'FAIL: member read sheets table';exception when insufficient_privilege then null;end;
 begin perform 1 from public.zoe_symptom_intake_notices;raise exception 'FAIL: member read notices';exception when insufficient_privilege then null;end;
 begin perform public.zoe_symptom_intakes_for_doctor('e1820000-0000-4000-8000-000000000001');raise exception 'FAIL: member read the doctor view';exception when insufficient_privilege then null;end;
 reset role;end$$;
do $$begin perform pg_temp.as_service();set local role service_role;
 begin perform 1 from public.zoe_symptom_intakes;raise exception 'FAIL: service role read intakes table directly';exception when insufficient_privilege then null;end;reset role;end$$;
do $$begin perform set_config('request.jwt.claims','{"role":"anon"}',true);set local role anon;
 begin perform public.zoe_symptom_intake_member();raise exception 'FAIL: anon member state';exception when insufficient_privilege then null;end;reset role;end$$;
-- The member's own state only (no answers in it).
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000a9','Synthetic I feel tired');
insert into kv values('j9',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
select pg_temp.finish((select (v->>'runId')::uuid from kv where k='j9'),pg_temp.turn('intake_asked','active','Synthetic when did it start?',null,'model','vercel.ai_gateway',null,'fatigue'));
select pg_temp.as_user('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011');set local role authenticated;
select pg_temp.ok((select v->>'active'='true'and v->>'enabled'='true'and v->>'sheetId'='fatigue'and (select array_agg(k order by k)from jsonb_object_keys(v)k)='{active,enabled,ok,sheetId}'from(select public.zoe_symptom_intake_member()v)x),'Member A reads only their own active-intake state');
reset role;
select pg_temp.as_user('e1820000-0000-4000-8000-000000000003','e1820000-0000-4000-8000-000000000013');set local role authenticated;
select pg_temp.ok((select v->>'active'='false'from(select public.zoe_symptom_intake_member()v)x),'Member T does not see A''s intake');
reset role;
-- The assigned doctor reads their member's summaries; another doctor and the admin cannot through this view.
select pg_temp.as_staff('e1820000-0000-4000-8000-000000000002','e1820000-0000-4000-8000-000000000012');set local role authenticated;
select pg_temp.ok((select jsonb_array_length(v->'intakes')=3 and exists(select 1 from jsonb_array_elements(v->'intakes')e where e->>'ending'='member_stopped')and v::text !~ 'Synthetic since this morning'
 from(select public.zoe_symptom_intakes_for_doctor('e1820000-0000-4000-8000-000000000001')v)x),'Assigned doctor reads the summaries (not the raw record)');
select pg_temp.ok((select x->>'outcome' from jsonb_array_elements(public.zoe_runs_for_doctor('e1820000-0000-4000-8000-000000000001')->'runs')x limit 1)in('intake_asked','intake_completed','intake_escalated','stale'),'Zoe runs view lists intake outcomes');
reset role;
select pg_temp.as_staff('e1820000-0000-4000-8000-000000000005','e1820000-0000-4000-8000-000000000015');set local role authenticated;
do $$begin perform public.zoe_symptom_intakes_for_doctor('e1820000-0000-4000-8000-000000000001');raise exception 'FAIL: other doctor read intakes';exception when insufficient_privilege then null;end$$;
reset role;

-- 11b. Future-dated readings (20261018115307). No path stores one; an existing one is ignored by the claim.
do $$begin
 begin insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('e1820000-0000-4000-8000-000000000001',gen_random_uuid(),160,120,now()+interval '4 days');
  raise exception 'FAIL: future reading stored';exception when check_violation then null;end;
 begin update public.patient_measurements set measured_at=now()+interval '1 hour' where user_id='e1820000-0000-4000-8000-000000000001';
  raise exception 'FAIL: reading moved into the future';exception when check_violation then null;end;
end$$;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('e1820000-0000-4000-8000-000000000001',gen_random_uuid(),121,79,now()+interval '4 minutes');
select pg_temp.ok(true,'A reading up to 5 minutes ahead (clock skew) is still accepted');
delete from public.patient_measurements where user_id='e1820000-0000-4000-8000-000000000001' and systolic=121;
-- A row stored before the trigger existed (as on staging): bypass triggers to plant it.
set local session_replication_role=replica;
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-0000000000f1',160,120,now()+interval '4 days');
set local session_replication_role=origin;
update public.patient_measurements set pulse=70 where submission_id='e1820000-0000-4000-8000-0000000000f1';
select pg_temp.ok(true,'An existing future row stays editable apart from its time');
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000b1','Synthetic I have a headache');
insert into kv values('fut1',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
select pg_temp.ok((select v#>>'{intake,latestReading,systolic}'='152'and v#>>'{intake,latestReading,diastolic}'='94'
 and (v#>>'{intake,latestReading,minutesAgo}')::int between 110 and 130 from kv where k='fut1'),'Claim ignores a future-dated reading and carries the latest past one');
insert into public.patient_measurements(user_id,submission_id,systolic,diastolic,measured_at)values('e1820000-0000-4000-8000-000000000001',gen_random_uuid(),185,112,now()-interval '1 hour');
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000b2','Synthetic my head still hurts');
insert into kv values('fut2',pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001'));
select pg_temp.ok((select v#>>'{intake,latestReading,systolic}'='185'and v#>>'{intake,latestReading,diastolic}'='112'
 and (v#>>'{intake,latestReading,minutesAgo}')::int between 55 and 65 from kv where k='fut2'),'Claim carries a crisis reading from 1 h ago (RF-03 still applies)');
reset role;

-- 12. Switch off: the claim carries no intake part.
update public.zoe_settings set symptom_intake_enabled=false;
select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011','e1820000-0000-4000-8000-0000000000aa','Synthetic still tired');
select pg_temp.ok((select not(v ? 'intake')from(select pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001')v)x),'Switch off: no intake in the job');

rollback;
