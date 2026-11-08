# Go-live environment: seed and settings checklist

What to apply right after the go-live database reset, so the app works for real members with the
day-one switch set. The order of the whole reset (freeze, reset, seed, first admin, open) is the one
checklist in `go-live-reset.md`; this file holds the values.

Production is staging until go-live. Nothing here is run on it before the reset: the seed refuses
while any STAGING template is approved, which is true of the database today.

## Order

| Step | What | Runbook |
| --- | --- | --- |
| 1 | Reset. `supabase db reset` runs no seed (`supabase/config.toml` `[db.seed] enabled = false`); pass `--no-seed` as well with `--linked`. Never pass `--sql-paths`, which force-enables seeding. | C1 |
| 2 | `scripts/seed-environment.sql` with the three psql variables below. | D1 |
| 3 | Vercel and Supabase settings from the checklist below, then redeploy. **Prerequisite:** PR #315 (`NOREON_CAPTCHA_ENABLED`, `NOREON_AI_WITHOUT_DPA_CONFIRMATION`, `NOREON_ZOE_URGENT_PLACEHOLDER`) is merged and deployed. On an older build these names do nothing: CAPTCHA is required and AI has no call basis once `NOREON_PRELAUNCH_STAGING` is removed. | D2–D7 |
| 4 | Model-mode evals from the backoffice: Low (`+chat-N` if warm replies go on), Medium, High (`+intake-N` if symptom intake goes on). The reset wiped `zoe_eval_runs`. | F2 |
| 5 | `scripts/seed-environment-ai.sql`: real AI calls and lab AI on. **Always run it** (Khikar: AI stays on). It refuses, naming the missing tier, until step 4 passed. | F3 |
| 6 | Staff Telegram second step (`staff_telegram_policy`, `NOREON_STAFF_TELEGRAM_SIGNIN=true`) only after every staff account has a binding. | E5 |

```sh
psql "$DB_URL" -X -v ON_ERROR_STOP=1 \
  -v telegram_account=<NOREON_TELEGRAM_ACCOUNT of the company bot> \
  -v telegram_bot_id=<NOREON_TELEGRAM_BOT_ID of the company bot> \
  -v conversation_policy_version=<approved policy id, e.g. go-live-1> \
  -f scripts/seed-environment.sql
psql "$DB_URL" -X -v ON_ERROR_STOP=1 -f scripts/seed-environment-ai.sql   # after the evals
```

Both files are one transaction each and idempotent. A re-run of the main seed never turns real
AI calls or lab AI back off.

## What the seed decides

Rule: a feature whose sign-off is not recorded is off on day one (GAPS Q2, runbook A1). Owner
decisions applied (Khikar, 19 Oct 01:28, PR #315): **CAPTCHA off** (Vercel and Supabase Auth, not
rows) and **AI on** (`zoe_settings.staging_ai_mode=true`; real calls and lab AI in step 5, after the evals).
Lines marked `[A1]` in the SQL are the switches to flip, in a reviewed PR, when the lead records a
sign-off. `scripts/check-seed-environment.ts` pins every value, so the PR changes both.

| Row | Day one | Why |
| --- | --- | --- |
| `telegram_channel_settings` | company bot, 600 s links, consent `telegram-replies-draft-1` | Sign-in and the bot. The consent id must equal `TELEGRAM_CONSENT_VERSION`; the check enforces it. |
| `conversation_policy` | delivery on, 3600/600/60/50, app chat **off** [A1] | Member messages reach the care team. |
| `clinic_portal_capabilities` | uploads on; result attach and clinic admin full access **off** [A1] | Result attach waits for the #191 re-review (GATES). |
| `zoe_settings` | consent on (`zoe-consent-draft-3` = `ZOE_CONSENT_VERSION`, with `zoe-consent-draft-2` also valid; an existing environment on draft-2 moves only after the app deploy, `staging-ai-mode.sql` step 0c), `staging_ai_mode` on, cap US$10; direct answers, warm replies, symptom intake, coaching (`coach_enabled`, migration default) **off** [A1] | AI on by owner decision; reply features are clinical sign-offs. |
| `zoe_settings.model_calls_allowed` | on, by `seed-environment-ai.sql` after the evals | The guard needs a passing eval per tier in the last 7 days. |
| `lab_ai_capabilities` | lab reading on, by `seed-environment-ai.sql` (step 5); member upload AI **off** [A1] | AI on by owner decision; it reads only while doctor completion is on. In the AI step so no clinic files queue before then. |
| `clinic_scheduling_capabilities` | **off** [A1] | GATES conditions open; when on, the clinic admin enters the real hours. |
| `staff_message_notice_settings` | on | Staff-only; silent until `staff_message.*` copy is approved. |
| `care_alert_settings`, `member_callback_settings`, `member_safety_settings`, `doctor_completion_capabilities`, `home_visit_settings`, `member_notice_settings`, `staff_zoe_settings`, `gp_report_capabilities`, `programme_settings`, `bp_week_settings`, `member_medicine_settings`, `admin_oversight_settings`, `ai_plan_capabilities`, `nurse_visit_settings`, `nurse_chat_settings`, `member_first_note_settings` (P42), `ldl_goal_settings` (both switches; LDL defaults, Armen/Yesayi) | **off** [A1] | Each waits for its recorded sign-off (GATES section 3). |
| `staff_telegram_policy` | not seeded | Step 6. |
| `doctor_telegram_settings` | off | Dedicated doctor Telegram sessions stay dark. No clinical reads or commands in T1. |
| Message templates | none approved | Only D1-signed copy at a new version, `approval_note 'signed by <name> on <yyyy-mm-dd>'`. The seed refuses any approved STAGING, PLACEHOLDER or unsigned row and lists the templates that stay silent (GAPS G2: sign-in needs `telegram.share_contact` and the others in runbook A2). |
| Clinics, staff, hours, prices, scheduling copy address | not seeded | Admin UI after the reset (runbook E). |

## Settings that are not rows

**Supabase Auth (dashboard):** Attack Protection hCaptcha **off** (matches the app); Send SMS hook
to `https://app.noreon.health/api/auth/send-sms` with the secret equal to
`NOREON_SUPABASE_SMS_HOOK_SECRET`; SMS rate limit about 30/hour; per-IP limits per
`abuse-protection.md`.

Doctor Telegram remains off until its own copy and connection acceptance checks are recorded.

| Server variable | Day one | Requirement |
| --- | --- | --- |
| `NOREON_DOCTOR_TELEGRAM` | unset | Exactly `true` plus `doctorChatV2Enabled` and `doctor_telegram_settings.enabled`; all must agree. |
| `NOREON_DOCTOR_TELEGRAM_KEY` | unset | Server-only `v1:<base64 of 32 random bytes>` for AES-256-GCM. Provision through the secret manager, never SQL or source control. Changing the key requires reconnecting existing sessions. |

Connections last 12 hours. A failed or uncertain refresh quarantines the connection and requires a fresh connection. Disconnect revokes only the dedicated Auth session and leaves the staff Telegram binding intact. Pending code verification uses a sealed, five-minute HttpOnly cookie separate from the browser Auth session. Telegram reply text is an unapproved Armenian/English placeholder; keep this feature dark until approved. T2–T4 must each prove pause-after-admission/disconnect/resume refusal for every command kind before enabling that kind.

**Telegram:** company bot webhook set to `https://app.noreon.health`; the test bot's webhook deleted.

**Vercel `noreon-app` Production variables** (the CAPTCHA and AI rows need #315 deployed, step 3). Names only; values live in Vercel and
`~/.config/noreon/`, never here. Action: **set** (must exist), **replace** (new value at go-live),
**decided** (owner decision, as stated), **A1** (match the day-one switch set: absent or `false` for
an off feature), **remove**. Every name the app reads is listed; `check-seed-environment.ts` fails
when code reads a name this table does not list.

Zoe member and staff replies use actual costs when known, full estimates for runs in flight, and `spent + least(estimate, US$0.25) <= cap` for shared tier/total admission; the US$6 high-tier, US$10 total and US$3 member caps stay unchanged, as do lab and care plan reservations.

| Name | Action | Note |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | set | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | replace | Rotate after the reset (GATES 5c). |
| `SUPABASE_SERVICE_ROLE_KEY` | replace | Rotate after the reset. |
| `NOREON_WORKSPACE_SUPABASE_URL` | set | |
| `NOREON_WORKSPACE_ANON_KEY` | replace | Rotated with the anon key. |
| `NOREON_WORKSPACE_SERVICE_ROLE_KEY` | replace | Rotated with the service role. |
| `NOREON_MESSAGING_SERVICE_ROLE_KEY` | replace | Rotated with the service role. |
| `CRON_SECRET` | set | |
| `NOREON_MEMBER_PUSH_ENABLED` | A1 | Only exact `true` enables member PWA push. Missing VAPID settings also leave it off. |
| `NOREON_VAPID_PUBLIC_KEY` | set | Public browser subscription key, one stable pair per environment. |
| `NOREON_VAPID_PRIVATE_KEY` | set | Integrator sets this only in Vercel env. Never print or commit it. A new key pair invalidates every subscription. |
| `NOREON_VAPID_SUBJECT` | set | VAPID contact URI (`mailto:` or HTTPS). |
| `NOREON_DEPLOYMENT_TARGET` | set | |
| `NEXT_PUBLIC_SITE_URL` | set | |
| `NOREON_APP_ORIGIN` | set | `https://app.noreon.health`; the fast Zoe run needs it. |
| `NOREON_MEMBER_APP_ORIGIN` | set | |
| `NOREON_MESSAGE_APP_URL` | remove | Twilio messaging only. |
| `NOREON_STAFF_INVITATION_ORIGIN` | set | `https://backoffice.noreon.health`. |
| `NOREON_STAFF_INVITATION_SECRET` | set | |
| `NOREON_CLINIC_CHAT` | A1 | Off unless exactly `true`, and requires the existing clinic portal and scheduling flags plus database scheduling capability for bookings. Clinic assistant: scoped record reads, narrow audited member files and existing confirm/decline/propose/withdraw commands. No model, clinical advice or new delivery claims. Leave absent or `false` at go-live pending copy and journey sign-off. New EN/HY/RU wording in `components/clinic-portal/chat.tsx` is unapproved staging copy. Not enabled or verified on hosted environments by this PR. |
| `NOREON_CLINIC_PORTAL_HOST` | set | |
| `NOREON_STAGING_STAFF_HOST` | remove | Staging site only (`staging-backoffice.noreon.health`, see `staging-site.md`): adds one staff host. Never set on production. |
| `NOREON_SUPABASE_SMS_HOOK_SECRET` | set | Equals the Supabase Send SMS hook secret. |
| `NOREON_PHONE_OTP_PROVIDER` | set | `telegram-hook`. |
| `NOREON_PHONE_OTP_HOOK_READY` | set | |
| `NOREON_ZOE_RUN_KEY` | set | Seals stored Zoe run input and output. |
| `AI_GATEWAY_API_KEY` | remove | Production uses Vercel OIDC; the key is for local development only. |
| `AXIOM_DATASET`, `AXIOM_DOMAIN`, `AXIOM_TOKEN` | set | |
| `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` | set | |
| `NOREON_LOG_LEVEL`, `NOREON_LOG_CONSOLE` | set | Optional; defaults apply when absent. |
| `NOREON_TELEGRAM_ACCOUNT` | replace | Company bot; equals the seed's `telegram_account`. |
| `NOREON_TELEGRAM_BOT_ID` | replace | Company bot; equals the seed's `telegram_bot_id`. |
| `NOREON_TELEGRAM_BOT_TOKEN` | replace | Company bot; revoke the test-bot tokens. |
| `NOREON_TELEGRAM_BOT_USERNAME` | replace | Company bot. |
| `NOREON_TELEGRAM_WEBHOOK_SECRET` | replace | Company bot. |
| `NOREON_TELEGRAM_ENABLED` | set | `true`. |
| `NOREON_TELEGRAM_AUTH_ENABLED` | set | Member Telegram sign-in. |
| `NOREON_TELEGRAM_SIGNIN_LINKS_ENABLED` | set | |
| `NOREON_CAPTCHA_ENABLED` | decided | Absent or `false`: CAPTCHA off (Khikar, 19 Oct 01:28). |
| `NEXT_PUBLIC_HCAPTCHA_SITE_KEY` | decided | Needed only when CAPTCHA is turned on. |
| `HCAPTCHA_SECRET_KEY` | unset | Needed for allowlisted test sign-in only when CAPTCHA is on; use the server secret matching the site key. The test route validates hCaptcha directly because it never requests an Auth OTP, and fails closed without this secret. Normal sign-in still uses Supabase Auth's CAPTCHA configuration. |
| `NOREON_CAPTCHA_DISABLED_FOR_STAGING` | remove | Retired by #315. |
| `NOREON_PRELAUNCH_STAGING` | remove | Only after `NOREON_ZOE_URGENT_PLACEHOLDER=true` is set. |
| `NOREON_ZOE_URGENT_PLACEHOLDER` | decided | `true`, set **before** removing the marker, or Zoe goes dark. |
| `NOREON_AI_WITHOUT_DPA_CONFIRMATION` | decided | Absent or `true`: AI on without the DPA basis. |
| `NOREON_ZOE_DPA_CONFIRMED` | decided | Absent until the DPAs are signed (Khikar's timeline, P14/P16). |
| `NOREON_ZOE_MODEL_CALLS_ENABLED` | decided | `true` (AI on). |
| `NOREON_ZOE_PRACTICE` | remove | Off at go-live: unset or `false`. Only exactly `true` enables the fictional staff practice room. Does not enable member Zoe. |
| `NOREON_ZOE_CHAT_DESIGN_PREVIEW` | remove | Staging only: `true` shows the Zoe chat design preview (`/patient/zoe/preview`, demo data). Absent for real members. |
| `NOREON_ZOE_BP_TRENDS` | A1 | Off unless exactly `true`; also requires `bp_weekly_summary_settings.enabled` and `member_notice_settings.care` (both seeded off). A sweep every 15 minutes between 09:00 and 11:00 Yerevan records at most one summary per member and Monday-based week; members skipped for quiet hours, the throttle or the hourly cap are retried in the window and on later days. The summary template `app.bp_weekly_summary` is **app only** (notice channel row has Telegram and push off, because the existing wording check keeps health values out of Telegram): fixed EN/HY/RU copy, no model, no doctor notification. Russian uses `ui_locale` for this notice. Draft thresholds, next steps and all language copy need Armen and language review; the newest summary template must be approved in the member's language before anything is written. `bp_weekly_trends` is service-only input for part B. No production state was checked by the builder. |
| `NOREON_ZOE_EMERGENCY_CARD` | A1 | Off unless exactly `true`. Set `true` on staging (Khikar, 31 Oct). Absent or `false` at go-live until sign-off. Keeps urgent typed messages in the chat with the shared 103 card, database-backed care-team status and composer below. Detection, storage, run and care alert are unchanged. The direct urgent page remains the fallback. No new member strings; existing urgent wording retains its pending sign-offs. |
| `NOREON_MEMBER_CHAT_V2` | A1 | Off unless exactly `true`. The new member chat at `/patient/chat`; the old chat stays the fallback. Set `true` on staging when Khikar tries it. Absent or `false` at go-live until it replaces the old chat. Urgent messages stay in its thread only with `NOREON_ZOE_EMERGENCY_CARD` on too; otherwise they open the full 103 page. |
| `NOREON_ZOE_APP_V3` | A1 | Off unless exactly `true`; needs `NOREON_MEMBER_CHAT_V2=true`. Absent or `false` at go-live until clinical approval of thresholds and wording. Turns on the blood pressure card, onboarding and dialog order at `/patient/chat`, published plan and teach-back, dose reminders and SAMS, plus the next-step, tests-needed, released-results and doctor-message blocks. Next-step cards reuse the saved Home journey and existing booking/plan views. Also opens the read-only overview at `/patient/chat/overview` and its chat menu item; off gives a 404 and no menu item. The overview uses the draft rules in `lib/clinical/zones/`. With it off the page reads no cards; `NOREON_MEMBER_NEXT_STEP` remains independent. Draft HY/EN/RU next-step wording needs approval. Tests have no proven freshness until document provenance is available. Plan teach-back uses the published plan flow. With `NOREON_MEMBER_CHAT_V2` also on, a plain `/patient/zoe` opens `/patient/chat`; card deep links and `?view=classic` keep the previous page, and the chat menu has a link back to it. |
| `NOREON_ZOE_VOICE_PROVIDER` | unset | `gateway` enables member V3 conversation audio only with `NOREON_ZOE_APP_V3=true`, `NOREON_MEMBER_CHAT_V2=true`, Gateway credentials/OIDC, `NOREON_ZOE_MODEL_CALLS_ENABLED=true`, `realCallsBasis` and `voice_settings.enabled`. Unknown or unset disables it; `fake` remains synthetic and non-production only. Server-only `public.voice_settings` configures STT, Armenian urgent STT, TTS, voice and instructions; reads cache for 30 seconds and fall back to code defaults if unreadable. Defaults: Gemini 2.5 Pro, parallel Armenian Scribe v2 for urgent detection, Gemini 3.8 Flash TTS/Kore. Spoken text uses the existing chat safety/send path; signed receipts bind both transcript hashes. No raw audio/secondary transcript storage or logging. Shared fail-closed member upload limiter; 2 MiB audio and 1200-character speech limits; no-store responses. Recording/header cap 60 seconds, total transcription/context budget 15 seconds, urgent engine 8 seconds. Independent decoded-duration validation remains a release gap. Browser/device and real provider acceptance are still required. No staff chat audio or settings admin UI in this change. |
| `NOREON_TEST_SIGNIN_ENABLED` | unset | Off unless exactly `true`. One of two switches (the other is the database switch, default off) for test-account sign-in, independent of the phone-code delivery provider and without SMS or Telegram delivery. It applies only to `+999` numbers on the admin-managed allowlist. The admin-issued code is single-use; issue a new code before each sign-in through `/staff/real/test-signin`. An accepted match spends the code in the same transaction as the browser challenge, even if the later Auth exchange fails; every use is audited. A checked challenge blocks another exchange for that phone only until finalization, admin reset or its two-minute expiry. Admin reset cancels pending challenges and issues a fresh code without clearing the five-failed-guesses window. Only accounts created and marked by this flow can be reused; existing unmarked accounts are refused. The private Auth password is set only at creation and derived from the account nonce and current messaging service-role key. Key rotation fails closed for existing test accounts; this flow never resets their passwords. A newly provisioned marked account persists even if its first exchange fails; cleanup attempts to revoke only that exchange's session, without deleting an identity that could have changed meanwhile. Set `true` only on staging and prod-as-staging; absent and the allowlist empty before real members (see `output/GO_LIVE_GATES.md`). |
| `NOREON_MEMBER_NEXT_STEP` | A1 | Off unless exactly `true`; needs `NOREON_MEMBER_CHAT_V2=true`. The member chat shows the next step after each stage as one plain line with a link (and refreshes after the questionnaire is completed). Draft wording; independent of `NOREON_ZOE_APP_V3`. Safe to be on at go-live once Armen and Yesayi approve the words. |
| `NOREON_MEMBER_NOTICES_IN_CHAT` | A1 | Off unless exactly `true`; also requires `NOREON_MEMBER_CHAT_V2=true`. Shows saved member notices in chronological order in `/patient/chat`, using the same stored text as Telegram, and remembers notices actually seen. Set `true` on staging when Khikar tries it. Absent or `false` at go-live until product, copy and iPhone journey sign-off. Does not enable notice production or Telegram delivery. Each notice's channels are one row in `notice_channels` (`chat`, `push`, `telegram`, all on by default): one SQL line changes a notice. A row changed by hand must also go into `scripts/seed-environment.sql` so the reset keeps it. Do not turn `telegram` off for a notice until both chat switches are on, because that notice then reaches the member only in the app. Notices queued while this switch is off are saved and appear when it goes on. |
| `NOREON_NURSE_TELEGRAM_ENABLED` | A1 | Off unless exactly `true`; also requires `NOREON_TELEGRAM_ENABLED=true` and the database switch `telegram_nurse_settings.enabled` (the seed writes it off). Lets a nurse with a verified Telegram binding see today's tasks and mark one done in the company bot, member details included and files never. Absent or `false` at go-live until the nurse Telegram review conditions in `output/GO_LIVE_GATES.md` are closed. |
| `NOREON_ZOE_CHAT_KIT` | optional | Off unless exactly `true`. Gives the live Zoe chat the chat kit's look; behaviour does not change. Set it only after the founders approve the look. |
| `NOREON_MEMBER_SCREENS_PROTOTYPE` | optional | Off unless exactly `true`. Gives member Progress, care plan and results the prototype's screens; old pages stay at `?view=classic`. Set on staging at merge; unset at go-live until copy and product sign-off. |
| `NOREON_MEMBER_CHAT_ONLY` | A1 | Off unless exactly `true`. Set `true` on staging at merge, `false` at go-live until product and HY/EN/RU copy sign-off. Chat landing, avatar menu and embedded pages; profile, questionnaire and urgent guidance take precedence. `?view=classic` keeps the previous pages. Does not enable app chat or action-card permissions. |
| `NOREON_MEMBER_HOME_PROTOTYPE` | optional | Off unless exactly `true`. Enables the prototype member Home; urgent visits keep the classic emergency Home. Enable on staging at merge. |
| `NOREON_ZOE_PROVIDER` | decided | `gateway`. |
| `NOREON_ZOE_PIPELINE_ENABLED` | decided | `true`. |
| `NOREON_ZOE_SCAFFOLD_ENABLED` | decided | `true` (Zoe consent and screens). |
| `NOREON_ZOE_AI_SETTINGS_ENABLED` | decided | `true` (backoffice AI settings and evals, needed for step 4). |
| `NOREON_ZOE_DAILY_SPEND_CAP_USD` | set | At most 10; the database cap is 10. |
| `NOREON_ZOE_DECISIONS` | optional | A list of switches, comma or space separated, and `OPENAI_API_KEY2` must be set (lib/zoe/decisions.ts). `shadow`: the OpenAI Decisions API is asked for route, language and topic beside Zoe's own routing and both answers go to the trace as labels (`zoe.route.decisions`, no member text). `language`: English can become Armenian in Latin letters (only for a member with Armenian in the chat, only on a confident answer). `route`: the risk tier can be raised, never lowered. `topic`: a rule-made "new, independent question" can be vetoed so the whole window counts, never created; the member's own New question button is not overruled. Each of the last three also records the trace line. A 1.5 s timeout and any error fail open to today's behaviour. Sends the redacted message window to OpenAI, so it is Khikar's switch; turn the last three on only after a day of `shadow` numbers. Every request is preceded by the read-only database check `zoe_run_classifier_authorized` (consent now, real calls permitted for the OpenAI provider as a processor of its own: `staging_ai_mode` or a signed `openai` data agreement, daily and member caps); a refusal or an error sends nothing. The effects ask only when the run is about to use a model, after every fixed exit (emergency, same-day, doctor request, a yes to Zoe's question), so those never send text and never wait; the shadow line asks after the reservation if no effect has. |
| `NOREON_ZOE_FREE_SPLIT` | optional | Absent = on (free mode's summary is a second call beside the judge). `false` rolls back to one call (lib/zoe/free-mode-speed.ts). |
| `NOREON_ZOE_FREE_FAST` | optional | Absent = on (Opus 5.5 replies on its fast endpoint, 2x price). `false` = standard endpoint. |
| `NOREON_NURSE_CHAT` | A1 | Off unless exactly `true`. Nurse conversation reader, exact nurse-authored in-app replies, selected-message doctor handoffs and combined coordination-task/visit Today card at `/staff/real/nurse-chat`. Scoped to the current assigned nurse; handoffs appear in responsible-doctor Today and chat with the existing referral resolution/history. No Zoe/model, takeover, alert closing or Telegram send. Requires migrations `20261031182321` and `20261031231434` and `nurse_chat_settings.enabled=true` (defaults and go-live seed off); replies also require `conversation_policy.app_chat_enabled=true`. Visits retain their separate existing switch. Handoffs set no new response deadline and do not implement urgent or next-shift routing. Unset at go-live until EN/HY/RU copy and product sign-off. Database RPCs independently enforce their switch and current staff/session/assignment; the environment flag gates app entry points and handoff reads. |
| `NOREON_NURSE_CHAT_V2` | A1 | Off unless exactly `true`, and needs `NOREON_NURSE_CHAT`. The new nurse chat at `/staff/real/nurse-chat-v2`; the current nurse chat stays the fallback. Set `true` on staging when a nurse tries it. Also turns on Zoe's nurse-first task for mild side effects (`lib/zoe/nurse-first.ts`, with `nurse_chat_settings.enabled`; staging rule until Armen and Yesayi sign off). Absent or `false` at go-live until it replaces the current chat. |
| `NOREON_SIDE_EFFECT_NURSE_FIRST` | unset | Off unless exactly `true`. A mild side effect from the approved list on a side effect card also gives the assigned nurse a same-day call task. The doctor still gets every report. Needs `nurse_chat_settings.enabled`. May go on for staging; before real members Armen and Yesayi sign the list. |
| `NOREON_DOCTOR_WORKSPACE` | unset | Physician prototype shell at `/staff/real/doctor-workspace`. Off unless exactly `true`; doctor identity and `staff_zoe_status` are also required. Integrator enables on staging at merge; remove/unset before go-live until copy, visual and clinical/product sign-off. Original Ask Zoe and member pages stay available. The existing go-live SQL seed keeps `staff_zoe_settings.staff_zoe_enabled=false`. |
| `NOREON_DOCTOR_CHAT_HOME` | unset | Off unless exactly `true`; also needs `NOREON_DOCTOR_WORKSPACE` and the existing `staff_zoe_status` switch. Doctors land in the workspace after sign-in. Today summaries, visible-tab polling every 60 seconds, assigned-member search and record/chart cards use existing permission and audit paths. Neutral Telegram notice text is unchanged; a role-checked landing links doctors to the workspace and keeps other staff on their original page. No model call for notifications, no autonomous clinical writes and no plan approval. Keep unset for go-live until copy, clinical/product and rendered-journey sign-off. Existing pages remain linked. |
| `NOREON_DOCTOR_CHAT_V2` | unset | Off unless exactly `true`; needs `NOREON_DOCTOR_CHAT_HOME`, `NOREON_DOCTOR_WORKSPACE`, `NOREON_DOCTOR_DECISIONS` and `staff_zoe_status`. Doctors get the rebuilt chat at their original address `/staff/real/doctor-workspace`; the old workspace stays at `/staff/real/doctor-workspace/classic` from the chat menu, and `/staff/real/doctor-chat-v2` redirects. It reads assigned member conversations and saves replies for a separate exact-text approval. Opening a member is switched off without `NOREON_DOCTOR_DECISIONS`. Saved plan approval in this chat also needs `NOREON_MULTI_MEDICINE_ENABLED`. The old doctor screen stays the fallback. Keep absent or `false` at go-live until the founders approve it. |
| `NOREON_RESULTS_REPORT` | unset | Off unless exactly `true`. Enables Phase 2 results assessment and doctor entries in the GP report and doctor chat. Also requires the GP report database switch; chat requires all doctor chat v2 gates. Doctor reviewed labs only. Keep absent or `false` until clinical review and migration replay pass. |
| `NOREON_DOCTOR_DECISIONS` | optional | Off unless exactly `true`. Decision cards in the doctor workspace: reply, acknowledge and LDL review, each pressed by the doctor on the exact record shown. Needs `NOREON_DOCTOR_WORKSPACE`. Set on staging at merge; unset at go-live until copy and clinical sign-off. |
| `NOREON_STAFF_ZOE_FAST`, `NOREON_STAFF_ZOE_EFFORT` | unset | Doctor Zoe speed. Unset: the tier model's fast endpoint where one exists, low effort. Change only to compare speed; the model itself is the tier in AI settings (`staff_zoe_settings.model_tier`) |
| `NOREON_ZOE_FREE_REPLY_EFFORT` | optional | Absent = `low`. `default` = the model's own effort. |
| `NOREON_ZOE_TOPIC_SCOPE` | optional | Absent = on (Zoe topic scope, 20 Oct: the free-mode model sees the newest message's topic plus a health summary; the topic check uses the low tier's model; lib/zoe/topic.ts). `off` gives the model the whole window as before and runs no check (rollback, and the eval's "before"). |
| `NOREON_ZOE_FREE_STYLE` | optional | Absent = `coach` (Zoe coach C1: motivational-interviewing style and the concrete answer shape, with the judge's `symptom_causes` check; lib/zoe/free-mode-style.ts). `base` uses the pre-C1 style and judge. All styles omit danger warnings at self-care and planned levels, ask one question about a key danger sign when needed, and mention 103 only at doctor-today or emergency level or for a matching sign the member described. `coach-first` (Armen, 30 Oct; not the default until Khikar and Armen approve): no routine offer to send to the doctor; the same 103 rule applies; every safety rule stays. |
| `NOREON_ZOE_MEMBER_CLEAR` | A1 | Off unless exactly `true`. Set `true` on staging (Khikar, 31 Oct); absent or `false` in the go-live environment until Armen and Yesayi sign off. Lets a member end repeated 103 advice by reporting they feel well, disputing the reading, asking to clear, or saving a newer BP below crisis. Urgent checks still win; care alerts and booking/publication safety holds remain. Fixed EN/HY/RU acknowledgement is unapproved staging copy in `lib/zoe/member-clear.ts`. Apply migration `20261031120846` before enabling. |
| `NOREON_ZOE_WHY` | optional | Absent = on: the doctor-summary call also writes Zoe's short rationale for the why record (lib/zoe/why.ts). `off` stops asking for it; the record from the code stays. |
| `NOREON_ZOE_LDL_TARGET` | unset | Absent = off: Zoe knows a doctor's LDL goal exists, never the number (lib/zoe/member-record.ts). `on` only after Armen and Yesayi agree that she may state a personal target. |
| `NOREON_ZOE_JUDGE_EFFORT` | optional | Absent = the judge model's own effort. Do not set `low` (it held correct answers, output/zoe-speed G2). |
| `NOREON_ZOE_JUDGE_TIER` | optional | Absent = `medium` (the judge as before). |
| `NOREON_ZOE_SUMMARY_TIER` | optional | Absent = `low` (Haiku 5.5). `speaker` = the reply's own model. |
| `NOREON_ZOE_SUMMARY_EFFORT` | optional | Absent = `none`. |
| `NOREON_ZOE_GATEWAY_CACHING` | optional | Absent = on (Gateway prompt caching for Zoe). `off` turns it off. |
| `NOREON_LAB_AI_ENABLED` | decided | `true` (AI on). |
| `NOREON_LAB_AI_PROVIDER` | decided | `gateway`. |
| `NOREON_AI_TIER_LAB_READING`, `NOREON_AI_TIER_PLAN_SUMMARY` | decided | Leave unset: optional tier overrides (#328); the default is medium. |
| `NOREON_AI_PLAN_PROVIDER` | remove | Until Armen, MDR and DPA (GATES #280 row). |
| `NOREON_ZOE_TEST_LEXICON` | remove | Test only. |
| `NOREON_ZOE_EVAL_HEALTH_ANSWERS` | remove | Eval only: runs the plumbing eval with free mode on (`scripts/check-zoe-eval.ts`). Never set on a deployment. |
| `NOREON_SYNTHETIC_ZOE_PREVIEW` | remove | Synthetic preview. |
| `NOREON_CONVERSATION_SYNTHETIC_ENGINE` | remove | Synthetic engine. |
| `NOREON_CONVERSATION_HARNESS_ENABLED` | remove | Test harness. |
| `NOREON_CONVERSATION_TRACE_ENABLED` | A1 | Trace view; off by default. |
| `NOREON_URGENT_ANSWER_REVIEW_ENABLED` | A1 | Off by default. |
| `NOREON_BP_DEVICES_ENABLED` | A1 | Off by default. |
| `NOREON_CARE_ALERTS_ENABLED` | A1 | With `care_alert_settings`. |
| `NOREON_DOCTOR_COMPLETION_ENABLED` | A1 | With `doctor_completion_capabilities`. |
| `NOREON_MULTI_MEDICINE_ENABLED` | A1 | With `multi_medicine_capabilities`. Turn this on first, then the database switch; off in the reverse order. |
| `NOREON_NATIVE_JOURNEY_ENABLED` | A1 | |
| `NOREON_GM_DASHBOARD_ENABLED` | A1 | |
| `NOREON_CLINIC_PORTAL_ENABLED` | set | |
| `NOREON_CLINIC_UPLOAD_STORAGE_ENABLED` | set | `true`; with `clinic_portal_capabilities.storage_enabled`. |
| `NOREON_CLINIC_RESULT_ATTACH_ENABLED` | A1 | With `result_attach_enabled`. |
| `NOREON_CLINIC_SCHEDULING_ENABLED` | A1 | With `clinic_scheduling_capabilities`. |
| `NOREON_CLINIC_TELEGRAM_INVITES` | set | Clinic admin invite by Telegram. |
| `NOREON_STAFF_INVITATIONS_ENABLED` | set | First admin invites the doctors. |
| `NOREON_STAFF_TELEGRAM_INVITES` | set | |
| `NOREON_STAFF_TELEGRAM_ENROLMENT` | set | |
| `NOREON_STAFF_TELEGRAM_RECOVERY` | set | |
| `NOREON_STAFF_TELEGRAM_SIGNIN` | set | `true` at step 6 only. |
| `NOREON_REGISTRATION_ENABLED` | set | |
| `NOREON_REGISTRATION_ALLOWED_PREFIXES` | set | |
| `NOREON_ADMIN_CHAT` | off (`false` or absent) | Read-only administrator operations chat. Only the exact value `true` enables its page, action and navigation. Keep off at go-live until copy and access review; existing operations pages remain available. No model, new response deadline or owner notices. |
| `NOREON_REAL_MEMBER_REVIEW_ENABLED` | set | |
| `NOREON_REAL_TEST_REQUESTS_ENABLED` | A1 | Legacy flow; decide (GAPS G15). |
| `NOREON_REPORT_IMPORT_ENABLED` | A1 | |
| `NOREON_PILOT_CATALOG_ENABLED` | A1 | Prices first (GAPS G8). |
| `NOREON_PILOT_PAYMENTS_ENABLED` | A1 | Decide payments on or off (G8). |
| `NOREON_PILOT_PAYMENTS_PROVIDER` | A1 | Not `fake` with real members. |
| `NOREON_SCHEDULING_EMAIL_ENABLED` | A1 | |
| `NOREON_SCHEDULING_APPROVED_TEMPLATE_JSON` | A1 | Only with signed copy. |
| `NOREON_BOOKING_FOUNDER_TELEGRAM_ENABLED` | remove | No sender in code. |
| `NOREON_MESSAGE_DELIVERY_ENABLED` | A1 | Twilio messaging path. |
| `NOREON_MESSAGE_OPERATIONS_ENABLED` | A1 | Twilio messaging path. |
| `NOREON_MESSAGE_RECOVERY_READY` | A1 | Twilio messaging path. |
| `NOREON_BREVO_API_KEY` | remove | Unless a decided path uses it. |
| `NOREON_BREVO_EMAIL_API_KEY`, `NOREON_BREVO_EMAIL_SENDER` | A1 | Email path, only if decided. |
| `NOREON_BREVO_SMS_READY`, `NOREON_BREVO_SMS_SENDER` | A1 | SMS path, only if decided. |
| `NOREON_TWILIO_ACCOUNT_SID`, `NOREON_TWILIO_AUTH_TOKEN`, `NOREON_TWILIO_API_KEY_SID`, `NOREON_TWILIO_API_KEY_SECRET` | remove | Unused (GAPS G10). |
| `NOREON_TWILIO_SMS_FROM`, `NOREON_TWILIO_SMS_READY`, `NOREON_TWILIO_CALLBACKS_ENABLED`, `NOREON_TWILIO_CALLBACK_URL` | remove | Unused. |
| `NOREON_TWILIO_VERIFY_API_KEY_SID`, `NOREON_TWILIO_VERIFY_API_KEY_SECRET`, `NOREON_TWILIO_VERIFY_SERVICE_SID`, `NOREON_TWILIO_VERIFY_READY` | remove | Unused. |
| `NOREON_TWILIO_WHATSAPP_FROM`, `NOREON_TWILIO_WHATSAPP_READY`, `NOREON_TWILIO_WHATSAPP_EN_CONTENT_SID`, `NOREON_TWILIO_WHATSAPP_HY_CONTENT_SID` | remove | Unused. |
| `NOREON_DEMO_AI_ENABLED`, `NOREON_DEMO_AI_BRIDGE_SECRET`, `NOREON_DEMO_SECRET`, `NOREON_DEMO_GP_EMAIL`, `NOREON_SHARED_DEMO`, `NEXT_PUBLIC_PATIENT_DEMO` | remove | Demo retired 18 Oct. |
| `OPENAI_API_KEY`, `OPENAI_REPORT_MODEL` | remove | Direct OpenAI path outside the Gateway cap (GAPS G10); rotate the key. |

`NEXT_PUBLIC_VERCEL_ENV`, `VERCEL`, `VERCEL_GIT_COMMIT_SHA`, `NODE_ENV` and `NEXT_RUNTIME` are set by
the platform.

## Verify

Read-only, after step 2 and again after step 5: runbook appendix Q1 (every row above), Q2 (no
approved STAGING or PLACEHOLDER body), Q3 (consent versions equal the code). CI replays both files
on a fresh database on every Verify run (`scripts/check-seed-environment.ts`).

## Fictional Zoe practice

`NOREON_ZOE_PRACTICE=true` exposes `/staff/real/zoe-practice` only to active doctors and administrators on staff hosts with a managed staff session. Every action repeats that check. All other values hide it. This flag does not enable member Zoe. Migration `20261101210705_zoe_practice.sql` must be applied before enabling the page.

`NOREON_ZOE_PRACTICE_DAILY_TURNS` optionally contains strict JSON, for example `{"doctor":30,"global":150}`. Defaults are 60 per doctor/administrator and 300 globally per UTC day. Both values must be integers between zero and those hard maxima; malformed configuration disables reservations. Lowering a limit takes effect immediately. A database transaction lock serializes reservations across sessions and servers; every reserved attempt counts, including provider failures. Record edits and resets preserve those reservations. An abandoned turn holds its session for five minutes; replacement or another reservation after expiry invalidates its completion token.

Practice uses the member pipeline's configured Gateway routing and judges, with the same provider flags and credentials. Missing Gateway configuration reports unavailable; there is no stand-in reply fallback. Practice does not use member pipeline database ports, delivery, clinical writes or the member sweep. Only the two `zoe_practice_*` tables store sessions and marks with immutable source snapshots. You can revise your own judgement and correction; another author cannot revise it. RLS allows active doctors/administrators to read practice work; mutations are service-only RPCs so an authenticated browser cannot forge a Zoe reply or attributed mark. The server validates ownership and the database repeats active-role and owner checks. The service credential is used only for practice persistence and read-only model configuration, never member pipeline writes. Mark snapshots are derived from persisted turns and include the job, finish, events, why, configuration version, rating, one of `unsafe`, `too_alarming`, `too_cautious`, `wrong_fact`, `wrong_tone`, `other`, and correction. A wrong mark requires a reason and a nonempty correction in both the server action and the database. Do not enter real member details into fictional practice.

Member push uses the migration-seeded `member_notice.push` English and Armenian v1 placeholders,
unapproved by default. Keep them silent until the neutral line is approved through the same template
sign-off process. Russian follows the notice locale fallback to Armenian. Do not seed VAPID keys in SQL.
No worker fetch handler or offline cache is installed. Only member chat registers the `/patient/` worker.

## Blood pressure monitor photos

`NOREON_ZOE_BP_PHOTO=true` enables the camera button on the V3 chat's BP and repeat cards.
It is off by default and also requires `NOREON_ZOE_APP_V3=true`. With either flag off,
`POST /patient/chat/bp-photo` returns 404. The new chat itself requires `NOREON_MEMBER_CHAT_V2=true`.
Apply the CLI-created `zoe_bp_photo` migration before enabling; its stamp is provisional for the integrator.
The migration adds `patient_photo_confirmed`, protects that source from zone annotation, and lets
content-free BP photo calls use the lab reader's existing reservation and daily cap. No photo is stored.

Real reading also requires `NOREON_ZOE_MODEL_CALLS_ENABLED=true`, database
`zoe_settings.model_calls_allowed`, and the configured lab-reading tier's Gateway model and budget.
Each member can make six attempts per minute. Only confirmed numbers pass through the normal save
and BP check. Editing a number clears photo provenance. All photo copy in en, hy and ru is draft
for Armen (`lib/bp-photo/copy.ts`). Keep the feature off pending copy approval, migration replay,
independent review and camera QA on iOS Safari. Hosted state has not been inspected or changed.

Go-live register row for the lead to add to the external `output/GO_LIVE_GATES.md`:

| Flag | Gated behavior | Default / hosted state | Open conditions |
| --- | --- | --- | --- |
| `NOREON_ZOE_BP_PHOTO` | Camera on BP and repeat cards plus member-only photo route; also requires V3 | Off / not inspected | Armen draft copy; final migration stamp and replay; source/cap SQL checks; independent review; iOS Safari camera QA |
