-- Staging AI mode on prod-as-staging (Khikar, 17 Oct 2026 22:53). Run in the Supabase SQL editor of
-- noreon-staging AFTER the PR's migration (20261017190654_staging_ai_mode) is applied and the Vercel
-- env rows in docs/operations/staging-ai-mode.md are set and redeployed. Every step is reversible
-- (section R). Before real members: section R, then GO_LIVE_GATES "staging AI on".

-- 0. Read the current state (expect one settings row; consent collection on with zoe-consent-draft-2, the wording the app shows: lib/zoe/member.ts ZOE_CONSENT_VERSION; with any other version the Home card, the Zoe screen card and the Me switch offer no grant).
select consent_collection_enabled,consent_wording_version,model_calls_allowed,staging_ai_mode,direct_answers_enabled,daily_spend_cap_usd from public.zoe_settings;
select tier,model_id,fallback_model_id,daily_cap_usd from public.zoe_tier_config order by tier;

-- 0b. Only if step 0 returned no row or collection is off (the 17g step should already have done this):
-- insert into public.zoe_settings(consent_collection_enabled,consent_wording_version)values(true,'zoe-consent-draft-2')
--  on conflict(singleton)do update set consent_collection_enabled=true,consent_wording_version='zoe-consent-draft-2';

-- 1. Staging AI mode: real calls without a signed data agreement are allowed for TESTING ONLY.
update public.zoe_settings set staging_ai_mode=true;

-- 2. In the backoffice: Operations, AI settings, "Model eval with real calls": run it once per tier
--    (Low, Medium, High). Each takes about a minute and costs cents. Then check all three passed:
select tier,model_id,mode,total_rows,must_failures,failures,failed_ids,created_at from public.zoe_eval_runs
 where mode='model'and created_at>now()-interval '1 hour' order by created_at desc;

-- 3. Real calls on. The database refuses this unless every tier's current model has a passing model-mode
--    eval from the last 7 days (and staging_ai_mode is on, or every configured provider's DPA is signed).
update public.zoe_settings set model_calls_allowed=true;

-- 4. Zoe's own answers to logistics and app-help questions (health stays a doctor draft).
update public.zoe_settings set direct_answers_enabled=true;

-- 5. Telegram templates for Zoe: her guarded free-text answers, and the STAGING placeholder urgent message.
--    Both are placeholders for testing; re-decide before go-live (S1/S6).
update public.system_message_templates set approved=true,
 approval_note='Staging AI mode 17 Oct 2026 (lead, Khikar decision 22:53). Placeholder; re-approve before go-live.'
 where template_id in('zoe.answer','zoe.urgent')and version=1;

-- 6. Lab PDF reading with the real reader: nothing in SQL beyond step 3 (same gate). Check the switch:
select enabled from public.lab_ai_capabilities;

-- 7. Verify (after sending the test bot "Where can I see my visit times?" and, separately, a health question):
select z.finished_at,z.outcome,z.reason_code,z.tier,z.model,z.cost_usd,z.fallback_used from public.zoe_runs z order by z.started_at desc limit 10;
select a.created_at,a.language,a.model,sm.state,sm.reason from public.zoe_member_answers a left join public.system_messages sm on sm.id=a.system_message_id order by a.created_at desc limit 5;
select (select coalesce(sum(coalesce(cost_usd,estimate_usd)),0)from public.zoe_runs where reserved and spend_day=(now() at time zone 'Asia/Yerevan')::date)
     +(select coalesce(sum(coalesce(cost_usd,estimate_usd)),0)from public.lab_ai_calls where reserved and spend_day=(now() at time zone 'Asia/Yerevan')::date) as spent_today_usd;

-- 8. Zoe warm replies (20261018121002; Khikar 18 Oct 15:56 "let it talk"). After the merge: in the backoffice run
--    "Model eval with real calls" for the Low tier (it now includes the chat rows, +chat-N); it must pass (MUST 0).
--    Then approve the two STAGING wordings and switch on. The guard refuses the switch without that eval.
select tier,model_id,must_failures,harness_version,created_at from public.zoe_eval_runs where mode='model'and tier='low'and harness_version ~ '\+chat-'order by created_at desc limit 3;
update public.system_message_templates set approved=true,
 approval_note='Staging warm replies 18 Oct 2026 (Khikar 15:56). STAGING wording; copy sign-off (Tatevik HY) before go-live.'
 where template_id in('zoe.chat','zoe.receipt')and version=1;
update public.zoe_settings set conversational_replies_enabled=true;
--    Verify: write "hi" in the app or to the TEST bot; Zoe answers in seconds with no fixed acknowledgement.
select z.finished_at,z.outcome,z.reason_code,z.tier from public.zoe_runs z order by z.started_at desc limit 5;
select a.created_at,a.kind,a.provider,sm.template_id,sm.state from public.zoe_member_answers a left join public.system_messages sm on sm.id=a.system_message_id order by a.created_at desc limit 5;
--    Off: update public.zoe_settings set conversational_replies_enabled=false;  (acknowledgements go as before at once;
--    any still held are released by the next Telegram sweep after 3 minutes).

-- 9. Zoe health answers (20261019183543; Khikar 19 Oct 20:06; spec Armen's clinical dialogue dataset v2.0). Zoe answers
--    health questions herself (education, next step, urgency in plain words). Staging only until Armen signs off the
--    dataset eval results (GO_LIVE_GATES); the go-live seed keeps it off. Needs model_calls_allowed, zoe.answer approved,
--    conversational_replies_enabled with zoe.receipt approved (the fixed lines), and symptom_intake_enabled (the symptom red
--    flags run with it; without it free mode stays off and the trace says symptom_red_flags_off). Switch on only after the
--    inbox follow-up PR (free-mode answers out of needs_reply) has merged.
update public.zoe_settings set health_answers_enabled=true;
--    Verify: ask "What does a home reading of 150/95 mean?" in the app; Zoe answers with a "How urgent" line.
select z.finished_at,z.outcome,z.reason_code,z.tier from public.zoe_runs z where z.reason_code like 'health%' or z.reason_code='urgent_health_answer_model' order by z.started_at desc limit 5;
--    Off: update public.zoe_settings set health_answers_enabled=false;  (health questions go to the doctor as before).
--    Topic scope (20261021070207): on with free mode (NOREON_ZOE_TOPIC_SCOPE=off in Vercel turns it off: the whole window as before).
--    Doctor takeover covers only the doctor's topic by default (Armen msg 251); the whole-conversation takeover of #369:
--      update public.zoe_settings set doctor_takeover_scope='conversation';   back: ... set doctor_takeover_scope='topic';

-- R. Rollback (any time; also the first go-live step). Template versions are immutable and approval
--    cannot be withdrawn in place, so: (1) switches off in one statement (the guard sees calls off
--    first); (2) a new UNAPPROVED version 2 of each Zoe template, which every later enqueue picks, so
--    new answers and urgent placeholders are held at claim; (3) hold anything already queued.
--    Tested in scripts/check-staging-ai-mode.sql (section 6).
-- update public.zoe_settings set conversational_replies_enabled=false,symptom_intake_enabled=false,health_answers_enabled=false;
-- update public.zoe_settings set model_calls_allowed=false,direct_answers_enabled=false,staging_ai_mode=false;
-- insert into public.system_message_templates(template_id,version,locale,body,free_body,approved,approval_note)
--  select t.template_id,t.version+1,t.locale,t.body,t.free_body,false,'Staging AI mode ended: withdrawn'from public.system_message_templates t
--  where t.template_id in('zoe.answer','zoe.urgent','zoe.chat','zoe.receipt','zoe.mode')and t.version=(select max(x.version)from public.system_message_templates x where x.template_id=t.template_id and x.locale=t.locale)
--  on conflict do nothing;
-- update public.system_messages set state='held',reason='template_withdrawn',state_seq=state_seq+1,updated_at=clock_timestamp()
--  where template_id in('zoe.answer','zoe.urgent','zoe.chat','zoe.receipt','zoe.mode')and state='queued';

-- 10. Doctor takeover (20261020082321; Armen 20 Oct): the doctor-mode lines on Telegram ("Your doctor is answering you now.",
--     "Zoe is with you again."). The app shows them without this. Wording UNAPPROVED v1 (Tatevik, Armen).
update public.system_message_templates set approved=true,
 approval_note='Staging doctor takeover 20 Oct 2026 (Armen). UNAPPROVED v1 wording; Tatevik and Armen sign-off before go-live.'
 where template_id='zoe.mode'and version=1;

-- 11. Zoe coaching foundation (20261020103406; COACH_SPEC C0, Armen 20 Oct). Not yet: coach_enabled stays off until C2/C4
--     give it something to do, and the coach consent wordings (coach_checkins_wording_version, memory_wording_version)
--     stay null until Tatevik approves them. When C4 lands, on staging:
-- update public.zoe_settings set coach_checkins_wording_version='<approved id>',coach_enabled=true;
--     Verify: select public._zoe_coach_block_reason('<test member>');  (null: coaching may run for that member)
--     Off: update public.zoe_settings set coach_enabled=false;  (cancels every open coach row and holds queued teasers).

-- 12. Zoe chat cards on Telegram (20261030102535; Khikar 30 Oct). Needs conversation_policy.zoe_chat_actions_enabled, already on
--     staging. Card text is held at claim until this runs. Wording UNAPPROVED v1 (Tatevik).
update public.system_message_templates set approved=true,
 approval_note='Staging Zoe chat cards 30 Oct 2026. UNAPPROVED v1 wording; Tatevik sign-off before go-live.'
 where template_id='zoe.card'and version=1;
