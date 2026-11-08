-- Zoe AI settings and risk-tier model routing (lead decisions 17 Oct 2026 15:12, 15:15, 15:17).
-- Three risk tiers (low, medium, high) each have a Gateway model from an allow-list, a fallback and
-- a daily spend limit; the total cap stays US$10/day (zoe_settings.daily_spend_cap_usd, CHECK <= 10).
-- A change takes effect only through a passing eval run of the full set (at least 262 rows, no MUST
-- failure) recorded by the server, is audited append-only, and can be rolled back.
-- Real AI calls stay OFF: zoe_settings.model_calls_allowed is still CHECK-forced false (not changed
-- here), so zoe_run_reserve refuses every non-local provider; the app flag
-- NOREON_ZOE_MODEL_CALLS_ENABLED is a second, independent switch. Urgent words never reach this code.

-- 1. Allow-list ---------------------------------------------------------------------------------
-- Changed only by migration. strength: 1 small, 2 mid, 3 strongest; a tier accepts only models
-- (primary and fallback) at least as strong as the tier (low 1, medium 2, high 3).
create table public.zoe_model_catalog (
 model_id text primary key check(model_id ~ '^[a-z0-9-]{1,32}/[a-z0-9_.:-]{1,64}$'),
 label text not null check(length(label)between 1 and 80),
 provider text not null check(provider in('anthropic','openai')),
 strength smallint not null check(strength between 1 and 3),
 -- US$ per million tokens, from the Gateway model list on 17 Oct 2026 (base tier); used for the
 -- pre-call estimate and the recorded cost.
 input_usd_per_mtok numeric(10,4)not null check(input_usd_per_mtok>0),
 output_usd_per_mtok numeric(10,4)not null check(output_usd_per_mtok>0),
 enabled boolean not null default true,
 added_at timestamptz not null default clock_timestamp()
);
insert into public.zoe_model_catalog(model_id,label,provider,strength,input_usd_per_mtok,output_usd_per_mtok)values
 ('anthropic/claude-haiku-5.5','Claude Haiku 5.5','anthropic',1,0.10,0.50),
 ('openai/gpt-6-luna','GPT-6 Luna','openai',1,0.10,0.50),
 ('anthropic/claude-sonnet-5.5','Claude Sonnet 5.5','anthropic',2,2,10),
 ('openai/gpt-6-sol','GPT-6 Sol','openai',2,2,10),
 ('anthropic/claude-opus-5.5','Claude Opus 5.5','anthropic',3,4,20),
 ('openai/gpt-6-astra','GPT-6 Astra','openai',3,10,50),
 ('anthropic/claude-fable-5.1','Claude Fable 5.1','anthropic',3,10,50);

-- 2. Per-tier configuration -----------------------------------------------------------------------
create table public.zoe_tier_config (
 tier text primary key check(tier in('low','medium','high')),
 model_id text not null references public.zoe_model_catalog(model_id),
 fallback_model_id text references public.zoe_model_catalog(model_id),
 daily_cap_usd numeric(8,2)not null check(daily_cap_usd>=0 and daily_cap_usd<=10),
 version integer not null default 1 check(version>=1),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default clock_timestamp(),
 check(fallback_model_id is distinct from model_id)
);
create function public._zoe_tier_rank(t text)returns smallint language sql immutable set search_path=''as $$
 select case t when 'low'then 1 when 'medium'then 2 when 'high'then 3 end::smallint$$;
-- Never down: a tier primary and fallback must be enabled and at least as strong as the tier.
create function public._zoe_tier_config_check()returns trigger language plpgsql set search_path=''as $$
begin
 if not exists(select 1 from public.zoe_model_catalog where model_id=new.model_id and enabled and strength>=public._zoe_tier_rank(new.tier))
  or(new.fallback_model_id is not null and not exists(select 1 from public.zoe_model_catalog where model_id=new.fallback_model_id and enabled and strength>=public._zoe_tier_rank(new.tier)))then
  raise exception using errcode='23514',message='Model not allowed for this tier';
 end if;
 return new;
end$$;
create trigger zoe_tier_config_check before insert or update on public.zoe_tier_config for each row execute function public._zoe_tier_config_check();
-- Decided defaults; the three limits add up to the US$10 total.
insert into public.zoe_tier_config(tier,model_id,fallback_model_id,daily_cap_usd)values
 ('low','anthropic/claude-haiku-5.5','openai/gpt-6-luna',1),
 ('medium','anthropic/claude-sonnet-5.5','openai/gpt-6-sol',3),
 ('high','anthropic/claude-opus-5.5','openai/gpt-6-astra',6);

-- 3. Eval runs --------------------------------------------------------------------------------------
-- Written only by the server (service role) after it ran the eval set for a candidate. mode is
-- 'plumbing' while real calls are off (the set runs with the stand-in model) and must be 'model'
-- once zoe_settings.model_calls_allowed is true. One run can apply one change.
create table public.zoe_eval_runs (
 id uuid primary key default gen_random_uuid(),
 tier text not null check(tier in('low','medium','high')),
 model_id text not null references public.zoe_model_catalog(model_id),
 fallback_model_id text references public.zoe_model_catalog(model_id),
 mode text not null check(mode in('plumbing','model')),
 harness_version text not null check(harness_version ~ '^[a-z0-9_.:+-]{1,240}$'),
 total_rows integer not null check(total_rows>=0),
 must_failures integer not null check(must_failures>=0),
 failures integer not null check(failures>=must_failures),
 failed_ids text[]not null default '{}'check(cardinality(failed_ids)<=40),
 requested_by uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 used_at timestamptz
);
create index zoe_eval_runs_recent on public.zoe_eval_runs(created_at desc);

-- 4. Change history (append-only) -------------------------------------------------------------------
create table public.zoe_tier_config_changes (
 id bigint generated always as identity primary key,
 tier text not null check(tier in('low','medium','high')),
 action text not null check(action in('apply','rollback')),
 before jsonb not null,
 after jsonb not null,
 eval_run_id uuid unique references public.zoe_eval_runs(id),
 rolled_back_change_id bigint references public.zoe_tier_config_changes(id),
 reason text check(length(reason)between 1 and 300),
 actor uuid not null references auth.users(id),
 created_at timestamptz not null default clock_timestamp(),
 check((action='apply')=(eval_run_id is not null)),
 check((action='rollback')=(rolled_back_change_id is not null))
);
create index zoe_tier_config_changes_recent on public.zoe_tier_config_changes(created_at desc);
create function public._zoe_append_only()returns trigger language plpgsql set search_path=''as $$begin
 raise exception using errcode='55000',message='Zoe AI settings history is append-only';end$$;
create trigger zoe_tier_config_changes_append_only before update or delete on public.zoe_tier_config_changes for each row execute function public._zoe_append_only();
create trigger zoe_eval_runs_no_delete before delete on public.zoe_eval_runs for each row execute function public._zoe_append_only();

create function public._zoe_tier_json(c public.zoe_tier_config)returns jsonb language sql stable set search_path=''as $$
 select jsonb_build_object('model',c.model_id,'fallback',c.fallback_model_id,'dailyCapUsd',c.daily_cap_usd,'version',c.version)$$;

-- 5. Runs: tier, reason and fallback in the trace; Gateway model ids contain a slash -----------------
alter table public.zoe_runs add column tier text check(tier in('none','low','medium','high')),
 add column tier_reason text check(tier_reason ~ '^[a-z0-9_.:-]{1,80}$'),
 add column fallback_used boolean not null default false;
alter table public.zoe_runs drop constraint zoe_runs_model_check;
alter table public.zoe_runs add constraint zoe_runs_model_check check(model ~ '^[a-z0-9_.:/-]{1,80}$');
create index zoe_runs_tier_spend on public.zoe_runs(spend_day,tier)where reserved;

-- 6. Admin read -----------------------------------------------------------------------------------------
create function public.zoe_ai_settings_admin()returns jsonb
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
  'catalog',(select jsonb_agg(jsonb_build_object('id',model_id,'label',label,'provider',provider,'strength',strength,
    'inputUsdPerMTok',input_usd_per_mtok,'outputUsdPerMTok',output_usd_per_mtok)order by strength,model_id)from public.zoe_model_catalog where enabled),
  'changes',coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'tier',x.tier,'action',x.action,'before',x.before,'after',x.after,'evalRunId',x.eval_run_id,
    'rolledBackChangeId',x.rolled_back_change_id,'reason',x.reason,'actor',coalesce((select display_name from public.workspace_staff w where w.user_id=x.actor),'Admin'),'at',x.created_at)order by x.id desc)
   from(select * from public.zoe_tier_config_changes order by id desc limit 30)x),'[]'),
  'evalRuns',coalesce((select jsonb_agg(jsonb_build_object('id',e.id,'tier',e.tier,'model',e.model_id,'fallback',e.fallback_model_id,'mode',e.mode,'harnessVersion',e.harness_version,
    'totalRows',e.total_rows,'mustFailures',e.must_failures,'failures',e.failures,'failedIds',to_jsonb(e.failed_ids),'used',e.used_at is not null,'at',e.created_at)order by e.created_at desc)
   from(select * from public.zoe_eval_runs order by created_at desc limit 10)e),'[]'));
end$$;

-- 7. Eval run record (service role; the server ran the set for this admin) ------------------------------
create function public.zoe_eval_run_record(p_admin uuid,p_tier text,p_model text,p_fallback text,p_mode text,p_harness_version text,p_total integer,p_must_failures integer,p_failures integer,p_failed_ids text[])returns jsonb
language plpgsql security definer set search_path=''as $$
declare id uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if not exists(select 1 from public.workspace_staff where user_id=p_admin and role='admin'and active)then return jsonb_build_object('ok',false,'code','not_admin');end if;
 begin
  insert into public.zoe_eval_runs(tier,model_id,fallback_model_id,mode,harness_version,total_rows,must_failures,failures,failed_ids,requested_by)
  values(p_tier,p_model,p_fallback,p_mode,p_harness_version,p_total,p_must_failures,p_failures,coalesce(p_failed_ids[1:40],'{}'),p_admin)returning zoe_eval_runs.id into id;
 exception when check_violation or foreign_key_violation or not_null_violation then return jsonb_build_object('ok',false,'code','invalid');end;
 return jsonb_build_object('ok',true,'id',id);
end$$;

-- 8. Apply a change (admin; needs an unused passing eval run for exactly this model pair) -----
create function public.zoe_tier_config_apply(p_eval uuid,p_daily_cap_usd numeric,p_expected_version integer,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid:=public._real_staff_require_admin();e public.zoe_eval_runs;c public.zoe_tier_config;s public.zoe_settings;before_cfg jsonb;ch bigint;
begin
 if p_daily_cap_usd is null or p_daily_cap_usd<0 or p_daily_cap_usd>10 or p_daily_cap_usd<>round(p_daily_cap_usd,2)or p_expected_version is null
  or(p_reason is not null and length(btrim(p_reason))not between 1 and 300)then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into e from public.zoe_eval_runs where id=p_eval for update;
 if not found or e.requested_by<>actor then return jsonb_build_object('ok',false,'code','eval_unknown');end if;
 if e.used_at is not null then return jsonb_build_object('ok',false,'code','eval_already_used');end if;
 if e.created_at<clock_timestamp()-interval '15 minutes'then return jsonb_build_object('ok',false,'code','eval_expired');end if;
 if e.must_failures>0 or e.total_rows<262 then return jsonb_build_object('ok',false,'code','eval_not_passed');end if;
 select * into s from public.zoe_settings where singleton;
 if(e.mode='model')<>coalesce(s.model_calls_allowed,false)then return jsonb_build_object('ok',false,'code','eval_mode_mismatch');end if;
 select * into c from public.zoe_tier_config where tier=e.tier for update;
 if not found then return jsonb_build_object('ok',false,'code','tier_unknown');end if;
 if c.version<>p_expected_version then return jsonb_build_object('ok',false,'code','stale','version',c.version);end if;
 if p_daily_cap_usd>least(coalesce(s.daily_spend_cap_usd,0),10)then return jsonb_build_object('ok',false,'code','above_total_cap');end if;
 before_cfg:=public._zoe_tier_json(c);
 begin
  update public.zoe_tier_config set model_id=e.model_id,fallback_model_id=e.fallback_model_id,daily_cap_usd=p_daily_cap_usd,version=version+1,updated_by=actor,updated_at=clock_timestamp()
  where tier=e.tier returning * into c;
 exception when check_violation then return jsonb_build_object('ok',false,'code','model_not_allowed');end;
 update public.zoe_eval_runs set used_at=clock_timestamp()where id=e.id;
 insert into public.zoe_tier_config_changes(tier,action,before,after,eval_run_id,reason,actor)values(c.tier,'apply',before_cfg,public._zoe_tier_json(c),e.id,nullif(btrim(p_reason),''),actor)returning id into ch;
 return jsonb_build_object('ok',true,'changeId',ch,'tier',c.tier,'version',c.version);
end$$;

-- 9. Roll back (admin): restore the configuration that was in place before a recorded change ----------
-- It restores a configuration that was live (and eval-passed or seeded) before, so it needs no new
-- eval; the allow-list and strength rule still apply, and the restore is itself audited.
create function public.zoe_tier_config_rollback(p_change bigint,p_expected_version integer,p_reason text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare actor uuid:=public._real_staff_require_admin();x public.zoe_tier_config_changes;c public.zoe_tier_config;s public.zoe_settings;before_cfg jsonb;ch bigint;cap numeric;
begin
 if p_change is null or p_expected_version is null or(p_reason is not null and length(btrim(p_reason))not between 1 and 300)then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into x from public.zoe_tier_config_changes where id=p_change;
 if not found then return jsonb_build_object('ok',false,'code','change_unknown');end if;
 select * into c from public.zoe_tier_config where tier=x.tier for update;
 if c.version<>p_expected_version then return jsonb_build_object('ok',false,'code','stale','version',c.version);end if;
 select * into s from public.zoe_settings where singleton;
 cap:=least((x.before->>'dailyCapUsd')::numeric,least(coalesce(s.daily_spend_cap_usd,0),10));
 before_cfg:=public._zoe_tier_json(c);
 begin
  update public.zoe_tier_config set model_id=x.before->>'model',fallback_model_id=x.before->>'fallback',daily_cap_usd=cap,version=version+1,updated_by=actor,updated_at=clock_timestamp()
  where tier=x.tier returning * into c;
 exception when check_violation or foreign_key_violation or not_null_violation then return jsonb_build_object('ok',false,'code','model_not_allowed');end;
 insert into public.zoe_tier_config_changes(tier,action,before,after,rolled_back_change_id,reason,actor)values(c.tier,'rollback',before_cfg,public._zoe_tier_json(c),x.id,nullif(btrim(p_reason),''),actor)returning id into ch;
 return jsonb_build_object('ok',true,'changeId',ch,'tier',c.tier,'version',c.version);
end$$;

-- 10. Route configuration for the worker (service role) -------------------------------------------------
create function public.zoe_route_config()returns jsonb
language plpgsql stable security definer set search_path=''as $$
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'tiers',coalesce((select jsonb_object_agg(c.tier,jsonb_build_object('version',c.version,'dailyCapUsd',c.daily_cap_usd,
  'model',(select jsonb_build_object('id',m.model_id,'inputUsdPerMTok',m.input_usd_per_mtok,'outputUsdPerMTok',m.output_usd_per_mtok)from public.zoe_model_catalog m where m.model_id=c.model_id),
  'fallback',(select jsonb_build_object('id',m.model_id,'inputUsdPerMTok',m.input_usd_per_mtok,'outputUsdPerMTok',m.output_usd_per_mtok)from public.zoe_model_catalog m where m.model_id=c.fallback_model_id)))
  from public.zoe_tier_config c),'{}'));
end$$;

-- 11. Spend reservation with the tier (replaces the 4-argument version) ---------------------------------
-- Serialised by the same advisory lock. A non-local provider is refused while model_calls_allowed is
-- false (always, today), and must name the tier configured primary or fallback model. Today's
-- reserved estimates and costs must stay within the tier limit AND the total cap.
drop function public.zoe_run_reserve(uuid,numeric,boolean,jsonb);
create function public.zoe_run_reserve(p_run uuid,p_estimate_usd numeric,p_local boolean,p_events jsonb,p_tier text,p_model text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;s public.zoe_settings;c public.zoe_tier_config;spent numeric;tier_spent numeric;cap numeric;tier_cap numeric;code text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>100 or p_local is null or p_tier is null or p_tier not in('low','medium','high')
  or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state<>'started'or r.reserved then return jsonb_build_object('ok',false,'code','run_not_reservable');end if;
 perform public._zoe_run_events(r,p_events);
 select * into s from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select coalesce(sum(coalesce(cost_usd,estimate_usd)),0),coalesce(sum(coalesce(cost_usd,estimate_usd))filter(where tier=p_tier),0)into spent,tier_spent
  from public.zoe_runs where spend_day=r.spend_day and reserved;
 code:=case when not p_local and not coalesce(s.model_calls_allowed,false)then 'model_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'end;
 update public.zoe_runs set tier=p_tier where id=r.id;
 if code is null then update public.zoe_runs set reserved=true,estimate_usd=p_estimate_usd where id=r.id;end if;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.spend.reserve','outcome',case when code is null then 'allow'else 'block'end,
  'reason',coalesce(code,'within_daily_spend_cap'),'rule',case when code='model_calls_not_permitted'then 'zoe.k2.launch_gate'else 'zoe.k7.daily_spend_cap'end,'ruleVersion','k7-a-2026-10-17-tiers','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.guard.name','spend_cap','noreon.zoe.spent_today_usd',spent,'noreon.zoe.estimate_usd',p_estimate_usd,'noreon.zoe.daily_cap_usd',cap,
   'noreon.zoe.tier',p_tier,'noreon.zoe.tier_spent_today_usd',tier_spent,'noreon.zoe.tier_cap_usd',tier_cap,
   'noreon.zoe.spend_day',r.spend_day::text,'noreon.zoe.provider_local',p_local))));
 return case when code is null then jsonb_build_object('ok',true)else jsonb_build_object('ok',false,'code',code)end;
end$$;

-- 12. Finish: also records tier, tier reason and fallback; accepts Gateway model ids ------------------
create or replace function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;c public.conversations;v_outcome text;v_reason text;d uuid;cr bigint;src text;v_summary text;v_draft text;v_sealed text;reasons text[];v_tier text;v_tier_reason text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found then return jsonb_build_object('ok',false,'code','run_unknown');end if;
 if r.state='finished'then return jsonb_build_object('ok',true,'outcome',r.outcome,'replayed',true);end if;
 v_outcome:=p_result->>'outcome';v_reason:=p_result->>'reason';v_summary:=nullif(btrim(p_result->>'summary'),'');v_draft:=nullif(btrim(p_result->>'draft'),'');v_sealed:=p_result->>'sealed';
 v_tier:=coalesce(p_result->>'tier',r.tier,'none');v_tier_reason:=coalesce(p_result->>'tierReason','not_routed');
 if length(v_sealed)>200000 then v_sealed:=null;end if;
 if v_outcome is null or v_outcome not in('draft_proposed','draft_blocked','summary_only','discarded','no_output')or coalesce(v_reason,'')!~'^[a-z0-9_.:-]{1,80}$'
  or length(v_summary)>4000 or length(v_draft)>2000 or(v_outcome='draft_proposed'and(v_draft is null or v_summary is null))
  or jsonb_typeof(coalesce(p_result->'guardReasons','[]'))<>'array'
  or coalesce(p_result->>'provider','none')!~'^[a-z0-9_.-]{1,64}$'or coalesce(p_result->>'model','none')!~'^[a-z0-9_.:/-]{1,80}$'
  or coalesce((p_result->>'costUsd')::numeric,0)<0
  or v_tier not in('none','low','medium','high')or v_tier_reason!~'^[a-z0-9_.:-]{1,80}$'
  -- A reserved run keeps the tier it reserved against.
  or(r.tier is not null and v_tier<>r.tier)then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 select coalesce(array_agg(x)filter(where x~'^[a-z0-9_.:-]{1,80}$'),'{}')into reasons from jsonb_array_elements_text(p_result->'guardReasons')x;
 perform public._zoe_run_events(r,p_result->'events');
 if v_outcome='draft_proposed'then
  select * into c from public.conversations where id=r.conversation_id for update;
  if c.version<>r.context_version then v_outcome:='stale';v_reason:='newer_member_message';
  elsif c.draft_epoch<>r.draft_epoch then v_outcome:='stale';v_reason:='doctor_work_since_claim';
  elsif exists(select 1 from public.conversation_drafts dd join public.conversation_revisions rv on rv.draft_id=dd.id and rv.revision=dd.revision
   where dd.conversation_id=c.id and dd.state in('pending','info_requested')and dd.context_version=c.version and rv.author_kind='staff')then v_outcome:='summary_only';v_reason:='doctor_draft_present';
  else
   select revision into cr from public.patient_clinical_cases where user_id=r.member_id;
   src:=public.patient_clinical_evidence(r.member_id)->>'token';
   update public.conversation_intents set state='invalidated'where state='open'and draft_id in(select id from public.conversation_drafts where conversation_id=c.id);
   update public.conversation_drafts set state='superseded'where conversation_id=c.id and state in('pending','info_requested');
   update public.conversations set draft_epoch=draft_epoch+1 where id=c.id;
   insert into public.conversation_drafts(conversation_id,state,context_version,clinical_revision,source_token)values(c.id,'pending',c.version,cr,src)returning id into d;
   insert into public.conversation_revisions(draft_id,revision,body,summary,content_hash,author_id,author_kind,provenance)
   values(d,1,v_draft,v_summary,public._conversation_hash(c.id,r.member_id,v_draft),null,'ai_assistant',
    jsonb_build_object('kind','zoe','engine',coalesce(p_result->>'provider','none'),'version',left(coalesce(p_result->>'configVersion','unknown'),128),'protocolVersion','not-clinical','runId',r.id));
  end if;
 end if;
 update public.zoe_runs z set state='finished',outcome=v_outcome,reason_code=v_reason,provider=coalesce(p_result->>'provider','none'),model=coalesce(p_result->>'model','none'),
  config_version=left(coalesce(p_result->>'configVersion','unknown'),200),cost_usd=case when z.reserved then coalesce((p_result->>'costUsd')::numeric,0)end,
  input_tokens=(p_result#>>'{usage,inputTokens}')::integer,output_tokens=(p_result#>>'{usage,outputTokens}')::integer,latency_ms=(p_result->>'latencyMs')::integer,
  redaction_count=coalesce((p_result->>'redactionCount')::integer,0),guard_reasons=reasons,
  summary=case when d is null then v_summary end,draft_id=d,sealed_io=v_sealed,finished_at=clock_timestamp(),
  tier=v_tier,tier_reason=v_tier_reason,fallback_used=coalesce((p_result->>'fallbackUsed')::boolean,false)
 where z.id=r.id returning * into r;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route',
  'outcome',case v_outcome when 'draft_proposed'then 'allow'when 'draft_blocked'then 'block'when 'summary_only'then 'recorded'when 'no_output'then 'failed'
   else case when v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call')then 'escalate'else 'skipped'end end,
  'reason',v_reason,'rule','zoe.pipeline','ruleVersion',left(coalesce(p_result->>'configVersion','unknown'),80),'actor','system',
  'attributes',jsonb_strip_nulls(jsonb_build_object('noreon.zoe.run.outcome',v_outcome,'noreon.draft.id',d::text,'noreon.zoe.cost_usd',r.cost_usd,
   'gen_ai.usage.input_tokens',r.input_tokens,'gen_ai.usage.output_tokens',r.output_tokens,'noreon.zoe.latency_ms',r.latency_ms,
   'noreon.zoe.tier',r.tier,'noreon.zoe.tier_reason',r.tier_reason,'gen_ai.request.model',left(r.model,128),'noreon.zoe.fallback_used',r.fallback_used,
   'noreon.zoe.guard.reasons',left(array_to_string(reasons,','),128),'noreon.zoe.io_stored',r.sealed_io is not null)))));
 return jsonb_build_object('ok',true,'outcome',v_outcome,'replayed',false,'draftId',d);
end$$;

-- 13. Admin run detail also shows the route --------------------------------------------------------------
create or replace function public.zoe_run_detail(p_run uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare admin uuid:=public._real_staff_require_admin();r public.zoe_runs;
begin
 select * into r from public.zoe_runs where id=p_run;
 if not found then return jsonb_build_object('ok',false,'code','run_unknown');end if;
 perform public._conversation_trace(r.member_id,r.conversation_id,'zoe_run',r.id::text,'zoe','zoe.run.io_viewed','recorded','admin_opened_run_detail','zoe.trace_access','1','admin',admin,
  jsonb_build_object('noreon.zoe.run.id',r.id::text,'noreon.zoe.io_stored',r.sealed_io is not null));
 return jsonb_build_object('ok',true,'run',jsonb_build_object('id',r.id,'memberId',r.member_id,'messageSeq',r.message_seq,'outcome',r.outcome,'reason',r.reason_code,
  'provider',r.provider,'model',r.model,'configVersion',r.config_version,'costUsd',r.cost_usd,'inputTokens',r.input_tokens,'outputTokens',r.output_tokens,'latencyMs',r.latency_ms,
  'tier',r.tier,'tierReason',r.tier_reason,'fallbackUsed',r.fallback_used,
  'guardReasons',to_jsonb(r.guard_reasons),'redactionCount',r.redaction_count,'summary',r.summary,'draftId',r.draft_id,'startedAt',r.started_at,'finishedAt',r.finished_at,'sealed',r.sealed_io));
end$$;

-- 14. RLS and grants -----------------------------------------------------------------------------------------
alter table public.zoe_model_catalog enable row level security;
alter table public.zoe_tier_config enable row level security;
alter table public.zoe_eval_runs enable row level security;
alter table public.zoe_tier_config_changes enable row level security;
revoke all on public.zoe_model_catalog,public.zoe_tier_config,public.zoe_eval_runs,public.zoe_tier_config_changes from public,anon,authenticated,service_role;
revoke all on function public._zoe_tier_rank(text),public._zoe_tier_config_check(),public._zoe_append_only(),public._zoe_tier_json(public.zoe_tier_config),
 public.zoe_ai_settings_admin(),public.zoe_eval_run_record(uuid,text,text,text,text,text,integer,integer,integer,text[]),
 public.zoe_tier_config_apply(uuid,numeric,integer,text),public.zoe_tier_config_rollback(bigint,integer,text),public.zoe_route_config(),
 public.zoe_run_reserve(uuid,numeric,boolean,jsonb,text,text)from public,anon,authenticated,service_role;
grant execute on function public.zoe_ai_settings_admin(),public.zoe_tier_config_apply(uuid,numeric,integer,text),public.zoe_tier_config_rollback(bigint,integer,text)to authenticated;
grant execute on function public.zoe_eval_run_record(uuid,text,text,text,text,text,integer,integer,integer,text[]),public.zoe_route_config(),
 public.zoe_run_reserve(uuid,numeric,boolean,jsonb,text,text)to service_role;
