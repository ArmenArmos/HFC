-- Zoe model catalog across Gateway providers: new providers are accepted and selectable by the tier
-- configuration, every provider shows its data agreement (all 'none'), and nothing else is relaxed:
-- the DB switch, the eval gate, the never-down rule, the caps and the urgent path. Rolled back; synthetic only.
begin;
create function pg_temp.ok(c boolean,label text)returns void language plpgsql as $$begin if c is distinct from true then raise exception 'FAIL: %',label;end if;end$$;
create function pg_temp.run(r text,claims jsonb,stmt text)returns jsonb language plpgsql as $$
declare j jsonb;
begin
 perform set_config('request.jwt.claims',claims::text,true);
 execute format('set local role %I',r);
 execute 'select to_jsonb(('||stmt||'))'into j;
 reset role;return j;
exception when others then reset role;return jsonb_build_object('sqlstate',sqlstate,'message',sqlerrm);
end$$;
create function pg_temp.who(u text)returns jsonb language sql as $$select jsonb_build_object('sub',u,'role','authenticated','amr',jsonb_build_array(jsonb_build_object('method','password')),'session_id',u)$$;
create function pg_temp.svc(stmt text)returns jsonb language sql as $$select pg_temp.run('service_role','{"role":"service_role"}',stmt)$$;
create function pg_temp.adm(u text,stmt text)returns jsonb language sql as $$select pg_temp.run('authenticated',pg_temp.who(u),stmt)$$;
create function pg_temp.eval(tier text,model text,fallback text)returns uuid language sql as $$
 select (pg_temp.svc(format('public.zoe_eval_run_record(%L,%L,%L,%L,%L,%L,%s,%s,%s,%L)','a1710000-0000-4000-8000-000000000001',tier,model,fallback,'plumbing','zoe-test+rows-279',279,0,0,'{}'))->>'id')::uuid$$;
create function pg_temp.apply(tier text,model text,fallback text,cap numeric)returns jsonb language sql as $$
 select pg_temp.adm('a1710000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,%s,%s,null)',pg_temp.eval(tier,model,fallback),cap,(select version from public.zoe_tier_config where tier=$1)))$$;
create function pg_temp.raises(stmt text)returns text language plpgsql as $$begin execute stmt;return null;exception when others then return sqlstate;end$$;

insert into auth.users(id)values('a1710000-0000-4000-8000-000000000001'),('a1710000-0000-4000-8000-000000000003'),('a1710000-0000-4000-8000-000000000004');
insert into auth.sessions(id,user_id,created_at,updated_at)select id,id,now(),now()from auth.users where id::text like 'a1710000-0000-4000-8000-00000000000_';
insert into public.workspace_clinics(id,name)values('a1710000-0000-4000-8000-000000000009','Synthetic catalog clinic');
insert into public.workspace_staff(user_id,role,display_name)values('a1710000-0000-4000-8000-000000000001','admin','Admin Synthetic');
insert into public.workspace_staff(user_id,role,display_name,clinic_id)values('a1710000-0000-4000-8000-000000000003','doctor','Dr Synthetic','a1710000-0000-4000-8000-000000000009');
insert into public.patient_clinical_cases(user_id,assigned_doctor_id)values('a1710000-0000-4000-8000-000000000004','a1710000-0000-4000-8000-000000000003');
insert into public.conversations(id,member_id)values('a1710000-0000-4000-8000-000000000010','a1710000-0000-4000-8000-000000000004');
insert into public.zoe_settings(singleton)values(true)on conflict do nothing;
update public.zoe_settings set daily_spend_cap_usd=10;

-- 1. Providers and data agreements --------------------------------------------------------------------
select pg_temp.ok((select array_agg(provider order by provider)='{alibaba,amazon,anthropic,deepseek,google,meta,mistral,moonshotai,openai,spacexai,zai}'from public.zoe_model_providers),'Exactly the eleven Gateway providers are listed');
select pg_temp.ok(not exists(select 1 from public.zoe_model_providers where data_agreement<>'none'),'No provider has a data agreement yet');
select pg_temp.ok((select bool_and(exists(select 1 from public.zoe_model_catalog m where m.provider=p.provider and m.enabled))from public.zoe_model_providers p),'Each provider has at least one enabled model');
select pg_temp.ok((select count(*)=26 and count(distinct provider)=11 from public.zoe_model_catalog where enabled),'The catalog has the 7 earlier and 19 new models across all eleven providers');
select pg_temp.ok((select count(*)filter(where strength=1)>=5 and count(*)filter(where strength=2)>=5 and count(*)filter(where strength=3)>=3 from public.zoe_model_catalog where enabled and provider not in('anthropic','openai')),'New providers bring cheap, mid and strong models');
select pg_temp.ok(not exists(select 1 from public.zoe_model_catalog where split_part(model_id,'/',1)<>provider),'Every model id starts with its provider');
select pg_temp.ok(pg_temp.raises($s$insert into public.zoe_model_providers(provider,label,data_agreement)values('acme','Acme','maybe')$s$)='23514','A data agreement must be none, pending or signed');
with x as(insert into public.zoe_model_providers(provider,label)values('acme','Acme')returning data_agreement)
select pg_temp.ok((select data_agreement='none'from x),'A new provider starts with no data agreement');
select pg_temp.ok(pg_temp.raises($s$insert into public.zoe_model_catalog(model_id,label,provider,strength,input_usd_per_mtok,output_usd_per_mtok)values('nobody/model-1','Nobody','nobody',1,1,1)$s$)='23503','A model from an unlisted provider is refused');
select pg_temp.ok(pg_temp.raises($s$insert into public.zoe_model_catalog(model_id,label,provider,strength,input_usd_per_mtok,output_usd_per_mtok)values('google/fake-1','Fake','anthropic',1,1,1)$s$)='23514','A model cannot be filed under another provider');
select pg_temp.ok(pg_temp.raises($s$insert into public.zoe_model_catalog(model_id,label,provider,strength,input_usd_per_mtok,output_usd_per_mtok)values('google/fake-2','Fake','google',4,1,1)$s$)='23514','Strength is still 1 to 3');
select pg_temp.ok(pg_temp.raises($s$insert into public.zoe_model_catalog(model_id,label,provider,strength,input_usd_per_mtok,output_usd_per_mtok)values('google/fake-3','Fake','google',1,0,1)$s$)='23514','A price must still be above zero');

-- 2. The earlier rows and the decided defaults are unchanged ---------------------------------------------
select pg_temp.ok((select count(*)=7 from public.zoe_model_catalog where (model_id,provider,strength,input_usd_per_mtok,output_usd_per_mtok)in(
 ('anthropic/claude-haiku-5.5','anthropic',1,0.10,0.50),('openai/gpt-6-luna','openai',1,0.10,0.50),('anthropic/claude-sonnet-5.5','anthropic',2,2,10),('openai/gpt-6-sol','openai',2,2,10),
 ('anthropic/claude-opus-5.5','anthropic',3,4,20),('openai/gpt-6-astra','openai',3,10,50),('anthropic/claude-fable-5.1','anthropic',3,10,50))and enabled),'The seven earlier models are kept as they were');
select pg_temp.ok((select count(*)=3 from public.zoe_tier_config where (tier,model_id,fallback_model_id,daily_cap_usd,version)in(
 ('low','anthropic/claude-haiku-5.5','openai/gpt-6-luna',1,1),('medium','anthropic/claude-sonnet-5.5','openai/gpt-6-sol',3,1),('high','anthropic/claude-opus-5.5','openai/gpt-6-astra',6,1))),'Tier defaults are unchanged');

-- 3. Admin read shows providers and their agreements; access is unchanged ---------------------------------
select pg_temp.ok((select jsonb_array_length(r->'providers')>=11 and not exists(select 1 from jsonb_array_elements(r->'providers')p where p->>'dataAgreement'<>'none'or p->>'label'is null)
 and exists(select 1 from jsonb_array_elements(r->'catalog')c where c->>'id'='google/gemini-4-argon'and c->>'provider'='google')
 from(select pg_temp.adm('a1710000-0000-4000-8000-000000000001','public.zoe_ai_settings_admin()')r)x),'An admin reads providers with their data agreement and the new models');
select pg_temp.ok(pg_temp.adm('a1710000-0000-4000-8000-000000000003','public.zoe_ai_settings_admin()')->>'sqlstate'='42501','A doctor still cannot read AI settings');
select pg_temp.ok(pg_temp.run('anon','{"role":"anon"}','public.zoe_ai_settings_admin()')->>'sqlstate'='42501','Anon still cannot read AI settings');
select pg_temp.ok(pg_temp.run(r,pg_temp.who('a1710000-0000-4000-8000-000000000001'),format('(select count(*)from public.%I)',t))->>'sqlstate'='42501','No direct table access: '||r||' '||t)
 from unnest(array['anon','authenticated','service_role'])r,unnest(array['zoe_model_providers','zoe_model_catalog'])t;

-- 4. Tier configuration can select the new providers, through the same eval gate --------------------------
select pg_temp.ok(pg_temp.apply('medium','google/gemini-3.8-flash','deepseek/deepseek-v4-pro',3)->>'ok'='true','Medium tier can use Gemini with a DeepSeek fallback');
select pg_temp.ok(pg_temp.apply('high','spacexai/grok-4.7','meta/muse-wonder-1.0',6)->>'ok'='true','High tier can use Grok with a Meta fallback');
select pg_temp.ok(pg_temp.apply('low','mistral/ministral-14b','alibaba/qwen3.8-flash',1)->>'ok'='true','Low tier can use Mistral with a Qwen fallback');
select pg_temp.ok((select count(*)=3 from public.zoe_tier_config where (tier,model_id,fallback_model_id,version)in(('medium','google/gemini-3.8-flash','deepseek/deepseek-v4-pro',2),
 ('high','spacexai/grok-4.7','meta/muse-wonder-1.0',2),('low','mistral/ministral-14b','alibaba/qwen3.8-flash',2))),'The tiers now use the selected models');
select pg_temp.ok((select count(*)=3 from public.zoe_tier_config_changes where action='apply'and eval_run_id is not null),'Each change is audited with its eval');
select pg_temp.ok((select model->>'id'='spacexai/grok-4.7'and (model->>'inputUsdPerMTok')::numeric=2 and fallback->>'id'='meta/muse-wonder-1.0'
 from(select pg_temp.svc('public.zoe_route_config()')->'tiers'->'high' j)x,lateral(select j->'model' model,j->'fallback' fallback)y),'The worker route read carries the new model and its price');

-- 5. Nothing else is relaxed -------------------------------------------------------------------------------
select pg_temp.ok(pg_temp.apply('high','google/gemini-3.5-flash-lite',null,6)->>'code'='model_not_allowed','A small model from a new provider cannot serve the high tier (floor Mid since 19 Oct; never Small)');
select pg_temp.ok(pg_temp.apply('medium','zai/glm-5.3','amazon/nova-2-lite',3)->>'code'='model_not_allowed','A small fallback from a new provider cannot serve the medium tier');
select pg_temp.ok(pg_temp.svc($s$public.zoe_eval_run_record('a1710000-0000-4000-8000-000000000001','high','google/gemini-9-unknown',null,'plumbing','x',279,0,0,'{}')$s$)->>'code'='invalid','A model off the allow-list still cannot be evaluated');
select pg_temp.ok(pg_temp.adm('a1710000-0000-4000-8000-000000000001',format('public.zoe_tier_config_apply(%L,6,2,null)',
 (pg_temp.svc($s$public.zoe_eval_run_record('a1710000-0000-4000-8000-000000000001','high','google/gemini-4-argon',null,'plumbing','x',279,1,1,'{}')$s$)->>'id')))->>'code'='eval_not_passed','A MUST failure still blocks a change to a new provider');
do $$begin
 begin update public.zoe_settings set model_calls_allowed=true;raise exception 'FAIL: model calls switched on';exception when check_violation then null;end;
end$$;
-- 20261023063508 (Codex A2-3): zoe_run_reserve and zoe_run_finish re-check Zoe consent; the fixture's members consent.
insert into public.zoe_settings(singleton)values(true)on conflict(singleton)do nothing;
update public.zoe_settings set consent_collection_enabled=true,consent_wording_version=coalesce(consent_wording_version,'zoe-consent-draft-1')where singleton;
insert into public.zoe_consents(member_id,kind,granted,wording_version)select c.member_id,'zoe_reads_messages',true,(select s.consent_wording_version from public.zoe_settings s where s.singleton)
 from public.conversations c where not public._zoe_consent_ok(c.member_id);
insert into public.zoe_runs(id,conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day)
select ('a1710000-0000-4000-8000-0000000001'||lpad(i::text,2,'0'))::uuid,'a1710000-0000-4000-8000-000000000010','a1710000-0000-4000-8000-000000000004',i,0,0,(clock_timestamp()at time zone 'Asia/Yerevan')::date from generate_series(1,3)i;
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1710000-0000-4000-8000-000000000101',0.01,false,'[]','high','spacexai/grok-4.7')$s$)->>'code'='model_calls_not_permitted','A real call to a configured new-provider model is still refused');
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1710000-0000-4000-8000-000000000102',0.01,true,'[]','urgent','x')$s$)->>'code'='invalid','There is still no urgent tier');
update public.zoe_tier_config set daily_cap_usd=0.20 where tier='high';
select pg_temp.ok(pg_temp.svc($s$public.zoe_run_reserve('a1710000-0000-4000-8000-000000000103',10.01,true,'[]','high','noreon-fake-deterministic-1')$s$)->>'code'='tier_spend_cap_reached','The caps still apply');
select pg_temp.ok(not exists(select 1 from public.zoe_runs where reserved and id::text like 'a1710000-%'),'Nothing was reserved');

select 'Zoe model catalog provider checks passed' as result;
rollback;
