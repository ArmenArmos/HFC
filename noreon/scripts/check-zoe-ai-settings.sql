-- Zoe AI settings and tier routing: admin-only access, eval-gated changes, append-only audit,
-- rollback, the locked DB switch, and per-tier plus total spend caps. Rolled back; synthetic only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
-- Runs one expression as a role with JWT claims; returns its value, or {"sqlstate":...} on error.
create function pg_temp.run(r text,claims jsonb,stmt text)returns jsonb language plpgsql as $$
declare j jsonb;
begin
 perform set_config('request.jwt.claims',claims::text,true);
 execute format('set local role %I',r);
 execute 'select to_jsonb(('||stmt||'))'into j;
 reset role;return j;
exception when others then reset role;return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);
end$$;
-- Staff RPCs need a password session that exists (the session id is the user id here).
create function pg_temp.who(u text)returns jsonb language sql as $$select jsonb_build_object('sub',u,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',u)$$;
create function pg_temp.svc(stmt text)returns jsonb language sql as $$select pg_temp.run('service_role','{"role":"service_role"}',stmt)$$;
create function pg_temp.adm(u text,stmt text)returns jsonb language sql as $$select pg_temp.run('authenticated',pg_temp.who(u),stmt)$$;
create function pg_temp.eval(admin text,tier text,model text,fallback text,mode text default 'plumbing',total integer default 279,mf integer default 0)returns uuid language sql as $$
 select (pg_temp.svc(format('public.zoe_eval_run_record(%L,%L,%L,%L,%L,%L,%s,%s,%s,%L)',admin,tier,model,fallback,mode,'zoe-test+rows-'||total,total,mf,mf,'{}'))->>'id')::uuid$$;
create function pg_temp.ver(t text)returns integer language sql as $$select version from public.zoe_tier_config where tier=t$$;

-- Admins A and B, a doctor, a member with a conversation.
insert into auth.users(id)values('a1700000-0000-4000-8000-000000000001'),('a1700000-0000-4000-8000-000000000002'),('a1700000-0000-4000-8000-000000000003'),('a1700000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)select id,id,now(),now()from auth.users where id::text like 'a1700000-0000-4000-8000-00000000000_';
insert into public.workspace_clinics(id,name)values('a1700000-0000-4000-8000-000000000009','Synthetic AI settings clinic');
insert into public.workspace_staff(user_id,role,display_name)values('a1700000-0000-4000-8000-000000000001','admin','Admin A Synthetic'),('a1700000-0000-4000-8000-000000000002','admin','Admin B Synthetic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('a1700000-0000-4000-8000-000000000003','doctor','Dr Synthetic','a1700000-0000-4000-8000-000000000009');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('a1700000-0000-4000-8000-000000000004','a1700000-0000-4000-8000-000000000003');
insert into public.conversations(id,member_id)values('a1700000-0000-4000-8000-000000000010','a1700000-0000-4000-8000-000000000004');
insert into public.zoe_settings(singleton)values(true)on conflict do nothing;
update public.zoe_settings set daily_spend_cap_usd=10;
create temp table k(n text primary key,v text);
grant all on k to authenticated,service_role;

-- Seeded defaults: three tiers, the limits add up to the US$10 total, real calls locked off.
select pg_temp.ok((select count(*)=3 and sum(daily_cap_usd)=10 from public.zoe_tier_config),'Three tiers seeded; limits add up to US$10');
select pg_temp.ok((select model_id='anthropic/claude-opus-5.5'and fallback_model_id='openai/gpt-6-astra'from public.zoe_tier_config where tier='high'),'High tier defaults to the strongest model with a strong fallback');

-- 1. Admin-only access ---------------------------------------------------------------------------------
select pg_temp.ok(pg_temp.run('anon','{"role":"anon"}','public.zoe_ai_settings_admin()')->>'sqlstate'='42501','Anon cannot read AI settings');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000003','public.zoe_ai_settings_admin()')->>'sqlstate'='42501','A doctor cannot read AI settings');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000003','public.zoe_tier_config_apply(gen_random_uuid(),1,1,null)')->>'sqlstate'='42501','A doctor cannot apply a change');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000003','public.zoe_tier_config_rollback(1,1,null)')->>'sqlstate'='42501','A doctor cannot roll back');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',$s$public.zoe_eval_run_record('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-fable-5.1',null,'plumbing','x',279,0,0,'{}')$s$)->>'sqlstate'='42501','An admin cannot record an eval result directly (server only)');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001','public.zoe_route_config()')->>'sqlstate'='42501','An admin cannot call the worker route read');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',$s$public.zoe_run_reserve(gen_random_uuid(),0,true,'[]','low','x')$s$)->>'sqlstate'='42501','An admin cannot reserve spend');
select pg_temp.ok(pg_temp.svc('public.zoe_ai_settings_admin()')->>'sqlstate'='42501','The service role has no admin read');
select pg_temp.ok(pg_temp.run(r,pg_temp.who('a1700000-0000-4000-8000-000000000001'),format('(select count(*)from public.%I)',t))->>'sqlstate'='42501','No direct table access: '||r||' '||t)
 from unnest(array['anon','authenticated','service_role'])r,unnest(array['zoe_model_catalog','zoe_tier_config','zoe_eval_runs','zoe_tier_config_changes'])t;
insert into k values('read',pg_temp.adm('a1700000-0000-4000-8000-000000000001','public.zoe_ai_settings_admin()')::text);
select pg_temp.ok((select (v::jsonb->>'ok')='true'and jsonb_array_length(v::jsonb->'tiers')=3 and (v::jsonb->>'modelCallsAllowed')='false'and (v::jsonb->>'totalCapUsd')::numeric=10 from k where n='read'),'An admin reads tiers, the locked switch and the US$10 total');

-- 2. Eval runs are recorded by the server for an active admin only --------------------------------------
select pg_temp.ok(pg_temp.svc($s$public.zoe_eval_run_record('a1700000-0000-4000-8000-000000000003','high','anthropic/claude-fable-5.1',null,'plumbing','x',279,0,0,'{}')$s$)->>'code'='not_admin','An eval for a non-admin is refused');
select pg_temp.ok(pg_temp.svc($s$public.zoe_eval_run_record('a1700000-0000-4000-8000-000000000001','high','openai/gpt-9-unknown',null,'plumbing','x',279,0,0,'{}')$s$)->>'code'='invalid','A model off the allow-list cannot even be evaluated');

-- 3. A change takes effect only through a passing, fresh, unused eval of this admin ---------------------
insert into k values('good',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-fable-5.1','anthropic/claude-opus-5.5'));
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000002',format('public.zoe_tier_config_apply(%L,5,1,null)',(select v from k where n='good')))->>'code'='eval_unknown','Another admin cannot use this eval');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,7,null)',(select v from k where n='good')))->>'code'='stale','A stale version is refused');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,10.5,1,null)',(select v from k where n='good')))->>'code'='invalid','A tier limit above US$10 is refused');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,1,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-fable-5.1',null,'plumbing',279,1)))->>'code'='eval_not_passed','A MUST failure blocks the change');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,1,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-fable-5.1',null,'plumbing',200,0)))->>'code'='eval_not_passed','A truncated eval set (under 262 rows) blocks the change');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,1,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-fable-5.1',null,'model')))->>'code'='eval_mode_mismatch','While calls are off only a plumbing eval counts (and vice versa later)');
insert into k values('old',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-fable-5.1',null));
update public.zoe_eval_runs set created_at=clock_timestamp()-interval '20 minutes'where id=(select v::uuid from k where n='old');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,1,null)',(select v from k where n='old')))->>'code'='eval_expired','An eval older than 15 minutes is refused');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,1,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-haiku-5.5',null)))->>'code'='model_not_allowed','A small model cannot serve the high tier (never down)');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,1,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-opus-5.5','openai/gpt-6-luna')))->>'code'='model_not_allowed','A small fallback cannot serve the high tier');
select pg_temp.ok(pg_temp.ver('high')=1 and(select model_id='anthropic/claude-opus-5.5'from public.zoe_tier_config where tier='high'),'Refused changes left the tier as it was');
insert into k values('applied',pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,1,%L)',(select v from k where n='good'),'Try Fable for clinical questions'))::text);
select pg_temp.ok((select (v::jsonb->>'ok')='true'and (v::jsonb->>'version')::int=2 from k where n='applied'),'A passing eval applies the change');
select pg_temp.ok((select model_id='anthropic/claude-fable-5.1'and fallback_model_id='anthropic/claude-opus-5.5'and daily_cap_usd=5 and version=2 and updated_by='a1700000-0000-4000-8000-000000000001'from public.zoe_tier_config where tier='high'),'The tier now uses the new model, fallback and limit');
select pg_temp.ok((select action='apply'and before->>'model'='anthropic/claude-opus-5.5'and after->>'model'='anthropic/claude-fable-5.1'and (before->>'dailyCapUsd')::numeric=6 and eval_run_id=(select v::uuid from k where n='good')
 and actor='a1700000-0000-4000-8000-000000000001'and reason='Try Fable for clinical questions'from public.zoe_tier_config_changes where id=(select (v::jsonb->>'changeId')::bigint from k where n='applied')),'The change is audited with before, after, eval, actor and reason');
select pg_temp.ok((select used_at is not null from public.zoe_eval_runs where id=(select v::uuid from k where n='good')),'The eval is marked used');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,2,null)',(select v from k where n='good')))->>'code'='eval_already_used','An eval applies one change only');

-- 4. Audit is append-only -------------------------------------------------------------------------------
do $$begin
 begin update public.zoe_tier_config_changes set reason='edited';raise exception 'FAIL: change history updated';exception when sqlstate '55000'then null;end;
 begin delete from public.zoe_tier_config_changes;raise exception 'FAIL: change history deleted';exception when sqlstate '55000'then null;end;
 begin delete from public.zoe_eval_runs;raise exception 'FAIL: eval runs deleted';exception when sqlstate '55000'then null;end;
end$$;

-- 5. Rollback restores the configuration before a change, audited, no eval needed ----------------------
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_rollback(%s,1,null)',(select v::jsonb->>'changeId'from k where n='applied')))->>'code'='stale','Rollback on a stale version is refused');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000002','public.zoe_tier_config_rollback(999999,2,null)')->>'code'='change_unknown','Unknown change');
insert into k values('rolled',pg_temp.adm('a1700000-0000-4000-8000-000000000002',format('public.zoe_tier_config_rollback(%s,2,%L)',(select v::jsonb->>'changeId'from k where n='applied'),'Back to Opus'))::text);
select pg_temp.ok((select (v::jsonb->>'ok')='true'and (v::jsonb->>'version')::int=3 from k where n='rolled'),'Rollback succeeds');
select pg_temp.ok((select model_id='anthropic/claude-opus-5.5'and fallback_model_id='openai/gpt-6-astra'and daily_cap_usd=6 and version=3 from public.zoe_tier_config where tier='high'),'Rollback restored model, fallback and limit');
select pg_temp.ok((select action='rollback'and rolled_back_change_id=(select (v::jsonb->>'changeId')::bigint from k where n='applied')and before->>'model'='anthropic/claude-fable-5.1'and after->>'model'='anthropic/claude-opus-5.5'
 and actor='a1700000-0000-4000-8000-000000000002'and eval_run_id is null from public.zoe_tier_config_changes where id=(select (v::jsonb->>'changeId')::bigint from k where n='rolled')),'The rollback is itself audited');
select pg_temp.ok((select jsonb_array_length(v::jsonb->'changes')=0 from k where n='read')and jsonb_array_length(pg_temp.adm('a1700000-0000-4000-8000-000000000001','public.zoe_ai_settings_admin()')->'changes')=2,'History shows both entries');

-- 6. The DB switch stays locked off ---------------------------------------------------------------------
do $$begin
 begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: model calls switched on';exception when check_violation then null;end;
end$$;

-- 7. Spend: real provider refused, per-tier cap, total cap ------------------------------------------------
-- 20261023063508 (Codex A2-3): zoe_run_reserve and zoe_run_finish re-check Zoe consent; the fixture's members consent.
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version=coalesce(consent_wording_version,'zoe-consent-draft-1')where singleton;
insert into public.zoe_consents(member_id,kind,granted,wording_version)select c.member_id,'zoe_reads_messages',true,(select s.consent_wording_version from public.zoe_settings s where s.singleton)
 from public.conversations c where not public._zoe_consent_ok(c.member_id);
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day)
select ('a1700000-0000-4000-8000-0000000001'||lpad(i::text,2,'0'))::uuid,'a1700000-0000-4000-8000-000000000010','a1700000-0000-4000-8000-000000000004',i,0,0,(clock_timestamp()at time zone 'Asia/Yerevan')::date from generate_series(1,7)i;
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000101',0.01,false,'[]','high','anthropic/claude-opus-5.5')$s$)->>'code'='model_calls_not_permitted','A real (non-local) provider is refused while the switch is off');
select pg_temp.ok((select not reserved and tier='high'from public.zoe_runs where id='a1700000-0000-4000-8000-000000000101'),'Nothing is reserved for it');
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000102',0.01,true,'[]','urgent','x')$s$)->>'code'='invalid','There is no urgent tier: urgent words never reach routing');
update public.zoe_tier_config set daily_cap_usd=0.02 where tier='low';
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000102',0.015,true,'[]','low','noreon-fake-deterministic-1')$s$)->>'ok'='true','Within the low tier limit');
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000103',0.015,true,'[]','low','noreon-fake-deterministic-1')$s$)->>'code'='tier_spend_cap_reached','The low tier limit is enforced');
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000104',0.015,true,'[]','medium','noreon-fake-deterministic-1')$s$)->>'ok'='true','Another tier is not affected by the low tier limit');
update public.zoe_settings set daily_spend_cap_usd=0.04;
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000105',0.015,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'code'='daily_spend_cap_reached','The total cap is enforced across tiers');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.spend.reserve'and reason_code='tier_spend_cap_reached'and attributes->>'noreon.zoe.tier'='low'and attributes ? 'noreon.zoe.tier_cap_usd'),'The tier cap refusal is traced with the tier');
update public.zoe_settings set daily_spend_cap_usd=10;

-- Shared caps use settled spend and at most US$0.25 for admission, retaining full in-flight estimates.
select pg_temp.ok(not has_function_privilege(r,'public._ai_cap_room(numeric,numeric,numeric)','execute'),'Cap helper is private to definer functions: '||r)
 from unnest(array['anon','authenticated','service_role'])r;
select pg_temp.ok(public._ai_cap_room(5.75,1.70,6) and not public._ai_cap_room(5.750001,1.70,6),'Exactly US$0.25 room is enough');
select pg_temp.ok(public._ai_cap_room(5.99,0.01,6) and not public._ai_cap_room(5.995,0.01,6),'Small estimates need only their own headroom');
savepoint shared_cap_checks;
update public.zoe_tier_config set daily_cap_usd=6 where tier='high';
update public.zoe_runs set tier='high',cost_usd=4.40 where id='a1700000-0000-4000-8000-000000000102';
update public.zoe_runs set cost_usd=0 where id='a1700000-0000-4000-8000-000000000104';
savepoint before_reserve;
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000106',1.70,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'ok'='true','US$4.40 spent admits a US$1.70 estimate under US$6');
select pg_temp.ok((select reserved and state='started' and estimate_usd=1.70 and cost_usd is null from public.zoe_runs where id='a1700000-0000-4000-8000-000000000106'),'The full US$1.70 estimate is stored in flight');
select pg_temp.ok((select tier_total=6.10 from public._ai_spend((now()at time zone 'Asia/Yerevan')::date,'high')),'Shared spend counts the full in-flight estimate');
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000107',1.70,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'code'='tier_spend_cap_reached','The next run sees the full in-flight estimate');
rollback to savepoint before_reserve;
update public.zoe_runs set cost_usd=5.80 where id='a1700000-0000-4000-8000-000000000102';
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000106',1.70,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'code'='tier_spend_cap_reached','US$5.80 spent refuses under US$6');
update public.zoe_runs set cost_usd=5.70 where id='a1700000-0000-4000-8000-000000000102';
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000106',1.70,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'ok'='true','US$5.70 spent admits under US$6');
rollback to savepoint before_reserve;
-- Existing spend in another tier isolates the total check from the tier check.
update public.zoe_runs set tier='low',cost_usd=8.40 where id='a1700000-0000-4000-8000-000000000102';
savepoint before_total_reserve;
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000106',1.70,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'ok'='true','US$8.40 total admits a US$1.70 estimate under US$10');
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000107',1.70,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'code'='daily_spend_cap_reached','The total cap counts the full in-flight estimate across tiers');
rollback to savepoint before_total_reserve;
update public.zoe_runs set cost_usd=9.80 where id='a1700000-0000-4000-8000-000000000102';
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000106',1.70,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'code'='daily_spend_cap_reached','US$9.80 total refuses under US$10');
update public.zoe_runs set cost_usd=9.70 where id='a1700000-0000-4000-8000-000000000102';
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1700000-0000-4000-8000-000000000106',1.70,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'ok'='true','US$9.70 total admits under US$10');
rollback to savepoint shared_cap_checks;
release savepoint shared_cap_checks;

-- 8. Finish records tier, reason and fallback; a reserved tier cannot be changed afterwards ---------------
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_finish('a1700000-0000-4000-8000-000000000104','{"outcome":"no_output","reason":"provider_timeout","tier":"high","tierReason":"rule_symptom","guardReasons":[],"provider":"vercel.ai_gateway","model":"anthropic/claude-sonnet-5.5","costUsd":0}')$s$)->>'code'='invalid','The tier a run reserved against cannot be rewritten at finish');
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_finish('a1700000-0000-4000-8000-000000000104','{"outcome":"no_output","reason":"provider_timeout","tier":"medium","tierReason":"rule_health_info","fallbackUsed":true,"guardReasons":[],"provider":"vercel.ai_gateway","model":"openai/gpt-6-sol","costUsd":0.002,"usage":{"inputTokens":300,"outputTokens":40}}')$s$)->>'ok'='true','Finish with a Gateway model id');
select pg_temp.ok((select tier='medium'and tier_reason='rule_health_info'and fallback_used and model='openai/gpt-6-sol'and cost_usd=0.002 from public.zoe_runs where id='a1700000-0000-4000-8000-000000000104'),'The run keeps tier, reason, fallback, model and cost');
select pg_temp.ok(exists(select 1 from public.conversation_trace_events where name='zoe.route'and attributes->>'noreon.zoe.run.id'='a1700000-0000-4000-8000-000000000104'
 and attributes->>'noreon.zoe.tier'='medium'and attributes->>'noreon.zoe.tier_reason'='rule_health_info'and attributes->>'noreon.zoe.fallback_used'='true'and attributes->>'gen_ai.request.model'='openai/gpt-6-sol'
 and attributes ? 'gen_ai.usage.input_tokens'and attributes ? 'noreon.zoe.cost_usd'),'The trace shows tier, reason, model, fallback, tokens and cost');
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_finish('a1700000-0000-4000-8000-000000000106','{"outcome":"discarded","reason":"urgent_route_no_model_call","guardReasons":[],"provider":"none","model":"none","costUsd":0}')$s$)->>'ok'='true','Finish an urgent run');
select pg_temp.ok((select tier='none'and not reserved from public.zoe_runs where id='a1700000-0000-4000-8000-000000000106'),'An urgent run has no tier and no reservation');

-- 9. Background model eval jobs: one running at a time, closed with the recorded run, stale ones freed ------
create function pg_temp.start(admin text,tier text,model text)returns jsonb language sql as $$select pg_temp.svc(format('public.zoe_model_eval_start(%L,%L,%L)',admin,tier,model))$$;
create function pg_temp.finish(job text,run text,code text)returns jsonb language sql as $$select pg_temp.svc(format('public.zoe_model_eval_finish(%L,%L,%L)',job,run,code))$$;
delete from public.zoe_model_eval_jobs;
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001','public.zoe_model_eval_start(''a1700000-0000-4000-8000-000000000001'',''low'',''anthropic/claude-haiku-5.5'')')->>'sqlstate'='42501','An admin session cannot start a job directly (service role only)');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000003','public.zoe_model_eval_job_admin()')->>'sqlstate'='42501','A doctor cannot read eval jobs');
select pg_temp.ok(pg_temp.run('anon','{"role":"anon"}','public.zoe_model_eval_job_admin()')->>'sqlstate'='42501','Anon cannot read eval jobs');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001','public.zoe_model_eval_job_admin()')->'job'='null'::jsonb,'No job yet');
select pg_temp.ok(pg_temp.start('a1700000-0000-4000-8000-000000000003','low','anthropic/claude-haiku-5.5')->>'code'='not_admin','A doctor cannot start a model eval');
select pg_temp.ok(pg_temp.start('a1700000-0000-4000-8000-000000000001','low','not/a-model')->>'code'='invalid','An unknown model is refused');
create temp table j1 as select (pg_temp.start('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-opus-5.5')->>'id')::uuid id;
select pg_temp.ok((select id from j1)is not null,'Admin A starts a high-tier job');
select pg_temp.ok(pg_temp.start('a1700000-0000-4000-8000-000000000002','low','anthropic/claude-haiku-5.5')->>'code'='eval_running','A second job, any tier, any admin, is refused while one runs');
select pg_temp.ok((select (pg_temp.adm('a1700000-0000-4000-8000-000000000001','public.zoe_model_eval_job_admin()')->'job'->>'status')='running'),'The page reads the running job');
-- Finish: the eval run must be a model run of the same tier by the same admin.
create temp table e1 as select pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-opus-5.5',null,'model',646,0) id;
create temp table e2 as select pg_temp.eval('a1700000-0000-4000-8000-000000000001','low','anthropic/claude-haiku-5.5',null,'model',400,0) id;
select pg_temp.ok(pg_temp.finish((select id::text from j1),(select id::text from e2),null)->>'code'='invalid','A run of another tier cannot close the job');
select pg_temp.ok(pg_temp.finish((select id::text from j1),(select id::text from e1),null)->>'ok'='true','The recorded run closes the job');
select pg_temp.ok(pg_temp.finish((select id::text from j1),(select id::text from e1),null)->>'code'='not_running','A closed job cannot be closed again');
select pg_temp.ok((select j->>'status'='done'and (j->'result'->>'total')::int=646 and (j->'result'->>'mustFailures')::int=0 from (select pg_temp.adm('a1700000-0000-4000-8000-000000000001','public.zoe_model_eval_job_admin()')->'job' j)x),'The page reads the result');
-- A failed run closes as failed with its code; the slot is free again.
create temp table j2 as select (pg_temp.start('a1700000-0000-4000-8000-000000000002','low','anthropic/claude-haiku-5.5')->>'id')::uuid id;
select pg_temp.ok(pg_temp.finish((select id::text from j2),null,'run_failed')->>'ok'='true','A failed run closes the job');
select pg_temp.ok((select status='failed'and error_code='run_failed'and finished_at is not null and eval_run_id is null from public.zoe_model_eval_jobs where id=(select id from j2)),'Failed with its code');
-- A job left running (the function was stopped) reads as timed out after 15 minutes and frees the slot.
create temp table j3 as select (pg_temp.start('a1700000-0000-4000-8000-000000000001','medium','anthropic/claude-sonnet-5.5')->>'id')::uuid id;
update public.zoe_model_eval_jobs set started_at=clock_timestamp()-interval '30 minutes'where id in((select id from j1),(select id from j2));
update public.zoe_model_eval_jobs set started_at=clock_timestamp()-interval '16 minutes'where id=(select id from j3);
select pg_temp.ok((select j->>'status'='failed'and j->>'errorCode'='timed_out' from (select pg_temp.adm('a1700000-0000-4000-8000-000000000001','public.zoe_model_eval_job_admin()')->'job' j)x),'A stale running job reads as timed out');
select pg_temp.ok(pg_temp.start('a1700000-0000-4000-8000-000000000002','low','anthropic/claude-haiku-5.5')->>'ok'='true','A stale job does not block a new one');
select pg_temp.ok((select status='failed'and error_code='timed_out' from public.zoe_model_eval_jobs where id=(select id from j3)),'The stale job is closed as timed out');
select pg_temp.ok(pg_temp.finish((select id::text from j3),null,'run_failed')->>'code'='not_running','A late finish of a timed-out job changes nothing');
select pg_temp.ok((select count(*)=1 from public.zoe_model_eval_jobs where status='running'),'Exactly one job runs');

-- 19 Oct (AI eval, lead): the high tier's floor is Mid (Sonnet 5.5 may serve it; recommended stays Strongest). Small stays
-- out of medium and high, for primary and fallback; the eval gate is unchanged.
select pg_temp.ok(public._zoe_tier_floor('low')=1 and public._zoe_tier_floor('medium')=2 and public._zoe_tier_floor('high')=2 and public._zoe_tier_rank('high')=3,'Floors low Small, medium and high Mid; high still recommends Strongest');
do $$begin update public.zoe_tier_config set model_id='anthropic/claude-haiku-5.5',fallback_model_id=null where tier='medium';raise exception 'FAIL: a Small model served the medium tier';exception when check_violation then null;end$$;
do $$begin update public.zoe_tier_config set fallback_model_id='anthropic/claude-haiku-5.5' where tier='high';raise exception 'FAIL: a Small fallback served the high tier';exception when check_violation then null;end$$;
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,%s,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-haiku-5.5',null),pg_temp.ver('high')))->>'code'='model_not_allowed','A Small model still cannot serve the high tier');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,%s,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-sonnet-5.5','openai/gpt-6-astra',total=>200),pg_temp.ver('high')))->>'code'='eval_not_passed','A Mid model on the high tier still needs a passing eval');
insert into k values('mid_high',pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,%s,%L)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-sonnet-5.5','openai/gpt-6-astra'),pg_temp.ver('high'),'AI eval 19 Oct: Sonnet for intake'))::text);
select pg_temp.ok((select (v::jsonb->>'ok')='true' from k where n='mid_high'),'With a passing eval a Mid model (Sonnet 5.5) serves the high tier');
select pg_temp.ok((select model_id='anthropic/claude-sonnet-5.5'and fallback_model_id='openai/gpt-6-astra' from public.zoe_tier_config where tier='high'),'The high tier now uses Sonnet 5.5 with the GPT-6 Astra fallback');
select pg_temp.ok((select action='apply'and after->>'model'='anthropic/claude-sonnet-5.5' from public.zoe_tier_config_changes where id=(select (v::jsonb->>'changeId')::bigint from k where n='mid_high')),'The switch is audited');
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_rollback(%s,%s,%L)',(select (v::jsonb->>'changeId')::bigint from k where n='mid_high'),pg_temp.ver('high'),'undo the Sonnet switch'))->>'ok'='true','The switch rolls back without a new eval');
-- Codex review of #336: a Mid fallback on high, and a rollback back to an earlier Mid configuration.
insert into k values('mid_fb',pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,%s,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-opus-5.5','anthropic/claude-sonnet-5.5'),pg_temp.ver('high')))::text);
select pg_temp.ok((select (v::jsonb->>'ok')='true' from k where n='mid_fb')and(select model_id='anthropic/claude-opus-5.5'and fallback_model_id='anthropic/claude-sonnet-5.5' from public.zoe_tier_config where tier='high'),'A Mid fallback serves the high tier with a passing eval');
insert into k values('mid_again',pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,%s,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-sonnet-5.5','openai/gpt-6-astra'),pg_temp.ver('high')))::text);
insert into k values('to_opus',pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,5,%s,null)',pg_temp.eval('a1700000-0000-4000-8000-000000000001','high','anthropic/claude-opus-5.5','openai/gpt-6-astra'),pg_temp.ver('high')))::text);
select pg_temp.ok(pg_temp.adm('a1700000-0000-4000-8000-000000000001',format('public.zoe_tier_config_rollback(%s,%s,%L)',(select (v::jsonb->>'changeId')::bigint from k where n='to_opus'),pg_temp.ver('high'),'back to Sonnet'))->>'ok'='true','A rollback to an earlier Mid configuration on the high tier is accepted');
select pg_temp.ok((select model_id='anthropic/claude-sonnet-5.5'and fallback_model_id='openai/gpt-6-astra' from public.zoe_tier_config where tier='high'),'The rollback restored Sonnet 5.5 on the high tier');

select 'Zoe AI settings checks passed' as result;
rollback;
