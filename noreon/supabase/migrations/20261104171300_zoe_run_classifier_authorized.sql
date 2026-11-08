-- Zoe: may this run's redacted message text go to a classifier at another provider (the OpenAI Decisions API, lib/zoe/decisions.ts)?
-- Read-only: the same checks the reservation makes (consent now, real calls permitted for that provider's model, daily and member caps), nothing
-- recorded and nothing reserved, so the answer can be asked before any request leaves. The classifier is a separate data processor from the
-- answering model: its provider needs its own signed data agreement (or staging_ai_mode before launch), exactly like a model in zoe_run_reserve.
-- A refusal is a code, never an error; the app sends nothing and carries on as it does today.
create function public.zoe_run_classifier_authorized(p_run uuid,p_model text default 'openai/gpt-6-luna')returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;s public.zoe_settings;spent numeric;member_spent numeric;cap numeric;member_cap numeric;code text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'then return jsonb_build_object('ok',false,'code','invalid');end if;
 select * into r from public.zoe_runs where id=p_run;
 if not found or r.state<>'started'then return jsonb_build_object('ok',false,'code','run_not_authorizable');end if;
 if not public._zoe_consent_ok(r.member_id)then return jsonb_build_object('ok',false,'code','no_zoe_reads_messages_consent');end if;
 select * into s from public.zoe_settings where singleton;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 member_cap:=least(coalesce(s.member_daily_cap_usd,3.00),cap);
 select x.total into spent from public._ai_spend(r.spend_day,'low')x;
 select coalesce(sum(coalesce(z.cost_usd,z.estimate_usd)),0)into member_spent from public.zoe_runs z where z.member_id=r.member_id and z.reserved and z.spend_day=r.spend_day;
 code:=case when not public._zoe_real_calls_permitted(p_model)then 'model_calls_not_permitted'
  when not public._ai_cap_room(coalesce(spent,0),0.001,cap)then 'daily_spend_cap_reached'
  when member_spent>=member_cap then 'member_spend_cap_reached'end;
 return case when code is null then jsonb_build_object('ok',true)else jsonb_build_object('ok',false,'code',code)end;
end$$;
revoke all on function public.zoe_run_classifier_authorized(uuid,text)from public,anon,authenticated,service_role;
grant execute on function public.zoe_run_classifier_authorized(uuid,text)to service_role;
