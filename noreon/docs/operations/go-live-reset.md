# Go-live reset: the one checklist

The single procedure for wiping prod-as-staging and opening it to real members. It replaces the reset
steps in `output/GO_LIVE_GATES.md` section 4 item 6 and `output/go-live-readiness-2026-10-19/RUNBOOK_DRAFT.md`
(both now point here) and the retired `output/GO_LIVE_ENV_SEED_DRAFT.sql`. Values for each seed row and
Vercel variable are in `go-live-environment.md`; this file is the order and the checks.
Written 21 Oct 2026 from the Codex Astra audit B5 (`output/codex-audits-2026-10-21/B5-golive-reset.review.md`).

Do not go on while a step's check fails.

## Before the day (prerequisites)

1. **Day-one switch set** approved: one ON/OFF per row of `output/GO_LIVE_GATES.md`, ON only with a recorded
   sign-off. Flip the `[A1]` lines of `scripts/seed-environment.sql` in a reviewed PR to match.
2. **Signed message templates** in `scripts/seed-environment.sql` section 7, EN and HY, at a version above
   every existing one, `approval_note 'signed by <name> on <yyyy-mm-dd>'`. Without them the seed succeeds but
   sign-in and messaging stay silent: a new member never gets the share-contact button. Minimum for sign-in
   and messaging: `telegram.share_contact`, `telegram.share_contact_label`, `telegram.contact_ok`,
   `telegram.contact_refused`, `telegram.binding_replaced`, `telegram.link_expired`, `telegram.link_confirmed`,
   `telegram.ack`, `telegram.unsupported_media`, `telegram.media_to_app`, `telegram.staff_contact_ok`, `telegram.replies_auto_linked`,
   `telegram.signup`, `telegram.ready`, `telegram.next_*`, `telegram.replies_off`, `telegram.staff_chat`,
   `member_notice.open_label`, plus the templates of every flow switched on in step 1. Never copy the
   STAGING v100/v101 bodies.
3. **Consent constants** in code equal the seed (`ZOE_CONSENT_VERSION`, `TELEGRAM_CONSENT_VERSION`,
   `CONSENT_VERSION`), with signed wording, merged and deployed.
4. **Reset method rehearsed** once on a scratch project restored from a production backup: what it wipes
   (`auth.users`, `storage.objects`, Storage files, `cron`, `vault`) and the restore drill. Record the exact
   commands here before the day.

## On the day

5. **Backup.** Manual backup or PITR point confirmed; read-only inventory (counts of members, staff,
   bindings, templates) saved under `output/`.
6. **Freeze every writer.** A Telegram flag alone is not enough: Zoe, lab AI and cleanup run on their own.
   - Delete the test bot's webhook (`tbot-webhook.mjs delete`).
   - Pause all four crons in `vercel.json` (`report-cleanup`, `telegram/dispatch`, `zoe/run`, `lab-ai`):
     disable Cron Jobs in the Vercel project settings (Settings, Cron Jobs).
   - Block app writes: Vercel Deployment Protection (or the firewall) on `app.`, `backoffice.` and the clinic
     host for everyone except the integrator.
   - Drain: wait until no Zoe run is in flight (`select count(*) from public.zoe_runs where state='started'`
     is 0) and the Vercel runtime log shows no function running.
   **Check:** 15 minutes with no new row in `public.zoe_runs`, `public.access_audit` or `public.config_audit`.
7. **Reset** with the rehearsed method, without seeding (`--no-seed`; never `--sql-paths`).
   **Check:** remote migration list equals `supabase/migrations`; members, staff, bindings, conversations,
   `zoe_eval_runs` are 0; Storage holds no objects of the old data (run the orphan sweep).
   Templates: each id's newest version is what the migrations create, approved or not. Do not expect only
   version 1: later migrations add newer versions (for example the urgent Zoe template in
   `20261019174735_zoe_urgent_no_medicine.sql`).
8. **Seed.** `scripts/seed-environment.sql` only (the command is at the top of the file), with the company
   bot's account and id and the approved conversation policy id, `ON_ERROR_STOP=1`.
   **Check:** the final notice "templates have no approved newest version" names none of the step 2 ids.
9. **Platform settings** (`go-live-environment.md`, "Settings that are not rows"):
   - Supabase Auth: Attack Protection **hCaptcha off**, matching the app (`NOREON_CAPTCHA_ENABLED` absent or
     `false`; Khikar 19 Oct). Turning it on in Supabase alone breaks every sign-in, because the app sends no
     token. Send-SMS hook to `/api/auth/send-sms` with the `whsec_` secret; SMS rate limit about 30/h.
   - Rotate the Supabase service-role and anon keys; update Vercel and CI secrets.
   - Vercel Production variables per `go-live-environment.md`; company bot's six `NOREON_TELEGRAM_*` values.
   - Redeploy. Delete or protect every pre-reset production deployment.
   **Check:** build log says hCaptcha is off; member code request and staff sign-in work without a token.
10. **First admin** (no admin exists after the reset, and staff invitations need one; do not run
    `scripts/seed-staff-workspace.mjs`, which creates a test clinic and test doctor):
    - Supabase dashboard, Authentication, Add user: Khikar's staff email and a password, auto-confirm.
    - SQL editor:
      ```sql
      insert into public.workspace_staff(user_id,role,display_name,clinic_id,active)
      select id,'admin','<display name>',null,true from auth.users where email='<staff email>';
      ```
    **Check:** sign in at backoffice and invite one doctor. Then enrol the admin's staff Telegram (a second
    Telegram account: one Telegram is one person in the app).
11. **People and clinics** in the admin UI: clinics and scheduling addresses, clinic admins, doctors and
    nurses by invitation, each enrols Telegram. Hours and partner-approved prices only for enabled flows.
    Only when every staff account has a binding: `insert into public.staff_telegram_policy(singleton,
    signin_required) values(true,true)` and `NOREON_STAFF_TELEGRAM_SIGNIN=true`.
12. **AI.** Model-mode evals from the backoffice for every configured tier, then
    `scripts/seed-environment-ai.sql` (it refuses until they pass). Read every switch back.
13. **Open.** Company bot webhook on (`tbot-webhook.mjs set`), crons back on, Deployment Protection off the
    custom domains. Live check: new member sign-in on the company bot in Armenian and English, staff sign-in,
    member message to doctor reply, every enabled flow; one disabled flow stays unavailable. Record the
    result in `output/GO_LIVE_GATES.md`.
