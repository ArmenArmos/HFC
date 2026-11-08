-- Zoe reply judge (20261018153754): the one reservation per run covers the judge too. The judge model's
-- real-call permission is checked like the speaker's, a judge equal to the speaker is refused, a per-member
-- daily cap (US$3) is enforced inside the spend lock, the 6-argument call still works, and grants are
-- service-role only. Rolled back. Synthetic fixtures only; no Telegram, network or provider.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.as_service()returns void language plpgsql as $$begin perform set_config('request.jwt.claims','{"role":"service_role"}',true);end$$;
create function pg_temp.principal(u bigint)returns text language sql as $$select format('["telegram","noreon_rjg",9027,"user",%s]',u)$$;
create function pg_temp.event(id text,u bigint,txt text)returns jsonb language sql as $$
 select jsonb_build_object('adapter','telegram','eventId',format('["telegram","noreon_rjg",9027,"update",%s]',id),'fingerprint','fp-'||id,'principalRef',pg_temp.principal(u),'kind','text','payload',jsonb_build_object('text',txt,'chatId',u,'messageId',id::bigint))
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

insert into auth.users(id,phone,phone_confirmed_at)values('d1920000-0000-4000-8000-000000000001','37499019201',now()),('d1920000-0000-4000-8000-000000000002',null,null),('d1920000-0000-4000-8000-000000000003',null,null);
insert into public.workspace_clinics(id,name)values('d1920000-0000-4000-8000-000000000004','Synthetic staging AI clinic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('d1920000-0000-4000-8000-000000000002','doctor','Dr Staging Synthetic','d1920000-0000-4000-8000-000000000004');
insert into public.workspace_staff(user_id,role,display_name)values('d1920000-0000-4000-8000-000000000003','admin','Admin Staging Synthetic');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('d1920000-0000-4000-8000-000000000001','d1920000-0000-4000-8000-000000000002');
update public.profiles set locale='en',display_name='Staging Member'where id='d1920000-0000-4000-8000-000000000001';
insert into public.telegram_channel_settings(account,bot_id,link_token_seconds,consent_version)values('noreon_rjg',9027,600,'consent-r');
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,intake_max_messages,synthetic_engine,delivery_enabled)values(true,'synthetic-rjg',3600,600,60,20,false,true);
select pg_temp.link('d1920000-0000-4000-8000-000000000001',8921);
insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-1');
insert into public.zoe_consents(member_id,kind,granted,wording_version)values('d1920000-0000-4000-8000-000000000001','zoe_reads_messages',true,'zoe-consent-draft-1');

-- 1. Off by default; the switch needs a basis AND passing model-mode evals ----------------------------
select pg_temp.ok((select not model_calls_allowed and not staging_ai_mode and not direct_answers_enabled from public.zoe_settings),'Everything off by default');
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: calls on with no basis';exception when check_violation then null;end$$;
update public.zoe_settings set staging_ai_mode=true;
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: calls on without a model-mode eval';exception when check_violation then
 if sqlerrm !~ 'eval' then raise exception 'FAIL: wrong refusal %',sqlerrm;end if;end$$;
-- A plumbing-mode or failing eval does not count.
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'plumbing','test',300,0,0,'d1920000-0000-4000-8000-000000000003'from public.zoe_tier_config;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','test',300,1,1,'d1920000-0000-4000-8000-000000000003'from public.zoe_tier_config;
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: plumbing or failing eval accepted';exception when check_violation then null;end$$;
-- Passing model-mode evals for two tiers only: still refused, naming the missing tier.
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','test',300,0,2,'d1920000-0000-4000-8000-000000000003'from public.zoe_tier_config where tier<>'high';
do $$begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: a tier without an eval accepted';exception when check_violation then
 if sqlerrm !~ 'high' then raise exception 'FAIL: missing tier not named %',sqlerrm;end if;end$$;
insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,requested_by)
 select tier,model_id,fallback_model_id,'model','test',300,0,0,'d1920000-0000-4000-8000-000000000003'from public.zoe_tier_config where tier='high';
update public.zoe_settings set model_calls_allowed=true;
select pg_temp.ok((select model_calls_allowed from public.zoe_settings),'Staging plus passing model-mode evals: calls may be switched on');

create function pg_temp.rsv(run uuid,est numeric,loc boolean,model text,judge text)returns jsonb language plpgsql as $$declare j jsonb;begin
 perform pg_temp.as_service();set local role service_role;j:=public.zoe_run_reserve(run,est,loc,'[]','low',model,judge);reset role;return j;end$$;
create function pg_temp.mrun(seq bigint)returns uuid language sql as $$select pg_temp.newrun('d1920000-0000-4000-8000-000000000001',seq)$$;
select pg_temp.say('1200',8921,'Hello');
update public.zoe_tier_config set daily_cap_usd=5 where tier='low';
update public.zoe_settings set daily_spend_cap_usd=10;

-- 1. Grants and signature ----------------------------------------------------------------------------------
select pg_temp.ok(not exists(select 1 from pg_proc where proname='zoe_run_reserve'and pronargs=6),'The 6-argument function is gone (one signature)');
select pg_temp.ok(has_function_privilege('service_role','public.zoe_run_reserve(uuid,numeric,boolean,jsonb,text,text,text)','execute')
 and not has_function_privilege('authenticated','public.zoe_run_reserve(uuid,numeric,boolean,jsonb,text,text,text)','execute')
 and not has_function_privilege('anon','public.zoe_run_reserve(uuid,numeric,boolean,jsonb,text,text,text)','execute'),'Only the service role may reserve');

-- 2. Judge model rules --------------------------------------------------------------------------------------
insert into kv values('r1',to_jsonb(pg_temp.mrun(-1)));
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r1'),0.001,false,'anthropic/claude-haiku-5.5','anthropic/claude-haiku-5.5')->>'code'='invalid','A judge equal to the speaker is refused');
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r1'),0.001,false,'anthropic/claude-haiku-5.5','Bad Model!')->>'code'='invalid','A malformed judge model id is refused');
-- A configured speaker with a judge whose provider is not permitted: staging off, only anthropic signed.
alter table public.zoe_settings disable trigger zoe_settings_guard;
update public.zoe_settings set staging_ai_mode=false;
alter table public.zoe_settings enable trigger zoe_settings_guard;
update public.zoe_model_providers set data_agreement='signed'where provider='anthropic';
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r1'),0.001,false,'anthropic/claude-haiku-5.5','openai/gpt-6-luna')->>'code'='judge_calls_not_permitted','A judge on an unsigned provider is refused (no way around the data-agreement gate)');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.spend.reserve'and reason_code='judge_calls_not_permitted'and attributes->>'noreon.zoe.judge_model'='openai/gpt-6-luna'and rule_id='zoe.k2.launch_gate'),'Judge refusal traced with the judge model under the launch gate');
select pg_temp.ok((select not reserved from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='r1')),'A refused reservation reserves nothing');
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r1'),0.001,false,'anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5')->>'ok'='true','A permitted judge on another model reserves');
update public.zoe_model_providers set data_agreement='none';
alter table public.zoe_settings disable trigger zoe_settings_guard;
update public.zoe_settings set staging_ai_mode=true;
alter table public.zoe_settings enable trigger zoe_settings_guard;
-- The 6-argument call (no judge) still works.
insert into kv values('r2',to_jsonb(pg_temp.mrun(-2)));
select pg_temp.ok((select j->>'ok'='true'from(select public.zoe_run_reserve((select (v#>>'{}')::uuid from kv where k='r2'),0.001,true,'[]','low','noreon-fake-deterministic-1')j from(select pg_temp.as_service())x)y),'The 6-argument call reserves (judge defaults to none)');

-- 3. Per-member daily cap: admission uses existing spend, never the incoming estimate --------------------
select pg_temp.ok((select member_daily_cap_usd=3.00 from public.zoe_settings where singleton),'Member cap defaults to US$3');
do $$begin update public.zoe_settings set member_daily_cap_usd=10.5;raise exception 'FAIL: member cap above US$10';exception when check_violation then null;end$$;
-- Real settled spend is US$1.31; the local fixture costs nothing.
update public.zoe_runs set cost_usd=case when id=(select (v#>>'{}')::uuid from kv where k='r1')then 1.31 else 0 end
 where id in(select (v#>>'{}')::uuid from kv where k in('r1','r2'));
insert into kv values('r3',to_jsonb(pg_temp.mrun(-3)));
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r3'),1.79,false,'anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5')->>'ok'='true','US$1.31 real spend plus US$1.79 estimate passes the US$3 member cap');
-- A reservation whose worker exits before making a call settles at zero, not its estimate.
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r3'),
 '{"outcome":"summary_only","reason":"doctor_mode_no_model_call","provider":"none","model":"none","costUsd":0,"usage":null}') ->>'ok'='true','A reserved run can finish without a model call');
select pg_temp.ok((select reserved and state='finished'and cost_usd=0 from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='r3')),'A completed no-call run keeps no estimated liability');
select pg_temp.as_service();
select pg_temp.ok((public.zoe_run_context(array[(select (v#>>'{}')::uuid from kv where k='r2')])->0->>'memberSpentTodayUsd')::numeric=1.31,'The early worker check also sees only US$1.31 after the no-call finish');
-- An actual call with unknown price keeps its estimate even after finishing.
insert into kv values('r4',to_jsonb(pg_temp.mrun(-4)));
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r4'),1.69,false,'anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5')->>'ok'='true','Below the cap another call reserves');
select pg_temp.ok(pg_temp.finish((select (v#>>'{}')::uuid from kv where k='r4'),
 '{"outcome":"no_output","reason":"provider_timeout","provider":"vercel.ai_gateway","model":"anthropic/claude-haiku-5.5","usage":{"inputTokens":900,"outputTokens":0}}')->>'ok'='true','A real call can finish without a known price');
select pg_temp.ok((select state='finished'and cost_usd is null and estimate_usd=1.69 from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='r4')),'Unknown real-call cost stays unknown');
select pg_temp.as_service();
select pg_temp.ok((public.zoe_run_context(array[(select (v#>>'{}')::uuid from kv where k='r2')])->0->>'memberSpentTodayUsd')::numeric=3,'The real unpriced call still counts at its estimate');
insert into kv values('r5',to_jsonb(pg_temp.mrun(-5)));
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r5'),0.01,false,'anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5')->>'code'='member_spend_cap_reached','Spend exactly at US$3 refuses');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where reason_code='member_spend_cap_reached'and (attributes->>'noreon.zoe.member_cap_usd')::numeric=3),'Member cap refusal is traced');
update public.zoe_runs set cost_usd=1.70 where id=(select (v#>>'{}')::uuid from kv where k='r4');
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r5'),0.01,false,'anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5')->>'code'='member_spend_cap_reached','Spend above the cap also refuses');
-- Local stand-ins remain exempt from the member check.
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r5'),0.01,true,'noreon-fake-deterministic-1','noreon.fake-judge')->>'ok'='true','Local runs are not member-capped');
-- Shared caps require room for US$0.25 of a large incoming estimate. Member spend is below its cap here.
update public.zoe_runs set cost_usd=0.69 where id=(select (v#>>'{}')::uuid from kv where k='r4');
insert into kv values('r6',to_jsonb(pg_temp.mrun(-6)));
update public.zoe_tier_config set daily_cap_usd=2.2 where tier='low';
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r6'),3,false,'anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5')->>'code'='tier_spend_cap_reached','The tier cap refuses with less than US$0.25 left');
update public.zoe_tier_config set daily_cap_usd=5 where tier='low';
update public.zoe_settings set daily_spend_cap_usd=2.2;
select pg_temp.ok(pg_temp.reserve((select (v#>>'{}')::uuid from kv where k='r6'),1.1,true,'high','noreon-fake-deterministic-1')->>'code'='daily_spend_cap_reached','The global cap refuses with less than US$0.25 left across tiers');
update public.zoe_settings set daily_spend_cap_usd=10;
-- Yesterday's liabilities do not count.
update public.zoe_runs set spend_day=spend_day-1 where member_id='d1920000-0000-4000-8000-000000000001'and id<>(select (v#>>'{}')::uuid from kv where k='r6');
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r6'),0.4,false,'anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5')->>'ok'='true','The member cap is per Yerevan day');
-- The effective member cap is still bounded by the global setting.
update public.zoe_settings set daily_spend_cap_usd=2;
insert into kv values('r7',to_jsonb(pg_temp.mrun(-7)));
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r7'),0.01,false,'anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5')->>'ok'='true','Within both caps reserves');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where reason_code='within_daily_spend_cap'and (attributes->>'noreon.zoe.member_cap_usd')::numeric=2),'The member cap is never above the global cap');
update public.zoe_settings set daily_spend_cap_usd=10;
select pg_temp.as_service();
select pg_temp.ok((public.zoe_run_context(array[(select (v#>>'{}')::uuid from kv where k='r7')])->0->>'memberDailyCapUsd')::numeric=3,'The run context carries the cap');
-- A lost worker has no settled price and may have called a model before dying. Absence of a trace is not zero spend.
update public.zoe_settings set daily_spend_cap_usd=10;
insert into kv values('r8',to_jsonb(pg_temp.mrun(-8)));
select pg_temp.ok(pg_temp.rsv((select (v#>>'{}')::uuid from kv where k='r8'),1.79,false,'anthropic/claude-haiku-5.5','anthropic/claude-sonnet-5.5')->>'ok'='true','A run reserves before its worker is lost');
update public.zoe_runs set started_at=clock_timestamp()-interval '11 minutes'where id=(select (v#>>'{}')::uuid from kv where k='r8');
select pg_temp.claim();
select pg_temp.ok((select state='finished'and reason_code='worker_lost'and reserved and cost_usd is null from public.zoe_runs where id=(select (v#>>'{}')::uuid from kv where k='r8')),'Lost-worker liability is retained until its price is known');
-- The check runs under the shared spend lock (no snapshot race between two runs of one member).
select pg_temp.ok((select prosrc ~ 'pg_advisory_xact_lock\(hashtextextended\(''zoe-spend-cap'',0\)\);[\s\S]*member_spent' from pg_proc where proname='zoe_run_reserve'),'Member spend is read after the spend lock is taken');
rollback;
