-- Zoe's direct answers in the member app thread (20261017202157): one conversation across app and
-- Telegram; an answer shows to its own member only, for an app-only member with no Telegram, and
-- for a Telegram message too; never a doctor draft, summary or held answer; nothing without the
-- approved zoe.answer wording; urgent text gets no answer. Rolled back. Synthetic fixtures only; no
-- Telegram network, provider or model.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_zai",9019,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_zai",9019,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.link(m uuid,u bigint)returns jsonb language plpgsql as $$declare b jsonb;begin
 b:=public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null);
 return public._telegram_replies_activate(m,(b->>'bindingId')::uuid);end$$;
create function pg_temp.say(id text,u bigint,txt text)returns void language plpgsql as $$begin
 perform pg_temp.as_service();perform public.channel_inbox_commit(pg_temp.event(id,u,txt));perform pg_temp.drain();end$$;
create function pg_temp.send(m text,sid text,rid text,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',rid,'text',txt));reset role;return j;end$$;
create function pg_temp.thread(m text,sid text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_member_thread();reset role;return j;end$$;
-- Claim, then reserve the member's run on the low tier (as the pipeline does before a model call).
create function pg_temp.claim_run(m uuid)returns uuid language plpgsql as $$declare j jsonb;run uuid;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;
 select (x->>'runId')::uuid into run from jsonb_array_elements(j)x where (x->>'memberId')::uuid=m;
 if run is null then raise exception 'FAIL: no claim for %',m;end if;
 update public.zoe_runs set reserved=true,tier='low'where id=run;return run;end$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.answer(text text,lang text default 'en')returns jsonb language sql as $$
 select jsonb_build_object('outcome','answered','reason','direct_answer_passed_guards','summary','Synthetic doctor summary of a logistics question','draft',null,'answer',text,'language',lang,
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',80),'costUsd',0.0002,'latencyMs',800,
  'provider','vercel.ai_gateway','model','anthropic/claude-haiku-5.5','configVersion','zoe-answers-in-app-check','sealed',null,'tier','low','tierReason','rule_logistics','fallbackUsed',false,'events','[]'::jsonb)
$$;
create function pg_temp.draft(body text)returns jsonb language sql as $$
 select jsonb_build_object('outcome','draft_proposed','reason','draft_passed_guards','summary','Synthetic doctor summary of a health question','draft',body,'guardReasons','[]'::jsonb,
  'redactionCount',0,'usage',jsonb_build_object('inputTokens',100,'outputTokens',20),'costUsd',0.001,'latencyMs',3,'provider','vercel.ai_gateway','model','anthropic/claude-haiku-5.5',
  'configVersion','zoe-answers-in-app-check','sealed',null,'tier','low','tierReason','rule_health','fallbackUsed',false,'events','[]'::jsonb)
$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

-- A: member with Telegram and the app; B: app-only member (no Telegram, Armenian); D: assigned doctor.
insert into auth.users(id,phone,phone_confirmed_at)values('e1810000-0000-4000-8000-000000000001','37499081801',now()),('e1810000-0000-4000-8000-000000000003','37499081803',now()),
 ('e1810000-0000-4000-8000-000000000002',null,null);
insert into public.workspace_clinics(id,name)values('e1810000-0000-4000-8000-000000000004','Synthetic Zoe answers clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('e1810000-0000-4000-8000-000000000002','doctor','Dr Answers Synthetic','e1810000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)values('e1810000-0000-4000-8000-000000000011','e1810000-0000-4000-8000-000000000001',now(),now()),
 ('e1810000-0000-4000-8000-000000000012','e1810000-0000-4000-8000-000000000002',now(),now()),('e1810000-0000-4000-8000-000000000013','e1810000-0000-4000-8000-000000000003',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('e1810000-0000-4000-8000-000000000001','e1810000-0000-4000-8000-000000000002'),('e1810000-0000-4000-8000-000000000003','e1810000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='Answers Member A'where id='e1810000-0000-4000-8000-000000000001';
update public.profiles set locale='hy',display_name='Answers Member B'where id='e1810000-0000-4000-8000-000000000003';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_zai',9019,600,'consent-zai');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-zai',3600,600,60,20,false,true,true);
select pg_temp.link('e1810000-0000-4000-8000-000000000001',8181);
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version,direct_answers_enabled)values(true,'zoe-consent-draft-1',true);
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('e1810000-0000-4000-8000-000000000001','zoe_reads_messages',true,'zoe-consent-draft-1'),
 ('e1810000-0000-4000-8000-000000000003','zoe_reads_messages',true,'zoe-consent-draft-1');
select pg_temp.ok((select bool_and(not approved)from public.system_message_templates where template_id='zoe.answer'),'zoe.answer wording starts unapproved');

-- 1. Unapproved wording: an app message is not answered; the doctor keeps it; nothing in the thread.
select pg_temp.ok((select v->>'ok'='true'from(select pg_temp.send('e1810000-0000-4000-8000-000000000003','e1810000-0000-4000-8000-000000000013','e1810000-0000-4000-8000-0000000000b0','Synthetic where do I book a visit?')v)x),'B app message stored');
insert into kv values('run0',to_jsonb(pg_temp.claim_run('e1810000-0000-4000-8000-000000000003')));
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run0'),pg_temp.answer('Synthetic book under Visits.','hy'))->>'outcome'='summary_only','Unapproved wording: not answered');
select pg_temp.ok((select reason_code='direct_answer_unapproved'from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='run0'))and not exists(select 1 from public.zoe_member_answers where member_id='e1810000-0000-4000-8000-000000000003'),'direct_answer_unapproved; nothing stored');
select pg_temp.ok((select v->'answers'='[]'::jsonb from(select pg_temp.thread('e1810000-0000-4000-8000-000000000003','e1810000-0000-4000-8000-000000000013')v)x),'Nothing in B''s thread');
update public.system_message_templates set approved=true where template_id='zoe.answer';

-- 2. App-only member: the answer shows in the app thread with no Telegram involved.
select pg_temp.send('e1810000-0000-4000-8000-000000000003','e1810000-0000-4000-8000-000000000013','e1810000-0000-4000-8000-0000000000b1','Synthetic where are my visit times?');
insert into kv values('runB',to_jsonb(pg_temp.claim_run('e1810000-0000-4000-8000-000000000003')));
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='runB'),pg_temp.answer('Synthetic visit times are under Care plan.','hy'))->>'outcome'='answered','App-only member: answered');
select pg_temp.ok((select system_message_id is null from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='runB'))
 and not exists(select 1 from public.system_messages where member_id='e1810000-0000-4000-8000-000000000003'),'No Telegram message for the app-only member');
insert into kv values('tB',pg_temp.thread('e1810000-0000-4000-8000-000000000003','e1810000-0000-4000-8000-000000000013'));
select pg_temp.ok((select jsonb_array_length(v->'answers')=1 and v->'answers'->0->>'text'='Synthetic visit times are under Care plan.'from kv where k='tB'),'B sees Zoe''s answer in the app');
select pg_temp.ok((select (select array_agg(k order by k)from jsonb_object_keys(v)k)='{ack,answers,messages,ok,replies,settledSeq,suggestionSafety,version,zoeReplies}'
 and (select array_agg(k order by k)from jsonb_object_keys(v->'answers'->0)k)='{at,id,text}'from kv where k='tB'),'Thread keys and answer keys exactly as the app contract expects');
select pg_temp.ok((select v::text !~ 'Synthetic doctor summary|vercel|haiku|runId|reason'from kv where k='tB'),'No summary, provider, model or run detail in the thread');

-- 3. Only its own member: A does not see B's answer, a doctor gets no member thread.
insert into kv values('tA0',pg_temp.thread('e1810000-0000-4000-8000-000000000001','e1810000-0000-4000-8000-000000000011'));
select pg_temp.ok((select v->'answers'='[]'::jsonb and v::text !~ 'Care plan'from kv where k='tA0'),'A does not see B''s answer');
select pg_temp.ok((select coalesce(v->'answers','[]'::jsonb)='[]'::jsonb and v::text !~ 'Care plan'from(select pg_temp.thread('e1810000-0000-4000-8000-000000000002','e1810000-0000-4000-8000-000000000012')v)x),'The doctor''s own session reads no member''s answers');
do $$begin perform set_config('request.jwt.claims','{"role":"anon"}',true);set local role anon;perform public.conversation_member_thread();raise exception 'FAIL: anon read a thread';
 exception when insufficient_privilege then reset role;end$$;
select pg_temp.ok(not has_table_privilege('authenticated','public.zoe_member_answers','select'),'No direct table read of answers');

-- 4. One conversation across channels: A writes in Telegram, Zoe answers, the app shows both.
select pg_temp.say('8101',8181,'Synthetic Telegram: when is my lab visit?');
insert into kv values('runT',to_jsonb(pg_temp.claim_run('e1810000-0000-4000-8000-000000000001')));
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='runT'),pg_temp.answer('Synthetic Telegram answer: see Visits.'))->>'outcome'='answered','Telegram message answered');
select pg_temp.ok((select sm.state='queued'and sm.template_id='zoe.answer'from public.zoe_member_answers a join public.system_messages sm on sm.id=a.system_message_id
 where a.run_id=(select (v#>>'{}')::uuid from kv where k='runT')),'Queued for Telegram as before');
select pg_temp.send('e1810000-0000-4000-8000-000000000001','e1810000-0000-4000-8000-000000000011','e1810000-0000-4000-8000-0000000000a1','Synthetic app: and where do I upload results?');
insert into kv values('runA',to_jsonb(pg_temp.claim_run('e1810000-0000-4000-8000-000000000001')));
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='runA'),pg_temp.answer('Synthetic app answer: open Reports.'))->>'outcome'='answered','App message answered');
select pg_temp.ok((select count(*)=1 from public.conversations where member_id='e1810000-0000-4000-8000-000000000001'),'One conversation for A');
insert into kv values('tA',pg_temp.thread('e1810000-0000-4000-8000-000000000001','e1810000-0000-4000-8000-000000000011'));
select pg_temp.ok((select (select array_agg(x->>'channel' order by (x->>'seq')::bigint)from jsonb_array_elements(v->'messages')x)='{telegram,app}'
 and (select array_agg(x->>'text' order by x->>'at')from jsonb_array_elements(v->'answers')x)='{"Synthetic Telegram answer: see Visits.","Synthetic app answer: open Reports."}'from kv where k='tA'),
 'A''s app thread: both channels'' messages and both of Zoe''s answers, in order');

-- 5. A doctor draft never shows; only the doctor's approval would release it (as a reply, not as Zoe).
select pg_temp.send('e1810000-0000-4000-8000-000000000001','e1810000-0000-4000-8000-000000000011','e1810000-0000-4000-8000-0000000000a2','Synthetic my pressure was high today');
insert into kv values('runD',to_jsonb(pg_temp.claim_run('e1810000-0000-4000-8000-000000000001')));
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='runD'),pg_temp.draft('Synthetic AI draft about pressure'))->>'outcome'='draft_proposed','Health question: a doctor draft');
insert into kv values('tD',pg_temp.thread('e1810000-0000-4000-8000-000000000001','e1810000-0000-4000-8000-000000000011'));
select pg_temp.ok((select jsonb_array_length(v->'answers')=2 and v->'replies'='[]'::jsonb and v::text !~ 'Synthetic AI draft|health question'from kv where k='tD'),'The draft and its summary are not in the thread; answers unchanged');
-- A draft-shaped finish cannot smuggle an answer.
select pg_temp.ok((select count(*)=0 from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='runD')),'No answer row for a draft run');

-- 6. A Telegram answer held because its wording was not approved stays out of the app.
update public.system_messages set state='held',reason='template_unapproved'where id=(select system_message_id from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='runT'));
select pg_temp.ok((select (select array_agg(x->>'text')from jsonb_array_elements(v->'answers')x)='{"Synthetic app answer: open Reports."}'
 from(select pg_temp.thread('e1810000-0000-4000-8000-000000000001','e1810000-0000-4000-8000-000000000011')v)x),'Held (unapproved) Telegram answer not shown');
update public.system_messages set reason='template_withdrawn'where id=(select system_message_id from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='runT'));
select pg_temp.ok((select jsonb_array_length(v->'answers')=1 from(select pg_temp.thread('e1810000-0000-4000-8000-000000000001','e1810000-0000-4000-8000-000000000011')v)x),'Held (wording withdrawn by the staging rollback) Telegram answer not shown');
-- Held only because Telegram could not carry it (route): the app still shows it.
update public.system_messages set reason='route_unavailable'where id=(select system_message_id from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='runT'));
select pg_temp.ok((select jsonb_array_length(v->'answers')=2 from(select pg_temp.thread('e1810000-0000-4000-8000-000000000001','e1810000-0000-4000-8000-000000000011')v)x),'Telegram route down: the app still shows the answer');

-- 7. Urgent: no answer, no model; the app message gets no Telegram urgent template either.
select pg_temp.send('e1810000-0000-4000-8000-000000000003','e1810000-0000-4000-8000-000000000013','e1810000-0000-4000-8000-0000000000b2','Synthetic urgent chest pain');
insert into kv values('runU',to_jsonb(pg_temp.claim_run('e1810000-0000-4000-8000-000000000003')));
update public.zoe_runs set reserved=false,tier=null where id=(select (v#>>'{}')::uuid from kv where k='runU');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='runU'),pg_temp.answer('Synthetic should never show.')||jsonb_build_object('tier','none'))->>'code'='invalid','An answer for an unreserved (urgent, no model) run is refused');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='runU'),jsonb_build_object('outcome','discarded','reason','urgent_route_no_model_call','summary',null,'draft',null,'answer',null,
 'guardReasons','[]'::jsonb,'redactionCount',0,'usage',null,'costUsd',0,'latencyMs',null,'provider','none','model','none','sealed',null,'tier','none','tierReason','not_routed','fallbackUsed',false,'events','[]'::jsonb))->>'outcome'='discarded','Urgent discard recorded');
select pg_temp.ok((select jsonb_array_length(v->'answers')=1 and v::text !~ 'should never show'from(select pg_temp.thread('e1810000-0000-4000-8000-000000000003','e1810000-0000-4000-8000-000000000013')v)x)
 and not exists(select 1 from public.system_messages where member_id='e1810000-0000-4000-8000-000000000003'),'Urgent: nothing new in the thread, nothing queued');

-- 8. Switch off: no thread at all (answers included).
update public.conversation_policy set app_chat_enabled=false;
select pg_temp.ok(pg_temp.thread('e1810000-0000-4000-8000-000000000003','e1810000-0000-4000-8000-000000000013')->>'code'='unavailable','Switch off: no thread');
rollback;
select 'PASS Zoe answers in app: own member only, app-only member, both channels in one thread, never a draft or held answer, approved wording only, urgent unanswered' as result;
