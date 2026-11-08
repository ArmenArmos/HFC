-- Codex Astra A2 (2026-10-20 audit of Zoe safety), the database half. lib/zoe/pipeline.ts carries the rest.
--
-- A2-2: zoe_run_finish (the doctor-mode guard of 20261020082321 / 20261021070207) lets the fixed same-day line through in doctor
--  mode: outcome summary_only, reason same_day_floor_*, health.urgency same_day, a receipt. Everything else as 20261021070207.
-- A2-3: consent withdrawal stops runs that were already claimed. zoe_run_reserve and zoe_run_finish check consent again with the
--  claim's own rule (_zoe_consent_ok), under the conversation row lock, which the withdrawal now takes too (trigger on
--  zoe_consents). A withdrawal holds the member's queued ordinary Zoe texts on Telegram; the claim re-checks at dispatch.
--  Decision: the fixed 103 texts (zoe_member_answers.kind 'urgent': urgent route, red flags, crisis) stay deliverable. The coach
--  withdrawal (20261020103406) cancels coach texts, none of which is a safety text; withholding 103 advice from a member who wrote
--  an emergency is the greater harm. Lead to confirm.
-- A2-5: a doctor's approved reply holds the member's queued ordinary Zoe texts for the doctor's matter: all of them with the
--  'conversation' scope, those for messages up to the reply's context version with the 'topic' scope (20261021070207). The claim
--  revalidates at dispatch. 103 texts stay deliverable; the doctor-mode notices (zoe.mode) are not Zoe answers and are untouched.

-- The claim's consent rule (zoe_run_claim, 20261020103406), one place.
create function public._zoe_consent_ok(m uuid)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select s.consent_collection_enabled and s.consent_wording_version is not null and public._zoe_consent_current(m,'zoe_reads_messages')
  from public.zoe_settings s where s.singleton),false)
$$;

-- Why a queued system message must not go now, for an ordinary Zoe text; null for anything else (a 103 text, a template that is not
-- a Zoe answer). Consent as at the claim; a doctor's reply approved after the text was written, in the taken-over scope.
create function public._zoe_text_hold(p_message uuid)returns text
language sql stable security definer set search_path=''as $$
 select case when a.id is null or a.kind='urgent'then null
  when not public._zoe_consent_ok(a.member_id)then 'zoe_consent_withdrawn'
  when public._zoe_doctor_mode(a.conversation_id)and exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
   where d.conversation_id=a.conversation_id and ap.created_at>a.created_at and(public._zoe_takeover_scope()='conversation'or a.message_seq<=ap.context_version))then 'doctor_takeover'
 end
 from(select 1)x left join public.zoe_member_answers a on a.system_message_id=p_message
$$;

-- Holds the queued ordinary Zoe texts of one conversation (p_through_seq: only answers to messages up to it; null: all).
create function public._zoe_text_hold_queued(p_conversation uuid,p_reason text,p_through_seq bigint)returns integer
language plpgsql security definer set search_path=''as $$
declare sm public.system_messages;n integer:=0;
begin
 for sm in update public.system_messages s set state='held',reason=p_reason,state_seq=s.state_seq+1,updated_at=clock_timestamp()
  from public.zoe_member_answers a where a.system_message_id=s.id and a.conversation_id=p_conversation and a.kind<>'urgent'and s.state='queued'
   and(p_through_seq is null or a.message_seq<=p_through_seq)
  returning s.* loop
  perform public._system_message_audit(sm.id,'held',jsonb_build_object('reason',p_reason));n:=n+1;
 end loop;
 return n;
end$$;

-- A2-3: the withdrawal, in its own transaction, under the conversation lock (reserve and finish take it too).
create function public._zoe_text_hold_on_withdrawal()returns trigger language plpgsql security definer set search_path=''as $$
declare c uuid;
begin
 if new.kind<>'zoe_reads_messages'or new.granted then return null;end if;
 select id into c from public.conversations where member_id=new.member_id for update;
 if c is not null then perform public._zoe_text_hold_queued(c,'zoe_consent_withdrawn',null);end if;
 return null;
end$$;
create trigger zoe_consents_zoe_text_hold after insert on public.zoe_consents for each row execute function public._zoe_text_hold_on_withdrawal();

-- A2-5: the takeover (runs after conversation_approvals_zoe_doctor_takeover, by name, inside conversation_command's lock).
create function public._zoe_text_hold_on_takeover()returns trigger language plpgsql security definer set search_path=''as $$
declare c uuid;
begin
 select d.conversation_id into c from public.conversation_drafts d where d.id=new.draft_id;
 if c is null or not public._zoe_doctor_mode(c)then return null;end if;
 perform public._zoe_text_hold_queued(c,'doctor_takeover',case when public._zoe_takeover_scope()='topic'then new.context_version end);
 return null;
end$$;
create trigger conversation_approvals_zoe_text_hold after insert on public.conversation_approvals for each row execute function public._zoe_text_hold_on_takeover();

-- A2-3: the reservation (as 20261019210625, change marked 20261023063508).
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

-- A2-2, A2-3: the finish (as 20261021070207, changes marked 20261023063508).
create or replace function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;o text;rs text;safety boolean;same_day boolean;held jsonb;res jsonb;tp jsonb;t_start integer;t_owner text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found or r.state='finished'or jsonb_typeof(p_result)is distinct from 'object'then return public._zoe_run_finish_core(p_run,p_result);end if;
 perform 1 from public.conversations where id=r.conversation_id for update;
 o:=p_result->>'outcome';rs:=p_result->>'reason';
 safety:=o='intake_escalated'or(o='discarded'and rs in('urgent_route_no_model_call','urgent_in_window_no_model_call','urgent_health_answer_model','urgent_health_answer_red_flag_yes'));
 -- 20261023063508 (Codex A2-2): the fixed same-day line on an exit (lib/zoe/pipeline.ts sameDayExit): a receipt, recorded as same-day.
 same_day:=o='summary_only'and coalesce(rs,'')like 'same\_day\_floor\_%'and p_result#>>'{health,urgency}'='same_day'and jsonb_typeof(p_result->'receipt')='object';
 -- 20261023063508 (Codex A2-3): consent again at publication, under the conversation lock the withdrawal takes. A withdrawn (or no
 -- longer current) consent publishes nothing ordinary: no answer, receipt, chat, intake turn, summary or draft. The fixed 103 texts
 -- (urgent route, red flag) still go: the member wrote an emergency, and withholding the 103 advice is the greater harm (the
 -- coach withdrawal of 20261020103406 cancels coach texts, none of which is a safety text).
 if not safety and not public._zoe_consent_ok(r.member_id)then
  held:=(p_result-'receipt'-'answer'-'language'-'intake'-'chat'-'health'-'summary'-'draft'-'topic')||jsonb_build_object('outcome','discarded','reason','consent_withdrawn');
  res:=public._zoe_run_finish_core(p_run,held);
  select * into r from public.zoe_runs where id=p_run;
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.consent','outcome','block','reason','consent_withdrawn_member_text_held',
   'rule','zoe.consent','ruleVersion','zoe-a2-consent-1','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','consent','noreon.zoe.consent.stage','finish',
   'noreon.zoe.consent.outcome',left(coalesce(o,'none'),40)))));
  return res;
 end if;
 -- 20261021070207: the topic, only when well formed (otherwise the run simply records none).
 tp:=case when jsonb_typeof(p_result->'topic')='object'then p_result->'topic'end;
 if tp is not null and tp->>'owner'in('zoe','doctor')and coalesce(tp->>'startSeq','')~'^[0-9]{1,9}$'and(tp->>'startSeq')::integer<=r.message_seq then
  t_start:=(tp->>'startSeq')::integer;t_owner:=tp->>'owner';end if;
 -- In doctor mode only the check's own verdict counts (doctorTopic "no", which a run that did not know about doctor mode never
 -- carries): a worker that could not read doctor mode is held as before.
 if not public._zoe_doctor_mode(r.conversation_id)or(t_owner='zoe'and tp->>'doctorTopic'='no'and public._zoe_takeover_scope()='topic')then
  res:=public._zoe_run_finish_core(p_run,p_result);
  if t_owner is not null then update public.zoe_runs set topic_start_seq=t_start,topic_owner=t_owner where id=p_run;end if;
  if t_owner='zoe'and public._zoe_doctor_mode(r.conversation_id)then
   select * into r from public.zoe_runs where id=p_run;
   perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.doctor_mode','outcome','allow','reason','doctor_mode_other_topic',
    'rule','zoe.doctor_mode','ruleVersion','zoe-doctor-mode-2','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','doctor_mode','noreon.zoe.doctor_mode.scope','topic'))));
  end if;
  return res;
 end if;
 if safety then res:=public._zoe_run_finish_core(p_run,p_result-'receipt');
 -- 20261023063508 (Codex A2-2): the fixed same-day line reaches the member in doctor mode too (it is the app's text, not Zoe's).
 elsif same_day then res:=public._zoe_run_finish_core(p_run,p_result);
 else
  -- Doctor-facing outcomes (and a discard with no text) keep their reason, summary and draft; nothing goes to the member.
  if o in('draft_proposed','draft_blocked','summary_only','no_output')or(o='discarded'and jsonb_typeof(p_result->'answer')is distinct from 'string')then
   held:=p_result-'receipt'-'answer'-'language';
  else held:=(p_result-'receipt'-'answer'-'language'-'intake'-'chat'-'health'-'summary'-'draft')||jsonb_build_object('outcome','discarded','reason','doctor_mode_held');
  end if;
  res:=public._zoe_run_finish_core(p_run,held);
  if p_result is distinct from held then
   select * into r from public.zoe_runs where id=p_run;
   perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.doctor_mode','outcome','block','reason','doctor_mode_member_text_held',
    'rule','zoe.doctor_mode','ruleVersion','zoe-doctor-mode-2','actor','system','attributes',jsonb_build_object('noreon.zoe.guard.name','doctor_mode',
    'noreon.zoe.doctor_mode.outcome',left(coalesce(o,'none'),40)))));
  end if;
 end if;
 -- A run held for the doctor belongs to the doctor's matter, whatever the worker said.
 if t_owner is not null then update public.zoe_runs set topic_start_seq=t_start,topic_owner='doctor'where id=p_run;end if;
 return res;
end$$;

-- A2-3, A2-5: the dispatch claim (as 20261017190654, change marked 20261023063508).
create or replace function public.system_message_claim(p_message uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare sm public.system_messages;t public.system_message_templates;ep public.conversation_endpoints;p public.conversation_policy;envelope jsonb;hold_reason text;zoe_hold text;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_message is null or p_attempt is null then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform set_config('lock_timeout','2s',true);
 select * into sm from public.system_messages where id=p_message for update;
 if not found then return jsonb_build_object('ok',false,'code','message_unknown');end if;
 if sm.state<>'queued'or exists(select 1 from public.system_message_attempts where id=p_attempt or message_id=p_message)then return jsonb_build_object('ok',false,'code','already_claimed_or_held');end if;
 select * into t from public.system_message_templates where template_id=sm.template_id and version=sm.template_version and locale=sm.locale;
 select * into p from public.conversation_policy where singleton;
 select * into ep from public.conversation_endpoints where id=sm.endpoint_id for share;
 -- 20261023063508 (Codex A2-3, A2-5): an ordinary Zoe text is revalidated at dispatch (consent, doctor takeover); 103 texts are not.
 zoe_hold:=public._zoe_text_hold(sm.id);
 hold_reason:=case
  when zoe_hold is not null then zoe_hold
  when not t.approved then 'template_unapproved'
  when not t.free_body and(t.body<>sm.body or public._system_message_hash(t.template_id,t.version,t.locale,t.body)<>sm.body_hash)then 'template_changed'
  when t.free_body and public._system_message_hash(t.template_id,t.version,t.locale,sm.body)<>sm.body_hash then 'template_changed'
  when p.singleton is null or not p.delivery_enabled then 'route_unavailable'
  when not ep.active or ep.expires_at<=clock_timestamp()or ep.member_id<>sm.member_id or ep.generation<>sm.endpoint_generation or ep.policy_version<>p.version then 'route_unavailable'
  when public._conversation_utf16(sm.body)>ep.max_utf16 then 'route_unavailable'
 end;
 if hold_reason is not null then
  update public.system_messages set state='held',reason=hold_reason,state_seq=state_seq+1,updated_at=clock_timestamp()where id=sm.id;
  perform public._system_message_audit(sm.id,'held',jsonb_build_object('reason',hold_reason));
  return jsonb_build_object('ok',false,'code',hold_reason);
 end if;
 envelope:=jsonb_build_object('messageId',sm.id,'attemptId',p_attempt,'address',ep.address,'text',sm.body,'bodyHash',sm.body_hash);
 update public.system_messages set state='sending',state_seq=state_seq+1,updated_at=clock_timestamp()where id=sm.id returning * into sm;
 insert into public.system_message_attempts(id,message_id,state_seq,envelope)values(p_attempt,sm.id,sm.state_seq,envelope);
 perform public._system_message_audit(sm.id,'claimed',jsonb_build_object('attemptId',p_attempt));
 return jsonb_build_object('ok',true,'fresh',true,'adapter',ep.adapter,'accountRef',ep.account_ref,'envelope',envelope);
exception when lock_not_available then return jsonb_build_object('ok',false,'code','busy');
end$$;

revoke all on function public._zoe_consent_ok(uuid),public._zoe_text_hold(uuid),public._zoe_text_hold_queued(uuid,text,bigint),
 public._zoe_text_hold_on_withdrawal(),public._zoe_text_hold_on_takeover()from public,anon,authenticated,service_role;
