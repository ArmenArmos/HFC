-- Zoe: the per-member daily spend cap becomes a setting (Khikar 20 Oct 00:58, "yes, do it": US$3; lead). It was a
-- constant US$0.50 (20261018153754): a free-mode run reserves its worst case up front (speaker attempts, the fallback,
-- the schema retry and the regenerate, two judge calls), so a member reached it after about three health questions a
-- day (Armen, 19 Oct 19:04 and 23:25). The global cap (daily_spend_cap_usd, at most US$10) and the tier caps are
-- unchanged; the member cap is never above the global cap. zoe_run_reserve checks it inside the spend lock as before;
-- zoe_run_context passes it to the worker's early check (lib/zoe/pipeline.ts). Everything else as in 20261018153754
-- and 20261018121002.
alter table public.zoe_settings add column member_daily_cap_usd numeric(6,2) not null default 3.00
 check(member_daily_cap_usd>0 and member_daily_cap_usd<=10);
comment on column public.zoe_settings.member_daily_cap_usd is
 'Per-member daily Zoe spend cap (USD), checked by zoe_run_reserve inside the spend lock; never above daily_spend_cap_usd.';

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
  when tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'
  when not p_local and member_spent+p_estimate_usd>member_cap then 'member_spend_cap_reached'end;
 update public.zoe_runs set tier=p_tier where id=r.id;
 if code is null then update public.zoe_runs set reserved=true,estimate_usd=p_estimate_usd where id=r.id;end if;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.spend.reserve','outcome',case when code is null then 'allow'else 'block'end,
  'reason',coalesce(code,'within_daily_spend_cap'),'rule',case when code in('model_calls_not_permitted','judge_calls_not_permitted')then 'zoe.k2.launch_gate'else 'zoe.k7.daily_spend_cap'end,'ruleVersion','k7-a-2026-10-20-member-cap','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.guard.name','spend_cap','noreon.zoe.spent_today_usd',spent,'noreon.zoe.estimate_usd',p_estimate_usd,'noreon.zoe.daily_cap_usd',cap,
   'noreon.zoe.tier',p_tier,'noreon.zoe.tier_spent_today_usd',tier_spent,'noreon.zoe.tier_cap_usd',tier_cap,'noreon.zoe.member_spent_today_usd',member_spent,'noreon.zoe.member_cap_usd',member_cap,
   'noreon.zoe.judge_model',coalesce(p_judge_model,'none'),
   'noreon.zoe.spend_day',r.spend_day::text,'noreon.zoe.provider_local',p_local,'noreon.zoe.staging_ai_mode',coalesce(s.staging_ai_mode,false)))));
 return case when code is null then jsonb_build_object('ok',true)else jsonb_build_object('ok',false,'code',code)end;
end$$;

create or replace function public.zoe_run_context(p_runs uuid[])returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare on_ boolean:=coalesce((select conversational_replies_enabled from public.zoe_settings where singleton),false);
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_runs is null or cardinality(p_runs)>50 then return '[]'::jsonb;end if;
 return coalesce((select jsonb_agg(jsonb_build_object('runId',r.id,'enabled',on_,
   'doctorName',(select ws.display_name from public.patient_clinical_cases cs join public.workspace_staff ws on ws.user_id=cs.assigned_doctor_id and ws.active and ws.removed_at is null
     where cs.user_id=r.member_id limit 1),
   -- Abuse limits: the member's Zoe spend today and the runs with a suspected injection in 24 hours.
   'memberSpentTodayUsd',coalesce((select sum(coalesce(z.cost_usd,z.estimate_usd))from public.zoe_runs z where z.member_id=r.member_id and z.reserved and z.spend_day=r.spend_day),0),
   'memberDailyCapUsd',(select least(coalesce(s.member_daily_cap_usd,3.00),least(coalesce(s.daily_spend_cap_usd,0),10))from public.zoe_settings s where s.singleton),
   'injectionsLast24h',(select count(*)from public.zoe_runs z where z.member_id=r.member_id and z.id<>r.id and z.state='finished'and z.finished_at>clock_timestamp()-interval '24 hours'
     and z.injection_detected),
   'locale',(select case when pr.locale='en'then 'en'else 'hy'end from public.profiles pr where pr.id=r.member_id),
   'answeredThroughSeq',greatest(
     coalesce((select max(a.message_seq)from public.zoe_member_answers a where a.conversation_id=r.conversation_id),0),
     coalesce((select max(ap.context_version)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=r.conversation_id),0))))
  from public.zoe_runs r where r.id=any(p_runs)and r.state='started'),'[]'::jsonb);
end$$;
