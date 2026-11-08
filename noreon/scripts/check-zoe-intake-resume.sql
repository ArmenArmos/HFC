-- Zoe intake resume (20261019141429): zoe_run_resumable offers the newest intake only when it expired and the run's
-- message is the member's next message after it (none in between, no intake active, within 7 days); a finish of a
-- resumed turn (intake id null) opens a new intake row with the record carried and the original start; service role
-- only. Rolled back. Synthetic fixtures only.
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
create function pg_temp.resumable(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_resumable(array[run]);reset role;return j->0->'intake';end$$;
create function pg_temp.summary_only()returns jsonb language sql as $$select jsonb_build_object('outcome','summary_only','reason','check','summary','Synthetic summary.','draft',null,'answer',null,
 'guardReasons','[]'::jsonb,'redactionCount',0,'usage',null,'costUsd',0,'latencyMs',0,'provider','none','model','none','configVersion','check','sealed',null,'tier','none','tierReason','not_routed','fallbackUsed',false,'events','[]'::jsonb)$$;
create function pg_temp.k(key text)returns uuid language sql as $$select (v#>>'{}')::uuid from kv where k=key$$;
create function pg_temp.next_run()returns uuid language sql as $$select (pg_temp.job(pg_temp.claim(),'e1820000-0000-4000-8000-000000000001')->>'runId')::uuid$$;
create function pg_temp.say_app(rid text,txt text)returns void language sql as $$select pg_temp.send('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011',rid,txt);select null::void$$;

-- 1. A headache intake asks the onset question; it is active, so nothing is resumable.
select pg_temp.say_app('e1820000-0000-4000-8000-0000000000c1','Synthetic I have a headache');
insert into kv values('r1',to_jsonb(pg_temp.next_run()));
select pg_temp.finish(pg_temp.k('r1'),pg_temp.turn('intake_asked','active','Synthetic. When did it start?',null));
select pg_temp.ok((select count(*)=1 from public.zoe_symptom_intakes where member_id='e1820000-0000-4000-8000-000000000001'and state='active'),'Setup: one active intake');

-- 2. Twelve hours idle: the claim expires it (the doctor gets the notice, unchanged).
update public.zoe_symptom_intakes set updated_at=now()-interval '13 hours'where member_id='e1820000-0000-4000-8000-000000000001'and state='active';
select pg_temp.claim();
select pg_temp.ok((select state='expired'from public.zoe_symptom_intakes where member_id='e1820000-0000-4000-8000-000000000001'order by created_at desc limit 1),'Setup: the intake expired');

-- 3. The member's next message: the expired intake is offered, with its sheet, record and start.
select pg_temp.say_app('e1820000-0000-4000-8000-0000000000c2','Synthetic in the morning');
insert into kv values('r2',to_jsonb(pg_temp.next_run()));
select pg_temp.ok((select v->>'sheetId'='headache'and (v->>'sheetVersion')::int=1 and (v->>'startedSeq')::int=1 and v->>'language'='en'and v#>>'{record,asked,0}'='onset'
 and (v->>'idleMinutes')::int>=0 from(select pg_temp.resumable(pg_temp.k('r2'))v)x),'Next message: the expired intake is offered');

-- 4. A resumed turn (intake id null) opens a new active intake from the original start.
select pg_temp.ok((pg_temp.finish(pg_temp.k('r2'),pg_temp.turn('intake_asked','active','Synthetic. Where is the pain?',null))->>'outcome')='intake_asked','Resumed turn recorded');
select pg_temp.ok((select count(*)=1 and min(started_seq)=1 and bool_and(record#>>'{asked,0}'='onset')from public.zoe_symptom_intakes where member_id='e1820000-0000-4000-8000-000000000001'and state='active'),
 'A new active intake, from the original start, with the record');

-- 5. While an intake is active nothing is offered.
select pg_temp.say_app('e1820000-0000-4000-8000-0000000000c3','Synthetic at the front');
insert into kv values('r3',to_jsonb(pg_temp.next_run()));
select pg_temp.ok(pg_temp.resumable(pg_temp.k('r3'))='null'::jsonb,'Active intake: nothing offered');
select pg_temp.finish(pg_temp.k('r3'),pg_temp.turn('intake_asked','active','Synthetic. How strong?',(select id::text from public.zoe_symptom_intakes where member_id='e1820000-0000-4000-8000-000000000001'and state='active')));

-- 6. Expired again, then a member message that is not the next one: nothing offered.
update public.zoe_symptom_intakes set updated_at=now()-interval '13 hours'where member_id='e1820000-0000-4000-8000-000000000001'and state='active';
select pg_temp.claim();
select pg_temp.say_app('e1820000-0000-4000-8000-0000000000c4','Synthetic something else');
insert into kv values('r4',to_jsonb(pg_temp.next_run()));
select pg_temp.ok(pg_temp.resumable(pg_temp.k('r4')) is not null and pg_temp.resumable(pg_temp.k('r4'))<>'null'::jsonb,'Next message after the second expiry: offered');
select pg_temp.finish(pg_temp.k('r4'),pg_temp.summary_only());
select pg_temp.say_app('e1820000-0000-4000-8000-0000000000c5','Synthetic yesterday');
insert into kv values('r5',to_jsonb(pg_temp.next_run()));
select pg_temp.ok(pg_temp.resumable(pg_temp.k('r5'))='null'::jsonb,'A member message in between: nothing offered');
select pg_temp.finish(pg_temp.k('r5'),pg_temp.summary_only());

-- 7. More than 7 days after the member's last intake message: nothing offered.
update public.zoe_symptom_intakes set state='active',ending=null,finished_at=null,last_seq=(select max(seq)from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='e1820000-0000-4000-8000-000000000001')
 where id=(select id from public.zoe_symptom_intakes where member_id='e1820000-0000-4000-8000-000000000001'order by created_at desc limit 1);
update public.zoe_symptom_intakes set state='expired',ending='expired',finished_at=now()where member_id='e1820000-0000-4000-8000-000000000001'and state='active';
-- History is immutable; the rolled-back test backdates it with triggers suspended.
set local session_replication_role=replica;
update public.conversation_messages set created_at=now()-interval '8 days'where seq=(select last_seq from public.zoe_symptom_intakes where member_id='e1820000-0000-4000-8000-000000000001'order by created_at desc limit 1)
 and conversation_id=(select id from public.conversations where member_id='e1820000-0000-4000-8000-000000000001');
set local session_replication_role=origin;
select pg_temp.say_app('e1820000-0000-4000-8000-0000000000c6','Synthetic in the evening');
insert into kv values('r6',to_jsonb(pg_temp.next_run()));
select pg_temp.ok(pg_temp.resumable(pg_temp.k('r6'))='null'::jsonb,'Over 7 days: nothing offered');

-- 8. Service role only.
do $$begin perform pg_temp.as_user('e1820000-0000-4000-8000-000000000001','e1820000-0000-4000-8000-000000000011');set local role authenticated;
 begin perform public.zoe_run_resumable(array[gen_random_uuid()]);raise exception 'FAIL: a member called zoe_run_resumable';exception when insufficient_privilege then null;end;reset role;end$$;
select pg_temp.ok(not has_function_privilege('anon','public.zoe_run_resumable(uuid[])','execute')and not has_function_privilege('authenticated','public.zoe_run_resumable(uuid[])','execute'),'No grant to anon or members');

select 'zoe intake resume checks passed' as result;
rollback;
