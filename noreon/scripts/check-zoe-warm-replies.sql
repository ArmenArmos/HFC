-- Zoe warm replies (20261018121002): the switch and its guard, the unapproved templates, the held Telegram
-- acknowledgement and both releases (finish and the 3-minute backstop), the run context, the chatted outcome
-- (sent, stand-in refused, wording unapproved, stale), the warm receipt (sent; never for urgent, abuse or a
-- stale run), the member thread (zoeReplies, settledSeq), invalid results, and grants. Rolled back.
-- Synthetic fixtures only; no network or model.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_zwr",9031,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_zwr",9031,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.bind(m uuid,kind text,u bigint)returns jsonb language sql as $$
 select public._telegram_auth_bind(m,kind,pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null)$$;
-- A Telegram message from T; returns its inbox id.
create function pg_temp.say(p_id text,txt text)returns uuid language plpgsql as $$begin
 perform pg_temp.as_service();perform public.channel_inbox_commit(pg_temp.event(p_id,9311,txt));perform pg_temp.drain();
 return (select i.id from public.channel_inbox i where i.event_id=format('["telegram","noreon_zwr",9031,"update",%s]',p_id));end$$;
create function pg_temp.ack(inbox uuid)returns public.system_messages language sql as $$select * from public.system_messages where source_inbox_id=inbox and template_id='telegram.ack'$$;
create function pg_temp.send(m text,sid text,rid text,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',rid,'text',txt));reset role;return j;end$$;
create function pg_temp.thread(m text,sid text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_member_thread();reset role;return j;end$$;
create function pg_temp.claim()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;return j;end$$;
create function pg_temp.run_for(m uuid)returns uuid language sql as $$select (x->>'runId')::uuid from jsonb_array_elements(pg_temp.claim())x where (x->>'memberId')::uuid=m$$;
create function pg_temp.context(run uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_context(array[run]);reset role;return j->0;end$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.backstop()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_held_ack_release();reset role;return j;end$$;
-- A finish result. chat: {kind,source}; receipt: {text,language}.
create function pg_temp.res(outcome text,reason text,answer text,chat jsonb default null,receipt jsonb default null,provider text default 'vercel.ai_gateway',tier text default 'low',draft text default null)returns jsonb language sql as $$
 select jsonb_strip_nulls(jsonb_build_object('outcome',outcome,'reason',reason,'summary','Synthetic summary for the doctor.','draft',draft,'answer',answer,'language',case when answer is null then null else 'en'end,
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',300,'outputTokens',40),'costUsd',0,'latencyMs',400,
  'provider',provider,'model','openai/gpt-5-mini','configVersion','zoe-warm-check','sealed',null,'tier',tier,'tierReason','conversational','fallbackUsed',false,'events','[]'::jsonb,
  'chat',chat,'receipt',receipt))
$$;
create function pg_temp.receipt()returns jsonb language sql as $$select jsonb_build_object('text','Thanks, Wendy. I''ve passed this to Dr Synthetic Warm Doctor; they''ll reply here. If this is urgent, call 103.','language','en')$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

-- A: app member (EN); T: Telegram member (EN); D: their doctor; X: admin.
insert into auth.users(id,phone,phone_confirmed_at)values('e1830000-0000-4000-8000-000000000001','37499083801',now()),('e1830000-0000-4000-8000-000000000003','37499083803',now()),
 ('e1830000-0000-4000-8000-000000000002','37499083802',now()),('e1830000-0000-4000-8000-000000000006',null,null);
insert into public.workspace_clinics(id,name)values('e1830000-0000-4000-8000-000000000004','Synthetic warm clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('e1830000-0000-4000-8000-000000000002','doctor','Dr Synthetic Warm Doctor','e1830000-0000-4000-8000-000000000004');
insert into public.workspace_staff(user_id,role,display_name)values('e1830000-0000-4000-8000-000000000006','admin','Synthetic Warm Admin');
insert into auth.sessions(id,user_id,created_at,updated_at)values('e1830000-0000-4000-8000-000000000011','e1830000-0000-4000-8000-000000000001',now(),now()),
 ('e1830000-0000-4000-8000-000000000013','e1830000-0000-4000-8000-000000000003',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000002'),('e1830000-0000-4000-8000-000000000003','e1830000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='Warm Member A'where id='e1830000-0000-4000-8000-000000000001';
update public.profiles set locale='en',display_name='Wendy Telegram'where id='e1830000-0000-4000-8000-000000000003';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_zwr',9031,600,'consent-zwr');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
 values(true,'synthetic-zwr',3600,600,60,40,false,true,true);
select public._telegram_replies_activate('e1830000-0000-4000-8000-000000000003',(pg_temp.bind('e1830000-0000-4000-8000-000000000003','member',9311)->>'bindingId')::uuid);
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('e1830000-0000-4000-8000-000000000001','zoe_reads_messages',true,'zoe-consent-draft-1'),
 ('e1830000-0000-4000-8000-000000000003','zoe_reads_messages',true,'zoe-consent-draft-1');
insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values('telegram.ack',2,'en','Synthetic approved acknowledgement. Call 103 in an emergency.',true,'test fixture');
update public.system_message_templates set approved=true where template_id in('zoe.answer','zoe.urgent');

-- 1. Defaults: the switch off, the two templates free-body and unapproved.
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
select pg_temp.ok((select not conversational_replies_enabled from public.zoe_settings),'Conversational replies off by default');
select pg_temp.ok((select count(*)=4 and bool_and(free_body and not approved)from public.system_message_templates where template_id in('zoe.chat','zoe.receipt')),'zoe.chat and zoe.receipt: EN and HY, free body, unapproved');

-- 2. Switch off: the Telegram acknowledgement goes as before, and the thread says Zoe does not reply herself.
insert into kv values('i0',to_jsonb(pg_temp.say('9300','Synthetic hello before the switch')));
select pg_temp.ok((select state='queued'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i0'))),'Switch off: acknowledgement queued');
select pg_temp.ok((select v->>'zoeReplies'='false'and v ? 'settledSeq'from(select pg_temp.thread('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011')v)x),'Switch off: zoeReplies false');
insert into kv values('r0',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.ok((select x->>'enabled'='false'and x->>'doctorName'='Dr Synthetic Warm Doctor'and x->>'answeredThroughSeq'='0'and x->>'locale'='en'from(select pg_temp.context((select (v#>>'{}')::uuid from kv where k='r0'))x)y),'Run context: switch off, the doctor''s name, nothing answered');
select pg_temp.ok((pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r0'),pg_temp.res('summary_only','no_draft_needs_doctor',null,null,pg_temp.receipt()))->>'outcome')='summary_only'
 and not exists(select 1 from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='r0')),'Switch off: a receipt in the result is not sent');

-- 3. The guard.
do $$begin begin update public.zoe_settings set conversational_replies_enabled=true;raise exception 'FAIL: on without real calls';exception when check_violation then null;end;end$$;
update public.zoe_settings set staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-475',475,0,0,'e1830000-0000-4000-8000-000000000006'from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
do $$begin begin update public.zoe_settings set conversational_replies_enabled=true;raise exception 'FAIL: on without a chat eval';exception when check_violation then null;end;end$$;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,1,1,'e1830000-0000-4000-8000-000000000006'from public.zoe_tier_config where tier='low';
do $$begin begin update public.zoe_settings set conversational_replies_enabled=true;raise exception 'FAIL: on with a failing chat eval';exception when check_violation then null;end;end$$;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,2,'e1830000-0000-4000-8000-000000000006'from public.zoe_tier_config where tier='high';
do $$begin begin update public.zoe_settings set conversational_replies_enabled=true;raise exception 'FAIL: on with a chat eval of another tier';exception when check_violation then null;end;end$$;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,2,'e1830000-0000-4000-8000-000000000006'from public.zoe_tier_config where tier='low';
update public.zoe_settings set conversational_replies_enabled=true;
select pg_temp.ok((select conversational_replies_enabled from public.zoe_settings),'On: real calls and a passing low-tier chat eval');
do $$begin begin update public.zoe_settings set model_calls_allowed=false;raise exception 'FAIL: calls off under the switch';exception when check_violation then null;end;end$$;

-- 4. On, but zoe.receipt unapproved: Zoe cannot promise a line, so the acknowledgement is not held.
insert into kv values('i1',to_jsonb(pg_temp.say('9301','Synthetic hello, receipt wording unapproved')));
select pg_temp.ok((select state='queued'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i1'))),'Receipt unapproved: acknowledgement queued');
select pg_temp.ok((select v->>'zoeReplies'='false'from(select pg_temp.thread('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011')v)x),'Receipt unapproved: zoeReplies false');
select pg_temp.finish(pg_temp.run_for('e1830000-0000-4000-8000-000000000003'),pg_temp.res('summary_only','no_draft_needs_doctor',null,null,pg_temp.receipt()));
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id in('zoe.chat','zoe.receipt');

-- 5. A greeting on Telegram: the acknowledgement is held for Zoe; her reply goes on zoe.chat; the ack stays held.
insert into kv values('i2',to_jsonb(pg_temp.say('9302','Synthetic hi')));
select pg_temp.ok((select state='held'and reason='zoe_will_reply'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i2'))),'Switch on: acknowledgement held for Zoe');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='auto_ack.held_for_zoe'and subject_id=(select id::text from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i2')))),'The hold is traced');
insert into kv values('r2',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.ok((select x->>'enabled'='true'and (x->>'answeredThroughSeq')::int=0 from(select pg_temp.context((select (v#>>'{}')::uuid from kv where k='r2'))x)y),'Run context: switch on');
insert into kv values('f2',pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r2'),pg_temp.res('chatted','chat_reply_passed_guards','Hello Wendy, it is good to hear from you. What can I help you with today?','{"kind":"greeting","source":"model"}')));
select pg_temp.ok((select v->>'outcome'='chatted'and v->>'answerId'is not null from kv where k='f2'),'Chatted');
select pg_temp.ok((select a.kind='chat'and a.provider='vercel.ai_gateway'and sm.template_id='zoe.chat'and sm.state='queued'from public.zoe_member_answers a join public.system_messages sm on sm.id=a.system_message_id
 where a.run_id=(select (v#>>'{}')::uuid from kv where k='r2')),'Zoe''s reply queued on zoe.chat');
select pg_temp.ok((select state='held'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i2'))),'Zoe replied: the acknowledgement stays held');
-- Telegram parity (Khikar 18 Oct "like Zoe is answering, just through Telegram"): the same text as the app thread, signed "Zoe: ".
select pg_temp.ok((select sm.body='Zoe: '||a.body and a.body like 'Hello Wendy%'from public.zoe_member_answers a join public.system_messages sm on sm.id=a.system_message_id
 where a.run_id=(select (v#>>'{}')::uuid from kv where k='r2')),'Telegram text = the app text, signed Zoe');
select pg_temp.ok(pg_temp.context((select (v#>>'{}')::uuid from kv where k='r2'))is null,'Run context only for started runs');
-- The backstop leaves it: a Zoe text exists for that message.
update public.system_messages set created_at=created_at-interval '10 minutes'where id=(select id from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i2')));
select pg_temp.backstop();
select pg_temp.ok((select state='held'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i2'))),'Backstop: an answered message keeps its acknowledgement held');

-- 6. A health question: the doctor draft, and the warm receipt instead of the acknowledgement.
insert into kv values('i3',to_jsonb(pg_temp.say('9303','Synthetic what is my target?')));
insert into kv values('r3',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.ok((select (x->>'answeredThroughSeq')::int>0 from(select pg_temp.context((select (v#>>'{}')::uuid from kv where k='r3'))x)y),'Run context: the greeting counts as answered');
insert into kv values('f3',pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r3'),pg_temp.res('draft_proposed','draft_passed_guards',null,null,pg_temp.receipt(),'vercel.ai_gateway','high','Synthetic draft for the doctor.')));
select pg_temp.ok((select v->>'outcome'='draft_proposed'and v->>'draftId'is not null and v->>'answerId'is not null from kv where k='f3'),'Draft and receipt');
select pg_temp.ok((select a.kind='receipt'and a.provider='noreon.rules'and a.body like 'Thanks, Wendy.%'and sm.template_id='zoe.receipt'from public.zoe_member_answers a join public.system_messages sm on sm.id=a.system_message_id
 where a.run_id=(select (v#>>'{}')::uuid from kv where k='r3')),'Receipt queued on zoe.receipt, authored by the rules');
select pg_temp.ok((select state='held'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i3'))),'Receipt sent: the acknowledgement stays held');

-- 7. Urgent words: no receipt, the urgent template, and the acknowledgement goes too.
insert into kv values('i4',to_jsonb(pg_temp.say('9304','Synthetic urgent words')));
insert into kv values('r4',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r4'),pg_temp.res('discarded','urgent_route_no_model_call',null,null,pg_temp.receipt(),'none','none'));
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='r4')),'Urgent: no receipt');
select pg_temp.ok(exists(select 1 from public.system_messages where source_inbox_id=(select (v#>>'{}')::uuid from kv where k='i4')and template_id='zoe.urgent'),'Urgent: zoe.urgent queued');
select pg_temp.ok((select state='queued'and reason is null from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i4'))),'Urgent: the acknowledgement released');
select pg_temp.ok(exists(select 1 from public.system_message_audit where kind='released'and message_id=(select id from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i4')))),'The release is audited');

-- 8. Abuse: the app's sorry-for-the-wait line (QA 18 Oct C02), so the acknowledgement stays held.
insert into kv values('i5',to_jsonb(pg_temp.say('9305','Synthetic rude words')));
insert into kv values('r5',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r5'),pg_temp.res('discarded','abusive_staff_flag',null,null,pg_temp.receipt(),'none','none'));
select pg_temp.ok((select kind='receipt'from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='r5'))
 and (select state='held'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i5'))),'Abuse: the app''s sorry-for-the-wait line, never silence; acknowledgement stays held');

-- 9. Stand-in model text is never sent (the acknowledgement goes); the fixed wording is.
insert into kv values('i6',to_jsonb(pg_temp.say('9306','Synthetic thanks')));
insert into kv values('r6',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
insert into kv values('f6',pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r6'),pg_temp.res('chatted','chat_reply_passed_guards','Synthetic stand-in reply.','{"kind":"thanks","source":"model"}',null,'noreon.fake')));
select pg_temp.ok((select reason_code='stand_in_answer_not_sent'and outcome='summary_only'from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='r6'))
 and not exists(select 1 from public.zoe_member_answers where body='Synthetic stand-in reply.')
 and (select state='queued'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i6'))),'Stand-in model text: not sent, acknowledgement released');
insert into kv values('i7',to_jsonb(pg_temp.say('9307','Synthetic thanks again')));
insert into kv values('r7',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r7'),pg_temp.res('chatted','chat_stand_in_fixed_wording','You are welcome, Wendy. Is there anything else I can help you with?','{"kind":"thanks","source":"fixed"}',null,'noreon.fake','none'));
select pg_temp.ok((select provider='noreon.rules'and model='zoe-conversation-fixed'and kind='chat'from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='r7')),'Fixed wording sent, authored by the rules');

-- 10. Stale: a newer message arrived; nothing is sent and the earlier acknowledgement stays held for the newer run.
insert into kv values('i8',to_jsonb(pg_temp.say('9308','Synthetic hello once')));
insert into kv values('r8',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
insert into kv values('i9',to_jsonb(pg_temp.say('9309','Synthetic hello twice')));
select pg_temp.ok((pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r8'),pg_temp.res('chatted','chat_reply_passed_guards','Hello Wendy.','{"kind":"greeting","source":"model"}'))->>'outcome')='stale','Chat reply to an older message: stale');
select pg_temp.ok((pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r8'),pg_temp.res('summary_only','x',null,null,pg_temp.receipt()))->>'replayed')='true','Finished once');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='r8'))
 and (select state='held'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i8'))),'Stale: no text, acknowledgement still held');
-- A stale doctor-path run never sends a receipt either.
insert into kv values('r9',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
insert into kv values('i10',to_jsonb(pg_temp.say('9310','Synthetic and a question')));
select pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r9'),pg_temp.res('summary_only','no_draft_needs_doctor',null,null,pg_temp.receipt()));
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='r9')),'A newer message: no receipt for the older run');

-- 11. The backstop: a held acknowledgement with no Zoe text after 3 minutes goes out; a fresh one waits.
update public.system_messages set created_at=created_at-interval '4 minutes'where id in(select id from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i8'))union select id from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i9')));
select pg_temp.ok((select (pg_temp.backstop()->>'released')::int=2),'Backstop: two old held acknowledgements released');
select pg_temp.ok((select state='queued'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i9')))and(select state='held'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i10'))),'Backstop: older released, the fresh one still held');

-- 12. Wording withdrawn: a conversational reply is not sent and the acknowledgement goes.
insert into public.system_message_templates(template_id,version,locale,body,free_body,approved,approval_note)values('zoe.chat',2,'en','withdrawn',true,false,'withdrawn');
insert into kv values('r10',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r10'),pg_temp.res('chatted','chat_reply_passed_guards','Hello Wendy.','{"kind":"greeting","source":"model"}'));
select pg_temp.ok((select reason_code='chat_wording_unapproved'from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='r10'))
 and (select state='queued'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i10'))),'zoe.chat withdrawn: not sent, acknowledgement released');
insert into public.system_message_templates(template_id,version,locale,body,free_body,approved,approval_note)values('zoe.chat',3,'en','re-approved',true,true,'Staging check');

-- 13. The app: zoeReplies, settledSeq and Zoe's chat reply in the thread.
select pg_temp.send('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011','e1830000-0000-4000-8000-0000000000a1','Synthetic hi from the app');
select pg_temp.ok((select v->>'zoeReplies'='true'and (v->>'settledSeq')::int=0 from(select pg_temp.thread('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011')v)x),'App: zoeReplies true, nothing settled yet');
insert into kv values('r11',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000001')));
select pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r11'),pg_temp.res('chatted','chat_reply_passed_guards','Hello, it is good to hear from you. What can I help you with today?','{"kind":"greeting","source":"model"}'));
select pg_temp.ok((select v->'answers'->-1->>'text'like 'Hello, it is good%'and (v->>'settledSeq')::int=1 from(select pg_temp.thread('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011')v)x),'App: Zoe''s reply in the thread, the message settled');
select pg_temp.ok((select system_message_id is null from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='r11')),'App: nothing queued on Telegram');
-- An urgent text for an app message.
select pg_temp.send('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011','e1830000-0000-4000-8000-0000000000a2','Synthetic urgent from the app');
do $$declare c public.conversations;run uuid;begin select * into c from public.conversations where member_id='e1830000-0000-4000-8000-000000000001';
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at,tier)
 values(c.id,c.member_id,c.version,c.version,c.draft_epoch,current_date,'finished','intake_escalated','check',clock_timestamp(),'none')returning id into run;
 insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model,kind)values(c.id,c.member_id,run,c.version,'Synthetic urgent text','en','noreon.rules','symptom-intake-fixed','urgent');end$$;
-- QA round 2 R08/S03: the urgent text always shows in the thread (the send path may not have shown the 103 screen).
select pg_temp.ok(exists(select 1 from jsonb_array_elements((select pg_temp.thread('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011'))->'answers')x where x->>'text'='Synthetic urgent text'),'App urgent text shown in the thread');
-- A member without consent: Zoe does not reply herself.
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('e1830000-0000-4000-8000-000000000001','zoe_reads_messages',false,'zoe-consent-draft-1');
select pg_temp.ok((select v->>'zoeReplies'='false'from(select pg_temp.thread('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011')v)x),'No current consent: zoeReplies false');

-- 14. Invalid results change nothing.
insert into kv values('i12',to_jsonb(pg_temp.say('9312','Synthetic another hello')));
insert into kv values('r12',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r12'),pg_temp.res('chatted','x','Hello.','{"kind":"greeting","source":"model"}',null,'vercel.ai_gateway','high'))->>'code'='invalid','A chat reply on the high tier is refused');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r12'),pg_temp.res('chatted','x','Hello.','{"kind":"medical","source":"model"}'))->>'code'='invalid','An unknown chat class is refused');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r12'),pg_temp.res('chatted','x',null,'{"kind":"greeting","source":"model"}'))->>'code'='invalid','A chat reply without text is refused');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r12'),pg_temp.res('summary_only','x',null,'{"kind":"greeting","source":"model"}'))->>'code'='invalid','A chat class on another outcome is refused');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r12'),pg_temp.res('chatted','x','Hello.','{"kind":"greeting","source":"model"}',pg_temp.receipt()))->>'code'='invalid','A receipt on a chat reply is refused');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r12'),pg_temp.res('summary_only','x',null,null,jsonb_build_object('text',repeat('x',701),'language','en')))->>'code'='invalid','A long receipt is refused');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r12'),pg_temp.res('summary_only','x',null,null,jsonb_build_object('text','Hi.','language','de')))->>'code'='invalid','A receipt in another language is refused');
select pg_temp.ok((select state='started'from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='r12')),'Refused results leave the run started');

-- 14b. Guard layers: the deflection is stored as its own kind; three injection runs in 24 hours raise one admin
-- alert (audit row and trace, a staff notice when staff notices are on) and the run context reports them.
create function pg_temp.deflect(run uuid)returns jsonb language sql as $$
 select pg_temp.finish(run,pg_temp.res('summary_only','injection_suspected_summary_only',null,null,jsonb_build_object('text','Wendy, I can''t do that, but I''m happy to help with your Noreon care.','language','en','kind','deflection'))||'{"injectionDetected":true}')$$;
select pg_temp.ok((pg_temp.deflect((select (v#>>'{}')::uuid from kv where k='r12'))->>'outcome')='summary_only','Deflection finish');
select pg_temp.ok((select kind='deflection'and model='zoe-deflection-fixed'from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='r12')),'Deflection stored as kind deflection');
select pg_temp.ok(not exists(select 1 from public.conversation_audit where kind='zoe.injection_alert'),'One attempt: no alert');
insert into kv values('i14',to_jsonb(pg_temp.say('9314','Synthetic injection two')));
select pg_temp.deflect(pg_temp.run_for('e1830000-0000-4000-8000-000000000003'));
-- Codex review F3: an ordinary message while throttled is not counted; a failed-provider injection run is.
insert into kv values('i14b',to_jsonb(pg_temp.say('9324','Synthetic ordinary question while throttled')));
select pg_temp.finish(pg_temp.run_for('e1830000-0000-4000-8000-000000000003'),pg_temp.res('no_output','member_throttled_injection',null,null,pg_temp.receipt(),'none','none'));
insert into kv values('i14c',to_jsonb(pg_temp.say('9325','Synthetic injection two b, provider down')));
select pg_temp.finish(pg_temp.run_for('e1830000-0000-4000-8000-000000000003'),pg_temp.res('no_output','provider_timeout',null,null,null,'none','none')||'{"injectionDetected":true}');
select pg_temp.ok((select count(*)=3 from public.zoe_runs where member_id='e1830000-0000-4000-8000-000000000003'and injection_detected),'Detections counted by the flag, not by the finish reason');
insert into kv values('i15',to_jsonb(pg_temp.say('9315','Synthetic injection three')));
insert into kv values('r15',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.ok((select (x->>'injectionsLast24h')::int=3 and (x->>'memberSpentTodayUsd')::numeric>=0 from(select pg_temp.context((select (v#>>'{}')::uuid from kv where k='r15'))x)y),'Run context counts earlier injection runs');
select pg_temp.deflect((select (v#>>'{}')::uuid from kv where k='r15'));
select pg_temp.ok((select count(*)=1 from public.conversation_audit where kind='zoe.injection_alert'and (detail->>'attempts24h')::int=3),'Third detection (the failed-provider one): one admin alert');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.guard.injection_throttled'and outcome='escalate'),'The alert is traced as an escalation');
insert into kv values('i16',to_jsonb(pg_temp.say('9316','Synthetic injection four')));
select pg_temp.deflect(pg_temp.run_for('e1830000-0000-4000-8000-000000000003'));
select pg_temp.ok((select count(*)=1 from public.conversation_audit where kind='zoe.injection_alert'),'Fourth attempt: still one alert per 24 hours');
insert into kv values('i17',to_jsonb(pg_temp.say('9317','Synthetic another message')));
select pg_temp.ok(pg_temp.finish(pg_temp.run_for('e1830000-0000-4000-8000-000000000003'),pg_temp.res('summary_only','x',null,null,jsonb_build_object('text','Hi.','language','en','kind','other')))->>'code'='invalid','An unknown receipt kind is refused');

-- 14c. The Zoe chat screen card records a grant as source zoe_screen (same wording checks).
insert into auth.users(id,phone,phone_confirmed_at)values('e1830000-0000-4000-8000-000000000007','37499083807',now());
insert into auth.sessions(id,user_id,created_at,updated_at)values('e1830000-0000-4000-8000-000000000017','e1830000-0000-4000-8000-000000000007',now(),now());
do $$declare j jsonb;begin
 perform pg_temp.as_user('e1830000-0000-4000-8000-000000000007','e1830000-0000-4000-8000-000000000017');set local role authenticated;
 j:=public.zoe_consent_set('zoe_reads_messages',true,'zoe-consent-draft-1','zoe_screen');reset role;
 if j->>'ok'<>'true'then raise exception 'FAIL: zoe_screen grant refused %',j;end if;
 perform pg_temp.as_user('e1830000-0000-4000-8000-000000000007','e1830000-0000-4000-8000-000000000017');set local role authenticated;
 j:=public.zoe_consent_set('zoe_reads_messages',false,'zoe-consent-draft-1','zoe_screen');reset role;
 if j->>'ok'<>'false'then raise exception 'FAIL: zoe_screen may only grant %',j;end if;
end$$;
select pg_temp.ok((select source='zoe_screen'and granted from public.zoe_consents where member_id='e1830000-0000-4000-8000-000000000007'order by id desc limit 1),'Grant recorded with source zoe_screen');

-- 15. Grants: only the service role reads the run context or runs the backstop.
do $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','e1830000-0000-4000-8000-000000000001','role','authenticated')::text,true);
 begin set local role authenticated;perform public.zoe_run_context(array[gen_random_uuid()]);raise exception 'FAIL: member read the run context';exception when insufficient_privilege then null;end;
 reset role;
 begin set local role authenticated;perform public.zoe_held_ack_release();raise exception 'FAIL: member ran the backstop';exception when insufficient_privilege then null;end;
 reset role;
 begin set local role anon;perform public._zoe_replies_on(gen_random_uuid());raise exception 'FAIL: anon called a helper';exception when insufficient_privilege then null;end;
 reset role;
end$$;
select pg_temp.ok(not has_function_privilege('service_role','public._zoe_text_enqueue(uuid,uuid,text,text)','execute')and has_function_privilege('service_role','public.zoe_run_context(uuid[])','execute'),'Helpers stay internal');

-- 16. Switch off again: acknowledgements are not held.
update public.zoe_settings set conversational_replies_enabled=false;
insert into kv values('i13',to_jsonb(pg_temp.say('9313','Synthetic hello after the switch')));
select pg_temp.ok((select state='queued'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='i13'))),'Switch off again: acknowledgement queued');

-- Codex review F5: a recorded Zoe reply whose delivery was withdrawn no longer keeps the acknowledgement held.
update public.zoe_settings set conversational_replies_enabled=true;
insert into kv values('review-inbox',to_jsonb(pg_temp.say('9399','Synthetic reviewer hello')));
insert into kv values('review-run',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.finish((select (v#>>'{}')::uuid from kv where k='review-run'),pg_temp.res('chatted','chat_reply_passed_guards','Hello Wendy.','{"kind":"greeting","source":"model"}'));
select pg_temp.ok((select state='held'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='review-inbox'))),'F5 setup: acknowledgement held behind Zoe''s reply');
update public.system_messages set state='held',reason='template_withdrawn',state_seq=state_seq+1,updated_at=clock_timestamp()
 where id=(select system_message_id from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='review-run'));
update public.system_messages set created_at=created_at-interval '4 minutes'where id=(select id from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='review-inbox')));
select pg_temp.backstop();
select pg_temp.ok((select state='queued'from pg_temp.ack((select (v#>>'{}')::uuid from kv where k='review-inbox'))),'F5: a withdrawn Zoe reply releases its acknowledgement');

select 'zoe warm replies checks passed' as result;
rollback;
