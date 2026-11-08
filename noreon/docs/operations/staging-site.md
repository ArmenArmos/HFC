# Staging site

`staging.noreon.health` (members) and `staging-backoffice.noreon.health` (staff and clinic) are a separate
copy of the app for agents and testers. They run the same code as production, follow `main`, and use their own
database: the Supabase project **noreon-staging** (`homqzwzrskgnizbycvhq`, Frankfurt). Nothing there is real:
every person is fictional, and no message can reach a real person. Production (`app.`, `backoffice.`) is
untouched by anything in this file.

Added 3 Nov 2026 (Khikar). Before this, production doubled as staging; it is still staging until go-live
(`go-live-reset.md`), but agents may no longer type credentials on production hosts, so test with the accounts below.

## How it is built

| Part | Where | Notes |
| --- | --- | --- |
| App | Vercel project `noreon-app`, custom environment **staging**, branch rule `main` | Own variables; production variables are untouched. Both hosts are attached to this environment. |
| Database | Supabase `noreon-staging` | All migrations; `scripts/seed-environment.sql` (inert bot `sandbox_inert`, policy `sandbox-1`), then `scripts/seed-staging.sql` (every feature switch on, placeholder wording approved). |
| Hosts | CNAME `staging` and `staging-backoffice` to the Vercel target, at GoDaddy | `NOREON_STAGING_STAFF_HOST` adds the staff host to `lib/staff/hosts.ts` (unset in production, so nothing changes there). The member app serves any host that is not the public site. |
| Migrations | `.github/workflows/supabase-deploy-staging.yml` | Runs on every push to `main` and by hand on any branch. |

## How merges deploy here (for the integrator)

- Merging to `main` makes Vercel build **two** deployments: production (held until the production schema check passes,
  see `deploy-order.md`) and staging (the custom environment tracks `main`). Staging is not held by the production check.
- The same merge starts `supabase-deploy-staging`, which applies the new migrations to `noreon-staging`. The staging
  app can therefore be live for a few minutes before its schema; a failed staging migration does not block production.
  If it fails, fix it before the next merge, or the staging schema falls behind.
- Check after a merge: `gh run list --workflow supabase-deploy-staging.yml --limit 1`, then open
  `https://staging.noreon.health/api/health`.
- A PR branch can be tried on staging before it merges: dispatch `supabase-deploy-staging` on the branch, then
  `vercel deploy --target=staging` (or a deployment with `target: staging` through the API) from that branch.

## Test accounts

Fictional, created by `scripts/seed-staging-accounts.mjs` and `scripts/seed-staging-clinic-admin.sql`.
Passwords are generated and kept only in `~/.noreon/staging-test-credentials.json` on the Mac that ran the seed
(mode 600, outside the repository). They are never in chat, in git, or in this file.

| Role | Sign-in | Where |
| --- | --- | --- |
| Admin, doctor, nurse, clinic admin | `staging-<role>@example.invalid` (`clinic` for the clinic admin) with the generated password | `https://staging-backoffice.noreon.health` |
| Members | Test phone numbers `+37499000101` to `+37499000106`; the one-time code is the Supabase test code, kept in the credentials file, no SMS | `https://staging.noreon.health` |

Six fictional members (phones `+37499000101` to `+37499000106`, entered in the app as `99000101` and so on) come from `scripts/seed-staging-members.sh` (rerunnable; it refuses any database
but noreon-staging): 101 fresh sign-up; 102 questionnaire done with a 103 care alert; 103 tests booked; 104 results in with a nurse
task; 105 results reviewed and a plan published; 106 a blood pressure week with 12 readings. All have the staging doctor and nurse
(101 has no case yet), and 102 to 106 have conversation messages. Run it after `seed-staging-accounts.mjs`.

Staff accounts belong to the fictional "Staging Clinic". Members register through the normal flow; the doctor and nurse
are assigned on enrolment like in production.

To reset an account: rerun the seed script (it keeps the passwords), or reset the member through the usual test-account reset.

## How agents sign in to staging

Staging is for agents only; the team keeps testing on production. Vercel Authentication stays on in front of both
hosts, so a browser needs the bypass cookie once:

1. Read the bypass secret from the Keychain inside a script or command (`security find-generic-password -a noreon -s vercel-staging-bypass -w`); never print or paste it into chat.
2. Open `https://staging.noreon.health/?x-vercel-protection-bypass=<secret>&x-vercel-set-bypass-cookie=true` (and the same for `https://staging-backoffice.noreon.health/`). The cookie lasts for the browser session. For `curl` or a script, send the header `x-vercel-protection-bypass`.
3. Staff: open `https://staging-backoffice.noreon.health` and sign in with the email and password for the role from `~/.noreon/staging-test-credentials.json` (keys `admin`, `doctor`, `nurse`, `clinic`). Read the file in a script; do not print it.
4. Member: open `https://staging.noreon.health`, enter a phone from the `members` list in the same file, and type the one-time code stored there (a Supabase test code, no SMS).

The settings, switches, clinical rules, templates and catalogues come from the repository (migrations and the seeds in
this file), the same sources as the go-live seed. Staging never reads production data.

## What is off, on purpose

No Telegram bot token, Twilio, Brevo, VAPID or SMS-hook variables are set in the staging environment, so the app can
send nothing to anyone. The company-bot rows in the database point at an inert name. Do not add a real bot or a real
SMS or email provider here. If a test bot is wanted later, create a separate bot used only by staging.

## AI

Real model calls use the Vercel AI Gateway through the project's OIDC (no key stored). The daily cap is
US$3 (`NOREON_ZOE_DAILY_SPEND_CAP_USD` and `zoe_settings.daily_spend_cap_usd`). `NOREON_PRELAUNCH_STAGING=true` and
`zoe_settings.staging_ai_mode` allow calls without a signed data agreement, for testing only.

**Switched on 3 Nov (night):** the three model evals (Low, Medium, High) passed from the staging backoffice ("Model eval with
real calls", about 10 minutes for High, a few cents each), `scripts/seed-environment-ai.sql` was applied, then
`direct_answers_enabled`, `conversational_replies_enabled`, `symptom_intake_enabled` and `health_answers_enabled` were set to true
by hand (each is guarded by the evals). Repeat the evals after a Zoe change that moves the harness; a run older than 7 days stops counting.

**No cron on staging.** Vercel runs cron jobs only for production deployments, so nothing on staging calls
`/api/internal/zoe/run` every five minutes. The app asks for one pass right after a member writes (it passes the project's
automation bypass secret since the PR that added `VERCEL_AUTOMATION_BYPASS_SECRET` to that call). Anything else (a held reply,
the lab reader) needs a manual pass: `curl -H "x-vercel-protection-bypass: <bypass>" -H "authorization: Bearer <cron secret>" https://staging.noreon.health/api/internal/zoe/run`,
with both values read from the Keychain (`vercel-staging-bypass`, `noreon-staging-cron-secret`), never printed.

## Database access and credentials

- The Supabase access token (scoped to this project, expires) and the database password live in the Keychain
  (`supabase-access-token`, `supabase-staging-db-password`); GitHub holds `SUPABASE_PROJECT_ID`, `SUPABASE_DB_PASSWORD`
  and `SUPABASE_STAGING_ACCESS_TOKEN`. When the token expires the staging migration job fails at "Link staging project":
  create a new token scoped to noreon-staging and replace that GitHub secret.
- Wipe and rebuild: delete the public schema and users, delete the storage buckets through the Storage API, then
  `supabase db push --include-all --db-url ...` (session pooler, port 5432), the two seeds and the accounts script.
- Never point any staging variable at `noreon-production`.
