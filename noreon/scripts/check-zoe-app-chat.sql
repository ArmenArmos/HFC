-- Zoe in the member app: one conversation across app and Telegram, the same intake rules, the same
-- Zoe claim and spend gate, doctor-approved replies only, and the member reads only their own
-- thread. Rolled back. Synthetic fixtures only; no Telegram network, provider or model.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_user(m text,sid text)returns void language plpgsql as $$begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub',m,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','otp')),'session_id',sid)::text,true);end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_app",9011,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_app",9011,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.link(m uuid,u bigint)returns jsonb language plpgsql as $$declare b jsonb;begin
 b:=public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null);
 return public._telegram_replies_activate(m,(b->>'bindingId')::uuid);end$$;
create function pg_temp.say(id text,u bigint,txt text)returns void language plpgsql as $$begin
 perform pg_temp.as_service();perform public.channel_inbox_commit(pg_temp.event(id,u,txt));perform pg_temp.drain();end$$;
-- The member's own session, as the app server action calls it.
create function pg_temp.send(m text,sid text,rid text,txt text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_receive(jsonb_build_object('requestId',rid,'text',txt));reset role;return j;end$$;
create function pg_temp.thread(m text,sid text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_user(m,sid);set local role authenticated;j:=public.conversation_member_thread();reset role;return j;end$$;
create function pg_temp.claim()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;return j;end$$;
create function pg_temp.svc(fn text,run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;
 if fn='finish'then j:=public.zoe_run_finish(run,arg);else j:=public.zoe_run_reserve(run,(arg->>'estimate')::numeric,(arg->>'local')::boolean,'[]'::jsonb,'high','noreon-fake-deterministic-1');end if;
 reset role;return j;end$$;
create function pg_temp.draft(body text)returns jsonb language sql as $$
 select jsonb_build_object('outcome','draft_proposed','reason','draft_passed_guards','summary','Synthetic summary for the doctor','draft',body,'guardReasons','[]'::jsonb,
  'redactionCount',0,'usage',jsonb_build_object('inputTokens',100,'outputTokens',20),'costUsd',0.001,'latencyMs',3,'provider','noreon.fake','model','noreon-fake-deterministic-1',
  'configVersion','zoe-app-chat-check','sealed',null,'events','[]'::jsonb)
$$;
create function pg_temp.approve(member text,rid text)returns jsonb language plpgsql as $$declare a jsonb;j jsonb;begin
 perform pg_temp.as_user('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000012');
 perform set_config('request.jwt.claims',jsonb_build_object('sub','a7000000-0000-4000-8000-000000000002','role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','a7000000-0000-4000-8000-000000000012')::text,true);
 set local role authenticated;
 a:=public.conversation_actions(member::uuid);
 j:=public.conversation_command(jsonb_build_object('schema',1,'purpose','reply.approve','intentId',(select x->>'intentId'from jsonb_array_elements(a#>'{view,actions}')x where x->>'purpose'='reply.approve'),'requestId',rid));
 reset role;return j;end$$;
create function pg_temp.awaiting()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform set_config('request.jwt.claims',jsonb_build_object('sub','a7000000-0000-4000-8000-000000000002','role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id','a7000000-0000-4000-8000-000000000012')::text,true);
 set local role authenticated;j:=public.conversation_awaiting_replies();reset role;return j;end$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

-- A: member with Telegram; B: member with the app only; D: assigned doctor; S: staff, not a member.
insert into auth.users(id,phone,phone_confirmed_at)values('a7000000-0000-4000-8000-000000000001','37499070001',now()),('a7000000-0000-4000-8000-000000000003','37499070003',now()),
 ('a7000000-0000-4000-8000-000000000002',null,null),('a7000000-0000-4000-8000-000000000005','37499070005',now());
insert into public.workspace_clinics(id,name)values('a7000000-0000-4000-8000-000000000004','Synthetic app chat clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('a7000000-0000-4000-8000-000000000002','doctor','Dr App Synthetic','a7000000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)values('a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000001',now(),now()),
 ('a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-000000000002',now(),now()),('a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-000000000003',now(),now()),
 ('a7000000-0000-4000-8000-000000000015','a7000000-0000-4000-8000-000000000005',now(),now());
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000002'),('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='App Member A'where id='a7000000-0000-4000-8000-000000000001';
update public.profiles set locale='hy',display_name='App Member B'where id='a7000000-0000-4000-8000-000000000003';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_app',9011,600,'consent-app');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-app',3600,600,60,6,false,true);
select pg_temp.link('a7000000-0000-4000-8000-000000000001',7701);
insert into public.system_message_templates(template_id,version,locale,body,approved)values('telegram.ack',99,'en','Synthetic approved acknowledgement.',true);

-- 1. Dark by default: the thread is unavailable until conversation_policy.app_chat_enabled is on.
select pg_temp.ok(pg_temp.thread('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011')->>'code'='unavailable','Switch off: no app thread');
update public.conversation_policy set app_chat_enabled=true;

-- 2. Shared conversation: an app message and a Telegram message land in one conversation.
insert into kv values('s1',pg_temp.send('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000a1','Synthetic app question about my visit'));
select pg_temp.ok((select v->>'ok'='true'from kv where k='s1'),'App message stored');
select pg_temp.say('7001',7701,'Synthetic Telegram follow-up');
select pg_temp.ok((select count(*)=1 from public.conversations where member_id='a7000000-0000-4000-8000-000000000001'),'One conversation per member across channels');
select pg_temp.ok((select array_agg(source order by seq)='{authenticated_member,telegram_member}'from public.conversation_messages m join public.conversations c on c.id=m.conversation_id where c.member_id='a7000000-0000-4000-8000-000000000001'),'Both channels in seq order with their sources');
-- Same intake side effects as Telegram: the doctor alert row (drives the staff notice) and the received audit.
select pg_temp.ok((select count(*)=2 from public.conversation_doctor_alerts where member_id='a7000000-0000-4000-8000-000000000001'and doctor_id='a7000000-0000-4000-8000-000000000002'),'Doctor alert for the app message and the Telegram one');
select pg_temp.ok(exists(select 1 from public.conversation_doctor_alerts where member_id='a7000000-0000-4000-8000-000000000001'and inbox_id is null),'App alert has no inbox row');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='message.received'and detail->>'channel'='app'),'App receipt audited like Telegram');
select pg_temp.ok(not exists(select 1 from public.system_messages where member_id='a7000000-0000-4000-8000-000000000001'and source_inbox_id is null),'No Telegram acknowledgement is queued for an app message');
insert into kv values('t1',pg_temp.thread('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011'));
select pg_temp.ok((select jsonb_array_length(v->'messages')=2 and v->'messages'->0->>'channel'='app'and v->'messages'->1->>'channel'='telegram'
 and v->'messages'->0->>'requestId'='a7000000-0000-4000-8000-0000000000a1'and v->'messages'->1->'requestId'='null'::jsonb from kv where k='t1'),'Thread shows both channels; request id only for app messages');
select pg_temp.ok((select v->>'ack'='Synthetic approved acknowledgement.'from kv where k='t1'),'Thread carries the approved Telegram acknowledgement in the member''s locale');
select pg_temp.ok((select pg_temp.thread('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013')->'ack'='null'::jsonb),'No approved Armenian acknowledgement: none (the app shows a plain status)');
-- Replay: the same request id never stores twice; a changed payload is a conflict.
select pg_temp.ok(pg_temp.send('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000a1','Synthetic app question about my visit')->>'replayed'='true','Retry replays');
select pg_temp.ok(pg_temp.send('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000a1','Different text')->>'code'='request_conflict','Changed retry refused');

-- 3. Size cap and limits are Telegram's.
select pg_temp.ok(pg_temp.send('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000a2',repeat('x',4097))->>'code'='invalid_command','Over 4096 UTF-16 units refused, like Telegram');
select pg_temp.ok(pg_temp.send('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000a3','   ')->>'code'='invalid_command','Blank text refused');
select pg_temp.ok(pg_temp.send('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000a4',repeat('y',4096))->>'ok'='true','Exactly 4096 accepted');
select pg_temp.send('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011',format('a7000000-0000-4000-8000-0000000000b%s',n),'Synthetic filler '||n)from generate_series(1,3)n;
select pg_temp.ok(pg_temp.send('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000c1','One too many')->>'code'='rate_limited','Same intake window and limit as Telegram');
select pg_temp.ok(not exists(select 1 from public.conversation_messages where body='One too many')and exists(select 1 from public.conversation_audit where kind='message.rate_limited'and detail->>'channel'='app'),'Over the limit: not stored, audited');
update public.conversation_policy set intake_max_messages=50;
-- Eligibility: staff are not members; a user without a clinical case is refused.
-- A permanent refusal is a code the app can explain, not an exception (18 Oct).
select pg_temp.ok(pg_temp.send('a7000000-0000-4000-8000-000000000002','a7000000-0000-4000-8000-000000000012','a7000000-0000-4000-8000-0000000000d1','Staff writing as member')->>'code'='not_eligible','Staff cannot write as a member');
select pg_temp.ok(not exists(select 1 from public.conversation_messages where body='Staff writing as member'),'Staff text not stored');
select pg_temp.ok(pg_temp.thread('a7000000-0000-4000-8000-000000000005','a7000000-0000-4000-8000-000000000015')->>'code'='not_eligible','No clinical case: no thread');

-- 4. The same Zoe pipeline: app messages are claimed like Telegram ones; a real model call is refused while off.
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('a7000000-0000-4000-8000-000000000003','zoe_reads_messages',true,'zoe-consent-draft-1'),
 ('a7000000-0000-4000-8000-000000000001','zoe_reads_messages',true,'zoe-consent-draft-1');
select pg_temp.claim();reset role;
select pg_temp.ok(pg_temp.send('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-0000000000e1','Synthetic app-only question')->>'ok'='true','App-only member writes');
insert into kv values('c1',pg_temp.claim());reset role;
select pg_temp.ok((select jsonb_array_length(v)=1 and v->0->>'memberId'='a7000000-0000-4000-8000-000000000003'and v->0->'messages'->0->>'text'='Synthetic app-only question'from kv where k='c1'),'An app message is claimed by the Zoe sweep');
insert into kv select 'run',v->0->'runId'from kv where k='c1';
select pg_temp.ok((select model_calls_allowed is not true from public.zoe_settings),'model_calls_allowed is off');
select pg_temp.ok(pg_temp.svc('reserve',(select (v#>>'{}')::uuid from kv where k='run'),'{"estimate":0.01,"local":false}')->>'code'='model_calls_not_permitted','No real model call while the switch is off');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.spend.reserve'and reason_code='model_calls_not_permitted'),'The refusal is traced');

-- 5. Approval gating: a proposed AI draft stays invisible until the doctor approves it, and an approved
-- reply reaches the app only under the same context rule as a Telegram send (Fable F1, F2).
select pg_temp.ok(pg_temp.svc('reserve',(select (v#>>'{}')::uuid from kv where k='run'),'{"estimate":0.01,"local":true}')->>'ok'='true','Local fake provider reserves');
select pg_temp.ok((select pg_temp.svc('finish',(v#>>'{}')::uuid,pg_temp.draft('Synthetic AI draft for the app member'))->>'outcome'='draft_proposed'from kv where k='run'),'Draft proposed');
insert into kv values('t2',pg_temp.thread('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013'));
select pg_temp.ok((select v->'replies'='[]'::jsonb and v::text !~ 'Synthetic AI draft|Synthetic summary'from kv where k='t2'),'Pending draft and summary are never in the member thread');
insert into kv values('ap',pg_temp.approve('a7000000-0000-4000-8000-000000000003','a7000000000040008000000000000a01'));
select pg_temp.ok((select v->>'ok'='true'from kv where k='ap'),'Doctor approves through the reply machine');
select pg_temp.ok((select state='held'and reason='route_policy_missing'from public.conversation_deliveries where id=(select (v->>'deliveryId')::uuid from kv where k='ap')),'App-only member: Telegram delivery held, nothing sent');
-- F2: until the member has it in the app, the doctor still sees it as not delivered.
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.awaiting()->'items')x where x->>'memberId'='a7000000-0000-4000-8000-000000000003'and x->>'reason'='not_delivered'),'Approved but not read in the app: still listed as not delivered');
insert into kv values('t3',pg_temp.thread('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013'));
select pg_temp.ok((select jsonb_array_length(v->'replies')=1 and v->'replies'->0->>'text'='Synthetic AI draft for the app member'and v->'replies'->0->>'doctorName'='Dr App Synthetic'
 and not(v->'replies'->0 ?| array['draftId','grantId','intentId','contentHash','doctorId'])from kv where k='t3'),'Context current: the approved reply appears with the doctor''s name, no approval metadata');
select pg_temp.ok((select reason='context_current'from public.conversation_app_releases where approval_id=(select (v->>'approvalId')::uuid from kv where k='ap')),'The release is recorded');
select pg_temp.ok(not exists(select 1 from jsonb_array_elements(pg_temp.awaiting()->'items')x where x->>'memberId'='a7000000-0000-4000-8000-000000000003'),'Released in the app: no longer "not delivered"');
-- Sticky: a newer member message after the release does not withdraw what the member may have read.
select pg_temp.send('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-0000000000e2','Synthetic follow-up after reading');
select pg_temp.ok((select jsonb_array_length(v->'replies')=1 from(select pg_temp.thread('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013')v)x),'Released reply stays after a newer message');
-- New information before any read voids the approval for the app, exactly as for Telegram.
create function pg_temp.cycle(member text,sid text,rid text,body text,approve_rid text)returns jsonb language plpgsql as $$declare j jsonb;run uuid;begin
 perform pg_temp.send(member,sid,rid,'Synthetic question '||rid);
 j:=pg_temp.claim();reset role;
 select (x->>'runId')::uuid into run from jsonb_array_elements(j)x where x->>'memberId'=member;
 perform pg_temp.svc('reserve',run,'{"estimate":0.01,"local":true}');
 perform pg_temp.svc('finish',run,pg_temp.draft(body));
 return pg_temp.approve(member,approve_rid);end$$;
select pg_temp.ok(pg_temp.cycle('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-0000000000e3','Reply voided by a newer message','a7000000000040008000000000000a03')->>'ok'='true','Second approval');
select pg_temp.send('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-0000000000e4','I vomited and feel dizzy (synthetic)');
select pg_temp.ok((select v::text !~ 'Reply voided by a newer message'from(select pg_temp.thread('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013')v)x),'F1: a newer member message before any read keeps the reply out of the app');
select pg_temp.ok(exists(select 1 from jsonb_array_elements(pg_temp.awaiting()->'items')x where x->>'memberId'='a7000000-0000-4000-8000-000000000003'and x->>'reason'='new_message'),'The doctor sees the new message to review');
select pg_temp.ok(pg_temp.cycle('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013','a7000000-0000-4000-8000-0000000000e5','Reply voided by new clinical information','a7000000000040008000000000000a05')->>'ok'='true','Third approval');
update public.patient_clinical_cases set revision=revision+1 where user_id='a7000000-0000-4000-8000-000000000003';
select pg_temp.ok((select v::text !~ 'Reply voided by new clinical information'from(select pg_temp.thread('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013')v)x),'F1: a clinical revision after approval keeps the reply out of the app');

-- 6. Cross-channel: a Telegram member's reply goes to Telegram, and to the app under the same rule.
select pg_temp.send('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000a5','Synthetic app line before the reply');
insert into kv values('c2',pg_temp.claim());reset role;
select pg_temp.ok((select jsonb_array_length(v)=1 and v->0->>'memberId'='a7000000-0000-4000-8000-000000000001'from kv where k='c2'),'Member A''s newest message is claimed');
select pg_temp.svc('reserve',(v->0->>'runId')::uuid,'{"estimate":0.01,"local":true}')from kv where k='c2';
select pg_temp.svc('finish',(v->0->>'runId')::uuid,pg_temp.draft('Synthetic reply for both channels'))from kv where k='c2';
insert into kv values('ap2',pg_temp.approve('a7000000-0000-4000-8000-000000000001','a7000000000040008000000000000a02'));
select pg_temp.ok((select state='queued'from public.conversation_deliveries where id=(select (v->>'deliveryId')::uuid from kv where k='ap2')),'Telegram member: the reply is queued for Telegram');
-- A newer message before the send and before any app read: held in Telegram, not in the app.
select pg_temp.say('7002',7701,'Synthetic newer Telegram line');
select pg_temp.ok((select state='held'and reason='newer_member_message'from public.conversation_deliveries where id=(select (v->>'deliveryId')::uuid from kv where k='ap2')),'Telegram send held by the newer message');
select pg_temp.ok((select v->'replies'='[]'::jsonb from(select pg_temp.thread('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011')v)x),'and the app does not show it either');
-- A reply Telegram carried is shown in the app whatever came after.
select pg_temp.ok(pg_temp.cycle('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000a6','Synthetic reply Telegram delivered','a7000000000040008000000000000a06')->>'ok'='true','Approval for A');
update public.conversation_deliveries set state='accepted_by_provider'where approval_id=(select ap.id from public.conversation_approvals ap where ap.body='Synthetic reply Telegram delivered');
select pg_temp.say('7003',7701,'Synthetic line after delivery');
insert into kv values('t6',pg_temp.thread('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011'));
select pg_temp.ok((select jsonb_array_length(v->'replies')=1 and v->'replies'->0->>'text'='Synthetic reply Telegram delivered'
 and (v->'replies'->0->>'at')::timestamptz<(v->'messages'->-1->>'at')::timestamptz from kv where k='t6'),'Carried by Telegram: shown in the app, before the newer message');
select pg_temp.ok((select reason='telegram_attempted'from public.conversation_app_releases r join public.conversation_approvals ap on ap.id=r.approval_id where ap.body='Synthetic reply Telegram delivered'),'Released because Telegram carried it');
-- A lapsed approving authority with a current context is not released.
select pg_temp.ok(pg_temp.cycle('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011','a7000000-0000-4000-8000-0000000000a7','Synthetic reply with lapsed authority','a7000000000040008000000000000a07')->>'ok'='true','Approval for lapse');
update public.conversation_deliveries set state='held',reason='approval_authority_lapsed'where approval_id=(select ap.id from public.conversation_approvals ap where ap.body='Synthetic reply with lapsed authority');
select pg_temp.ok((select v::text !~ 'lapsed authority'from(select pg_temp.thread('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011')v)x),'Lapsed authority: not shown');
select pg_temp.ok(not has_table_privilege('authenticated','public.conversation_app_releases','select')and not has_table_privilege('service_role','public.conversation_app_releases','select')
 and(select relrowsecurity from pg_class where oid='public.conversation_app_releases'::regclass),'Releases: RLS on, reachable only through functions');

-- 7. The member reads only their own conversation.
select pg_temp.ok((select v::text !~ 'Synthetic app-only|Synthetic AI draft for the app member'from(select pg_temp.thread('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011')v)x),'A sees nothing of B');
select pg_temp.ok((select v::text !~ 'Synthetic app question|Synthetic Telegram|both channels'from(select pg_temp.thread('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013')v)x),'B sees nothing of A');
do $$begin perform pg_temp.as_user('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013');set local role authenticated;
 perform public.conversation_workspace('a7000000-0000-4000-8000-000000000001');raise exception 'FAIL: member read another conversation';
exception when insufficient_privilege then reset role;end$$;
do $$begin perform pg_temp.as_user('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013');set local role authenticated;
 perform count(*)from public.conversation_messages;raise exception 'FAIL: direct table read';
exception when insufficient_privilege then reset role;end$$;
select pg_temp.ok(not has_function_privilege('anon','public.conversation_member_thread()','execute'),'Anonymous cannot read a thread');
select pg_temp.ok(not has_function_privilege('authenticated','public.zoe_run_claim(integer)','execute'),'Members cannot claim Zoe runs');
select pg_temp.ok((select relrowsecurity from pg_class where oid='public.conversation_messages'::regclass)and(select relrowsecurity from pg_class where oid='public.conversation_policy'::regclass),'RLS stays on');

-- 8. Care-alert screening sees app messages exactly like Telegram ones.
insert into public.care_alert_settings(enabled)values(true)on conflict do nothing;
select pg_temp.as_service();set local role service_role;
insert into kv values('pending',public.care_alert_messages_pending(50,false));
reset role;
select pg_temp.ok(exists(select 1 from kv,jsonb_array_elements(kv.v)x where kv.k='pending'
 and (x->>'messageId')::uuid in(select m.id from public.conversation_messages m where m.source='authenticated_member')),'App messages are queued for care-alert screening');
-- 9. Voice evidence is atomic with the message, immutable on retries, and readable on another device.
-- These SQL fixtures are opaque proof strings. Cryptographic acceptance is tested through the server action
-- in check-zoe-voice-provenance.ts; SQL never grants voice provenance from the receipt alone.
update public.conversation_policy set intake_max_messages=100;
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','a7000000-0000-4000-8000-000000000011');
set local role authenticated;
insert into kv values('voice',public.conversation_receive('{"requestId":"a7111111-0000-4000-8000-000000000001","text":"145/92"}',false,'synthetic-signed-receipt'));
select pg_temp.ok((select v->>'ok'='true'from kv where k='voice'),'Send stores voice message before any card opens');
select pg_temp.ok(public.conversation_receive('{"requestId":"a7111111-0000-4000-8000-000000000001","text":"145/92"}',false,'replacement-proof')->>'replayed'='true','A retry replays the original message');
select pg_temp.ok(public.conversation_receive('{"requestId":"a7111111-0000-4000-8000-000000000002","text":"146/93"}',false)->>'ok'='true','Old two-argument callers still send');
select pg_temp.ok(public.conversation_receive('{"requestId":"a7111111-0000-4000-8000-000000000002","text":"146/93"}',false,'later-proof')->>'replayed'='true','A typed replay cannot acquire new proof');
reset role;
select pg_temp.ok((select voice_receipt='synthetic-signed-receipt'from public.conversation_messages where request_id='a7111111-0000-4000-8000-000000000001'),'Lost card opening cannot lose stored proof; retry cannot overwrite it');
select pg_temp.ok((select voice_receipt is null from public.conversation_messages where request_id='a7111111-0000-4000-8000-000000000002'),'A typed message stays typed on replay');
insert into auth.sessions(id,user_id,created_at,updated_at)values('a7111111-0000-4000-8000-000000000011','a7000000-0000-4000-8000-000000000001',now(),now());
select pg_temp.as_user('a7000000-0000-4000-8000-000000000001','a7111111-0000-4000-8000-000000000011');
set local role authenticated;
select pg_temp.ok(public.conversation_member_voice_receipt((select (v->>'version')::bigint from kv where k='voice'))->>'receipt'='synthetic-signed-receipt','Another device recovers the persisted proof without tab storage');
select pg_temp.ok(public.conversation_member_voice_receipt((select (v->'messages'->1->>'seq')::bigint from kv where k='t1'))->>'text'='Synthetic Telegram follow-up','BP cards still read the member''s Telegram message as typed');
-- Simulate a failed transaction between receive and its reply. Message and proof roll back together.
do $$begin
 begin
  perform public.conversation_receive('{"requestId":"a7111111-0000-4000-8000-000000000003","text":"147/94"}',false,'rollback-proof');
  raise exception using errcode='P0001',message='Synthetic rollback';
 exception when sqlstate 'P0001'then null;
 end;
end$$;
reset role;
select pg_temp.ok(not exists(select 1 from public.conversation_messages where request_id='a7111111-0000-4000-8000-000000000003'),'Message and proof roll back together');
select pg_temp.as_user('a7000000-0000-4000-8000-000000000003','a7000000-0000-4000-8000-000000000013');
set local role authenticated;
select pg_temp.ok(public.conversation_member_voice_receipt((select (v->>'version')::bigint from kv where k='voice'))is null,'Another member cannot read the proof');
reset role;
select pg_temp.ok(not has_function_privilege('anon','public.conversation_member_voice_receipt(bigint)','execute'),'Anonymous cannot read proof');
select pg_temp.ok(not has_function_privilege('anon','public.conversation_receive(jsonb,boolean,text)','execute'),'Anonymous cannot send proof');

rollback;
