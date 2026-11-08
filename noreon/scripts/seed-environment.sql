-- Go-live environment seed: the settings rows no migration creates, at their day-one values.
--
-- Run ONCE, by the integrator, right after the go-live database reset (runbook D1), never as a
-- `supabase db reset` seed (config.toml has the reset seed off) and never on the database as it is
-- today (prod-as-staging): the final check refuses while any STAGING template is approved.
--
--   psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
--     -v telegram_account=<NOREON_TELEGRAM_ACCOUNT of the company bot> \
--     -v telegram_bot_id=<NOREON_TELEGRAM_BOT_ID of the company bot> \
--     -v conversation_policy_version=<approved conversation policy id, e.g. go-live-1> \
--     -f scripts/seed-environment.sql
--
-- Then, only after the model-mode evals of runbook F2, scripts/seed-environment-ai.sql.
-- docs/operations/go-live-environment.md has the order, the Vercel and Supabase settings that are
-- not rows, and why each value below is what it is. scripts/check-seed-environment.ts replays this
-- file on a fresh database in CI and pins every value; change both together.
--
-- No secrets here: tokens, webhook and hook secrets live in Vercel and Supabase Auth, never in rows.
-- Idempotent: each row is an upsert to the same values, so a second run changes nothing.
--
-- Day-one switch set. Rule (GAPS Q2, runbook A1): a feature whose sign-off is not recorded is OFF.
-- Owner decisions applied: CAPTCHA off (Vercel and Supabase Auth, not rows) and AI on
-- (Khikar, 19 Oct 01:28; PR #315): zoe_settings.staging_ai_mode=true here; real calls and lab AI
-- in seed-environment-ai.sql. Lines marked
-- [A1] are the ones to flip, in a reviewed PR, when the lead records a sign-off.

begin;

-- 1. Telegram channel: the company bot. Table 20261016162322:14-20, no migration row.
--    consent_version must equal TELEGRAM_CONSENT_VERSION (lib/telegram-runtime/member.ts); the check pins it.
insert into public.telegram_channel_settings(singleton,account,bot_id,link_token_seconds,consent_version)
values(true,:'telegram_account',(:'telegram_bot_id')::bigint,600,'telegram-replies-draft-1')
on conflict(singleton)do update set account=excluded.account,bot_id=excluded.bot_id,
 link_token_seconds=excluded.link_token_seconds,consent_version=excluded.consent_version;

-- 2. Conversation policy: member messages are delivered to the care team. Table 20261016162000:2-9
--    ("intentionally no policy seed"), app_chat_enabled 20261017184839.
insert into public.conversation_policy(singleton,version,grant_seconds,intent_seconds,intake_window_seconds,
 intake_max_messages,synthetic_engine,delivery_enabled,app_chat_enabled)
values(true,:'conversation_policy_version',3600,600,60,50,false,true,
 false)                                    -- [A1] app chat: off until its sign-off (GATES 5d)
on conflict(singleton)do update set version=excluded.version,grant_seconds=excluded.grant_seconds,
 intent_seconds=excluded.intent_seconds,intake_window_seconds=excluded.intake_window_seconds,
 intake_max_messages=excluded.intake_max_messages,synthetic_engine=excluded.synthetic_engine,
 delivery_enabled=excluded.delivery_enabled;       -- app_chat_enabled: a first insert only; seed-environment-v3.sql owns it after that

-- 3. Clinic portal: uploads on (uploads also need NOREON_CLINIC_UPLOAD_STORAGE_ENABLED).
--    Table 20261016054000:6, +20261016215605, +20261018161307.
insert into public.clinic_portal_capabilities(singleton,storage_enabled,result_attach_enabled,clinic_admin_full_access)
values(true,true,
 false,                                    -- [A1] lab-result attach (GATES: #191 re-review open)
 false)                                    -- [A1] clinic admin full access
on conflict(singleton)do update set storage_enabled=excluded.storage_enabled,
 result_attach_enabled=excluded.result_attach_enabled,clinic_admin_full_access=excluded.clinic_admin_full_access;

-- [A1] NOREON_MEMBER_CHAT_ONLY=false (or absent) at go-live until product and copy sign-off.
-- Staging: exactly true. Environment flag only, set in runbook step 3, not a database row.
-- [A1] NOREON_ZOE_EMERGENCY_CARD=false (or absent) at go-live until sign-off.
-- Staging: exactly true (Khikar, 31 Oct). Environment setting in runbook step 3, not a DB row.
-- It reuses the urgent page wording and database care-team status; no new member strings.
-- [A1] NOREON_ZOE_MEMBER_CLEAR=false (or absent) in the go-live environment, until Armen
-- and Yesayi sign off. Staging: exactly true (Khikar, 31 Oct). It is an environment flag,
-- not a database setting; set it alongside the other Zoe environment flags in runbook step 3.
-- Its fixed EN/HY/RU acknowledgement is UNAPPROVED STAGING COPY. No sign-off is implied by this seed.
-- 4. Zoe. Table 20261017000158:8-19 and later columns. Consent collection on with the wording the
--    app shows (ZOE_CONSENT_VERSION, lib/zoe/member.ts; the check pins it). staging_ai_mode=true is
--    the owner's AI decision. model_calls_allowed and the three reply switches are not set here:
--    their guards need model-mode evals newer than 7 days, which the reset wiped, so
--    scripts/seed-environment-ai.sql owns them (runbook F3). A first insert leaves them false; a
--    re-run of this file never changes them.
insert into public.zoe_settings(singleton,consent_collection_enabled,consent_wording_version,consent_wording_also_valid,
 daily_spend_cap_usd,staging_ai_mode)
values(true,true,'zoe-consent-draft-3','{zoe-consent-draft-2}',10,true)
on conflict(singleton)do update set consent_collection_enabled=excluded.consent_collection_enabled,
 consent_wording_version=excluded.consent_wording_version,consent_wording_also_valid=excluded.consent_wording_also_valid,
 daily_spend_cap_usd=excluded.daily_spend_cap_usd,staging_ai_mode=excluded.staging_ai_mode,updated_at=clock_timestamp();

-- 5. Rows no migration creates; absent means off. Written so that every table has its row.
insert into public.care_alert_settings(singleton,enabled,telegram_delivery,sandbox_test_accounts)
values(true,false,false,false)             -- [A1] care-team alerts (P19 wording, Fable F5, S1)
on conflict(singleton)do update set telegram_delivery=excluded.telegram_delivery,sandbox_test_accounts=excluded.sandbox_test_accounts,updated_at=clock_timestamp();  -- enabled: a first insert only; seed-environment-v3.sql owns it after that

insert into public.staff_message_notice_settings(singleton,enabled)
values(true,true)                          -- staff-only notice; silent until staff_message.* copy is approved
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();

insert into public.member_callback_settings(singleton,enabled)
values(true,false)                         -- [A1] member callback requests
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();

insert into public.member_safety_settings(singleton,enabled)
values(true,false)                         -- [A1] member safety C1-C12 (Armen)
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();

-- 6. Rows migrations seed off. Upserts, so a missing row is created rather than skipped.
insert into public.clinic_scheduling_capabilities(singleton,enabled)
values(true,false)                         -- [A1] clinic hours and booking proposals (GATES conditions open)
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();

-- Lab PDF reading (AI on) is switched on by seed-environment-ai.sql, with real calls (runbook F3):
-- on here it would queue clinic files with nothing to read them. A re-run never turns it off.
insert into public.lab_ai_capabilities(singleton,enabled,member_upload_enabled,member_upload_doctor_approval)
values(true,false,
 false,                                    -- [A1] member upload AI
 true)                                     -- doctor approves member uploads before the member sees values (Armen, 20 Oct)
on conflict(singleton)do update set member_upload_enabled=excluded.member_upload_enabled,member_upload_doctor_approval=excluded.member_upload_doctor_approval;

insert into public.doctor_completion_capabilities(singleton,enabled)
values(true,false)                         -- [A1] B5 doctor completion (P17, Armen)
on conflict(singleton)do update set enabled=excluded.enabled;

insert into public.doctor_telegram_settings(singleton,enabled)
values(true,false)                         -- doctor Telegram connection stays off until T4 is reviewed
on conflict(singleton)do update set enabled=excluded.enabled;

insert into public.home_visit_settings(singleton,telegram_notice,auto_close)
values(true,false,false)                   -- [A1] home-visit notice, auto close
on conflict(singleton)do update set telegram_notice=excluded.telegram_notice,auto_close=excluded.auto_close,updated_at=clock_timestamp();

insert into public.member_notice_settings(singleton,booking,reminders,results,care)
values(true,false,false,false,false)       -- [A1] member Telegram notices (D1-signed member.* copy)
on conflict(singleton)do update set booking=excluded.booking,reminders=excluded.reminders,results=excluded.results,
 care=excluded.care,updated_at=clock_timestamp();

insert into public.gp_report_capabilities(singleton,enabled)
values(true,false)                         -- [A1] GP report (P25)
on conflict(singleton)do update set enabled=excluded.enabled;

insert into public.programme_settings(singleton,enabled)
values(true,false)                         -- [A1] programme rhythm (C10, C12)
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();

-- Weekly home BP summary, part A: also needs NOREON_ZOE_BP_TRENDS=true and notices care.
insert into public.bp_weekly_summary_settings(singleton,enabled)
values(true,false)                         -- [A1] draft thresholds and EN/HY/RU copy await sign-off
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();
insert into public.notice_channels(template_id,telegram,push)values('app.bp_weekly_summary',false,false)   -- app only: readings stay out of Telegram and push
on conflict(template_id)do update set telegram=excluded.telegram,push=excluded.push;

insert into public.bp_week_settings(singleton,enabled,reminders,member_can_start)
values(true,false,false,false)             -- [A1] BP week (C1-C4)
on conflict(singleton)do update set enabled=excluded.enabled,reminders=excluded.reminders,
 member_can_start=excluded.member_can_start,updated_at=clock_timestamp();

insert into public.member_medicine_settings(singleton,enabled,reminders,asks)
values(true,false,false,false)             -- [A1] medicines, reminders and Zoe's missed-dose asks (item 5)
on conflict(singleton)do update set enabled=excluded.enabled,reminders=excluded.reminders,asks=excluded.asks,updated_at=clock_timestamp();

insert into public.admin_oversight_settings(singleton,admin_conversation_read_enabled)
values(true,false)                         -- [A1] admin conversation read
on conflict(singleton)do update set admin_conversation_read_enabled=excluded.admin_conversation_read_enabled,updated_at=clock_timestamp();

insert into public.ai_plan_capabilities(singleton,enabled)
values(true,false)                         -- [A1] AI care plan draft (Armen Q1-Q4/Q8, MDR; NOREON_AI_PLAN_PROVIDER removed)
on conflict(singleton)do update set enabled=excluded.enabled;

insert into public.nurse_chat_settings(singleton,enabled)
values(true,false) -- [A1] Nurse conversation read/send waits for product and copy sign-off.
on conflict(singleton)do update set enabled=excluded.enabled;

insert into public.telegram_nurse_settings(singleton,enabled)
values(true,false) -- Nurse work in Telegram stays off until the environment flag, signed nurse copy and a phone pass.
on conflict(singleton)do update set enabled=excluded.enabled;

insert into public.nurse_visit_settings(singleton,enabled)
values(true,false)                         -- [A1] nurse visit flow (checklist sign-off)
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();

insert into public.member_first_note_settings(singleton,enabled)
values(true,false)                         -- [A1] first doctor note (P42)
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();

insert into public.staff_zoe_settings(singleton,staff_zoe_enabled)
values(true,false)                         -- [A1] Doctor Zoe, staff read-only chat
on conflict(singleton)do update set staff_zoe_enabled=excluded.staff_zoe_enabled,updated_at=clock_timestamp();

insert into public.multi_medicine_capabilities(singleton,enabled)
values(true,false)                         -- [A1] plans with several medicines (needs NOREON_MULTI_MEDICINE_ENABLED)
on conflict(singleton)do update set enabled=excluded.enabled,updated_at=clock_timestamp();

insert into public.ldl_goal_settings(singleton,ldl_goal_enabled,ldl_response_enabled,lipid_planner_enabled)
values(true,false,false,false)                   -- [A1] LDL goal (defaults pending Armen/Yesayi; hy copy sign-off); lipid planner rules proposed, unsigned
on conflict(singleton)do update set ldl_goal_enabled=excluded.ldl_goal_enabled,ldl_response_enabled=excluded.ldl_response_enabled,lipid_planner_enabled=excluded.lipid_planner_enabled,updated_at=clock_timestamp();

-- Not seeded on purpose:
--  staff_telegram_policy: inserted at runbook E5, after every staff account has a Telegram binding.
--  workspace_scheduling_settings.copy_email, clinics, staff, hours, prices: entered in the admin UI.

-- 7. Signed message templates. Migrations insert every template as an unapproved placeholder, which
--    the outbox holds (silence). Add here only D1-signed EN+HY copy, at a version above every
--    existing one for that id (bodies are immutable), with approval_note 'signed by <name> on <yyyy-mm-dd>'.
--    The STAGING v100/v101 rows of prod-as-staging must never be copied here. Example shape:
-- insert into public.system_message_templates(template_id,version,locale,body,approved,approval_note)values
--  ('telegram.ack',200,'en','<signed text>',true,'signed by <name> on <yyyy-mm-dd>')
-- on conflict(template_id,version,locale)do update set approved=true,approval_note=excluded.approval_note
--  where not public.system_message_templates.approved;

-- 8. Checks: refuse to commit a wrong result.
do $$
declare t text;missing text:='';bad text;held text;
begin
 foreach t in array array['telegram_channel_settings','conversation_policy','clinic_portal_capabilities','zoe_settings',
  'care_alert_settings','staff_message_notice_settings','member_callback_settings','member_safety_settings',
  'clinic_scheduling_capabilities','lab_ai_capabilities','doctor_completion_capabilities','home_visit_settings',
  'member_notice_settings','gp_report_capabilities','programme_settings','bp_week_settings','bp_weekly_summary_settings','member_medicine_settings',
  'admin_oversight_settings','ai_plan_capabilities','nurse_visit_settings','nurse_chat_settings','telegram_nurse_settings','member_first_note_settings','ldl_goal_settings','staff_zoe_settings','multi_medicine_capabilities','doctor_telegram_settings']loop
  if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'and c.relname=t)
   then missing:=missing||t||' ';
  else execute format('select %L where (select count(*) from public.%I)<>1',t,t)into bad;
   if bad is not null then missing:=missing||t||'(rows<>1) ';end if;
  end if;
 end loop;
 if missing<>''then raise exception 'Go-live seed: settings rows missing or duplicated: %',missing;end if;

 if (select account ~* 'test|staging' from public.telegram_channel_settings) then
  raise exception 'Go-live seed: telegram_account looks like the test bot; use the company bot';end if;
 if (select version ~* 'staging|test' from public.conversation_policy) then
  raise exception 'Go-live seed: conversation_policy_version must be the approved go-live id, not a staging one';end if;
 if (select version !~ '^[a-z0-9][a-z0-9.-]{0,63}$' from public.conversation_policy) then
  raise exception 'Go-live seed: conversation_policy_version must be a non-empty id like go-live-1';end if;

 select string_agg(template_id||' v'||version||' '||locale,', ' order by template_id,version,locale)into bad
  from public.system_message_templates
  where approved and(body ~* 'staging|placeholder' or coalesce(approval_note,'')!~ '^signed by .+ on [0-9]{4}-[0-9]{2}-[0-9]{2}$');
 if bad is not null then
  raise exception 'Go-live seed: approved templates that are not signed go-live copy (STAGING/PLACEHOLDER body or no signer): %. Run this only after the reset.',left(bad,600);
 end if;

 -- Not a failure (GAPS G2 is its own blocker), but say which templates will stay silent.
 select string_agg(distinct template_id,', ' order by template_id)into held from(
  select distinct on(template_id,locale)template_id,approved from public.system_message_templates
  order by template_id,locale,version desc)n where not approved;
 if held is not null then raise notice 'Go-live seed: these templates have no approved newest version and stay silent: %',held;end if;
end$$;

commit;
