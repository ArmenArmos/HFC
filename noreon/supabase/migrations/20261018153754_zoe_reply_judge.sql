-- Zoe redesign PR1: the reply judge (lead decision 18 Oct 18:05; Codex condition F5). App side: lib/zoe/reply-check.ts.
-- Every model-written member text now also passes seven hard patterns and a judge model that differs from the
-- speaker; the run's ONE reservation must cover every permitted attempt (the speaker's retries and fallback, the
-- schema retry, the judge). This migration makes the reservation enforce that budget atomically:
--  1. zoe_run_reserve gains p_judge_model: its real-call permission is checked like the speaker's (a judge
--     must not be a way around the data-agreement gate).
--  2. A per-member daily cap (US$0.50, lib/zoe/conversation.ts MEMBER_DAILY_CAP_USD) is checked inside the
--     existing spend lock, so two concurrent runs of one member cannot both pass on a snapshot (Codex F5).
-- Everything else is unchanged from 20261017190654_staging_ai_mode.sql §2.

drop function public.zoe_run_reserve(uuid,numeric,boolean,jsonb,text,text);
create function public.zoe_run_reserve(p_run uuid,p_estimate_usd numeric,p_local boolean,p_events jsonb,p_tier text,p_model text,p_judge_model text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;s public.zoe_settings;c public.zoe_tier_config;spent numeric;tier_spent numeric;member_spent numeric;cap numeric;tier_cap numeric;code text;
 member_cap constant numeric:=0.50;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>100 or p_local is null or p_tier is null or p_tier not in('low','medium','high')
  or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'or(p_judge_model is not null and p_judge_model!~'^[a-z0-9_.:/-]{1,80}$')
  or p_judge_model is not distinct from p_model and p_judge_model is not null then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state<>'started'or r.reserved then return jsonb_build_object('ok',false,'code','run_not_reservable');end if;
 perform public._zoe_run_events(r,p_events);
 select * into s from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(r.spend_day,p_tier)x;
 -- This member's Zoe spend today: actual cost where known, else the reserved estimate (unknown usage keeps its liability).
 select coalesce(sum(coalesce(z.cost_usd,z.estimate_usd)),0)into member_spent from public.zoe_runs z where z.member_id=r.member_id and z.reserved and z.spend_day=r.spend_day;
 code:=case when not p_local and not public._zoe_real_calls_permitted(p_model)then 'model_calls_not_permitted'
  when not p_local and p_judge_model is not null and not public._zoe_real_calls_permitted(p_judge_model)then 'judge_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'
  when not p_local and member_spent+p_estimate_usd>member_cap then 'member_spend_cap_reached'end;
 update public.zoe_runs set tier=p_tier where id=r.id;
 if code is null then update public.zoe_runs set reserved=true,estimate_usd=p_estimate_usd where id=r.id;end if;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.spend.reserve','outcome',case when code is null then 'allow'else 'block'end,
  'reason',coalesce(code,'within_daily_spend_cap'),'rule',case when code in('model_calls_not_permitted','judge_calls_not_permitted')then 'zoe.k2.launch_gate'else 'zoe.k7.daily_spend_cap'end,'ruleVersion','k7-a-2026-10-18-judge','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.guard.name','spend_cap','noreon.zoe.spent_today_usd',spent,'noreon.zoe.estimate_usd',p_estimate_usd,'noreon.zoe.daily_cap_usd',cap,
   'noreon.zoe.tier',p_tier,'noreon.zoe.tier_spent_today_usd',tier_spent,'noreon.zoe.tier_cap_usd',tier_cap,'noreon.zoe.member_spent_today_usd',member_spent,'noreon.zoe.member_cap_usd',member_cap,
   'noreon.zoe.judge_model',coalesce(p_judge_model,'none'),
   'noreon.zoe.spend_day',r.spend_day::text,'noreon.zoe.provider_local',p_local,'noreon.zoe.staging_ai_mode',coalesce(s.staging_ai_mode,false)))));
 return case when code is null then jsonb_build_object('ok',true)else jsonb_build_object('ok',false,'code',code)end;
end$$;
revoke all on function public.zoe_run_reserve(uuid,numeric,boolean,jsonb,text,text,text)from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_reserve(uuid,numeric,boolean,jsonb,text,text,text)to service_role;
