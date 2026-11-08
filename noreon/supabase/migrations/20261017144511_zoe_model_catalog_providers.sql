-- Zoe model catalog: every major Vercel AI Gateway provider, not only Anthropic and OpenAI (Khikar,
-- 17 Oct 2026: switching providers should be a setting, with other providers' configs ready).
-- Catalog and admin read only. Nothing about calls changes: zoe_settings.model_calls_allowed stays
-- CHECK-forced false, urgent words never reach routing, a tier change still needs a passing eval run,
-- the never-down strength rule and the per-tier and US$10 total caps are untouched.

-- 1. Providers (lookup, replaces the provider CHECK) ---------------------------------------------------
-- data_agreement records whether Noreon has a data processing agreement with the provider:
-- 'none', 'pending' (in negotiation) or 'signed'. All are 'none' today; real member data must not go
-- to a provider before its agreement is signed and legal has signed off. Changed only by migration.
create table public.zoe_model_providers (
 provider text primary key check(provider ~ '^[a-z0-9-]{1,32}$'),
 label text not null check(length(label)between 1 and 40),
 data_agreement text not null default 'none' check(data_agreement in('none','pending','signed'))
);
insert into public.zoe_model_providers(provider,label)values
 ('anthropic','Anthropic'),('openai','OpenAI'),('google','Google'),('spacexai','xAI'),('mistral','Mistral'),
 ('deepseek','DeepSeek'),('meta','Meta'),('alibaba','Alibaba (Qwen)'),('moonshotai','Moonshot AI (Kimi)'),('zai','Z.ai (GLM)'),('amazon','Amazon');

alter table public.zoe_model_catalog drop constraint zoe_model_catalog_provider_check;
alter table public.zoe_model_catalog add constraint zoe_model_catalog_provider_fkey foreign key(provider)references public.zoe_model_providers(provider),
 -- The Gateway model id starts with its provider, so a row cannot be filed under another provider.
 add constraint zoe_model_catalog_provider_prefix check(split_part(model_id,'/',1)=provider);

-- 2. Models -------------------------------------------------------------------------------------------
-- Ids and US$ per million tokens (base tier, input / output) from https://ai-gateway.vercel.sh/v1/models,
-- fetched 17 Oct 2026 14:43 UTC. Strength: 1 small, 2 mid, 3 strongest (a tier accepts only models at
-- least as strong as its risk). 3 is kept for each large lab's flagship; open-weight and second-line
-- flagships are 2 until an eval in model mode shows otherwise. Existing rows are kept unchanged.
insert into public.zoe_model_catalog(model_id,label,provider,strength,input_usd_per_mtok,output_usd_per_mtok)values
 ('openai/gpt-6.1-sol','GPT-6.1 Sol','openai',2,2,10),
 ('google/gemini-3.5-flash-lite','Gemini 3.5 Flash Lite','google',1,0.30,2.50),
 ('google/gemini-3.8-flash','Gemini 3.8 Flash','google',2,0.75,3.75),
 ('google/gemini-4-argon','Gemini 4 Argon','google',3,2,10),
 ('spacexai/grok-4.3','Grok 4.3','spacexai',2,1.25,2.50),
 ('spacexai/grok-4.7','Grok 4.7','spacexai',3,2,6),
 ('mistral/ministral-14b','Ministral 14B','mistral',1,0.20,0.20),
 ('mistral/mistral-large-4','Mistral Large 4','mistral',2,0.68,2.09),
 ('deepseek/deepseek-v4.1-flash','DeepSeek V4.1 Flash','deepseek',1,0.30,1.20),
 ('deepseek/deepseek-v4-pro','DeepSeek V4 Pro','deepseek',2,0.66,1.98),
 ('meta/llama-4-maverick','Llama 4 Maverick 17B','meta',1,0.24,0.97),
 ('meta/muse-spark-1.3','Muse Spark 1.3','meta',2,1.25,4.25),
 ('meta/muse-wonder-1.0','Muse Wonder','meta',3,4,20),
 ('alibaba/qwen3.8-flash','Qwen 3.8 Flash','alibaba',1,0.15,0.47),
 ('alibaba/qwen3.8-max','Qwen 3.8 Max','alibaba',2,2,6),
 ('moonshotai/kimi-k3','Kimi K3','moonshotai',2,3,15),
 ('zai/glm-5.3-flash','GLM 5.3 Flash','zai',1,0.15,0.50),
 ('zai/glm-5.3','GLM 5.3','zai',2,1.40,4.40),
 ('amazon/nova-2-lite','Nova 2 Lite','amazon',1,0.30,2.50);

-- 3. Admin read: providers with their data agreement, and each model's provider label -------------------
create or replace function public.zoe_ai_settings_admin()returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;today date;
begin
 perform public._real_staff_require_admin();
 select * into s from public.zoe_settings where singleton;
 today:=(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date;
 return jsonb_build_object('ok',true,
  'modelCallsAllowed',coalesce(s.model_calls_allowed,false),'settingsRow',s.singleton is not null,
  'totalCapUsd',least(coalesce(s.daily_spend_cap_usd,0),10),'spendDay',today,
  'spentTodayUsd',(select coalesce(sum(coalesce(cost_usd,estimate_usd)),0)from public.zoe_runs where spend_day=today and reserved),
  'tiers',(select jsonb_agg(public._zoe_tier_json(c)||jsonb_build_object('tier',c.tier,'updatedAt',c.updated_at,
    'spentTodayUsd',(select coalesce(sum(coalesce(cost_usd,estimate_usd)),0)from public.zoe_runs where spend_day=today and reserved and tier=c.tier))
   order by public._zoe_tier_rank(c.tier))from public.zoe_tier_config c),
  'providers',coalesce((select jsonb_agg(jsonb_build_object('id',p.provider,'label',p.label,'dataAgreement',p.data_agreement)order by p.label)from public.zoe_model_providers p),'[]'),
  'catalog',(select jsonb_agg(jsonb_build_object('id',model_id,'label',label,'provider',provider,'strength',strength,
    'inputUsdPerMTok',input_usd_per_mtok,'outputUsdPerMTok',output_usd_per_mtok)order by strength,model_id)from public.zoe_model_catalog where enabled),
  'changes',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'tier',x.tier,'action',x.action,'before',x.before,'after',x.after,'evalRunId',x.eval_run_id,
    'rolledBackChangeId',x.rolled_back_change_id,'reason',x.reason,'actor',coalesce((select display_name from public.workspace_staff w where w.user_id=x.actor),'Admin'),'at',x.created_at)order by x.id desc)
   from(select * from public.zoe_tier_config_changes order by id desc limit 30)x),'[]'),
  'evalRuns',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'tier',e.tier,'model',e.model_id,'fallback',e.fallback_model_id,'mode',e.mode,'harnessVersion',e.harness_version,
    'totalRows',e.total_rows,'mustFailures',e.must_failures,'failures',e.failures,'failedIds',to_jsonb(e.failed_ids),'used',e.used_at is not null,'at',e.created_at)order by e.created_at desc)
   from(select * from public.zoe_eval_runs order by created_at desc limit 10)e),'[]'));
end$$;

-- 4. RLS and grants: no direct access, same as the catalog -------------------------------------------------
alter table public.zoe_model_providers enable row level security;
revoke all on public.zoe_model_providers from public,anon,authenticated,service_role;
revoke all on function public.zoe_ai_settings_admin()from public,anon,authenticated,service_role;
grant execute on function public.zoe_ai_settings_admin()to authenticated;
