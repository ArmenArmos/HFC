-- Doctor takeover of a member's Zoe conversation (20261020082321; Armen 20 Oct). The assigned doctor's approved reply puts
-- the thread in doctor mode (who and when recorded, audited, the member told in the app and on Telegram); in doctor mode
-- zoe_run_finish holds every member text except the safety ones (urgent route, 103 window, red flag: still sent, still a
-- care alert) and no receipt goes; the message stays on the doctor's needs-reply list; only the assigned doctor hands it
-- back (member told again); Zoe consent off: no change. Each step through the real path: conversation_receive,
-- zoe_run_claim, zoe_run_finish, conversation_actions, conversation_command. Synthetic, rolled back.
\set ON_ERROR_STOP on
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.u(n int)returns uuid language sql immutable as $$select('e1d70000-0000-4000-8000-0000000000'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.sid(n int)returns uuid language sql immutable as $$select('e1d70000-0000-4000-8000-0000000001'||lpad(n::text,2,'0'))::uuid$$;
create function pg_temp.as_user(n int,amr text default 'password')returns void language sql as $$
 select set_config('request.jwt.claims',jsonb_build_object('sub',pg_temp.u(n),'role','authenticated',
  'amr',jsonb_build_array(jsonb_build_object('method',amr)),'session_id',pg_temp.sid(n))::text,true)$$;
create function pg_temp.as_service()returns void language sql as $$select set_config('request.jwt.claims','{"role":"service_role"}',true)$$;
create function pg_temp.denied(sql text)returns boolean language plpgsql as $$begin execute sql;return false;exception when insufficient_privilege then return true;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,anon,service_role;
create function pg_temp.send(member int,txt text,to_doctor boolean default false)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(member,'otp');set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text',txt),to_doctor);reset role;
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
  'provider','vercel.ai_gateway','model','anthropic/claude-opus-5.5','configVersion','doctor-takeover-check','sealed',null,'tier','high','tierReason','rule_result_reading','fallbackUsed',false,
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
insert into auth.users(id,phone,phone_confirmed_at)select pg_temp.u(n),case when n<10 then '374990370'||lpad(n::text,2,'0')end,case when n<10 then now()end
 from unnest(array[1,2,3,11,12,13,14])n;
insert into auth.sessions(id,user_id,created_at,updated_at)select pg_temp.sid(n),pg_temp.u(n),now()-interval '1 hour',now()from unnest(array[1,2,3,11,12,13,14])n;
insert into public.workspace_clinics(id,name)values(pg_temp.u(20),'Synthetic takeover clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values
 (pg_temp.u(11),'doctor','Dr Takeover One',pg_temp.u(20)),(pg_temp.u(12),'doctor','Dr Takeover Two',pg_temp.u(20)),(pg_temp.u(13),'nurse','Nurse Takeover',pg_temp.u(20));
insert into public.workspace_staff(user_id,role,display_name)values(pg_temp.u(14),'admin','Admin Takeover');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id,assigned_nurse_id)values(pg_temp.u(1),pg_temp.u(11),pg_temp.u(13)),(pg_temp.u(2),pg_temp.u(12),null),(pg_temp.u(3),pg_temp.u(11),pg_temp.u(13));
update public.profiles set locale='en',display_name='Zara Synthetic'where id in(pg_temp.u(1),pg_temp.u(2),pg_temp.u(3));
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-takeover',3600,600,60,80,false,true,true)on conflict(singleton)do update set version=excluded.version,intake_max_messages=80,app_chat_enabled=true,delivery_enabled=true,grant_seconds=3600,intent_seconds=600;
-- Member 01 also has Telegram (the route a doctor's reply takes).
insert into public.conversation_endpoints(member_id,adapter,account_ref,principal_ref,address,generation,active,policy_version,expires_at,max_utf16)
 values(pg_temp.u(1),'telegram','synthetic-bot','synthetic-takeover-1','9100001',1,true,'synthetic-takeover',now()+interval '1 day',4096);
insert into public.zoe_consents(member_id,kind,granted,wording_version)select pg_temp.u(n),'zoe_reads_messages',true,'zoe-consent-draft-1'from unnest(array[1,2])n;
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-1',staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,pg_temp.u(14)from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_settings set conversational_replies_enabled=true;
update public.zoe_settings set health_answers_enabled=true;
-- This check covers the whole-conversation takeover; the per-topic scope (the default since 20261021070207) is in check-zoe-context-scope.sql.
update public.zoe_settings set doctor_takeover_scope='conversation';
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id in('zoe.answer','zoe.chat','zoe.receipt','zoe.urgent');
select pg_temp.ok((select bool_and(not approved and free_body)and count(*)=2 from public.system_message_templates where template_id='zoe.mode'),'zoe.mode ships unapproved (staging approves it)');
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id='zoe.mode';
insert into public.care_alert_settings(enabled)values(true)on conflict do nothing;
update public.care_alert_settings set enabled=true;

-- Eligible members may see due-task suggestions before their first conversation message.
select pg_temp.ok((pg_temp.thread(2)->>'suggestionSafety')::boolean,'an empty consented conversation has no alarm or pending safety check');
select pg_temp.ok((pg_temp.thread(3)->>'suggestionSafety')='false','an empty conversation without consent cannot suggest');

-- 0. Grants: the doctor wrappers for authenticated, the worker read for the service role, everything else private.
select pg_temp.ok(has_function_privilege('authenticated','public.doctor_zoe_mode(uuid)','execute')and has_function_privilege('authenticated','public.doctor_zoe_hand_back(uuid)','execute')
 and not has_function_privilege('anon','public.doctor_zoe_hand_back(uuid)','execute')and not has_function_privilege('authenticated','public.zoe_run_doctor_mode(uuid[])','execute')
 and has_function_privilege('service_role','public.zoe_run_doctor_mode(uuid[])','execute')and not has_function_privilege('authenticated','public.zoe_run_finish(uuid,jsonb)','execute')
 and not has_function_privilege('service_role','public._zoe_run_finish_core(uuid,jsonb)','execute')and not has_function_privilege('authenticated','public._zoe_mode_notify(uuid,uuid,text,timestamptz)','execute'),
 'grants: doctor wrappers, worker read, private helpers');
select pg_temp.ok(not has_table_privilege('authenticated','public.zoe_doctor_mode','select')and not has_table_privilege('authenticated','public.zoe_mode_notices','select')
 and not has_table_privilege('anon','public.zoe_mode_notices','select')and(select bool_and(relrowsecurity)from pg_class where oid in('public.zoe_doctor_mode'::regclass,'public.zoe_mode_notices'::regclass)),
 'tables: RLS on, no client access');
-- The guard wraps the finish (a later change that replaces zoe_run_finish instead of _zoe_run_finish_core fails here).
select pg_temp.ok((select prosrc like '%_zoe_run_finish_core%'and prosrc like '%_zoe_doctor_mode%'from pg_proc where oid='public.zoe_run_finish(uuid,jsonb)'::regprocedure),'zoe_run_finish is the doctor-mode wrapper');

-- 1. Before any doctor reply: Zoe answers; only the assigned doctor reads the state or hands back.
select pg_temp.ok(pg_temp.view(11,1)->>'doctorMode'='false'and pg_temp.view(11,1)->>'zoeActive'='true','assigned doctor: Zoe is answering');
select pg_temp.ok(pg_temp.denied($$select pg_temp.view(12,1)$$),'another doctor cannot read the state');
select pg_temp.ok(pg_temp.denied($$select pg_temp.view(13,1)$$),'nurse cannot read the state');
select pg_temp.ok(pg_temp.denied($$select pg_temp.view(14,1)$$),'admin cannot read the state');
select pg_temp.ok(pg_temp.denied($$select pg_temp.view(1,1)$$),'member cannot read the state');
select pg_temp.ok(pg_temp.denied($$select pg_temp.hand_back(1,1)$$),'member cannot hand back');
select pg_temp.ok(pg_temp.denied($$select pg_temp.hand_back(12,1)$$),'another doctor cannot hand back');
select pg_temp.ok(pg_temp.denied($$select pg_temp.hand_back(13,1)$$),'nurse cannot hand back');
select pg_temp.ok(pg_temp.denied($$select pg_temp.hand_back(14,1)$$),'admin cannot hand back');
select pg_temp.as_user(1,'otp');
select pg_temp.ok(pg_temp.denied($$set local role authenticated;insert into public.zoe_doctor_mode(conversation_id,member_id,doctor_mode,changed_by,reason)select id,member_id,false,member_id,'hand_back'from public.conversations$$),
 'member cannot write the state directly');reset role;
select pg_temp.ok((pg_temp.thread(1)->>'zoeReplies')::boolean,'before: the app expects Zoe to reply');

-- 2. The assigned doctor replies: doctor mode, who and when, audited, the member told in the app and on Telegram.
select pg_temp.reply(1,11);
select pg_temp.ok((select doctor_mode and changed_by=pg_temp.u(11)and reason='doctor_reply'and changed_at>now()-interval '1 minute'from pg_temp.mode(1)),'doctor mode on, by the doctor who replied');
select pg_temp.ok((select count(*)=1 from public.conversation_audit where conversation_id=pg_temp.conv(1)and kind='zoe.doctor_mode_on'and actor_id=pg_temp.u(11)
 and detail->>'approvalId'=(select a.id::text from public.conversation_approvals a join public.conversation_drafts d on d.id=a.draft_id where d.conversation_id=pg_temp.conv(1))),'takeover audited with the approval');
select pg_temp.ok((select count(*)=1 and bool_and(n.body='Your doctor is answering you now.'and n.language='en'and sm.template_id='zoe.mode'and sm.state='queued'
  and sm.body='Zoe: Your doctor is answering you now.'and sm.source_inbox_id is null)
 from public.zoe_mode_notices n join public.system_messages sm on sm.id=n.system_message_id where n.member_id=pg_temp.u(1)and n.kind='doctor_on'),'member line stored and queued for Telegram');
select pg_temp.ok((select count(*)=1 from public.conversation_audit where conversation_id=pg_temp.conv(1)and kind='zoe.doctor_mode_on'),'one takeover');
select pg_temp.ok((select t->'answers'@>'[{"text":"Your doctor is answering you now."}]'::jsonb and not(t->>'zoeReplies')::boolean from pg_temp.thread(1)t),'app chat: the line is shown, Zoe is not writing');
select pg_temp.ok(pg_temp.view(11,1)->>'doctorMode'='true'and pg_temp.view(11,1)->>'byName'='Dr Takeover One'and pg_temp.view(11,1)->>'since'is not null,'conversation page: you are answering');
select pg_temp.ok(exists(select 1 from public.access_audit where member_id=pg_temp.u(1)and actor_id=pg_temp.u(11)and surface='doctor_zoe_mode'),'the read is in access_audit');
-- The Telegram line goes out through the existing dispatcher.
insert into kv select 'line',to_jsonb(system_message_id::text)from public.zoe_mode_notices where member_id=pg_temp.u(1);
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((public.telegram_dispatch_queue(50)->'system')@>jsonb_build_array((select v from kv where k='line')),'the dispatcher queue lists the line');
reset role;

-- 3. In doctor mode: the worker sees it; any member text other than a safety text is held; no receipt; needs reply.
create temp table r3 as select pg_temp.next(1,'What does 150/95 mean?')run;grant select on r3 to authenticated,service_role;
select pg_temp.ok(pg_temp.dm_runs((select run from r3)),'zoe_run_doctor_mode: true for the claimed run');
select pg_temp.ok((select j->>'outcome'='discarded'from(select pg_temp.finish((select run from r3),pg_temp.res('answered','health_answer_passed_guards','Synthetic answer.',
 jsonb_build_object('health',pg_temp.h('planned')))||pg_temp.receipt())j)q),'a health answer (a run in flight at the takeover) is held');
select pg_temp.ok((select state='finished'and outcome='discarded'from public.zoe_runs where id=(select run from r3))
 and not exists(select 1 from public.zoe_member_answers where run_id=(select run from r3)),'held: no Zoe text, no receipt');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where subject_id=(select run::text from r3)and name='zoe.guard.doctor_mode'),'held: traced on the run');
select pg_temp.ok(pg_temp.waiting(11,1),'the message is on the doctor''s needs-reply list');
-- What the worker sends in doctor mode: a discard, no text. Recorded as sent, with no receipt.
select pg_temp.ok((pg_temp.finish(pg_temp.next(1,'Thanks','none'),pg_temp.res('discarded','doctor_mode',null,jsonb_build_object('tier','none','tierReason','not_routed'))||pg_temp.receipt())->>'outcome')='discarded'
 and not exists(select 1 from public.zoe_member_answers a join public.zoe_runs z on z.id=a.run_id where z.member_id=pg_temp.u(1)and z.reason_code='doctor_mode'),'doctor-mode run: discarded, no receipt');
select pg_temp.ok((select reason_code='doctor_mode'from public.zoe_runs where member_id=pg_temp.u(1)order by message_seq desc limit 1),'the worker''s reason is kept');
-- A conversational reply and an intake question are held too; the intake is not started.
-- Exact fixed task acknowledgements pass without handing the conversation back to Zoe.
do $$declare lang text;task_body text;run uuid;result jsonb;bad jsonb;begin
 foreach lang in array array['en','hy','ru']loop
  task_body:=case lang when 'en'then 'You can do that on the card here.'when 'hy'then 'Կարող եք դա անել այստեղի քարտով։'else 'Вы можете сделать это на карточке здесь.'end;
  run:=pg_temp.next(1,'Synthetic exact task request','none');
  result:=pg_temp.finish(run,pg_temp.res('chatted','task_request_no_model',task_body,jsonb_build_object('tier','none','receipt',null,'draft',null,'chat',jsonb_build_object('kind','capabilities','source','fixed')),lang));
  perform pg_temp.ok(result->>'outcome'='chatted'and exists(select 1 from public.zoe_member_answers a where a.run_id=run and a.body=task_body and a.language=lang),'fixed task acknowledgement reaches the member in its language');
  perform pg_temp.ok((select doctor_mode from pg_temp.mode(1)),'fixed task acknowledgement preserves doctor takeover');
  perform pg_temp.ok((pg_temp.thread(1)->>'suggestionSafety')::boolean,'a finished nonstale task with consent and no alarm permits suggestions');
 end loop;
 for bad in select value from jsonb_array_elements('[{"answer":"Unapproved task wording"},{"chat":{"kind":"greeting","source":"fixed"}},{"chat":{"kind":"capabilities","source":"model"}},{"tier":"low"},{"language":"xx"},{"receipt":{"text":"Extra text","language":"en","kind":"receipt"}}]'::jsonb)loop
  run:=pg_temp.next(1,'Synthetic invalid task acknowledgement','none');
  result:=pg_temp.finish(run,pg_temp.res('chatted','task_request_no_model','You can do that on the card here.',jsonb_build_object('tier','none','chat',jsonb_build_object('kind','capabilities','source','fixed')))||bad);
  perform pg_temp.ok(not exists(select 1 from public.zoe_member_answers a where a.run_id=run),'an altered task payload cannot bypass doctor takeover');
 end loop;
 run:=pg_temp.next(1,'Synthetic task with consent withdrawn before finish','none');
 insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.u(1),'zoe_reads_messages',false,'zoe-consent-draft-1');
 perform pg_temp.ok(pg_temp.thread(1)->>'suggestionSafety'='false','suggestion safety reads current consent from the database');
 result:=pg_temp.finish(run,pg_temp.res('chatted','task_request_no_model','You can do that on the card here.',jsonb_build_object('tier','none','chat',jsonb_build_object('kind','capabilities','source','fixed'))));
 perform pg_temp.ok(not exists(select 1 from public.zoe_member_answers a where a.run_id=run)and(select reason_code='consent_withdrawn'from public.zoe_runs where id=run),'fixed task still checks consent at publication');
 insert into public.zoe_consents(member_id,kind,granted,wording_version)values(pg_temp.u(1),'zoe_reads_messages',true,'zoe-consent-draft-1');
 run:=pg_temp.next(1,'Synthetic stale task acknowledgement','none');
 update public.conversations set version=version+1 where id=pg_temp.conv(1);
 result:=pg_temp.finish(run,pg_temp.res('chatted','task_request_no_model','You can do that on the card here.',jsonb_build_object('tier','none','chat',jsonb_build_object('kind','capabilities','source','fixed'))));
 perform pg_temp.ok(not exists(select 1 from public.zoe_member_answers a where a.run_id=run)and(select outcome='stale'from public.zoe_runs where id=run),'fixed task still checks conversation freshness');
 perform pg_temp.ok(pg_temp.thread(1)->>'suggestionSafety'='false','a stale finish is not screening evidence for suggestions');
end$$;
select pg_temp.ok((pg_temp.finish(pg_temp.next(1,'Hello','none'),pg_temp.res('chatted','conversation_reply','Hello Zara.',jsonb_build_object('tier','none','chat',jsonb_build_object('kind','greeting','source','fixed'))))->>'outcome')='discarded',
 'chat reply held');
select pg_temp.ok((pg_temp.finish(pg_temp.next(1,'I have a headache'),pg_temp.res('intake_asked','intake_started','When did it start?',jsonb_build_object('intake',jsonb_build_object('id',null,'sheetId','none',
 'sheetVersion',0,'startedSeq',1,'language','en','state','active','record','{}'::jsonb,'summary',null,'answerSource','fixed','alertRedFlags',null))))->>'outcome')='discarded'
 and not exists(select 1 from public.zoe_symptom_intakes where member_id=pg_temp.u(1)),'intake question held, no intake started');
-- Astra DT-03: the app shows no "Zoe is writing" in doctor mode: every member message counts as settled, even with a run still open.
select pg_temp.send(1,'Are you there?');
select pg_temp.ok((select(t->>'settledSeq')::bigint=(select max(seq)from public.conversation_messages where conversation_id=pg_temp.conv(1))from pg_temp.thread(1)t),
 'doctor mode: settledSeq covers the newest member message');
select pg_temp.ok(pg_temp.thread(1)->>'suggestionSafety'='false','doctor-mode settledSeq is not evidence that the newest message was screened');
select pg_temp.claim(1,'none');
update public.zoe_runs set state='finished',outcome='discarded',reason_code='doctor_mode',finished_at=now()where member_id=pg_temp.u(1)and state='started';
-- A summary for the doctor is kept (doctor-facing), its receipt dropped.
select pg_temp.ok((pg_temp.finish(pg_temp.next(1,'Another question'),pg_temp.res('summary_only','direct_answer_not_allowed',null)||pg_temp.receipt())->>'outcome')='summary_only'
 and not exists(select 1 from public.zoe_member_answers where member_id=pg_temp.u(1)and kind='receipt'),'doctor summary kept, receipt dropped');

-- 4. Safety in doctor mode: the urgent text and the crisis text still go to the member at once, with a care alert.
create temp table r4 as select pg_temp.next(1,'Synthetic urgent words','none')run;grant select on r4 to authenticated,service_role;
select pg_temp.ok((pg_temp.finish((select run from r4),pg_temp.res('discarded','urgent_route_no_model_call','Synthetic urgent text. Call 103.',jsonb_build_object('tier','none','tierReason','urgent',
 'events',jsonb_build_array(jsonb_build_object('name','zoe.urgent_match','outcome','escalate','reason','urgent_words_matched','rule','zoe.urgent_staging_placeholder','ruleVersion','check','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.urgent.red_flags','RF-01')))))||pg_temp.receipt())->>'outcome')='discarded','urgent route finished');
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=(select run from r4)and kind='urgent'and body='Synthetic urgent text. Call 103.'),'urgent text sent to the member in doctor mode');
select pg_temp.ok(exists(select 1 from public.care_alerts where member_id=pg_temp.u(1)and source='zoe'and state<>'resolved'and doctor_id=pg_temp.u(11)),'care alert raised for the doctor');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where member_id=pg_temp.u(1)and kind='receipt'),'no receipt beside the urgent text');
-- The 103 window's follow-up and the self-harm crisis text (forwarded automatically) go too.
select pg_temp.ok((pg_temp.finish(pg_temp.next(1,'Synthetic crisis words','none'),pg_temp.res('discarded','urgent_in_window_no_model_call','Synthetic crisis text. Call 103.',
 jsonb_build_object('tier','none','tierReason','urgent','health',jsonb_build_object('urgency','emergency','modelUrgency','none','forward','auto','forwardReason','self_harm'))))->>'outcome')='discarded','crisis run finished');
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where member_id=pg_temp.u(1)and kind='urgent'and body='Synthetic crisis text. Call 103.'),'103 window / crisis text sent in doctor mode');
-- A red flag (intake escalated) goes too, and the intake row records it.
select pg_temp.ok((pg_temp.finish(pg_temp.next(1,'Synthetic red flag words','none'),pg_temp.res('intake_escalated','symptom_red_flag_no_model_call','Synthetic urgent text. Call 103.',
 jsonb_build_object('tier','none','tierReason','urgent','intake',jsonb_build_object('id',null,'sheetId','none','sheetVersion',0,'startedSeq',1,'language','en','state','escalated',
  'record','{}'::jsonb,'summary',null,'answerSource','fixed','alertRedFlags',jsonb_build_array('RF-01')))))->>'outcome')='intake_escalated','red flag finished in doctor mode');
select pg_temp.ok((select count(*)from public.zoe_member_answers where member_id=pg_temp.u(1)and kind='urgent')=3,'red-flag text sent in doctor mode');
select pg_temp.ok(pg_temp.waiting(11,1),'still needs the doctor''s reply');

-- 5. Another doctor reply in doctor mode changes nothing (no second line).
select pg_temp.reply(1,11,'Synthetic second question');
select pg_temp.ok(pg_temp.notices(1,'doctor_on')=1 and(select count(*)=1 from public.conversation_audit where conversation_id=pg_temp.conv(1)and kind='zoe.doctor_mode_on'),'second reply: still one takeover');

-- 6. Hand back: the assigned doctor only; mode off, audited, the member told again; idempotent.
select pg_temp.ok(pg_temp.denied($$select pg_temp.hand_back(12,1)$$)and pg_temp.denied($$select pg_temp.hand_back(1,1)$$),'refused for another doctor and the member in doctor mode');
select pg_temp.ok((select doctor_mode from pg_temp.mode(1)),'still doctor mode after the refusals');
select pg_temp.ok((select j->>'ok'='true'and j->>'replayed'='false'and j->>'notified'='true'from(select pg_temp.hand_back(11,1)j)q),'assigned doctor hands back');
select pg_temp.ok((select not doctor_mode and reason='hand_back'and changed_by=pg_temp.u(11)from pg_temp.mode(1)),'Zoe mode, by the doctor');
select pg_temp.ok(exists(select 1 from public.conversation_audit where conversation_id=pg_temp.conv(1)and kind='zoe.doctor_mode_off'and actor_id=pg_temp.u(11))
 and exists(select 1 from public.access_audit where member_id=pg_temp.u(1)and surface='doctor_zoe_mode'and object_id='hand_back'),'hand back audited');
select pg_temp.ok((select count(*)=1 and bool_and(n.body='Zoe is with you again.'and sm.body='Zoe: Zoe is with you again.'and sm.state='queued')
 from public.zoe_mode_notices n join public.system_messages sm on sm.id=n.system_message_id where n.member_id=pg_temp.u(1)and n.kind='zoe_back'),'member told: app and Telegram');
select pg_temp.ok((select t->'answers'@>'[{"text":"Zoe is with you again."}]'::jsonb and(t->>'zoeReplies')::boolean from pg_temp.thread(1)t),'app chat: the line, and Zoe replies again');
select pg_temp.ok(pg_temp.hand_back(11,1)->>'replayed'='true'and pg_temp.notices(1,'zoe_back')=1,'second hand back: nothing new');
select pg_temp.ok(not pg_temp.dm_runs(pg_temp.next(1,'What about salt?')),'the worker sees Zoe mode');
create temp table r6 as select id as run from public.zoe_runs where member_id=pg_temp.u(1)and state='started';grant select on r6 to authenticated,service_role;
select pg_temp.ok((pg_temp.finish((select run from r6),pg_temp.res('answered','health_answer_passed_guards','Синтетический ответ.',jsonb_build_object('health',pg_temp.h('planned')),'ru'))->>'outcome')='answered',
 'after the hand back Zoe answers again');

-- 7. The line follows the language of Zoe's newest text (Russian here); the next takeover says it in Russian.
select pg_temp.reply(1,11,'Synthetic third question');
select pg_temp.ok((select body='Сейчас вам отвечает ваш врач.'and language='ru'from public.zoe_mode_notices where member_id=pg_temp.u(1)and kind='doctor_on'order by created_at desc limit 1),'takeover line in Russian');
select pg_temp.ok(pg_temp.notices(1,'doctor_on')=2,'a new takeover after the hand back');

-- 8. Zoe consent off (member 03): a doctor reply changes nothing; nothing is said to the member.
select pg_temp.typed(3,11);
select pg_temp.ok(pg_temp.mode(3)is null and pg_temp.notices(3,'doctor_on')=0,'consent off: no doctor mode, no line');
select pg_temp.ok(pg_temp.view(11,3)->>'doctorMode'='false'and pg_temp.view(11,3)->>'zoeActive'='false','consent off: the page says Zoe is off');
select pg_temp.ok(pg_temp.hand_back(11,3)->>'replayed'='true','consent off: hand back is a no-op');

-- QA92. An explicit message to the doctor settles immediately and stays in needs reply, without taking over the thread.
-- Use topic scope so an unrelated-topic verdict cannot bypass this choice.
update public.zoe_settings set doctor_takeover_scope='topic';
select pg_temp.ok(has_function_privilege('authenticated','public.conversation_receive(jsonb,boolean)','execute')
 and not has_function_privilege('anon','public.conversation_receive(jsonb,boolean)','execute')
 and not has_function_privilege('service_role','public.conversation_receive(jsonb,boolean)','execute')
 and to_regprocedure('public.conversation_receive(jsonb)')is null,'member receive: one optional-route signature, restricted grant');
insert into kv values('direct-command',jsonb_build_object('requestId',gen_random_uuid(),'text','Synthetic message explicitly for the doctor'));
select pg_temp.as_user(2,'otp');set local role authenticated;
select pg_temp.ok(public.conversation_receive((select v from kv where k='direct-command'),true)->>'ok'='true','explicit doctor message received');
select pg_temp.ok(public.conversation_receive((select v from kv where k='direct-command'),true)->>'replayed'='true','explicit doctor message retry replays');
select pg_temp.ok(public.conversation_receive((select v from kv where k='direct-command'))->>'code'='request_conflict','retry cannot change the route to Zoe');
select pg_temp.ok(public.conversation_receive(jsonb_build_object('requestId',gen_random_uuid(),'text','Synthetic null route'),null)->>'code'='invalid_command','null route rejected');
reset role;
select pg_temp.ok((select count(*)=1 and bool_and(to_doctor)from public.conversation_messages where conversation_id=pg_temp.conv(2)),
 'retry preserves exactly one message with its doctor address');
select pg_temp.ok(not public._zoe_doctor_mode(pg_temp.conv(2)),'explicit address does not take over the conversation');
select pg_temp.ok((select(t->>'settledSeq')::bigint=(select max(seq)from public.conversation_messages where conversation_id=pg_temp.conv(2))from pg_temp.thread(2)t),
 'doctor-addressed message settles before a worker starts');
select pg_temp.ok(pg_temp.waiting(12,2),'explicit doctor message is in Waiting before processing');
create temp table direct_run as select pg_temp.claim(2,'none')run;grant select on direct_run to authenticated,service_role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((select j->0->>'doctorMode'='true'and j->0->>'scope'='conversation'
 from(select public.zoe_run_doctor_mode(array[(select run from direct_run)])j)q),'explicit doctor run forces conversation scope in topic mode');
reset role;
select pg_temp.ok(pg_temp.finish((select run from direct_run),pg_temp.res('discarded','doctor_mode',null,jsonb_build_object('tier','none','tierReason','not_routed')))->>'outcome'='discarded',
 'worker doctor-mode discard finishes');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=(select run from direct_run)),'explicit doctor run has no Zoe answer or receipt');
-- A later ordinary question remains Zoe's; it cannot clear the older request addressed to the doctor.
create temp table ordinary_run as select pg_temp.next(2,'Synthetic later ordinary health question')run;grant select on ordinary_run to authenticated,service_role;
select pg_temp.ok(not pg_temp.dm_runs((select run from ordinary_run)),'the next ordinary message remains Zoe eligible');
select pg_temp.ok((select not to_doctor from public.conversation_messages where conversation_id=pg_temp.conv(2)order by seq desc limit 1),'omitted route defaults to false');
select pg_temp.ok((pg_temp.thread(2)->>'settledSeq')::bigint<(select max(seq)from public.conversation_messages where conversation_id=pg_temp.conv(2)),
 'a newer ordinary message still waits for Zoe');
select pg_temp.ok(pg_temp.finish((select run from ordinary_run),pg_temp.res('answered','health_answer_passed_guards','Synthetic later health answer.',jsonb_build_object('health',pg_temp.h('planned'))))->>'outcome'='answered',
 'Zoe answers the later ordinary question');
select pg_temp.ok(public._zoe_answered_open(pg_temp.conv(2))is null and pg_temp.waiting(12,2),'later Zoe answer cannot remove the doctor-addressed window from Waiting');
-- Exercise the answered-window guard directly: a mistakenly answered doctor request still needs the doctor.
-- First make both runs otherwise eligible for Answered by Zoe, as an old/in-flight worker could have recorded them.
update public.zoe_runs set outcome='answered',forward='none',forward_reason='none'where id=(select run from direct_run);
insert into public.zoe_member_answers(run_id,conversation_id,member_id,message_seq,kind,body,language,provider,model)
 select d.run,pg_temp.conv(2),pg_temp.u(2),r.message_seq,'answer','Synthetic old worker answer.','en','vercel.ai_gateway','anthropic/claude-opus-5.5'
 from direct_run d join public.zoe_runs r on r.id=d.run;
insert into public.conversation_audit(conversation_id,actor_id,kind,detail)
 select pg_temp.conv(2),pg_temp.u(2),'zoe.answered',jsonb_build_object('runId',run,'health',pg_temp.h('planned'))from direct_run;
select pg_temp.ok(public._zoe_answered_open(pg_temp.conv(2))is null,'doctor address blocks Answered by Zoe even with otherwise eligible answers');
-- Prove the address, rather than another fixture condition, is the blocker; restore it immediately.
-- Messages are immutable; the fixture bypasses the trigger only for this toggle (rolled back with everything else).
set local session_replication_role=replica;
update public.conversation_messages set to_doctor=false where conversation_id=pg_temp.conv(2)and to_doctor;
set local session_replication_role=origin;
select pg_temp.ok(public._zoe_answered_open(pg_temp.conv(2))is not null,'control: the same fully answered window without an explicit doctor address is Answered by Zoe');
set local session_replication_role=replica;
update public.conversation_messages set to_doctor=true where conversation_id=pg_temp.conv(2)and request_id=((select v from kv where k='direct-command')->>'requestId')::uuid;
set local session_replication_role=origin;
-- Astra R388: a request to the doctor and a quick follow-up to Zoe, both stored before the worker claims, are one run. The
-- whole run stays with the doctor: no ordinary Zoe answer, still Waiting, and a safety text still goes out.
select pg_temp.send(2,'Synthetic batched request for my doctor',true);
select pg_temp.send(2,'Synthetic quick follow-up to Zoe');
create temp table batch_run as select pg_temp.claim(2,'none')run;grant select on batch_run to authenticated,service_role;
select pg_temp.ok((select message_seq from public.zoe_runs where id=(select run from batch_run))=(select max(seq)from public.conversation_messages where conversation_id=pg_temp.conv(2))
 and not(select to_doctor from public.conversation_messages where conversation_id=pg_temp.conv(2)order by seq desc limit 1),'batched run ends on the ordinary follow-up');
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((select j->0->>'doctorMode'='true'and j->0->>'scope'='conversation'
 from(select public.zoe_run_doctor_mode(array[(select run from batch_run)])j)q),'a doctor request anywhere in the batch keeps the run with the doctor');
reset role;
select pg_temp.ok((pg_temp.finish((select run from batch_run),pg_temp.res('discarded','urgent_route_no_model_call','Synthetic batched urgent text. Call 103.',jsonb_build_object('tier','none','tierReason','urgent',
 'events',jsonb_build_array(jsonb_build_object('name','zoe.urgent_match','outcome','escalate','reason','urgent_words_matched','rule','zoe.urgent_staging_placeholder','ruleVersion','check','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.urgent.red_flags','RF-01'))))))->>'outcome')='discarded','batched run: safety finish accepted');
select pg_temp.ok(exists(select 1 from public.zoe_member_answers where run_id=(select run from batch_run)and kind='urgent')
 and not exists(select 1 from public.zoe_member_answers where run_id=(select run from batch_run)and kind<>'urgent'),'batched run: the safety text goes out, no ordinary Zoe answer');
select pg_temp.ok(pg_temp.waiting(12,2),'batched doctor request is in Waiting');
-- The window ends with that run: the next ordinary message alone is Zoe's again.
create temp table after_batch as select pg_temp.next(2,'Synthetic later message to Zoe','none')run;grant select on after_batch to authenticated,service_role;
select pg_temp.ok(not pg_temp.dm_runs((select run from after_batch)),'after the batched run, an ordinary message is Zoe eligible again');
select pg_temp.finish((select run from after_batch),pg_temp.res('discarded','doctor_mode',null,jsonb_build_object('tier','none','tierReason','not_routed')));
-- Gohar QA 97: a request to the doctor, then "New question", then a message to Zoe, all before the worker claims: the
-- divider ends the doctor request, so the run is Zoe's. Without the divider the same batch stays with the doctor (above).
select pg_temp.send(2,'Synthetic request for my doctor before a new question',true);
select pg_temp.as_user(2,'otp');set local role authenticated;
select pg_temp.ok(public.conversation_member_new_topic()->>'replayed'='false','member presses New question after the doctor request');
reset role;
select pg_temp.send(2,'Synthetic new question for Zoe');
create temp table new_topic_run as select pg_temp.claim(2,'none')run;grant select on new_topic_run to authenticated,service_role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((select j->0->>'doctorMode'='false'and j->0->>'scope'='topic'
 from(select public.zoe_run_doctor_mode(array[(select run from new_topic_run)])j)q),'QA 97: after New question the next message is Zoe''s, not the doctor''s');
reset role;
select pg_temp.ok(pg_temp.waiting(12,2),'QA 97: the earlier doctor request still waits for the doctor');
select pg_temp.finish((select run from new_topic_run),pg_temp.res('discarded','doctor_mode',null,jsonb_build_object('tier','none','tierReason','not_routed')));
update public.zoe_settings set doctor_takeover_scope='conversation';

-- 9. Member 02 (doctor 12): doctor 11 never reaches it; a member without Telegram gets the app line only.
select pg_temp.ok(pg_temp.denied($$select pg_temp.view(11,2)$$),'doctor 11 cannot read member 02');
select pg_temp.typed(2,12);
select pg_temp.ok((select doctor_mode from pg_temp.mode(2))and(select count(*)=1 and bool_and(system_message_id is null)from public.zoe_mode_notices where member_id=pg_temp.u(2)),'typed reply takes over; no Telegram route: app line only');


-- With an actual previous doctor reply, doctorMatter is present; explicit routing still forces the whole-run scope.
update public.zoe_settings set doctor_takeover_scope='topic';
select pg_temp.send(2,'Synthetic unrelated question still addressed to my doctor',true);
create temp table direct_matter_run as select pg_temp.claim(2,'none')run;grant select on direct_matter_run to authenticated,service_role;
select pg_temp.as_service();set local role service_role;
select pg_temp.ok((select j->0->>'doctorMode'='true'and j->0->>'scope'='conversation'and jsonb_typeof(j->0->'doctorMatter')='object'
 from(select public.zoe_run_doctor_mode(array[(select run from direct_matter_run)])j)q),'explicit doctor address cannot enter the doctorMatter unrelated-topic bypass');
reset role;

-- A live alarm still wins over the fixed task acknowledgement in doctor mode.
do $$declare run uuid;result jsonb;t jsonb;newest bigint;i integer;begin
 update public.zoe_doctor_mode set doctor_mode=true where conversation_id=pg_temp.conv(1);
 run:=pg_temp.next(1,'Synthetic urgent alarm before a task','none');
 result:=pg_temp.finish(run,pg_temp.res('discarded','urgent_route_no_model_call','Synthetic safety text. Call 103.',jsonb_build_object('tier','none')));
 perform pg_temp.ok(exists(select 1 from public.zoe_member_answers a where a.run_id=run and kind='urgent'),'the alarm fixture reached the urgent route');
 run:=pg_temp.next(1,'Synthetic task while alarm is active','none');
 result:=pg_temp.finish(run,pg_temp.res('chatted','task_request_no_model','You can do that on the card here.',jsonb_build_object('tier','none','chat',jsonb_build_object('kind','capabilities','source','fixed'))));
 perform pg_temp.ok(not exists(select 1 from public.zoe_member_answers a where a.run_id=run),'an active alarm blocks the task exception');
 perform pg_temp.ok((select doctor_mode from pg_temp.mode(1)),'the task never clears doctor takeover');
 -- The bounded member view can omit an old unresolved alarm entirely. Add later synthetic
 -- messages without new Zoe answers, then finish the newest run: only the full-history alarm gate can block.
 select max(seq)into newest from public.conversation_messages where conversation_id=pg_temp.conv(1);
 for i in 1..105 loop
  insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)
  values(pg_temp.conv(1),newest+i,pg_temp.u(1),'Synthetic later message','authenticated_member',gen_random_uuid());
 end loop;
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,state,outcome,reason_code,spend_day,finished_at)
 select c.id,c.member_id,newest+105,c.version,c.draft_epoch,'finished','summary_only','doctor_mode',current_date,clock_timestamp()
 from public.conversations c where c.id=pg_temp.conv(1);
 t:=pg_temp.thread(1);
 perform pg_temp.ok(jsonb_array_length(t->'messages')=100,'the fixture exercises the bounded 100-message view');
 perform pg_temp.ok(not exists(select 1 from jsonb_array_elements(t->'answers')a where a->>'text'='Synthetic safety text. Call 103.'),'the alarm answer is outside the visible thread');
 perform pg_temp.ok(t->>'suggestionSafety'='false','an unresolved alarm outside the bounded thread still suppresses suggestions');
end$$;
rollback;
select 'check-zoe-doctor-takeover: all assertions passed'as result;
