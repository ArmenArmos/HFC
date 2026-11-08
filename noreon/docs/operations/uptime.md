# Uptime checks and alerting

Updated 18 October 2026. Standards backlog item 5. The probes ship in the app; the external
monitor needs an account, which Khikar creates (no new paid vendor is required).

## Probes in the app

| Probe | Answers | Notes |
| --- | --- | --- |
| `GET /api/health` (app and backoffice hosts) | 200 `{"status":"ok","db":"ok","version":"<7-char commit>"}`, or 503 `{"status":"degraded","db":"unreachable",...}` | Calls `health_ping()` through PostgREST with the service role: proves the function, the API and the database answer. Reads no table. `HEAD` works too. |
| `GET /api/health/telegram` (app host) | 200 `{"status":"ok"}` or `{"status":"off"}`; 503 `{"status":"degraded","reason":...}` | Asks Telegram `getWebhookInfo`: the webhook is registered to `/api/telegram/webhook`, at most 50 updates waiting, no delivery error in the last 15 minutes. Reasons: `unreachable`, `not_registered`, `backlog`, `recent_error`. |

Both answer fixed fields only: no secrets, no member data, no error text. Each instance reuses its
answer for 10 seconds, so a probe flood costs one database read or one Telegram call per instance
per 10 seconds (and firewall rule 8 in `abuse-protection.md` caps it per IP). `scripts/check-health.ts`
covers the answers and that the token never appears.

## Targets (initial)

- Monthly availability 99.5% for `app.noreon.health` and `backoffice.noreon.health` (about 3.6 hours
  of downtime a month), measured by the external monitor below.
- Bot: webhook healthy 99% of 3-minute checks.
- Member pages under 1 second at p95 (from the speed work); tracked in Vercel Speed Insights, not here.

## External monitor (Khikar creates the account)

Recommended: **Better Stack Uptime, free plan** (10 monitors, 3-minute checks, email alerts, a
public status page, EU region available). Alternative: **UptimeRobot free plan** (50 monitors,
5-minute checks, email and Telegram alert contacts); check its current terms for commercial use
before choosing it. Either sends alerts to **ops@noreon.health** (never a personal address).
Confirm at sign-up which alert channels the free plan includes; if Telegram alerts are offered, add
the ops Telegram group as a second contact.

| # | Monitor | URL | Expect | Interval | Alert after |
| --- | --- | --- | --- | --- | --- |
| 1 | App health | `https://app.noreon.health/api/health` | 200 and keyword `"status":"ok"` | 3 min | 2 failures |
| 2 | Backoffice health | `https://backoffice.noreon.health/api/health` | 200 and keyword `"status":"ok"` | 3 min | 2 failures |
| 3 | App home page | `https://app.noreon.health/` | 200 | 5 min | 2 failures |
| 4 | Backoffice sign-in page | `https://backoffice.noreon.health/` | 200 | 5 min | 2 failures |
| 5 | Telegram bot webhook | `https://app.noreon.health/api/health/telegram` | 200 (keyword `ok`; `off` only while the bot is deliberately off) | 3 min | 2 failures |
| 6 | TLS certificates | both hosts | valid for more than 14 days | daily | 1 failure |

Set request timeout to 10 seconds and the user agent to the service default. Do not add the
monitor's addresses to any firewall allow list; the health routes need no exception.

## Log-based alerts (Axiom, once server logs are live)

Axiom's free tier includes monitors. On the `noreon-app-prod` dataset (EU), with a notifier to
ops@noreon.health:

- **5xx burst:** count of requests with status at least 500 over 5 minutes is above 10.
- **Cron silent:** no log line from `/api/internal/telegram/dispatch` or from `/api/internal/zoe/run`
  for 20 minutes (both run every 5 minutes; silence means sign-in links, notices or Zoe replies stall).
  Operations in the backoffice shows the same from the job ledger (`docs/operations/jobs.md`).
- **Rate limits hit:** more than 20 events with `msg:"rate_limited"` for one `operation` in
  15 minutes (an attack, or a limit set too low for real use). Count this event, not 429s: the
  sign-in paths answer 200 with a reason, and only uploads return 429. The event carries
  `operation`, `limit_kinds` (bucket kinds, comma-separated) and `retry_after` only.
- **Vercel address missing:** any event with `msg:"rate_limit_source_unknown"`. It means
  requests arrived without `x-vercel-forwarded-for` and share one network bucket; check with Vercel.

Sentry (EU) already alerts on new error issues; keep its default "new issue" alert pointed at ops@.

## When an alert fires

1. Open the failing URL. 503 from `/api/health` with `db: unreachable`: check the Supabase status page
   and the project's health in the dashboard. 5xx everywhere: check the latest Vercel deployment and
   roll back with Vercel instant rollback if it started with a deploy.
2. Telegram `not_registered`: the webhook was removed or pointed elsewhere; re-register it (operator
   step in the Telegram runbook). `backlog` or `recent_error`: the webhook is failing; read the
   Vercel function logs for `/api/telegram/webhook`.
3. Write a short post-incident note in `output/incidents/<date>.md`: what members saw, how long, cause,
   fix, follow-up.
