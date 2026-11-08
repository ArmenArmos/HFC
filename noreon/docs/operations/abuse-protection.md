# Abuse protection

Updated 19 October 2026. OWASP ASVS L2 (V2.2 anti-automation, V11 business logic limits, V12
file uploads). Two layers: limits in the app and database (this repo, always on), and Vercel
Firewall rules in front of the app (recommended below, applied by the integrator).

## CAPTCHA: two settings, both off for now

Khikar, 19 Oct 2026 01:28: "we don't need captcha for now. When we really need it we will turn it
on. Keep it off in the seed data as well." The app limits below, the Vercel Firewall rules and the
Supabase Auth limits are the protection meanwhile.

| Layer | Setting | Off (today) | On |
| --- | --- | --- | --- |
| App (Vercel env) | `NOREON_CAPTCHA_ENABLED` (`lib/captcha.ts`) | unset or `false`: no widget, server actions send no token. Build and runtime logs print `hCaptcha is OFF`. | `true`, with `NEXT_PUBLIC_HCAPTCHA_SITE_KEY`: widget on member, Telegram-link, staff and clinic sign-in; actions refuse a request without a token. |
| Supabase Auth (dashboard, Authentication → Attack Protection) | "Enable CAPTCHA protection", provider hCaptcha, secret | off: Auth ignores tokens | on: Auth rejects a sign-in without a valid token |

The two must agree. Turn CAPTCHA **on** in this order: set `NOREON_CAPTCHA_ENABLED=true` (and the
site key) in Vercel and redeploy; then switch Supabase Attack Protection on. Turn it **off** in the
reverse order: Supabase first, then the app setting. With Supabase on and the app off, every sign-in
fails. Any value other than `true` or `false` fails the build. The setting is independent of
`NOREON_PRELAUNCH_STAGING`. The retired `NOREON_CAPTCHA_DISABLED_FOR_STAGING` is ignored (the logs
ask for its removal). The native app (`apps/patient-mobile`) always shows the widget and sends a
token, which Supabase ignores while its CAPTCHA is off.

## How the app limiter works

`rate_limit_claim` (migration `20261017224355_abuse_rate_limits.sql`) keeps fixed-window counters
in `public.rate_limit_counters`. The app calls it through `lib/security/rate-limit.ts` with the
service role; browsers cannot reach the table or the function.

- **Buckets.** `source` is the caller's network: the IPv4 address, or the IPv6 /64, read only from
  `x-vercel-forwarded-for`, which Vercel's edge sets itself. A client-sent `X-Forwarded-For`,
  `X-Real-IP`, `Forwarded` or `CF-Connecting-IP` is never read (`scripts/check-rate-limit-source.ts`).
  A request without a valid Vercel address falls into one shared `unknown` bucket rather than a
  fresh one. Off Vercel (local, CI) the source bucket is skipped. `phone`, `email` and `user` are
  the account.
- **Nothing raw is stored.** Every bucket is an HMAC-SHA256 digest under a key derived from
  `SUPABASE_SERVICE_ROLE_KEY`. The table holds no address, phone, email or user id.
- **Limits live in SQL** (`_rate_limit_policy`), so a caller cannot widen them. Unknown
  operations, kinds and malformed keys are refused.
- **Strangers cannot lock members out for free.** Account buckets for codes and passwords are
  checked before the attempt and counted only after it got past CAPTCHA: a code Supabase confirmed
  sending, or a wrong password. Requests with a bad CAPTCHA only fill their own network's bucket.
- **Shared addresses.** Armenian mobile carriers put many phones behind one IPv4 address (carrier
  NAT), so network limits are set well above one person's use. If the `rate_limited` log alert in
  `uptime.md` shows real members being refused, raise the `source` rows in `_rate_limit_policy` by migration.
- **Every refusal is logged** to Axiom through `lib/observability/logger.ts` as a warn event
  `{"msg":"rate_limited","operation":...,"limit_kinds":"source,email","retry_after":...}` (no keys or
  identities), and a request without Vercel's address logs `msg:"rate_limit_source_unknown"`.
- **Previews cannot exercise it.** `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_URL` exist
  for Production only, so on previews limited actions answer "unavailable". The limiter is verified
  locally and on production.
- **Fails closed.** If the limiter cannot answer, sign-in and uploads say "try later". The one
  exception is a database that does not have the function yet (app deployed before its
  migration), which admits and logs `rate_limit_claim is not deployed yet`.

## Inventory

| Entry point | What it can be abused for | Limits that already existed | Added here |
| --- | --- | --- | --- |
| Member phone code, `requestPhoneCode` (server action on `/patient`) → Supabase `signInWithOtp` → `/api/auth/send-sms` hook | Spamming a member's Telegram with codes; burning Supabase's project-wide SMS/OTP quota so nobody can sign in | hCaptcha when switched on (off now, see CAPTCHA above); one code in flight per phone (`auth_code_request_begin`); Supabase per-phone resend interval and project-wide SMS cap | `member_code`: 30 per network per 15 min; 8 confirmed sends per phone per hour |
| "Use another Telegram account", `switchTelegramAccount` | Proof-link creation | Twice per request; 10 per browser per phone per hour, 50 per phone per hour (`telegram_auth_challenge_create`) | Counts in the `member_code` network bucket |
| Member code check, `verifyPhoneCode` | Guessing 6-digit codes | 5 wrong codes end a request; 10 wrong per phone per hour end any guessed request (`auth_code_request_check`) | `member_verify`: 60 per network per 15 min |
| One-tap link, `/patient/telegram-link` | Hammering Auth (tokens are 192-bit, single use, 24 hours since 18 Oct 2026) | Single use, bound to the member's chat and a browser nonce | `member_link`: 30 per network per 15 min |
| Staff and clinic sign-in, `backofficeSignIn` (backoffice `/`) | Password guessing, credential stuffing | hCaptcha when switched on (off now, see CAPTCHA above); Telegram second step when required | `staff_signin`: 30 per network per 15 min; 10 wrong passwords per email per 15 min |
| Staff Telegram code, recovery and invites | Code guessing, spam | Per-user limits in SQL (`staff_code_challenges`, recoveries 1 per hour, `rate_limited_day`) | None needed |
| Telegram webhook, `/api/telegram/webhook` | Forged updates, floods | Constant-time secret header; 256 KB body cap; per-conversation intake limit (`conversation_policy.intake_max_messages`) | Firewall rule 1 (Telegram's address ranges only) |
| Auth hook, `/api/auth/send-sms` | Forged hook calls | Standard Webhooks signature; spend ledger and replay ledger | Firewall rule 2 |
| Member earlier results upload, `PUT /patient/progress/earlier/upload` | Storage churn (upload, delete, upload), large files | Same-origin; 4 MB; content sniffing; 50 live files per member; duplicate digest | `member_upload`: 30 per member, 60 per network per hour (429) |
| Clinic PDF upload, `PUT /clinic/real/batches/[id]/files/[fileId]` | Storage churn from a stolen session | Same-origin; UI scope header; pre-registered batch files only; size cap | `clinic_upload`: 400 per account per hour (429) |
| Callback requests, `requestCallback` | Flooding the care team | Per-member daily limit (`member_callback_requests`, `daily_limit`) | None needed |
| Zoe app chat send | Flooding Zoe and the care team | Per-conversation intake window (`conversation_policy`) | None needed |
| Shared reports, `/patient/reports/shared` | Upload floods | `claim_workspace_admission` (demo workspace) | None needed |
| Native `/api/native/verify-phone` | Code guessing | Off while the Telegram code provider is on (production) | None; revisit if native sign-in returns |
| Cron routes, `/api/internal/*` | Triggering jobs | `CRON_SECRET` bearer | Firewall rule 6 |

## Supabase Auth limits: check them (integrator)

Supabase Auth applies its own per-IP limits (sign-ins, token verifications). Our sign-in calls Auth
from the server, so Auth sees Vercel's few egress addresses, not the member's: those per-IP limits
act as one limit for all members together (hosted defaults are 30 per 5 minutes). Per-member and
per-network limiting is now done by the app, so on the production project (Authentication → Rate
Limits) raise "sign-ups and sign-ins" and "token verifications" to about 150 per 5 minutes, and
keep the SMS/OTP-sent limit as a project-wide spend cap. CAPTCHA is off by decision (above); these
limits and the Firewall rules carry the load until it is switched on.

## Recommended Vercel Firewall rules (integrator applies; not applied by this PR)

Project `noreon-app`, Firewall → Custom rules. Start each rule in **Log** for a day, read the hits,
then switch to the action shown. Server actions are POSTs to the page URL with a `Next-Action`
header, so "POST to the page" is the sign-in action.

| # | Name | Condition | Action |
| --- | --- | --- | --- |
| 1 | Telegram webhook from Telegram only | Path equals `/api/telegram/webhook` and IP not in `149.154.160.0/20`, `91.108.4.0/22` (Telegram's documented webhook ranges) | Deny |
| 2 | Auth hook rate | Path equals `/api/auth/send-sms` | Rate limit 120 per minute per IP, then deny |
| 3 | Member sign-in rate | Host `app.noreon.health`, method POST, path equals `/patient` or starts with `/patient/telegram-link` | Rate limit 20 per minute per IP, then challenge |
| 4 | Staff sign-in rate | Host `backoffice.noreon.health`, method POST, path equals `/` | Rate limit 15 per minute per IP, then challenge |
| 5 | Upload rate | Method PUT and path starts with `/patient/progress/earlier/upload` or `/clinic/real/batches/` | Rate limit 60 per minute per IP, then deny |
| 6 | Cron routes | Path starts with `/api/internal/` and header `user-agent` does not start with `vercel-cron/` | Log only (the bearer secret is the real control; this shows probing) |
| 7 | Legacy Twilio callback | Path starts with `/api/messaging/twilio/` | Deny while the product is Telegram-only |
| 8 | Health probes | Path starts with `/api/health` | Rate limit 60 per minute per IP, then deny |

Also: keep the managed rulesets (OWASP core) in Log first if the plan has them; use Attack
Challenge Mode only during an incident, because it would also challenge Telegram and Supabase
calls to the webhook and hook. Rate-limit rules need a plan that offers them; if it does not,
rules 1, 6 and 7 still work as plain custom rules.

## Verify

- `node scripts/run-checks.mjs --sql` runs `scripts/check-rate-limits.sql` (limits trigger, other
  networks and accounts unaffected, peeks never count, windows reset, bad input refused, browser
  roles locked out).
- `scripts/check-rate-limit-source.ts`: spoofed forwarding headers do not change the bucket;
  only digests leave the app.
- Live: 31 code requests from one network in 15 minutes get "Too many tries" on the 31st.

## Rollback

Revert the app change (Vercel instant rollback is enough: older code never calls the limiter).
The table and functions can stay; they do nothing without callers.
