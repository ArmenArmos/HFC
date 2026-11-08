# Error monitoring (Sentry)

Sentry collects unhandled errors from members' and staff browsers and from the
server (Node and edge), so a crash on a member's phone becomes an issue we can see.
Server logs go to Axiom; a Sentry error carries the same `request_id` tag as the
Axiom log lines for that request.

Sentry is a processor of error data for Noreon. Before real members use the app,
Khikar accepts Sentry's DPA (Settings → Legal & Compliance) and Sentry is listed
with the other processors (P14).

## Where the data lives

- Organisation `noreon-health`, **EU data region (Frankfurt)**. The region is fixed
  when the organisation is created and cannot be changed.
- The app refuses any DSN that is not `https://…ingest.de.sentry.io/…`
  (`lib/monitoring/sentry-options.ts`). A US DSN leaves Sentry off rather than
  sending data to the US.

## What is sent

- Error type, a scrubbed message and the stack trace (file, function, line).
- The route without its query string or fragment, and the HTTP method.
- Browser, OS and device model, runtime version, release and environment.
- Request breadcrumbs: method, status code and URL path only; navigation paths.
- Tag `request_id` (from the `x-request-id` header the Axiom proxy sets) and, if
  our code ever sets one, an internal member UUID as `user.id`.

## What is not sent

- Request and response bodies, cookies, query strings, and every request header
  except `user-agent`, `x-request-id`, `content-type` and `accept-language`.
- User email, username, IP address and location. Every event carries `user.ip_address: null`, which tells Sentry not to infer the IP or a location from it. A user id that is not a UUID is dropped.
- Console output (console breadcrumbs are dropped), local variables, source lines
  around stack frames, `extra` data and any custom context.
- In any message, tag or fingerprint: Telegram bot tokens, JWTs and bearer tokens,
  email addresses and @handles, query strings, Postgres `Failing row contains (...)`
  and `Key (column)=(value)` details, quoted values that are not code identifiers,
  readings (a clinical word followed by a number, BP pairs, numbers with units),
  decimals, phone numbers, and any number of 2 or more digits unless it is a status,
  line or port. Then **every word not in an error vocabulary** (`MESSAGE_WORDS` in
  `lib/monitoring/scrub.ts`) is replaced, so lowercase prose, single names and
  medicines go too; Armenian, Cyrillic and Georgian words always go. Messages are
  capped at 200 characters. Linked causes (`Error.cause`) get the same treatment.
  Replacements read `[text]`, `[number]`, `[reading]`, `[email]`, `[handle]`,
  `[secret]` or `[redacted]`. If useful words keep showing as `[text]`, add them to
  the vocabulary with a test.
- Exception mechanism data, React component stacks, and query strings in stack
  frame URLs. Allowed header values that do not look like that header are dropped.
- Any field whose key names something personal or clinical (name, phone, email,
  address, birth, message, text, note, answer, BP, pulse, glucose, lab, result,
  value, medication, token, cookie, session and similar).
- Session Replay is not installed. Turning it on later needs `maskAllText`,
  `blockAllMedia` and a legal OK.
- Performance tracing is off (no `tracesSampleRate`), so no transactions or spans.
- Release-health sessions are off (no BrowserSession or ProcessSession integration):
  sessions carry the IP address and user agent and never pass `beforeSend`. A
  `beforeEnvelope` hook still strips IPs, session user agents and non-UUID `did`s from
  every envelope type as a backstop.

Code must not put member data in error messages at all (noreon-core AGENTS.md, "Errors and logs"); the scrubber is the backstop. The SDK's `dataCollection` switches turn most of this off; `lib/monitoring/scrub.ts`
runs on every event as `beforeSend` / `beforeSendTransaction` / `beforeBreadcrumb`.
`scripts/check-sentry-scrub.ts` feeds both the scrubber and a real SDK (through a
mock transport) PHI samples and fails if any reach the outgoing envelope. Change
the scrubber only with that check passing, and add a sample for any new kind of data.

Also set, once, in the Sentry project (Settings → Security & Privacy): **Data
Scrubber on**, **Use Default Scrubbers on**, **Prevent Storing of IP Addresses
on**. These are a server-side backstop.

## Configuration

| Variable | Where | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_SENTRY_DSN` | Vercel noreon-app, Production (and Preview if wanted) | The project's DSN (public by design; must be `*.ingest.de.sentry.io`) |
| `SENTRY_AUTH_TOKEN` | Vercel noreon-app, Production (+ Preview), **Sensitive** | Organization auth token (Settings → Developer Settings → Organization Tokens; it carries the release and source-map scopes). Build time only, never in the browser bundle. |
| `SENTRY_ORG` | Vercel noreon-app, Production (+ Preview) | `noreon-health` |
| `SENTRY_PROJECT` | Vercel noreon-app, Production (+ Preview) | The Sentry project slug |

With `NEXT_PUBLIC_SENTRY_DSN` unset the app builds and runs without Sentry. With
the DSN but no token, errors are sent but stack traces stay minified.

Source maps are created only when the token, org and project are all set. After
upload they are deleted from the build and their `sourceMappingURL` comments are
stripped, so browsers never receive them. A failed upload warns and the deploy
continues; deletion still runs.

## Alert rules

Create in Sentry (Alerts → Create alert → Issues), all to **ops@noreon.health**:

1. **New issue**: "A new issue is created", environment `production`.
2. **Regression**: "The issue changes state from resolved to unresolved".
3. **Spike**: "Number of events in an issue is more than 50 in 1 hour", or
   "Number of users affected by an issue is more than 10 in 1 hour".

Never route alerts to a personal inbox or a chat with members in it. Alert emails
contain the scrubbed error title only.

## Triage

1. Open the issue. Read the error type, message and the top in-app frame.
2. Copy the `request_id` tag and search Axiom (`noreon-app-prod`) for it to see the
   request's log lines: route, timings, database calls.
3. Server render errors also carry Next's `digest`, which the Axiom
   `error.unhandled` line records too.
4. Fix in a lane PR from `main`; mark the issue "Resolved in next release" so a
   recurrence opens a regression alert.
5. If you ever see member data in an event: delete the event (or issue), add a
   sample of that data to `scripts/check-sentry-scrub.ts`, fix the scrubber, and
   tell the lead the same day.

## Turning it off

- Fastest: remove `NEXT_PUBLIC_SENTRY_DSN` from Vercel and redeploy. The browser
  and server stop sending; nothing else changes.
- Without a redeploy: in Sentry, Project Settings → Client Keys → disable the key.
  Events are rejected at Sentry's edge.
- Remove `SENTRY_AUTH_TOKEN` to stop source-map uploads.
