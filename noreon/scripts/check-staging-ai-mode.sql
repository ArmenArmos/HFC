-- Staging AI mode (20261017190654): the real-call gate (staging or signed DPA, plus a passing
-- model-mode eval per tier), per-call re-checks in both reservations, caps unchanged, Zoe's direct
-- answers (stored, Telegram-queued, never from the stand-in, never for a stale or non-low run) and the
-- urgent template. Rolled back. Synthetic fixtures only; no Telegram, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_sai",9017,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_sai",9017,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
$$;
create function pg_temp.drain()returns void language plpgsql as $$declare i jsonb;begin
 for i in select jsonb_array_elements(public.channel_inbox_next(50))loop perform public.channel_inbox_process((i#>>'{}')::uuid);end loop;end$$;
create function pg_temp.link(m uuid,u bigint)returns jsonb language plpgsql as $$declare b jsonb;begin
 b:=public._telegram_auth_bind(m,'member',pg_temp.principal(u),(select public._telegram_account_ref(s)from public.telegram_channel_settings s),public._auth_phone(m),u::text,null);
 return public._telegram_replies_activate(m,(b->>'bindingId')::uuid);end$$;
create function pg_temp.say(id text,u bigint,txt text)returns void language plpgsql as $$begin
 perform pg_temp.as_service();perform public.channel_inbox_commit(pg_temp.event(id,u,txt));perform pg_temp.drain();end$$;
create function pg_temp.claim()returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_claim(10);reset role;return j;end$$;
create function pg_temp.reserve(run uuid,est numeric,loc boolean,tier text,model text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_reserve(run,est,loc,'[]',tier,model);reset role;return j;end$$;
create function pg_temp.finish(run uuid,arg jsonb)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_finish(run,arg);reset role;return j;end$$;
create function pg_temp.answer(text text,provider text default 'vercel.ai_gateway',tier text default 'low')returns jsonb language sql as $$
 select jsonb_build_object('outcome','answered','reason','direct_answer_passed_guards','summary','Member asked where visit times are.','draft',null,'answer',text,'language','en',
  'guardReasons','[]'::jsonb,'redactionCount',0,'usage',jsonb_build_object('inputTokens',900,'outputTokens',80),'costUsd',0.0002,'latencyMs',800,
  'provider',provider,'model','anthropic/claude-haiku-5.5','configVersion','zoe-conversation-prompt-1+test','sealed',null,'tier',tier,'tierReason','rule_logistics','fallbackUsed',false,'events','[]'::jsonb)
$$;
create function pg_temp.newrun(m uuid,seq bigint)returns uuid language sql as $$
 insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day)
 select c.id,m,seq,c.version,c.draft_epoch,(now() at time zone 'Asia/Yerevan')::date from public.conversations c where c.member_id=m returning id
$$;
create temp table kv(k text primary key,v jsonb);
grant all on kv to authenticated,service_role;

insert into auth.users(id,phone,phone_confirmed_at)values('d1910000-0000-4000-8000-000000000001','37499019101',now()),('d1910000-0000-4000-8000-000000000002',null,null),('d1910000-0000-4000-8000-000000000003',null,null);
insert into public.workspace_clinics(id,name)values('d1910000-0000-4000-8000-000000000004','Synthetic staging AI clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1910000-0000-4000-8000-000000000002','doctor','Dr Staging Synthetic','d1910000-0000-4000-8000-000000000004');
insert into public.workspace_staff(user_id,role,display_name)values('d1910000-0000-4000-8000-000000000003','admin','Admin Staging Synthetic');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1910000-0000-4000-8000-000000000001','d1910000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='Staging Member'where id='d1910000-0000-4000-8000-000000000001';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_sai',9017,600,'consent-s');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-sai',3600,600,60,20,false,true);
select pg_temp.link('d1910000-0000-4000-8000-000000000001',8911);
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('d1910000-0000-4000-8000-000000000001','zoe_reads_messages',true,'zoe-consent-draft-1');

-- 1. Off by default; the switch needs a basis AND passing model-mode evals ----------------------------
select pg_temp.ok((select not model_calls_allowed and not staging_ai_mode and not direct_answers_enabled from public.zoe_settings),'Everything off by default');
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: calls on with no basis';exception when check_violation then null;end$$;
update public.zoe_settings set staging_ai_mode=true;
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: calls on without a model-mode eval';exception when check_violation then
 if sqlerrm !~ 'eval' then raise exception 'FAIL: wrong refusal %',sqlerrm;end if;end$$;
-- A plumbing-mode or failing eval does not count.
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'plumbing','test',300,0,0,'d1910000-0000-4000-8000-000000000003'from public.zoe_tier_config;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','test',300,1,1,'d1910000-0000-4000-8000-000000000003'from public.zoe_tier_config;
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: plumbing or failing eval accepted';exception when check_violation then null;end$$;
-- Passing model-mode evals for two tiers only: still refused, naming the missing tier.
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','test',300,0,2,'d1910000-0000-4000-8000-000000000003'from public.zoe_tier_config where tier<>'high';
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: a tier without an eval accepted';exception when check_violation then
 if sqlerrm !~ 'high' then raise exception 'FAIL: missing tier not named %',sqlerrm;end if;end$$;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','test',300,0,0,'d1910000-0000-4000-8000-000000000003'from public.zoe_tier_config where tier='high';
update public.zoe_settings set model_calls_allowed=true;
select pg_temp.ok((select model_calls_allowed from public.zoe_settings),'Staging plus passing model-mode evals: calls may be switched on');

-- 2. Reservation re-checks at each call; caps unchanged ------------------------------------------------
select pg_temp.say('1100',8911,'Where can I see my visit times?');
insert into kv values('c1',pg_temp.claim());
select pg_temp.ok((select jsonb_array_length(v)=1 and v->0->'answers'='[]'::jsonb and (v->0->>'directAnswers')::boolean=false from kv where k='c1'),'Job carries Zoe answers (none yet) and the direct-answer switch (off)');
insert into kv select 'run',v->0->'runId'from kv where k='c1';
select pg_temp.ok(pg_temp.reserve((select (v#>>'{}')::uuid from kv where k='run'),0.001,false,'low','openai/gpt-5-mini')->>'code'='model_not_configured_for_tier','Only the tier''s configured models may reserve');
update public.zoe_tier_config set daily_cap_usd=0.0 where tier='low';
select pg_temp.ok(pg_temp.reserve((select (v#>>'{}')::uuid from kv where k='run'),0.001,false,'low','anthropic/claude-haiku-5.5')->>'code'='tier_spend_cap_reached','Tier cap still enforced with real calls on');
update public.zoe_tier_config set daily_cap_usd=1 where tier='low';
update public.zoe_settings set daily_spend_cap_usd=0.0005;
select pg_temp.ok(pg_temp.reserve((select (v#>>'{}')::uuid from kv where k='run'),0.001,false,'low','anthropic/claude-haiku-5.5')->>'code'in('daily_spend_cap_reached','tier_spend_cap_reached'),'Total cap (it also bounds the tier cap) still enforced with real calls on');
update public.zoe_settings set daily_spend_cap_usd=10;
do $$begin update public.zoe_settings set daily_spend_cap_usd=10.5;raise exception 'FAIL: cap above US$10';exception when check_violation then null;end$$;
-- Staging off, no DPA: the live switch is refused at the next change and every call is refused.
do $$begin update public.zoe_settings set staging_ai_mode=false;raise exception 'FAIL: staging off with calls on and no DPA';exception when check_violation then null;end$$;
alter table public.zoe_settings disable trigger zoe_settings_guard;
update public.zoe_settings set staging_ai_mode=false;
alter table public.zoe_settings enable trigger zoe_settings_guard;
select pg_temp.ok(pg_temp.reserve((select (v#>>'{}')::uuid from kv where k='run'),0.001,false,'low','anthropic/claude-haiku-5.5')->>'code'='model_calls_not_permitted','Not staging, no signed DPA: the call is refused even with calls on');
-- DPA path: only the provider with a signed agreement may be called.
update public.zoe_model_providers set data_agreement='signed'where provider='anthropic';
select pg_temp.ok(pg_temp.reserve((select (v#>>'{}')::uuid from kv where k='run'),0.001,false,'low','openai/gpt-6-luna')->>'code'='model_calls_not_permitted','DPA path: an unsigned provider (the fallback) is refused');
do $$begin update public.zoe_settings set direct_answers_enabled=true;raise exception 'FAIL: settings change accepted with an unsigned configured provider';exception when check_violation then null;end$$;
select pg_temp.ok(pg_temp.reserve((select (v#>>'{}')::uuid from kv where k='run'),0.001,false,'low','anthropic/claude-haiku-5.5')->>'ok'='true','DPA path: a signed provider''s model is reserved');
update public.zoe_model_providers set data_agreement='none';
alter table public.zoe_settings disable trigger zoe_settings_guard;
update public.zoe_settings set staging_ai_mode=true;
alter table public.zoe_settings enable trigger zoe_settings_guard;
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.spend.reserve'and reason_code='model_calls_not_permitted'and attributes->>'noreon.zoe.staging_ai_mode'='false'),'Refusal traced with the staging flag');

-- Lab reading uses the same gate (the reservation calls the same helper).
select pg_temp.ok((select prosrc ~ '_zoe_real_calls_permitted\(p_model\)' from pg_proc where proname='lab_ai_call_reserve'),'Lab reading reserves through the same staging/DPA gate');

-- 3. Direct answers ---------------------------------------------------------------------------------------------
-- Off: an answered result is kept as a summary only, nothing stored or queued.
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run'),pg_temp.answer('You can find visit times under Care plan.'))->>'outcome'='summary_only','Direct answers off: nothing sent');
select pg_temp.ok((select reason_code='direct_answers_off'from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='run'))
 and not exists(select 1 from public.zoe_member_answers)and not exists(select 1 from public.system_messages where template_id='zoe.answer'),'Recorded as direct_answers_off; no answer row, no message');
update public.zoe_settings set direct_answers_enabled=true;
select pg_temp.say('1101',8911,'Thanks. And where do I record a reading?');
insert into kv values('c2',pg_temp.claim());
select pg_temp.ok((select (v->0->>'directAnswers')::boolean from kv where k='c2'),'Job carries the switch (on)');
insert into kv select 'run2',v->0->'runId'from kv where k='c2';
select pg_temp.ok(pg_temp.reserve((select (v#>>'{}')::uuid from kv where k='run2'),0.001,false,'low','anthropic/claude-haiku-5.5')->>'ok'='true','Staging: the low tier model reserves');
-- Invalid answers are refused outright.
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run2'),pg_temp.answer(repeat('x',701)))->>'code'='invalid','Answer over 700 characters refused');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run2'),pg_temp.answer('Open Progress.',tier=>'high'))->>'code'='invalid','An answer for a non-low tier is refused');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run2'),pg_temp.answer('Open Progress.')-'summary')->>'code'='invalid','An answer without a doctor summary is refused');
-- The stand-in never reaches a member.
insert into kv values('run3',to_jsonb(pg_temp.newrun('d1910000-0000-4000-8000-000000000001',-5)));
update public.zoe_runs set reserved=true,tier='low'where id=(select (v#>>'{}')::uuid from kv where k='run3');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run3'),pg_temp.answer('Fake answer.','noreon.fake'))->>'outcome'='summary_only','Stand-in answer kept as summary only');
select pg_temp.ok((select reason_code='stand_in_answer_not_sent'from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='run3'))and not exists(select 1 from public.zoe_member_answers),'Recorded as stand_in_answer_not_sent; nothing stored');
-- 20261017202157: with the zoe.answer wording unapproved, nothing is answered (the doctor keeps it).
insert into kv values('run8u',to_jsonb(pg_temp.newrun('d1910000-0000-4000-8000-000000000001',-7)));
update public.zoe_runs set reserved=true,tier='low'where id=(select (v#>>'{}')::uuid from kv where k='run8u');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run8u'),pg_temp.answer('Open Care plan.'))->>'outcome'='summary_only','Unapproved answer wording: not answered');
select pg_temp.ok((select reason_code='direct_answer_unapproved'from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='run8u'))and not exists(select 1 from public.zoe_member_answers),'Recorded as direct_answer_unapproved; nothing stored');
update public.system_message_templates set approved=true where template_id='zoe.answer';
-- A real answer: stored, shown to the doctor, queued for Telegram.
insert into kv values('f2',pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run2'),pg_temp.answer('Open Progress and choose to record a reading.')));
select pg_temp.ok((select v->>'outcome'='answered'and v->>'answerId'is not null from kv where k='f2'),'Answered');
select pg_temp.ok((select a.body='Open Progress and choose to record a reading.'and a.provider='vercel.ai_gateway'and a.system_message_id is not null and sm.template_id='zoe.answer'and sm.state='queued'
 and sm.body='Zoe: '||a.body and sm.body_hash=public._system_message_hash('zoe.answer',1,'en','Zoe: '||a.body)from public.zoe_member_answers a join public.system_messages sm on sm.id=a.system_message_id),'Answer stored and queued on the member''s Telegram endpoint, signed "Zoe: " (20261018121002)');
select pg_temp.ok(exists(select 1 from public.conversation_audit where kind='zoe.answered')and not exists(select 1 from public.conversation_trace_events where attributes::text ~ 'record a reading'),'Audited; no answer text in any trace event');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run2'),pg_temp.answer('Another.'))->>'replayed'='true','A repeat finish replays');
select pg_temp.ok((select count(*)=1 from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='run2')),'One answer per run');
-- Free-body claim: held while unapproved (approval withdrawn after the answer); once approved, sent with its own hash.
create function pg_temp.sm_claim(m uuid)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.system_message_claim(m,gen_random_uuid());reset role;return j;end$$;
-- (Approval is one-way in production; the frozen-template trigger is lifted here only to test the claim.)
alter table public.system_message_templates disable trigger system_message_templates_frozen;
update public.system_message_templates set approved=false where template_id='zoe.answer';
alter table public.system_message_templates enable trigger system_message_templates_frozen;
select pg_temp.ok(pg_temp.sm_claim((select system_message_id from public.zoe_member_answers limit 1))->>'code'='template_unapproved','Held until the zoe.answer template is approved');
update public.system_messages set state='queued',reason=null where template_id='zoe.answer';
update public.system_message_templates set approved=true where template_id='zoe.answer';
select pg_temp.ok((select (pg_temp.sm_claim(system_message_id)#>>'{envelope,text}')='Zoe: Open Progress and choose to record a reading.'from public.zoe_member_answers limit 1),'Approved: the answer text is the envelope');
-- Fixed templates still compare their body.
select pg_temp.ok((select not free_body from public.system_message_templates where template_id='telegram.ack'limit 1),'The acknowledgement stays a fixed-body template');
-- The doctor view includes the answer.
select pg_temp.ok((select count(*)=1 from public.zoe_member_answers)and(select body from public.zoe_member_answers)is not null,'Answer row present for zoe_runs_for_doctor');
-- Context: the next claim carries Zoe's answer.
select pg_temp.say('1102',8911,'Thank you');
insert into kv values('c3',pg_temp.claim());
select pg_temp.ok((select v->0->'answers'->0->>'body'='Open Progress and choose to record a reading.'from kv where k='c3'),'Zoe''s earlier answer is in the next job''s context');
-- Stale: the member wrote again after the claim.
insert into kv select 'run4',v->0->'runId'from kv where k='c3';
select pg_temp.ok(pg_temp.reserve((select (v#>>'{}')::uuid from kv where k='run4'),0.001,false,'low','anthropic/claude-haiku-5.5')->>'ok'='true','Reserved');
select pg_temp.say('1103',8911,'One more thing');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run4'),pg_temp.answer('You are welcome.'))->>'outcome'='stale','Stale answer (newer member message)');
select pg_temp.ok((select count(*)=1 from public.zoe_member_answers),'The stale answer is not stored or sent');

-- F1 (#236): the language key is required; a finish without it is refused, never half-stored.
insert into kv values('run6',to_jsonb(pg_temp.newrun('d1910000-0000-4000-8000-000000000001',-6)));
update public.zoe_runs set reserved=true,tier='low'where id=(select (v#>>'{}')::uuid from kv where k='run6');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run6'),pg_temp.answer('Open Care plan.')-'language')->>'code'='invalid','An answer without its language is refused');
-- F4 (#236), now shown in the app (20261017202157): an answer to an app message is stored, with no Telegram message.
update public.conversations set version=version+1 where member_id='d1910000-0000-4000-8000-000000000001';
insert into public.conversation_messages(conversation_id,seq,author_id,body,source,request_id)
 select id,version,member_id,'Where are my visit times? (app)','authenticated_member',gen_random_uuid()from public.conversations where member_id='d1910000-0000-4000-8000-000000000001';
insert into kv values('run7',to_jsonb(pg_temp.newrun('d1910000-0000-4000-8000-000000000001',(select version from public.conversations where member_id='d1910000-0000-4000-8000-000000000001'))));
update public.zoe_runs set reserved=true,tier='low'where id=(select (v#>>'{}')::uuid from kv where k='run7');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run7'),pg_temp.answer('Open Care plan.'))->>'outcome'='answered','App message: answered');
select pg_temp.ok((select system_message_id is null from public.zoe_member_answers where run_id=(select (v#>>'{}')::uuid from kv where k='run7'))
 and(select detail->>'channel'='app'from public.conversation_audit where kind='zoe.answered'and detail->>'runId'=(select v#>>'{}' from kv where k='run7')),'Stored for the app thread; nothing queued for Telegram');
-- F5 (#236): expired evals do not block other settings changes while calls stay on; switching on again re-checks.
update public.zoe_eval_runs set created_at=created_at-interval '8 days';
update public.zoe_settings set daily_spend_cap_usd=5;
update public.zoe_settings set direct_answers_enabled=false;
select pg_temp.ok((select daily_spend_cap_usd=5 and not direct_answers_enabled from public.zoe_settings),'Cap and switches can change after the evals expired');
update public.zoe_settings set model_calls_allowed=false;
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: switched on again with expired evals';exception when check_violation then null;end$$;
update public.zoe_eval_runs set created_at=now()where mode='model'and must_failures=0;
update public.zoe_settings set model_calls_allowed=true,direct_answers_enabled=true,daily_spend_cap_usd=10;

-- 4. Urgent: the fixed urgent template is queued for a Telegram message; nothing reaches a model -------------
select pg_temp.say('1104',8911,'Is my visit tomorrow?');
insert into kv values('c4',pg_temp.claim());
insert into kv select 'run5',v->0->'runId'from kv where k='c4';
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run5'),jsonb_build_object('outcome','discarded','reason','urgent_route_no_model_call','summary',null,'draft',null,'answer',null,
 'guardReasons','[]'::jsonb,'redactionCount',0,'usage',null,'costUsd',0,'latencyMs',null,'provider','none','model','none','sealed',null,'tier','none','tierReason','not_routed','fallbackUsed',false,'events','[]'::jsonb))->>'outcome'='discarded','Urgent discard recorded');
select pg_temp.ok(exists(select 1 from public.system_messages where template_id='zoe.urgent'and state='queued')
 and (select not reserved and cost_usd is null from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='run5')),'Urgent template queued (held until approved); no reservation, no cost');
select pg_temp.ok((select bool_and(not approved)from public.system_message_templates where template_id='zoe.urgent'),'Urgent placeholder wording is not approved by the migration');

-- 6. Rollback as written in docs/operations/staging-ai-mode.sql section R (keep the two in step) ----------
update public.system_message_templates set approved=true where template_id='zoe.urgent';
select pg_temp.ok(exists(select 1 from public.system_messages where template_id='zoe.urgent'and state='queued'),'An urgent placeholder is queued before the rollback');
do $$begin update public.system_message_templates set approved=false where template_id='zoe.answer';raise exception 'FAIL: approval withdrawn in place';exception when sqlstate '55000' then null;end$$;
update public.zoe_settings set model_calls_allowed=false,direct_answers_enabled=false,staging_ai_mode=false;
insert into public.system_message_templates(template_id,version,locale,body,free_body,approved,approval_note)
 select t.template_id,t.version+1,t.locale,t.body,t.free_body,false,'Staging AI mode ended: withdrawn'from public.system_message_templates t
 where t.template_id in('zoe.answer','zoe.urgent')and t.version=(select max(x.version)from public.system_message_templates x where x.template_id=t.template_id and x.locale=t.locale)
 on conflict do nothing;
update public.system_messages set state='held',reason='template_withdrawn',state_seq=state_seq+1,updated_at=clock_timestamp()
 where template_id in('zoe.answer','zoe.urgent')and state='queued';
select pg_temp.ok((select not model_calls_allowed and not direct_answers_enabled and not staging_ai_mode from public.zoe_settings),'Rollback: every switch off');
select pg_temp.ok(not exists(select 1 from public.system_messages where template_id in('zoe.answer','zoe.urgent')and state='queued'),'Rollback: nothing Zoe queued is left to send');
select pg_temp.ok((select count(*)=4 and bool_and(not approved)from public.system_message_templates t where t.template_id in('zoe.answer','zoe.urgent')
 and t.version=(select max(x.version)from public.system_message_templates x where x.template_id=t.template_id and x.locale=t.locale)),'Rollback: an unapproved newest version for both templates, both locales');
-- After the rollback a new urgent placeholder takes the withdrawn newest version and is held at claim; an answer can no longer be stored.
select pg_temp.say('1105',8911,'Is my visit at nine?');
insert into kv values('c6',pg_temp.claim());
insert into kv select 'run8',v->0->'runId'from kv where k='c6';
select pg_temp.finish((select (v#>>'{}')::uuid from kv where k='run8'),jsonb_build_object('outcome','discarded','reason','urgent_route_no_model_call','summary',null,'draft',null,'answer',null,'language',null,
 'guardReasons','[]'::jsonb,'redactionCount',0,'usage',null,'costUsd',0,'latencyMs',null,'provider','none','model','none','sealed',null,'tier','none','tierReason','not_routed','fallbackUsed',false,'events','[]'::jsonb));
select pg_temp.ok((select s.template_version=(select max(x.version)from public.system_message_templates x where x.template_id='zoe.urgent'and x.locale=s.locale)from public.system_messages s where s.template_id='zoe.urgent'and s.state='queued'),'New urgent placeholder uses the withdrawn newest version');
select pg_temp.ok(pg_temp.sm_claim((select id from public.system_messages where template_id='zoe.urgent'and state='queued'))->>'code'='template_unapproved','and is held at claim');
select pg_temp.ok(pg_temp.reserve(gen_random_uuid(),0.001,false,'low','anthropic/claude-haiku-5.5')->>'code'in('run_not_reservable','model_calls_not_permitted'),'Rollback: no real call can reserve');

-- 5. Grants -------------------------------------------------------------------------------------------------------------
select pg_temp.ok(not has_table_privilege('authenticated','public.zoe_member_answers','select')and not has_table_privilege('service_role','public.zoe_member_answers','select'),'No direct table access to answers');
select pg_temp.ok(not has_function_privilege('authenticated','public._zoe_real_calls_permitted(text)','execute')and not has_function_privilege('authenticated','public._zoe_answer_enqueue(uuid,uuid,text)','execute'),'Helpers not callable by members');
rollback;
select 'PASS staging AI mode: gate needs staging or signed DPA plus model-mode evals per tier; per-call recheck; caps unchanged; direct answers stored, queued, never stand-in, stale or non-low; urgent template' as result;
