# Server logs (Axiom)

The app writes structured JSON log lines from its own server code and, in production, sends them to Axiom's EU region. There is no Vercel log drain. The code is in `lib/observability/`.

## What is logged

Every line has `ts` (and `_time` for Axiom), `level`, `msg` (an event name such as `route`) and, where known, `request_id`, `route`, `method`, `actor_kind` and `actor_id`, plus the deployment's `region`, `commit` and `env`.

| `msg` | When | Fields |
| --- | --- | --- |
| `proxy` | Every request through `proxy.ts`, public and prerendered pages included, except static files (`_next/static`, `_next/image`, images, fonts, icons, scripts, styles) | `route` (path without query), `method`, `status` and `outcome` of the proxy decision (`next`, `rewrite`, `redirect`, `not_found`, `denied`), `duration_ms` of the proxy alone, `actor_kind`, `ua_family`, `country`, `ip_prefix` |
| `route` | Each route handler call (all `route.ts` files, wrapped with `withRouteLogging`) | `status`, `outcome`, `duration_ms`, `member_id` when the path is `/members/<uuid>/...` |
| `action` | Each server action call (every `"use server"` export, wrapped with `loggedAction`) | `action` (the function name), `route` (the page it was called from), `status` (200, a redirect or 404 status, or 500), `outcome`, `duration_ms` |
| `db.rpc` | Every Supabase RPC made by the server | `rpc` (the function name), `db_status`, `rpc_ms` |
| `db.rest` | A table read or write that failed or took over a second | `table`, `method`, `db_status`, `rpc_ms` |
| `db.call` / `db.fetch_failed` | Supabase auth, storage or functions returning 5xx, or a network failure | `db` (the kind only), `db_status`, `error_name` |
| `sweep` | Cron sweeps: Telegram dispatch, auth cleanup, lab AI, monitoring follow-up, message dispatch | `sweep`, `outcome`, `counts` (numbers only, under count names such as `processed`, `failed`, `sent`), `duration_ms` |
| `error.unhandled` | Any error Next reports through `onRequestError` (renders, routes, actions) | `route` (the template, e.g. `/staff/real/members/[id]`), `route_type`, `error_name`, `error_code`, `error_message`, `error_stack`, `digest` |
| `log.ingest_failed`, `log.dropped` | The logger's own health (at most one warning a minute) | `outcome`, `db_status`, `dropped` |

Each line goes to the console (Vercel's runtime logs) and, when the variables below are set, to Axiom. The proxy and the route handler each write a line for an API request; they share the `request_id`.

### Who acted

`actor_kind` is `member`, `staff`, `clinic`, `anon` or `system`, and `actor_id` is the Supabase auth user id (a uuid). They are set where the sign-in helpers resolve the user: `patientIdentity` (member), `getStaff` and `validatedStaffSession` (staff), `clinicAccess` (clinic). Cron routes are `system`. A line written before the helper runs has no actor.

### The proxy line

The proxy line is the only one with request facts, and each is coarse on purpose:

- `actor_kind` there says which sign-in cookie the browser sent (`member`, `staff`, `clinic`, or `anon` for none). The proxy does not verify the cookie and has no `actor_id`; the `route` and `action` lines carry the verified actor.
- `ua_family` is a browser family (`safari`, `chrome`, `telegram`, `bot`...), never the user agent string.
- `country` is Vercel's two-letter `x-vercel-ip-country`.
- `ip_prefix` is the client's network, never the address: `203.0.113.0/24` for IPv4, `2001:db8:85a3::/48` for IPv6. The allow-list rejects anything else in that field.

The status is the proxy's own decision. For a request it passes on (`outcome: "next"`), the page's final status is not known there; route handler and action lines carry theirs.

### Request ids

`proxy.ts` gives every request an `x-request-id`, keeping the caller's value only when it looks like an id (8 to 128 of `A-Z a-z 0-9 . _ : -`). Server components, actions and route handlers can read it with `headers()`, every response returns it, and every server call to Supabase carries it as an `x-request-id` header. Ask a member or a tester for the `x-request-id` of a failing response (browser dev tools, Network tab) and search for it.

Whether Supabase keeps that header in its own API logs depends on what Supabase records for the project; do not rely on it. The `db.rpc` lines in Axiom carry the id either way.

## What is not covered

These never reach our code, so they have no line here. Vercel's own request logs (short retention) remain the source for them:

- static assets: `_next/static`, `_next/image`, and public files such as images, fonts and the favicon;
- requests Vercel blocks before the app (firewall, bot protection, DDoS mitigation, deployment protection);
- some 404s answered at Vercel's edge without running the proxy, and requests to deployments other than Production (preview deployments have no `AXIOM_TOKEN`);
- browser-side errors (Sentry covers those separately).

Next.js also prints its own error output (the original message and stack of an unhandled error) to Vercel's runtime logs. That output is not scrubbed. This was already the case before Axiom, it never goes to Axiom, and it stays in Vercel's short-retention logs, which only the team can read. The ids-only rule below keeps member data out of it.

## What is never logged

The allow-list in `lib/observability/redact.ts` is the only way into a log line. A field that is not named there is dropped (only the number of dropped fields is kept, as `redacted_fields`), and each allowed field has a strict shape: ids must be uuids, names of RPCs, tables and sweeps must be identifiers, and `msg` must be an event name.

So these never reach a log line: full IP addresses, user agent strings, names, phone numbers, emails, message text, questionnaire answers, blood pressure and other measurements, lab values, document contents, tokens, cookies, request or response headers, request bodies, RPC arguments and results, and query strings.

**Rule for code (shared with Sentry):** never put member data in log text or error messages. Use ids only. Write `log.info("event.name", { member_id })`, never a message that names, quotes or describes a member. `msg` must be an event name, and the redaction below is a backstop, not a licence.

Free text is scrubbed rather than trusted:

- **Routes:** query and fragment removed; uuids become `:id`, numbers `:n`, and any segment that is not a short lowercase word (a token, a name, a phone number, a file name) becomes `:x`.
- **Error messages:** first line only. Everything from a Postgres detail marker on (`Failing row contains (...)`, `Key (col)=(value)`, `DETAIL:`, `HINT:`) is cut. Quoted text, URLs, emails and long opaque strings are replaced, and every number becomes `#`. Parentheses keep only a code. A word survives only if it is in `lib/observability/error-words.ts` (built from the messages this code throws, plus common Postgres and network wording) or is shaped like code (`snake_case`, `camelCase`, `JWT`); anything else, a lower-case name included, becomes `<w>`. 160 characters at most. `error_code` must look like a Postgres, PostgREST, Node or auth code, and `error_name` like an error class name.
- **Stacks:** only `at fn (file:line:col)` frames, at most 12, without query strings. The message line is never kept.
- **Sweep counts:** only numbers whose key names a count.

`scripts/check-log-redaction.ts` feeds objects full of sample PII and PHI through the logger and fails if any of it comes out. Adding a field to the allow-list is a privacy change: give it a strict shape and a case in that check.

## Environment variables

Server-only, set in Vercel for **Production** only and marked **Sensitive**. Never give them a `NEXT_PUBLIC_` name: the token must never reach the browser.

| Variable | Value |
| --- | --- |
| `AXIOM_TOKEN` | An ingest-only API token for the one dataset |
| `AXIOM_DATASET` | `noreon-app-prod` |
| `AXIOM_DOMAIN` | `eu-central-1.aws.edge.axiom.co` |

Optional, any environment:

| Variable | Effect |
| --- | --- |
| `NOREON_LOG_CONSOLE` | `off` stops console lines; `on` forces them (they are on by default in `next dev`, `next start` and on Vercel, and off in check scripts) |
| `NOREON_LOG_LEVEL` | `debug`, `info` (default), `warn` or `error` |

With `AXIOM_TOKEN` unset (local, preview, tests), lines go to the console only and nothing is sent. `AXIOM_DOMAIN` is required and has no default, so a missing value never falls back to Axiom's US endpoint (`api.axiom.co`); the logger only sends to an `*.axiom.co` domain.

### How sending works

Lines are buffered in memory and sent as NDJSON to `https://$AXIOM_DOMAIN/v1/ingest/$AXIOM_DATASET` after the response, through Next's `after()` (or, where that is not allowed, a short delayed send kept alive by Vercel's `waitUntil`), in batches of 100 with a 2-second timeout. Nothing on the request path waits for the network. A failed or slow send is dropped with one warning a minute; the buffer holds at most 1000 lines and counts what it drops.

## Turning it off

Remove `AXIOM_TOKEN` from the Production environment in Vercel and redeploy (Vercel applies environment changes to new deployments only). Lines then go to the console only. To stop console lines too, set `NOREON_LOG_CONSOLE=off`.

## Searching in Axiom

Open the `noreon-app-prod` dataset in Axiom (EU) and use the query tab (APL).

Errors in the last hour:

```kusto
['noreon-app-prod']
| where _time > ago(1h) and level == "error"
| project _time, msg, route, action, status, error_name, error_code, error_message, request_id
| order by _time desc
```

Slowest routes and actions today (p95):

```kusto
['noreon-app-prod']
| where _time > ago(24h) and msg in ("route", "action")
| summarize p95_ms = percentile(duration_ms, 95), calls = count() by route, action
| order by p95_ms desc
| take 20
```

Slowest RPCs:

```kusto
['noreon-app-prod']
| where _time > ago(24h) and msg == "db.rpc"
| summarize p95_ms = percentile(rpc_ms, 95), calls = count(), failures = countif(db_status >= 400) by rpc
| order by p95_ms desc
```

Everything for one request:

```kusto
['noreon-app-prod']
| where request_id == "PASTE-THE-ID"
| order by _time asc
```

What one staff member did (their auth user id):

```kusto
['noreon-app-prod']
| where _time > ago(7d) and actor_kind == "staff" and actor_id == "PASTE-THE-UUID"
| project _time, msg, route, action, status, outcome, request_id
| order by _time desc
```

Cron sweeps:

```kusto
['noreon-app-prod']
| where _time > ago(6h) and msg == "sweep"
| project _time, sweep, outcome, duration_ms, counts
| order by _time desc
```

## Monitors (set up in Axiom)

Two suggested monitors, each notifying `ops@noreon.health` (an email notifier in Axiom):

1. **Error rate over 1% in 5 minutes** (threshold monitor, every 5 minutes, alert when above 1):

   ```kusto
   ['noreon-app-prod']
   | where msg in ("route", "action")
   | summarize calls = count(), errors = countif(status >= 500) by bin(_time, 5m)
   | where calls >= 20
   | project _time, rate = 100.0 * errors / calls
   ```

   The `calls >= 20` line keeps one failure in a quiet window from paging; the burst monitor below covers those.

2. **Any 5xx burst** (threshold monitor, every 5 minutes, alert when above 5):

   ```kusto
   ['noreon-app-prod']
   | where (msg in ("route", "action") and status >= 500) or msg == "error.unhandled"
   | summarize errors = count() by bin(_time, 5m)
   ```

## Checks

- `scripts/check-log-redaction.ts`: no sample PII or PHI survives redaction or the logger.
- `scripts/check-log-coverage.ts`: every `route.ts` handler and every `"use server"` export is wrapped, so a new one cannot be silent.
- `scripts/check-log-transport.ts`: batching, the auth header and NDJSON body, the timeout and bounded buffer against a local mock ingest server, console-only behaviour with the variables unset, and the request id from proxy to route lines and Supabase calls.
- After a deploy with the variables set: call any page, read its `x-request-id` response header, and find it with the "one request" query above.
