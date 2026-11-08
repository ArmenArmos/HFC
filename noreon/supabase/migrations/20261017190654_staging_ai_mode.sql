-- Staging AI mode (Khikar, 17 Oct 2026 22:53: "we are not live yet, this is testing, we need to have
-- it to test, all the paperwork will be done later"). Real model calls for Zoe and lab PDF reading on
-- prod-as-staging. The DPA, the S1 urgent list and the legal check become go-live gates
-- (GO_LIVE_GATES "staging AI on").
--
-- Everything stays OFF by default. Real calls need, in the database:
--  1. zoe_settings.model_calls_allowed = true, which a trigger allows only when
--     a) staging_ai_mode is true (prod-as-staging, no real members), or every provider the tiers use
--        has a signed data agreement (zoe_model_providers.data_agreement, #217), and
--     b) each tier's current primary model has a passing model-mode eval run (zoe_eval_runs, #211
--        Fable F-2) from the last 7 days;
--  2. and at every call, zoe_run_reserve / lab_ai_call_reserve re-check: staging_ai_mode, or the
--     called model's provider has a signed agreement. The tier and total caps (US$10/day) are
--     unchanged and still checked in the same lock.
-- In the app the Gateway adapter still needs NOREON_ZOE_PROVIDER / NOREON_LAB_AI_PROVIDER =gateway,
-- NOREON_ZOE_MODEL_CALLS_ENABLED=true, and NOREON_PRELAUNCH_STAGING=true (or NOREON_ZOE_DPA_CONFIRMED).
--
-- Direct answers: Zoe may answer a member's logistics or app-help message herself (the app's fixed
-- rules decide; health is always a doctor draft). Its own switch, direct_answers_enabled, default off.
-- The answer is stored (zoe_member_answers), shown to the doctor, used as conversation context, and
-- for a Telegram message queued as a system message (template zoe.answer, held until approved). A
-- stand-in (fake) answer is never stored or sent.
--
-- The urgent route is unchanged: urgent words stop the run in the app before routing, reservation or
-- any model. Telegram urgent messages also get the fixed zoe.urgent template (placeholder wording,
-- held until approved).

-- 1. Settings ------------------------------------------------------------------------------------------
alter table public.zoe_settings drop constraint zoe_settings_model_calls_allowed_check;
alter table public.zoe_settings
 add column staging_ai_mode boolean not null default false,
 add column direct_answers_enabled boolean not null default false;
comment on column public.zoe_settings.staging_ai_mode is
 'Prod-as-staging only: real AI calls without a signed data agreement. Must be false before real members (GO_LIVE_GATES).';
comment on column public.zoe_settings.direct_answers_enabled is
 'Zoe may send her own answer to logistics and app-help messages (app rules decide; health stays a doctor draft).';

-- Real calls are allowed for a model when calls are on and the deployment is staging or the
-- model's provider signed a data agreement.
create function public._zoe_real_calls_permitted(p_model text)returns boolean
language sql stable security definer set search_path=''as $$
 select coalesce((select s.model_calls_allowed and(s.staging_ai_mode or exists(select 1 from public.zoe_model_providers p
   where p.provider=split_part(p_model,'/',1)and p.data_agreement='signed'))from public.zoe_settings s where s.singleton),false)
$$;

create function public._zoe_settings_guard()returns trigger language plpgsql set search_path=''as $$
declare missing text;
begin
 if not new.model_calls_allowed then return new;end if;
 if not new.staging_ai_mode and exists(select 1 from public.zoe_tier_config c join public.zoe_model_catalog m on m.model_id in(c.model_id,c.fallback_model_id)
  join public.zoe_model_providers p on p.provider=m.provider where p.data_agreement<>'signed')then
  raise exception using errcode='23514',message='Real AI calls need staging_ai_mode or a signed data agreement for every configured provider';
 end if;
 -- The eval check runs when calls are switched on (or the basis changes), not on every later
 -- settings change: an expired eval must not block lowering the cap (Fable F5, #236).
 if tg_op='UPDATE'and old.model_calls_allowed and old.staging_ai_mode is not distinct from new.staging_ai_mode then return new;end if;
 select string_agg(c.tier,',' order by c.tier)into missing from public.zoe_tier_config c
  where not exists(select 1 from public.zoe_eval_runs e where e.mode='model'and e.tier=c.tier and e.model_id=c.model_id
   and e.must_failures=0 and e.total_rows>=262 and e.created_at>clock_timestamp()-interval '7 days');
 if missing is not null then
  raise exception using errcode='23514',message='Real AI calls need a passing model-mode eval run for each tier model (missing: '||missing||')';
 end if;
 return new;
end$$;
create trigger zoe_settings_guard before insert or update on public.zoe_settings for each row execute function public._zoe_settings_guard();

-- 2. Reservations re-check the basis at every call ----------------------------------------------------------
-- Bodies unchanged from 20261017165252_lab_ai_extraction.sql except the first refusal.
create or replace function public.zoe_run_reserve(p_run uuid,p_estimate_usd numeric,p_local boolean,p_events jsonb,p_tier text,p_model text)returns jsonb
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
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(r.spend_day,p_tier)x;
 code:=case when not p_local and not public._zoe_real_calls_permitted(p_model)then 'model_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'end;
 update public.zoe_runs set tier=p_tier where id=r.id;
 if code is null then update public.zoe_runs set reserved=true,estimate_usd=p_estimate_usd where id=r.id;end if;
 perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.spend.reserve','outcome',case when code is null then 'allow'else 'block'end,
  'reason',coalesce(code,'within_daily_spend_cap'),'rule',case when code='model_calls_not_permitted'then 'zoe.k2.launch_gate'else 'zoe.k7.daily_spend_cap'end,'ruleVersion','k7-a-2026-10-17-staging','actor','system',
  'attributes',jsonb_build_object('noreon.zoe.guard.name','spend_cap','noreon.zoe.spent_today_usd',spent,'noreon.zoe.estimate_usd',p_estimate_usd,'noreon.zoe.daily_cap_usd',cap,
   'noreon.zoe.tier',p_tier,'noreon.zoe.tier_spent_today_usd',tier_spent,'noreon.zoe.tier_cap_usd',tier_cap,
   'noreon.zoe.spend_day',r.spend_day::text,'noreon.zoe.provider_local',p_local,'noreon.zoe.staging_ai_mode',coalesce(s.staging_ai_mode,false)))));
 return case when code is null then jsonb_build_object('ok',true)else jsonb_build_object('ok',false,'code',code)end;
end$$;

create or replace function public.lab_ai_call_reserve(p_job uuid,p_lease uuid,p_purpose text,p_tier text,p_model text,p_local boolean,p_estimate_usd numeric)returns jsonb
language plpgsql security definer set search_path=''as $$
declare j public.lab_ai_jobs;s public.zoe_settings;c public.zoe_tier_config;spent numeric;tier_spent numeric;cap numeric;tier_cap numeric;code text;day date;v_call uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 if p_purpose is null or p_purpose not in('extract','summary')or p_tier is null or p_tier not in('low','medium','high')or coalesce(p_model,'')!~'^[a-z0-9_.:/-]{1,80}$'
  or p_local is null or p_estimate_usd is null or p_estimate_usd<0 or p_estimate_usd>100 then return jsonb_build_object('ok',false,'code','invalid');end if;
 perform pg_advisory_xact_lock(hashtextextended('zoe-spend-cap',0));
 select * into j from public.lab_ai_jobs where id=p_job for update;
 if not found or j.state<>'running'or j.lease_token is distinct from p_lease then return jsonb_build_object('ok',false,'code','job_not_running');end if;
 if(select count(*)from public.lab_ai_calls where job_id=j.id)>=6 then return jsonb_build_object('ok',false,'code','job_call_limit');end if;
 select * into s from public.zoe_settings where singleton;
 select * into c from public.zoe_tier_config where tier=p_tier;
 day:=(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date;
 cap:=least(coalesce(s.daily_spend_cap_usd,0),10);
 tier_cap:=least(coalesce(c.daily_cap_usd,0),cap);
 select x.total,x.tier_total into spent,tier_spent from public._ai_spend(day,p_tier)x;
 code:=case when not p_local and not public._zoe_real_calls_permitted(p_model)then 'model_calls_not_permitted'
  when c.tier is null then 'tier_not_configured'
  when not p_local and p_model is distinct from c.model_id and p_model is distinct from c.fallback_model_id then 'model_not_configured_for_tier'
  when tier_spent+p_estimate_usd>tier_cap then 'tier_spend_cap_reached'
  when spent+p_estimate_usd>cap then 'daily_spend_cap_reached'end;
 insert into public.lab_ai_calls(job_id,purpose,tier,model,local,spend_day,estimate_usd,reserved,refusal)
  values(j.id,p_purpose,p_tier,p_model,p_local,day,p_estimate_usd,code is null,code)returning lab_ai_calls.id into v_call;
 return case when code is null then jsonb_build_object('ok',true,'callId',v_call)else jsonb_build_object('ok',false,'code',code,'callId',v_call)end;
end$$;

-- 3. Direct answers ---------------------------------------------------------------------------------------------
alter table public.zoe_runs drop constraint zoe_runs_outcome_check;
alter table public.zoe_runs add constraint zoe_runs_outcome_check check(outcome in('draft_proposed','draft_blocked','summary_only','discarded','no_output','stale','skipped','answered'));

create table public.zoe_member_answers (
 id uuid primary key default gen_random_uuid(),
 conversation_id uuid not null references public.conversations(id)on delete cascade,
 member_id uuid not null references auth.users(id)on delete cascade,
 run_id uuid not null unique references public.zoe_runs(id)on delete cascade,
 message_seq bigint not null,
 body text not null check(length(body)between 1 and 700 and body=btrim(body)),
 language text not null check(language in('en','hy','ru')),
 provider text not null check(provider ~ '^[a-z0-9_.-]{1,64}$'and provider<>'noreon.fake'),
 model text not null check(model ~ '^[a-z0-9_.:/-]{1,80}$'),
 -- The Telegram delivery, when the answered message came from Telegram.
 system_message_id uuid references public.system_messages(id),
 created_at timestamptz not null default clock_timestamp()
);
create index zoe_member_answers_conversation on public.zoe_member_answers(conversation_id,created_at desc);
comment on table public.zoe_member_answers is
 'Zoe''s direct answers to members (logistics and app help only, guarded). Member-facing text; deleted with the account.';
alter table public.zoe_member_answers enable row level security;
revoke all on public.zoe_member_answers from public,anon,authenticated,service_role;

-- Free-text system messages: a template whose body is a label, not the text. The claim then checks
-- the message's own hash instead of comparing with the template body. Approval still applies.
alter table public.system_message_templates add column free_body boolean not null default false;
insert into public.system_message_templates(template_id,version,locale,body,free_body,approval_note)values
 ('zoe.answer',1,'en','Zoe direct answer (free text, guarded by lib/zoe/output-guard.ts).',true,'Approve to let Zoe''s guarded direct answers reach Telegram (staging AI mode).'),
 ('zoe.answer',1,'hy','Zoe direct answer (free text, guarded by lib/zoe/output-guard.ts).',true,'Approve to let Zoe''s guarded direct answers reach Telegram (staging AI mode).'),
 ('zoe.urgent',1,'en','STAGING PLACEHOLDER, not clinically approved. Your message may describe an emergency. If you may be in danger, call 103 now. Zoe cannot help in an emergency.',false,'S1/S6 wording pending'),
 ('zoe.urgent',1,'hy','STAGING PLACEHOLDER, not clinically approved. Ձեր հաղորդագրությունը կարող է շտապ դեպք նկարագրել։ Եթե կարծում եք, որ վտանգի մեջ եք, անմիջապես զանգահարեք 103։ Zoe-ն չի կարող օգնել շտապ դեպքում։',false,'S1/S6 wording pending');

create or replace function public.system_message_claim(p_message uuid,p_attempt uuid)returns jsonb
language plpgsql security definer set search_path=''as $$
declare sm public.system_messages;t public.system_message_templates;ep public.conversation_endpoints;p public.conversation_policy;envelope jsonb;hold_reason text;
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
 hold_reason:=case
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

-- Queues one free-text system message (a Zoe answer) on the endpoint the member's message came in on.
create function public._zoe_answer_enqueue(m uuid,p_inbox uuid,p_body text)returns uuid
language plpgsql security definer set search_path=''as $$
declare l text;t public.system_message_templates;ep public.conversation_endpoints;new_id uuid;
begin
 select e.* into ep from public.channel_inbox i join public.conversation_endpoints e on e.id=i.endpoint_id where i.id=p_inbox;
 if not found or ep.member_id<>m or not ep.active then return null;end if;
 select coalesce((select locale from public.profiles where id=m),'hy')into l;
 select * into t from public.system_message_templates where template_id='zoe.answer'and locale=l and free_body order by version desc limit 1;
 if not found then return null;end if;
 insert into public.system_messages(member_id,template_id,template_version,locale,body,body_hash,endpoint_id,endpoint_generation,source_inbox_id)
 values(m,t.template_id,t.version,t.locale,p_body,public._system_message_hash(t.template_id,t.version,t.locale,p_body),ep.id,ep.generation,p_inbox)
 on conflict(source_inbox_id,template_id)do nothing returning system_messages.id into new_id;
 if new_id is not null then perform public._system_message_audit(new_id,'enqueued',jsonb_build_object('template',t.template_id,'version',t.version,'locale',t.locale));end if;
 return new_id;
end$$;

-- 4. Claim: app messages too (same as the in-app chat lane), Zoe's earlier answers as context, and the switch ----
create or replace function public.zoe_run_claim(p_limit integer)returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;rec record;r public.zoe_runs;jobs jsonb:='[]';consent boolean;skip text;since timestamptz;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 for r in update public.zoe_runs set state='finished',outcome='no_output',reason_code='worker_lost',finished_at=clock_timestamp()
  where state='started'and started_at<clock_timestamp()-interval '10 minutes'returning * loop
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.route','outcome','failed','reason','worker_lost','rule','zoe.pipeline','ruleVersion','1','actor','system','attributes',jsonb_build_object('noreon.zoe.run.outcome','no_output'))));
 end loop;
 select * into s from public.zoe_settings where singleton;
 for rec in
  select c.id conversation_id,c.member_id,c.version,c.draft_epoch,lm.seq,cs.assigned_doctor_id,pr.display_name
  from public.conversations c
  join lateral(select m.seq,m.source,m.created_at from public.conversation_messages m where m.conversation_id=c.id order by m.seq desc limit 1)lm on true
  join public.patient_clinical_cases cs on cs.user_id=c.member_id
  left join public.profiles pr on pr.id=c.member_id
  where lm.source in('telegram_member','authenticated_member')and lm.created_at>clock_timestamp()-interval '24 hours'
   and not exists(select 1 from public.zoe_runs zr where zr.conversation_id=c.id and zr.message_seq>=lm.seq)
  order by lm.created_at limit greatest(1,least(coalesce(p_limit,10),20))
  for update of c skip locked
 loop
  -- K4: consent counts only while collection is on with a server-held wording.
  consent:=s.singleton is not null and s.consent_collection_enabled and s.consent_wording_version is not null
   and coalesce((select granted from public.zoe_consents where member_id=rec.member_id and kind='zoe_reads_messages'order by id desc limit 1),false);
  skip:=case when s.singleton is null or not s.consent_collection_enabled or s.consent_wording_version is null then 'zoe_settings_off'
   when not consent then 'no_zoe_reads_messages_consent' when rec.assigned_doctor_id is null then 'no_assigned_doctor'
   -- Fable Z-F3: a message the doctor already answered gets no AI draft.
   when exists(select 1 from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id
    where d.conversation_id=rec.conversation_id and ap.context_version>=rec.version)then 'already_answered'end;
  insert into public.zoe_runs(conversation_id,member_id,message_seq,context_version,draft_epoch,spend_day,state,outcome,reason_code,finished_at)
  values(rec.conversation_id,rec.member_id,rec.seq,rec.version,rec.draft_epoch,(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date,
   case when skip is null then 'started'else 'finished'end,case when skip is null then null else 'skipped'end,skip,case when skip is null then null else clock_timestamp()end)
  on conflict(conversation_id,message_seq)do nothing returning * into r;
  if r.id is null then continue;end if;
  perform public._zoe_run_events(r,jsonb_build_array(jsonb_build_object('name','zoe.guard.consent','outcome',case when skip is null then 'allow'else 'block'end,
   'reason',coalesce(skip,'zoe_reads_messages_granted'),'rule','zoe.consent','ruleVersion',coalesce(s.consent_wording_version,'none'),'actor','system',
   'attributes',jsonb_build_object('noreon.zoe.guard.name','consent','noreon.zoe.consent.kind','zoe_reads_messages'))));
  if skip is not null then r:=null;continue;end if;
  -- The window: member messages since the last approved reply (at most 20), the last approved
  -- replies, and Zoe's own answers in the same window (at most 10).
  since:=(select max(ap.created_at)from public.conversation_approvals ap join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id);
  jobs:=jobs||jsonb_build_array(jsonb_build_object('runId',r.id,'memberId',rec.member_id,'messageSeq',rec.seq,'displayName',rec.display_name,
   'messages',(select jsonb_agg(jsonb_build_object('seq',w.seq,'text',w.body,'minutesAgo',w.ago)order by w.seq)from(
     select m.seq,m.body,floor(extract(epoch from clock_timestamp()-m.created_at)/60)::integer ago from public.conversation_messages m
     where m.conversation_id=rec.conversation_id and m.seq<=rec.seq and(since is null or m.created_at>since or m.seq=rec.seq)order by m.seq desc limit 20)w),
   'replies',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select ap.body,ap.created_at,floor(extract(epoch from clock_timestamp()-ap.created_at)/60)::integer ago from public.conversation_approvals ap
     join public.conversation_drafts d on d.id=ap.draft_id where d.conversation_id=rec.conversation_id order by ap.created_at desc limit 3)x),'[]'),
   'answers',coalesce((select jsonb_agg(jsonb_build_object('body',x.body,'minutesAgo',x.ago)order by x.created_at)from(
     select a.body,a.created_at,floor(extract(epoch from clock_timestamp()-a.created_at)/60)::integer ago from public.zoe_member_answers a
     where a.conversation_id=rec.conversation_id and(since is null or a.created_at>since)order by a.created_at desc limit 10)x),'[]'),
   'directAnswers',coalesce(s.direct_answers_enabled,false)));
  r:=null;
 end loop;
 return jobs;
end$$;

-- 5. Finish: the answered outcome (everything else unchanged from 20261017135503 §12) -------------------------
create or replace function public.zoe_run_finish(p_run uuid,p_result jsonb)returns jsonb
language plpgsql security definer set search_path=''as $$
declare r public.zoe_runs;c public.conversations;v_outcome text;v_reason text;d uuid;cr bigint;src text;v_summary text;v_draft text;v_sealed text;reasons text[];v_tier text;v_tier_reason text;
 v_answer text;v_lang text;msg public.conversation_messages;aid uuid;smid uuid;
begin
 if auth.role()is distinct from 'service_role'then raise insufficient_privilege;end if;
 select * into r from public.zoe_runs where id=p_run for update;
 if not found then return jsonb_build_object('ok',false,'code','run_unknown');end if;
 if r.state='finished'then return jsonb_build_object('ok',true,'outcome',r.outcome,'replayed',true);end if;
 v_outcome:=p_result->>'outcome';v_reason:=p_result->>'reason';v_summary:=nullif(btrim(p_result->>'summary'),'');v_draft:=nullif(btrim(p_result->>'draft'),'');v_sealed:=p_result->>'sealed';
 v_answer:=nullif(btrim(p_result->>'answer'),'');v_lang:=p_result->>'language';
 v_tier:=coalesce(p_result->>'tier',r.tier,'none');v_tier_reason:=coalesce(p_result->>'tierReason','not_routed');
 if length(v_sealed)>200000 then v_sealed:=null;end if;
 if v_outcome is null or v_outcome not in('draft_proposed','draft_blocked','summary_only','discarded','no_output','answered')or coalesce(v_reason,'')!~'^[a-z0-9_.:-]{1,80}$'
  or length(v_summary)>4000 or length(v_draft)>2000 or(v_outcome='draft_proposed'and(v_draft is null or v_summary is null))
  -- An answer is only ever for the low tier, with a summary for the doctor, from a reserved call.
  or(v_outcome='answered'and(v_answer is null or length(v_answer)>700 or v_summary is null or v_tier<>'low'or not r.reserved or coalesce(v_lang,'')not in('en','hy','ru')))
  or jsonb_typeof(coalesce(p_result->'guardReasons','[]'))<>'array'
  or coalesce(p_result->>'provider','none')!~'^[a-z0-9_.-]{1,64}$'or coalesce(p_result->>'model','none')!~'^[a-z0-9_.:/-]{1,80}$'
  or coalesce((p_result->>'costUsd')::numeric,0)<0
  or v_tier not in('none','low','medium','high')or v_tier_reason!~'^[a-z0-9_.:-]{1,80}$'
  -- A reserved run keeps the tier it reserved against.
  or(r.tier is not null and v_tier<>r.tier)then
  return jsonb_build_object('ok',false,'code','invalid');end if;
 select coalesce(array_agg(x)filter(where x~'^[a-z0-9_.:-]{1,80}$'),'{}')into reasons from jsonb_array_elements_text(p_result->'guardReasons')x;
 perform public._zoe_run_events(r,p_result->'events');
 if v_outcome='answered'then
  select * into c from public.conversations where id=r.conversation_id for update;
  if c.version<>r.context_version then v_outcome:='stale';v_reason:='newer_member_message';
  elsif c.draft_epoch<>r.draft_epoch then v_outcome:='stale';v_reason:='doctor_work_since_claim';
  elsif not coalesce((select direct_answers_enabled from public.zoe_settings where singleton),false)then v_outcome:='summary_only';v_reason:='direct_answers_off';
  -- The stand-in's fixed text never reaches a member.
  elsif coalesce(p_result->>'provider','none')in('none','noreon.fake')then v_outcome:='summary_only';v_reason:='stand_in_answer_not_sent';
  -- Only Telegram can show the answer today; an app message keeps the doctor flow (Fable F4, #236)
  -- until the in-app chat renders zoe_member_answers.
  elsif(select m.source from public.conversation_messages m where m.conversation_id=c.id and m.seq=r.message_seq)is distinct from 'telegram_member'then
   v_outcome:='summary_only';v_reason:='direct_answer_no_channel';
  else
   select * into msg from public.conversation_messages where conversation_id=c.id and seq=r.message_seq;
   insert into public.zoe_member_answers(conversation_id,member_id,run_id,message_seq,body,language,provider,model)
   values(c.id,r.member_id,r.id,r.message_seq,v_answer,v_lang,p_result->>'provider',coalesce(p_result->>'model','none'))returning id into aid;
   if msg.source='telegram_member'and msg.request_id is not null then
    smid:=public._zoe_answer_enqueue(r.member_id,msg.request_id,v_answer);
    update public.zoe_member_answers set system_message_id=smid where id=aid;
   end if;
   insert into public.conversation_audit(conversation_id,actor_id,kind,detail)values(c.id,null,'zoe.answered',jsonb_build_object('runId',r.id,'answerId',aid,'seq',r.message_seq,'telegram',smid is not null));
  end if;
 elsif v_outcome='draft_proposed'then
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
 -- Telegram urgent messages also get the fixed urgent template (held until approved); app ones see the 103 screen.
 if v_outcome='discarded'and v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call')then
  select * into msg from public.conversation_messages where conversation_id=r.conversation_id and seq=r.message_seq;
  if msg.source='telegram_member'and msg.request_id is not null then
   perform public._system_message_enqueue('zoe.urgent',r.member_id,e,msg.request_id)from public.channel_inbox i join public.conversation_endpoints e on e.id=i.endpoint_id
    where i.id=msg.request_id and e.member_id=r.member_id and e.active;
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
  'outcome',case v_outcome when 'draft_proposed'then 'allow'when 'answered'then 'allow'when 'draft_blocked'then 'block'when 'summary_only'then 'recorded'when 'no_output'then 'failed'
   else case when v_reason in('urgent_route_no_model_call','urgent_in_window_no_model_call')then 'escalate'else 'skipped'end end,
  'reason',v_reason,'rule','zoe.pipeline','ruleVersion',left(coalesce(p_result->>'configVersion','unknown'),80),'actor','system',
  'attributes',jsonb_strip_nulls(jsonb_build_object('noreon.zoe.run.outcome',v_outcome,'noreon.draft.id',d::text,'noreon.zoe.answer.id',aid::text,'noreon.zoe.answer.telegram',smid is not null,
   'noreon.zoe.cost_usd',r.cost_usd,'gen_ai.usage.input_tokens',r.input_tokens,'gen_ai.usage.output_tokens',r.output_tokens,'noreon.zoe.latency_ms',r.latency_ms,
   'noreon.zoe.tier',r.tier,'noreon.zoe.tier_reason',r.tier_reason,'gen_ai.request.model',left(r.model,128),'noreon.zoe.fallback_used',r.fallback_used,
   'noreon.zoe.guard.reasons',left(array_to_string(reasons,','),128),'noreon.zoe.io_stored',r.sealed_io is not null)))));
 return jsonb_build_object('ok',true,'outcome',v_outcome,'replayed',false,'draftId',d,'answerId',aid);
end$$;

-- 6. The doctor sees what Zoe told the member -------------------------------------------------------------------
create or replace function public.zoe_runs_for_doctor(p_member uuid)returns jsonb
language plpgsql stable security definer set search_path=''as $$
declare who jsonb:=public.real_clinical_staff_identity();
begin
 if who is null or who->>'role'<>'doctor'or not exists(select 1 from public.patient_clinical_cases where user_id=p_member and assigned_doctor_id=auth.uid())then raise insufficient_privilege;end if;
 return jsonb_build_object('ok',true,'runs',coalesce((select jsonb_agg(jsonb_build_object('id',z.id,'messageSeq',z.message_seq,'outcome',z.outcome,'reason',z.reason_code,
  'summary',z.summary,'guardReasons',to_jsonb(z.guard_reasons),'provider',z.provider,'model',z.model,'draftId',z.draft_id,
  'draftState',(select d.state from public.conversation_drafts d where d.id=z.draft_id),
  'draftCurrent',(select d.context_version=c.version from public.conversation_drafts d join public.conversations c on c.id=d.conversation_id where d.id=z.draft_id),
  'answer',(select a.body from public.zoe_member_answers a where a.run_id=z.id),'finishedAt',z.finished_at)order by z.finished_at desc)
  from(select * from public.zoe_runs where member_id=p_member and state='finished'and outcome<>'skipped'order by finished_at desc limit 5)z),'[]'));
end$$;

-- 6b. The admin page shows the staging and direct-answer switches (body otherwise unchanged from
-- 20261017165252_lab_ai_extraction.sql).
create or replace function public.zoe_ai_settings_admin()returns jsonb
language plpgsql security definer set search_path=''as $$
declare s public.zoe_settings;today date;
begin
 perform public._real_staff_require_admin();
 select * into s from public.zoe_settings where singleton;
 today:=(clock_timestamp()at time zone coalesce(s.time_zone,'Asia/Yerevan'))::date;
 return jsonb_build_object('ok',true,
  'modelCallsAllowed',coalesce(s.model_calls_allowed,false),'settingsRow',s.singleton is not null,
  'stagingAiMode',coalesce(s.staging_ai_mode,false),'directAnswersEnabled',coalesce(s.direct_answers_enabled,false),
  'totalCapUsd',least(coalesce(s.daily_spend_cap_usd,0),10),'spendDay',today,
  'spentTodayUsd',(select x.total from public._ai_spend(today,null)x),
  'tiers',(select jsonb_agg(public._zoe_tier_json(c)||jsonb_build_object('tier',c.tier,'updatedAt',c.updated_at,
    'spentTodayUsd',(select x.tier_total from public._ai_spend(today,c.tier)x))
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

-- 7. Grants ----------------------------------------------------------------------------------------------------------
revoke all on function public.zoe_ai_settings_admin()from public,anon,authenticated,service_role;
grant execute on function public.zoe_ai_settings_admin()to authenticated;
revoke all on function public._zoe_real_calls_permitted(text),public._zoe_settings_guard(),public._zoe_answer_enqueue(uuid,uuid,text)from public,anon,authenticated,service_role;
