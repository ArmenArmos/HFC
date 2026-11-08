-- Zoe urgent route text (20261019064453): outside an intake, urgent words get Zoe's urgent or crisis text in the
-- message language (RU too) in the app thread and on Telegram when zoe.answer is approved; zoe.urgent stays the
-- Telegram fallback (wording unapproved, or no text from an older worker); the held acknowledgement goes too; a text
-- on any other discarded run, or in an unsupported language, is invalid. Rolled back. Synthetic fixtures only.
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
-- Conversational replies on with the receipt approved, so Telegram acknowledgements are held for Zoe (as in check-zoe-warm-replies).
update public.zoe_settings set staging_ai_mode=true;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','zoe-check+model+rows-510+chat-33',510,0,0,'e1830000-0000-4000-8000-000000000006'from public.zoe_tier_config;
update public.zoe_settings set model_calls_allowed=true;
update public.zoe_settings set conversational_replies_enabled=true;
update public.system_message_templates set approved=true,approval_note='Staging check'where template_id in('zoe.chat','zoe.receipt');
create function pg_temp.urgent(reason text,answer text,lang text)returns jsonb language sql as $$
 select pg_temp.res('discarded',reason,answer,null,null,'none','none')||case when lang is null then '{}'::jsonb else jsonb_build_object('language',lang)end$$;
create function pg_temp.k(key text)returns uuid language sql as $$select (v#>>'{}')::uuid from kv where k=key$$;

-- 1. Telegram, Russian urgent words, zoe.answer approved: Zoe's text in Russian, no template, the acknowledgement released.
insert into kv values('i1',to_jsonb(pg_temp.say('9401','Synthetic urgent words one')));
select pg_temp.ok((select state='held'from pg_temp.ack(pg_temp.k('i1'))),'Setup: the acknowledgement is held for Zoe');
insert into kv values('r1',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.ok((pg_temp.finish(pg_temp.k('r1'),pg_temp.urgent('urgent_route_no_model_call','Синтетический срочный текст. Позвоните 103.','ru'))->>'outcome')='discarded','RU urgent: finished discarded');
select pg_temp.ok((select kind='urgent'and language='ru'and provider='noreon.rules'and model='zoe-urgent-fixed'and system_message_id is not null from public.zoe_member_answers where run_id=pg_temp.k('r1')),'RU urgent: an urgent answer in Russian, sent on Telegram');
select pg_temp.ok((select template_id='zoe.answer'from public.system_messages where id=(select system_message_id from public.zoe_member_answers where run_id=pg_temp.k('r1'))),'RU urgent: sent through the zoe.answer channel');
select pg_temp.ok(not exists(select 1 from public.system_messages where source_inbox_id=pg_temp.k('i1')and template_id='zoe.urgent'),'RU urgent: no duplicate zoe.urgent template');
select pg_temp.ok((select state='queued'from pg_temp.ack(pg_temp.k('i1'))),'RU urgent: the held acknowledgement released');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='zoe.urgent'and detail->>'runId'=pg_temp.k('r1')::text and detail->>'language'='ru'),'RU urgent: audited');

-- 2. In the urgent window, the crisis text, zoe.answer unapproved: stored for the app, the template on Telegram.
insert into public.system_message_templates(template_id,version,locale,body,free_body,approved,approval_note)
 select 'zoe.answer',max(version)+1,'en','withdrawn',true,false,'Staging check'from public.system_message_templates where template_id='zoe.answer'and locale='en';
insert into kv values('i2',to_jsonb(pg_temp.say('9402','Synthetic follow-up in the window')));
insert into kv values('r2',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.finish(pg_temp.k('r2'),pg_temp.urgent('urgent_in_window_no_model_call','Synthetic crisis text. You are not alone. Call 103.','en'));
select pg_temp.ok((select kind='urgent'and system_message_id is null from public.zoe_member_answers where run_id=pg_temp.k('r2')),'Unapproved: the text is stored, not sent on Telegram');
select pg_temp.ok(exists(select 1 from public.system_messages where source_inbox_id=pg_temp.k('i2')and template_id='zoe.urgent'),'Unapproved: the zoe.urgent template is the fallback');
insert into public.system_message_templates(template_id,version,locale,body,free_body,approved,approval_note)
 select 'zoe.answer',max(version)+1,'en','re-approved',true,true,'Staging check'from public.system_message_templates where template_id='zoe.answer'and locale='en';

-- 3. An older worker (no text): exactly as before, the template and no answer row.
insert into kv values('i3',to_jsonb(pg_temp.say('9403','Synthetic urgent words three')));
insert into kv values('r3',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.finish(pg_temp.k('r3'),pg_temp.urgent('urgent_route_no_model_call',null,null));
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=pg_temp.k('r3')),'No text: no answer row');
select pg_temp.ok(exists(select 1 from public.system_messages where source_inbox_id=pg_temp.k('i3')and template_id='zoe.urgent'),'No text: zoe.urgent queued');
select pg_temp.ok((select state='queued'from pg_temp.ack(pg_temp.k('i3'))),'No text: the acknowledgement released');

-- 4. The app: the urgent text shows in the member's thread; nothing goes to Telegram.
select pg_temp.send('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011','e1830000-0000-4000-8000-0000000000b1','Synthetic urgent from the app');
insert into kv values('r4',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000001')));
select pg_temp.finish(pg_temp.k('r4'),pg_temp.urgent('urgent_route_no_model_call','Synthetic urgent text for the app. Call 103.','en'));
select pg_temp.ok(exists(select 1 from jsonb_array_elements((select pg_temp.thread('e1830000-0000-4000-8000-000000000001','e1830000-0000-4000-8000-000000000011'))->'answers')x where x->>'text'='Synthetic urgent text for the app. Call 103.'),'App: the urgent text in the thread');
select pg_temp.ok((select system_message_id is null from public.zoe_member_answers where run_id=pg_temp.k('r4')),'App: nothing queued on Telegram');

-- 5. Invalid: a text on a discarded run that is not urgent, or in an unsupported language; nothing stored.
insert into kv values('i5',to_jsonb(pg_temp.say('9405','Synthetic message five')));
insert into kv values('r5',to_jsonb(pg_temp.run_for('e1830000-0000-4000-8000-000000000003')));
select pg_temp.ok((pg_temp.finish(pg_temp.k('r5'),pg_temp.urgent('scope_not_supported','Synthetic text','en'))->>'code')='invalid','A text on a non-urgent discarded run is invalid');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r5'),pg_temp.urgent('urgent_route_no_model_call','Synthetic text','de'))->>'code')='invalid','An unsupported language is invalid');
select pg_temp.ok((pg_temp.finish(pg_temp.k('r5'),pg_temp.urgent('urgent_route_no_model_call',repeat('x',701),'en'))->>'code')='invalid','A text over 700 characters is invalid');
select pg_temp.ok(not exists(select 1 from public.zoe_member_answers where run_id=pg_temp.k('r5')),'Invalid: nothing stored');

select 'zoe urgent route checks passed' as result;
rollback;
