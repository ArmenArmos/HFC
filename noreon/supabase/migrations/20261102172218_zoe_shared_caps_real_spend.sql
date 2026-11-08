-- Shared Zoe caps count settled costs and full in-flight estimates under the existing spend lock.
-- A new reply needs at most US$0.25 of headroom; store its full estimate until actual cost is known.
-- Member/staff caps and lab/care-plan reservations are unchanged (Khikar, 2 Nov 2026).
create function public._ai_cap_room(p_spent numeric,p_estimate numeric,p_cap numeric)returns boolean
language sql immutable set search_path=''as $$
 select p_spent+least(p_estimate,0.25)<=p_cap
$$;
-- Only the owning definer functions may execute this helper.
revoke all on function public._ai_cap_room(numeric,numeric,numeric)from public,anon,authenticated,service_role;

create or replace function public.zoe_run_reserve(p_run uuid,p_estimate_usd numeric,p_local boolean,p_events jsonb,p_tier text,p_model text,p_judge_model text default null)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;s public.zoe_settings;c public.zoe_tier_config;spent numeric;tier_spent numeric;member_spent numeric;cap numeric;tier_cap numeric;code text;
 member_cap numeric;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>100 or p_local is null or p_tier is null or p_tier not in('low','medium','high')
  or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'or(p_judge_model is not null and p_judge_model!~'^[a-z0-9_.:/-]{1,80}$')
  or p_judge_model is not distinct from p_model and p_judge_model is not null then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state<>'started'or r.reserved then return jsonb_build_object('ok',false,'code','run_not_reservable');end if;
 perform public._zoe_run_events(r,p_events);
 -- 20261023063508 (Codex A2-3): consent again, under the conversation lock the withdrawal takes (_zoe_text_hold_on_withdrawal),
 -- with the claim's own check. A run claimed before a withdrawal reserves nothing and calls no provider.
 if r.conversation_id is not null then perform 1 from public.conversations where id=r.conversation_id for update;end if;
 if not public._zoe_consent_ok(r.member_id)then
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.consent','outcome','block','reason','no_zoe_reads_messages_consent',
   'rule','zoe.consent','ruleVersion','zoe-a2-consent-1','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','consent','noreon.zoe.consent.stage','reserve'))));
  return jsonb_build_object('ok',false,'code','no_zoe_reads_messages_consent');
 end if;
 select * into s from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 -- The per-member daily cap is a setting (Khikar 20 Oct 00:58: US$3), never above the global cap.
 member_cap:=least(coalesce(s.member_daily_cap_usd,3.00),cap);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(r.spend_day,p_tier)x;
 -- This member's Zoe spend today: actual cost where known, else the reserved estimate (unknown usage keeps its liability).
 select coalesce(sum(coalesce(z.cost_usd,z.estimate_usd)),0)into member_spent from public.zoe_runs z where z.member_id=r.member_id and z.reserved and z.spend_day=r.spend_day;
 code:=case when not p_local and not public._zoe_real_calls_permitted(p_model)then 'model_calls_not_permitted'
  when not p_local and p_judge_model is not null and not public._zoe_real_calls_permitted(p_judge_model)then 'judge_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when not public._ai_cap_room(tier_spent,p_estimate_usd,tier_cap) then 'tier_spend_cap_reached'
  when not public._ai_cap_room(spent,p_estimate_usd,cap) then 'daily_spend_cap_reached'
  -- Member admission uses existing spend; shared caps require the admission headroom.
  when not p_local and member_spent>=member_cap then 'member_spend_cap_reached'end;
 update public.zoe_runs set tier=p_tier where id=r.id;
 if code is null then update public.zoe_runs set reserved=true,estimate_usd=p_estimate_usd where id=r.id;end if;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.spend.reserve','outcome',case when code is null then 'allow'else 'block'end,
  'reason',coalesce(code,'within_daily_spend_cap'),'rule',case when code in('model_calls_not_permitted','judge_calls_not_permitted')then 'zoe.k2.launch_gate'else 'zoe.k7.daily_spend_cap'end,'ruleVersion','k7-a-2026-10-31-member-spend','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.guard.name','spend_cap','noreon.zoe.spent_today_usd',spent,'noreon.zoe.estimate_usd',p_estimate_usd,'noreon.zoe.daily_cap_usd',cap,
   'noreon.zoe.tier',p_tier,'noreon.zoe.tier_spent_today_usd',tier_spent,'noreon.zoe.tier_cap_usd',tier_cap,'noreon.zoe.member_spent_today_usd',member_spent,'noreon.zoe.member_cap_usd',member_cap,
   'noreon.zoe.judge_model',coalesce(p_judge_model,'none'),
   'noreon.zoe.spend_day',r.spend_day::text,'noreon.zoe.provider_local',p_local,'noreon.zoe.staging_ai_mode',coalesce(s.staging_ai_mode,false)))));
 return case when code is null then jsonb_build_object('ok',true)else jsonb_build_object('ok',false,'code',code)end;
end$$;

create or replace function public.staff_zoe_reserve(p_run uuid,p_estimate_usd numeric,p_local boolean,p_tier text,p_model text)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.staff_zoe_runs;z public.zoe_settings;c public.zoe_tier_config;a public.staff_zoe_settings;spent numeric;tier_spent numeric;staff_spent numeric;cap numeric;tier_cap numeric;code text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>10 or p_local is null or p_tier is null or p_tier not in('low','medium','high')
  or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into r from public.staff_zoe_runs where id=p_run for update;
 if not found or r.state<>'started'or r.reserved then return jsonb_build_object('ok',false,'code','run_not_reservable');end if;
 select * into a from public.staff_zoe_settings where singleton;
 select * into z from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 cap:=least(coalesce(z.daily_spend_cap_usd,0),10);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(r.spend_day,p_tier)x;
 select coalesce(sum(coalesce(s.cost_usd,s.estimate_usd)),0)into staff_spent from public.staff_zoe_runs s where s.staff_id=r.staff_id and s.reserved and s.spend_day=r.spend_day;
 code:=case when not a.staff_zoe_enabled then 'off'
  when not p_local and not public._zoe_real_calls_permitted(p_model)then 'model_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when not p_local and not public._ai_cap_room(tier_spent,p_estimate_usd,tier_cap) then 'tier_spend_cap_reached'
  when not p_local and not public._ai_cap_room(spent,p_estimate_usd,cap) then 'daily_spend_cap_reached'
  when not p_local and staff_spent+p_estimate_usd>a.staff_daily_cap_usd then 'staff_spend_cap_reached'end;
 if code is not null then return jsonb_build_object('ok',false,'code',code);end if;
 update public.staff_zoe_runs set reserved=true,tier=p_tier,estimate_usd=case when p_local then 0 else p_estimate_usd end,model=p_model where id=r.id;
 return jsonb_build_object('ok',true);
end$$;
