-- Zoe topic scope and per-topic doctor takeover (20261021070207; Armen and Khikar 20 Oct, Armen msg 251). The member's
-- "New question" divider (who may write and read it, the thread key only when there is one); the worker's topic context
-- (zoe_run_topic: the divider, the last recorded topic, the health profile); zoe_run_finish recording each run's topic and,
-- in doctor mode with the 'topic' scope, letting through only a run whose topic the check gave to Zoe; the 'conversation'
-- scope unchanged; the Telegram acknowledgement and the app's settledSeq under each scope. Synthetic, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('c0e70000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('c0e70000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method',amr)),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,anon,service_role;
create function pg_temp.send(member int,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(member,'otp');set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text',txt));reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: message not received: %',j;end if;return j;end$$;
create function pg_temp.claim(member int,p_tier text default 'high')returns uuid language plpgsql as $$declare j jsonb;run uuid;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;
 select(x->>'runId')::uuid into run from jsonb_array_elements(j)x where(x->>'memberId')::uuid=pg_temp.u(member);
 if run is null then raise exception 'FAIL: no run claimed: %',j;end if;
 update public.zoe_runs set reserved=p_tier<>'none',tier=nullif(p_tier,'none')where id=run;return run;end$$;
create function pg_temp.next(member int,txt text,p_tier text default 'high')returns uuid language sql as $$select pg_temp.send(member,txt);select pg_temp.claim(member,p_tier)$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.res(outcome text,reason text,answer text,extra jsonb default '{}',lang text default 'en')returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'reason',reason,'summary','Synthetic summary for the doctor.','answer',answer,'language',case when answer is null then null else lang end,
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',300),'costUsd',0.01,'latencyMs',900,
  'provider','vercel.ai_gateway','model','anthropic/claude-opus-5.5','configVersion','topic-scope-check','sealed',null,'tier','high','tierReason','rule_result_reading','fallbackUsed',false,
  'events','[]'::jsonb))||extra
$$;
create function pg_temp.h(urgency text,fwd text default 'none',reason text default 'none')returns jsonb language sql as $$
 select jsonb_build_object('urgency',urgency,'modelUrgency',urgency,'forward',fwd,'forwardReason',reason)$$;
create function pg_temp.receipt()returns jsonb language sql as $$select jsonb_build_object('receipt',jsonb_build_object('text','Synthetic warm receipt.','language','en','kind','receipt'))$$;
-- A pending draft for member n (as Zoe proposes it), then doctor d approves it through conversation_actions and conversation_command.
create function pg_temp.reply(member int,d int,txt text default 'Synthetic question for the doctor')returns jsonb language plpgsql as $$declare run uuid;a jsonb;c jsonb;j jsonb;begin
 run:=pg_temp.next(member,txt,'medium');
 j:=pg_temp.finish(run,pg_temp.res('draft_proposed','draft_passed_guards',null,jsonb_build_object('draft','Synthetic doctor reply.','tier','medium')));
 if j->>'outcome'<>'draft_proposed'then raise exception 'FAIL: no draft proposed: %',j;end if;
 perform pg_temp.as_user(d);set local role authenticated;a:=public.conversation_actions(pg_temp.u(member));reset role;
 c:=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(a#>'{view,actions}')x where x->>'purpose'='reply.approve'),
  'requestId',replace(gen_random_uuid()::text,'-',''));
 perform pg_temp.as_user(d);set local role authenticated;j:=public.conversation_command(c);reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: approval refused: %',j;end if;return j;end$$;
-- The doctor writes their own reply (conversation_compose) and approves it: the typed-reply path.
create function pg_temp.typed(member int,d int)returns jsonb language plpgsql as $$declare w jsonb;a jsonb;c jsonb;j jsonb;begin
 perform pg_temp.send(member,'Synthetic question, typed reply');
 perform pg_temp.as_user(d);set local role authenticated;w:=public.conversation_workspace(pg_temp.u(member));
 j:=public.conversation_compose(pg_temp.u(member),gen_random_uuid(),(w->>'version')::bigint,(w->>'clinicalRevision')::bigint,(w->>'draftEpoch')::bigint,w->>'sourceToken','Synthetic typed reply.','Synthetic summary.');
 if j->>'ok'<>'true'then raise exception 'FAIL: compose refused: %',j;end if;
 a:=public.conversation_actions(pg_temp.u(member));
 c:=jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(a#>'{view,actions}')x where x->>'purpose'='reply.approve'),
  'requestId',replace(gen_random_uuid()::text,'-',''));
 j:=public.conversation_command(c);reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: typed approval refused: %',j;end if;return j;end$$;
create function pg_temp.conv(member int)returns uuid language sql as $$select id from public.conversations where member_id=pg_temp.u(member)$$;
create function pg_temp.mode(member int)returns public.zoe_doctor_mode language sql as $$select * from public.zoe_doctor_mode where conversation_id=pg_temp.conv(member)$$;
create function pg_temp.view(n int,member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_zoe_mode(pg_temp.u(member));reset role;return j;end$$;
create function pg_temp.hand_back(n int,member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_zoe_hand_back(pg_temp.u(member));reset role;return j;end$$;
create function pg_temp.thread(member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(member,'otp');set local role authenticated;j:=public.conversation_member_thread();reset role;return j;end$$;
create function pg_temp.waiting(n int,member int)returns boolean language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.conversation_awaiting_replies();reset role;
 return exists(select 1 from jsonb_array_elements(j->'items')x where(x->>'memberId')::uuid=pg_temp.u(member)and x->>'reason'='new_message');end$$;
create function pg_temp.dm_runs(run uuid)returns boolean language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_doctor_mode(array[run]);reset role;return(j->0->>'doctorMode')::boolean;end$$;
create function pg_temp.notices(member int,kind text)returns bigint language sql as $$select count(*)from public.zoe_mode_notices where member_id=pg_temp.u(member)and zoe_mode_notices.kind=notices.kind$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

-- People: members 01, 03 (doctor 11, nurse 13), 02 (doctor 12); doctors 11, 12; nurse 13; admin 14. Member 03 has no Zoe consent.
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990380'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,3,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,2,3,11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic topic clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','Dr Topic One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Dr Topic Two',pg_temp.u(20)),(pg_temp.u(13),'nurse','Nurse Topic',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Topic');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(11),pg_temp.u(13)),(pg_temp.u(2),pg_temp.u(12),null),(pg_temp.u(3),pg_temp.u(11),pg_temp.u(13));
update public.profiles set locale='en',display_name='Zara Synthetic'where id in(pg_temp.u(1),pg_temp.u(2),pg_temp.u(3));
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-topic',3600,600,60,40,false,true,true)on conflict(singleton)do update set version=excluded.version,intake_max_messages=40,app_chat_enabled=true,delivery_enabled=true,grant_seconds=3600,intent_seconds=600;
-- Member 01 also has Telegram (the route a doctor's reply takes).
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values(pg_temp.u(1),'telegram','synthetic-bot','synthetic-topic-1','9100001',1,true,'synthetic-topic',now()+interval '1 day',4096);
insert into public.zoe_consents(member_id,kind,granted,wording_version)select pg_temp.u(n),'zoe_reads_messages',true,'zoe-consent-draft-1'from unnest(array[1,2])n;
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-1',staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.u(14)from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_settings set conversational_replies_enabled=true;
update public.zoe_settings set health_answers_enabled=true;


update public.system_message_templates set approved=true,approval_note='Staging check'where template_id in('zoe.answer','zoe.chat','zoe.receipt','zoe.urgent');
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id='zoe.mode';
create function pg_temp.topic_ctx(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_topic(array[run]);reset role;return j->0;end$$;
create function pg_temp.dm_row(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_doctor_mode(array[run]);reset role;return j->0;end$$;
create function pg_temp.new_topic(member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(member,'otp');set local role authenticated;j:=public.conversation_member_new_topic();reset role;return j;end$$;
create function pg_temp.breaks(n int,member int)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(n);set local role authenticated;j:=public.doctor_conversation_topic_breaks(pg_temp.u(member));reset role;return j;end$$;
create function pg_temp.topic(owner text,start_seq int,doctor text default null)returns jsonb language sql as $$
 select jsonb_build_object('topic',jsonb_strip_nulls(jsonb_build_object('topic','new','source','classifier','startSeq',start_seq,'owner',owner,'doctorTopic',doctor,'kept',0,'dropped',2)))$$;
create function pg_temp.answered(run uuid)returns boolean language sql as $$select exists(select 1 from public.zoe_member_answers where run_id=run and kind='answer')$$;
grant execute on all functions in schema pg_temp to authenticated,anon,service_role;

-- 0. Grants and storage.
select pg_temp.ok(has_function_privilege('authenticated','public.conversation_member_new_topic()','execute')and has_function_privilege('authenticated','public.doctor_conversation_topic_breaks(uuid)','execute')
 and not has_function_privilege('anon','public.conversation_member_new_topic()','execute')and not has_function_privilege('authenticated','public.zoe_run_topic(uuid[])','execute')
 and has_function_privilege('service_role','public.zoe_run_topic(uuid[])','execute')and not has_function_privilege('authenticated','public._conversation_topic_breaks(uuid)','execute')
 and not has_function_privilege('service_role','public._conversation_topic_breaks(uuid)','execute'),'grants: member and doctor wrappers, worker read, private helper');
select pg_temp.ok(not has_table_privilege('authenticated','public.conversation_topic_breaks','select')and not has_table_privilege('anon','public.conversation_topic_breaks','insert')
 and(select relrowsecurity from pg_class where oid='public.conversation_topic_breaks'::regclass),'dividers: RLS on, no client access');
select pg_temp.ok((select doctor_takeover_scope='topic'from public.zoe_settings where singleton),'default scope: per topic (Armen msg 251)');
select pg_temp.ok((select prosrc like '%_zoe_run_finish_core%'and prosrc like '%doctorTopic%'from pg_proc where oid='public.zoe_run_finish(uuid,jsonb)'::regprocedure),'zoe_run_finish is still the wrapper');

-- 1. The health profile: questionnaire conditions, the member's own medicines, an open care alert.
insert into public.patient_assessments(user_id,answers,completed_at)values(pg_temp.u(1),
 '{"q6.conditions":{"value":["diabetes","kidney","none"]},"q5.diagnosed":{"value":"treated"}}'::jsonb,now()-interval '3 days');
insert into public.member_medicines(user_id,name,dose,times,started_on)values(pg_temp.u(1),'Synthetic amlodipine','5 mg',array['08:00'::time,'20:00'::time],current_date-10);
insert into public.member_medicines(user_id,name,dose,times,started_on,stopped_at)values(pg_temp.u(1),'Synthetic stopped medicine',null,array['09:00'::time],current_date-30,now()-interval '1 day');

-- 2. Before any divider: no 'breaks' key in the member's thread (the app running during the deploy has a strict schema).
create temp table r1 as select pg_temp.next(1,'My platelets are 140, is that low?')run;grant select on r1 to authenticated,service_role;
select pg_temp.ok(not(pg_temp.thread(1)?'breaks'),'no divider: no breaks key');
select pg_temp.ok((select t->>'breakAfterSeq'is null and t->>'startSeq'is null and t->>'zoeOwns'='false'
  and t#>'{profile,conditions}'='["diabetes","kidney"]'::jsonb and t#>>'{profile,bpDiagnosed}'='treated'
  and jsonb_array_length(t#>'{profile,medicines}')=1 and t#>'{profile,medicines,0,times}'='["08:00","20:00"]'::jsonb and t#>>'{profile,medicines,0,name}'='Synthetic amlodipine'
 from pg_temp.topic_ctx((select run from r1))t),'topic context: no divider, no topic yet, the profile');
-- The run records its topic.
select pg_temp.finish((select run from r1),pg_temp.res('answered','health_answer_passed_guards','Synthetic answer about platelets.',jsonb_build_object('health',pg_temp.h('planned')))||pg_temp.topic('zoe',1));
select pg_temp.ok((select topic_start_seq=1 and topic_owner='zoe'from public.zoe_runs where id=(select run from r1)),'the finish records the topic');
-- A malformed topic is ignored, never an error.
create temp table r1b as select pg_temp.next(1,'And is 130 low?')run;grant select on r1b to authenticated,service_role;
select pg_temp.finish((select run from r1b),pg_temp.res('answered','health_answer_passed_guards','Synthetic answer.',jsonb_build_object('health',pg_temp.h('planned'),
 'topic',jsonb_build_object('owner','someone','startSeq','x'))))->>'outcome' as o \gset
select pg_temp.ok(:'o'='answered'and(select topic_owner is null from public.zoe_runs where id=(select run from r1b)),'a malformed topic: none recorded');

-- 3. The member's divider.
select pg_temp.ok((select j->>'ok'='true'and j->>'replayed'='false'and(j->>'afterSeq')::int=2 from(select pg_temp.new_topic(1)j)q),'the member presses New question');
select pg_temp.ok((select j->>'replayed'='true'from(select pg_temp.new_topic(1)j)q)and(select count(*)=1 from public.conversation_topic_breaks where member_id=pg_temp.u(1)),'a second press before a message: nothing new');
select pg_temp.ok(exists(select 1 from public.conversation_audit where conversation_id=pg_temp.conv(1)and kind='member.topic_break'and actor_id=pg_temp.u(1)),'audited');
select pg_temp.ok((select t->'breaks'@>'[{"afterSeq":2}]'::jsonb from pg_temp.thread(1)t),'the member''s thread has the divider');
select pg_temp.ok(pg_temp.breaks(11,1)->'breaks'@>'[{"afterSeq":2}]'::jsonb,'the assigned doctor sees it');
select pg_temp.ok(pg_temp.denied($$select pg_temp.breaks(12,1)$$)and pg_temp.denied($$select pg_temp.breaks(13,1)$$)and pg_temp.denied($$select pg_temp.breaks(1,1)$$),'another doctor, a nurse, the member: refused');
select pg_temp.ok((select j->>'replayed'='true'from(select pg_temp.new_topic(2)j)q),'a member with no conversation: nothing');
update public.conversation_policy set app_chat_enabled=false;
select pg_temp.ok(pg_temp.new_topic(1)->>'code'='unavailable','app chat off: refused');
update public.conversation_policy set app_chat_enabled=true;
create temp table r2 as select pg_temp.next(1,'What is a good breakfast?')run;grant select on r2 to authenticated,service_role;
select pg_temp.ok((select(t->>'breakAfterSeq')::int=2 and(t->>'startSeq')::int=1 from pg_temp.topic_ctx((select run from r2))t),'the next run sees the divider and the last topic');
select pg_temp.finish((select run from r2),pg_temp.res('answered','health_answer_passed_guards','Synthetic breakfast answer.',jsonb_build_object('health',pg_temp.h('planned')))||pg_temp.topic('zoe',3));

-- 4. Doctor mode with the 'topic' scope.
select pg_temp.reply(1,11,'Synthetic platelets question for the doctor');
select pg_temp.ok((select doctor_mode from pg_temp.mode(1)),'doctor mode on');
select pg_temp.ok(pg_temp.view(11,1)->>'scope'='topic','the doctor''s page says per topic');
create temp table r4 as select pg_temp.next(1,'Can I add honey to my oats?')run;grant select on r4 to authenticated,service_role;
select pg_temp.ok((select d->>'doctorMode'='true'and d->>'scope'='topic'and d#>>'{doctorMatter,reply}'='Synthetic doctor reply.'
  and jsonb_array_length(d#>'{doctorMatter,messages}')between 1 and 3 from pg_temp.dm_row((select run from r4))d),'the worker gets the scope and the doctor''s matter');
select pg_temp.ok((pg_temp.thread(1)->>'zoeReplies')::boolean,'topic scope: the Telegram acknowledgement still waits for Zoe');
select pg_temp.ok((select(t->>'settledSeq')::bigint<(select max(seq)from public.conversation_messages where conversation_id=pg_temp.conv(1))from pg_temp.thread(1)t),'topic scope: the open run is not settled ("Zoe is writing")');
select pg_temp.ok((select t->>'zoeOwns'='false'from pg_temp.topic_ctx((select run from r4))t),'Zoe does not own a topic since the doctor''s reply');
-- The check gave the new question to Zoe: her answer goes out, the topic is hers.
select pg_temp.finish((select run from r4),pg_temp.res('answered','health_answer_passed_guards','Synthetic honey answer.',jsonb_build_object('health',pg_temp.h('planned')))
 ||pg_temp.topic('zoe',5,'no')||pg_temp.receipt())->>'outcome' as o \gset
select pg_temp.ok(:'o'='answered'and pg_temp.answered((select run from r4)),'unrelated new question: Zoe''s answer goes to the member');
select pg_temp.ok((select topic_owner='zoe'from public.zoe_runs where id=(select run from r4))and exists(select 1 from public.conversation_trace_events where subject_id=(select run::text from r4)and name='zoe.guard.doctor_mode'and outcome='allow'),
 'recorded as Zoe''s topic, traced');
select pg_temp.ok((select doctor_mode from pg_temp.mode(1)),'doctor mode stays on for the doctor''s topic');
-- Zoe owns that topic now: the next run sees it.
create temp table r5 as select pg_temp.next(1,'And how much honey?')run;grant select on r5 to authenticated,service_role;
select pg_temp.ok((select t->>'zoeOwns'='true'and(t->>'startSeq')::int=5 from pg_temp.topic_ctx((select run from r5))t),'Zoe owns her topic since the doctor''s reply');
-- Without the check's "no" (a worker that did not know about doctor mode), or with the doctor's topic: held as before.
select pg_temp.finish((select run from r5),pg_temp.res('answered','health_answer_passed_guards','Synthetic answer.',jsonb_build_object('health',pg_temp.h('planned')))||pg_temp.topic('zoe',5))->>'outcome' as o \gset
select pg_temp.ok(:'o'='discarded'
 and not pg_temp.answered((select run from r5)),'owner zoe without the check''s verdict: held');
select pg_temp.ok((select topic_owner='doctor'from public.zoe_runs where id=(select run from r5)),'a held run is the doctor''s');
create temp table r6 as select pg_temp.next(1,'Should I repeat the blood test sooner?','none')run;grant select on r6 to authenticated,service_role;
select pg_temp.ok((select t->>'zoeOwns'='false'from pg_temp.topic_ctx((select run from r6))t),'after a held run Zoe owns nothing');
select pg_temp.finish((select run from r6),pg_temp.res('discarded','doctor_mode',null,jsonb_build_object('tier','none','tierReason','not_routed'))||pg_temp.topic('doctor',1,'yes'))->>'outcome' as o \gset
select pg_temp.ok(:'o'='discarded'
 and not exists(select 1 from public.zoe_member_answers where run_id=(select run from r6)),'the doctor''s follow-up: held, no text');
select pg_temp.ok(pg_temp.waiting(11,1),'the doctor''s list still has the member');
-- Safety texts unchanged.
create temp table r6b as select pg_temp.next(1,'Synthetic urgent words','none')run;grant select on r6b to authenticated,service_role;
insert into kv select 'urgent',pg_temp.finish((select run from r6b),pg_temp.res('discarded','urgent_route_no_model_call','Synthetic urgent text. Call 103.',jsonb_build_object('tier','none','tierReason','urgent',
 'events',jsonb_build_array(jsonb_build_object('name','zoe.urgent_match','outcome','escalate','reason','urgent_words_matched','rule','zoe.urgent_staging_placeholder','ruleVersion','check','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.urgent.red_flags','RF-01'))))));
select pg_temp.ok((select v->>'outcome'from kv where k='urgent')='discarded'
 and exists(select 1 from public.zoe_member_answers where member_id=pg_temp.u(1)and kind='urgent'),'urgent text in doctor mode, topic scope');

-- 5. The 'conversation' scope: everything held, as in 20261020082321, even with the check's "no".
update public.zoe_settings set doctor_takeover_scope='conversation';
select pg_temp.ok(not(pg_temp.thread(1)->>'zoeReplies')::boolean,'conversation scope: Zoe will not reply');
create temp table r7 as select pg_temp.next(1,'What about coffee?')run;grant select on r7 to authenticated,service_role;
select pg_temp.ok((select(t->>'settledSeq')::bigint=(select max(seq)from public.conversation_messages where conversation_id=pg_temp.conv(1))from pg_temp.thread(1)t),'conversation scope: settled at once');
select pg_temp.finish((select run from r7),pg_temp.res('answered','health_answer_passed_guards','Synthetic coffee answer.',jsonb_build_object('health',pg_temp.h('planned')))||pg_temp.topic('zoe',9,'no'))->>'outcome' as o \gset
select pg_temp.ok(:'o'='discarded'
 and not pg_temp.answered((select run from r7)),'conversation scope: held');
select pg_temp.ok(pg_temp.dm_row(pg_temp.next(1,'Hello again'))->>'scope'='conversation','the worker gets the conversation scope');
select pg_temp.ok(pg_temp.view(11,1)->>'scope'='conversation','the doctor''s page says the whole conversation');
update public.zoe_settings set doctor_takeover_scope='topic';

-- 6. Outside doctor mode the topic is recorded and changes nothing else (member 02).
create temp table r8 as select pg_temp.next(2,'What does LDL mean?')run;grant select on r8 to authenticated,service_role;
select pg_temp.finish((select run from r8),pg_temp.res('answered','health_answer_passed_guards','Synthetic LDL answer.',jsonb_build_object('health',pg_temp.h('planned')))||pg_temp.topic('zoe',1))->>'outcome' as o \gset
select pg_temp.ok(:'o'='answered'
 and pg_temp.answered((select run from r8))and(select topic_owner='zoe'from public.zoe_runs where id=(select run from r8)),'Zoe mode: answered, topic recorded');

rollback;
select 'check-zoe-context-scope: all assertions passed'as result;
