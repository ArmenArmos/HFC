# Data map: where each kind of data lives

Written 19 October 2026 from the code at `main` and read-only checks. Update it when a
processor, region or data flow changes. "Member data" means anything about a person:
identity, contact details, answers, readings, lab values, files, messages. "Pseudonymous"
means internal ids and activity metadata without names, contact details or clinical content;
it is still personal data under GDPR. Switch states below are taken from
`output/GO_LIVE_GATES.md` and code gates, not re-verified in production for this document.

## Summary

| Store or processor | What it holds | Region | How we know | Member data? |
| --- | --- | --- | --- | --- |
| Supabase Postgres (project `makyulcjgqffiuzbhyte`) | Profiles, questionnaire answers, readings, lab values, care plans, conversations, Zoe runs and traces, bookings, audit rows, job ledger | AWS `eu-central-1` (Frankfurt) | The database host's IPv6 address is in `2a05:d014::/35`, which AWS publishes as `eu-central-1` EC2 (ip-ranges.json, checked 19 Oct 2026); the production deploy connects through the `aws-0-eu-central-1` session pooler, which only serves projects in that region | Yes, all of it |
| Supabase Auth (same project) | Sign-in identities: phone numbers, emails, password hashes, sessions | Same as the database | Same project | Yes |
| Supabase Storage (same project) | `patient-reports` (member report PDFs and images), `member-history` (documents members upload about their history), `clinic-originals` (clinic lab PDFs read by the lab AI), `workspace-case-reports` (legacy shared-demo case reports, `20261009180320_shared_case_reports.sql`) | Same as the database | Buckets created in `supabase/migrations/`; `lib/member-history/server.ts`, `lib/clinic-portal/upload-runtime.ts`, `lib/staff/reports.ts` | Yes, whole documents |
| Shared-demo Supabase project (`homqzwzrskgnizbycvhq`), legacy | Demo workspace cases and `workspace-case-reports` objects, reached through `NOREON_WORKSPACE_SUPABASE_URL` (`lib/staff/auth.ts`) when the shared demo is on | Same AWS prefix as production (`2a05:d014::/35`, eu-central-1) by the same DNS method; not checked in its dashboard | `lib/staff/auth.ts`; `output/remove-demo-2026-10-18/STATUS.md` | Demo data only by intent; objects stored earlier stay until the project is deleted |
| Vercel (project `noreon-app`, and `noreon-core` for the public site) | Runs the app. Keeps runtime logs: every structured log line (`lib/observability/logger.ts` writes to the console) and Next.js's own unscrubbed error output, short retention | Functions in `fra1` (Frankfurt), `vercel.json` `regions`. Where Vercel stores runtime logs is not documented here: unknown. Static files on Vercel's global CDN | `vercel.json`; `docs/operations/logging.md` | Pseudonymous ids in structured lines; unscrubbed error text can carry whatever an error message held (the ids-only rule in `AGENTS.md` is the control) |
| Axiom (dataset `noreon-app-prod`) | Structured server logs: routes, statuses, timings, `actor_id` and `member_id`, country and IP prefix | EU, `eu-central-1.aws.edge.axiom.co` | `docs/operations/logging.md`; the logger refuses non-`*.axiom.co` domains and has no US default | Pseudonymous: allow-listed fields only (`lib/observability/redact.ts`), no names, contact details or clinical content |
| Sentry (organisation `noreon-health`) | Errors from browser, server and edge: scrubbed messages, stack traces, request metadata, a UUID `user.id` where set; no bodies | EU, Frankfurt (`*.ingest.de.sentry.io`) | `docs/operations/error-monitoring.md`; the app refuses any other DSN | Pseudonymous: scrubbed (`lib/monitoring/scrub.ts`) of recognisable names, contacts and clinical text; plain prose cannot be fully recognised |
| Vercel AI Gateway, then the model provider | Zoe: redacted member message text and context. Lab reading: whole lab PDFs. Care plan drafts: structured clinical summary | Gateway: Vercel. Providers: whichever model the admin AI settings pick per tier. Defaults in code are Anthropic (`anthropic/claude-*`) and OpenAI (`openai/gpt-6-*`); the catalog (`20261017144511_zoe_model_catalog_providers.sql`, `lib/zoe/route-config.ts`) also allows Alibaba, Amazon, DeepSeek, Google, Meta, Mistral, Moonshot AI, SpaceX AI (xAI) and Z.ai models. **Provider region and retention are not pinned** (no provider `only`/order or zero-data-retention option in the code) | `lib/zoe/gateway.ts`, `lib/lab-ai/provider.ts`, `lib/ai-plan/provider.ts` | Yes (redacted text for Zoe; whole documents for lab reading). Each feature has its own switches (`output/GO_LIVE_GATES.md`); on for staging tests, off for real members |
| OpenAI Responses API, direct (report import) | Whole member report files (PDF or image) for extraction | OpenAI (US); sent with `store: false`, which is not a zero-data-retention agreement | `lib/reports/provider.ts`, `lib/reports/server.ts`; gate `NOREON_REPORT_IMPORT_ENABLED` plus `OPENAI_API_KEY` (`lib/reports/enabled.ts`), separate from the Gateway gates. `OPENAI_API_KEY` is present in production (`output/GO_LIVE_GATES.md`); whether the flag is on there is not verified here | Yes, whole documents |
| Telegram (Bot API, `api.telegram.org`) | Every message between a member and the Noreon bot, the member's Telegram id, name and username as Telegram has them; photos the member sends | Telegram's servers (global; Telegram does not offer a region choice) | `lib/telegram-runtime/`, `lib/telegram-channel/` | Yes: message text and photos, held by Telegram under its own terms |
| hCaptcha | Browser signals for the sign-in CAPTCHA | Intuition Machines (US); Supabase Auth verifies the token | `lib/captcha.ts`; Supabase Auth CAPTCHA setting | Device and network signals, no health data |
| Google Apps Script, Sheets and Gmail (public site contact form) | Name, email, message, callback choice and phone number; appended to a Google Sheet and emailed in full to info@noreon.health | Google; region of the Sheet and mailbox unknown | `app/(marketing)/contact/actions.ts` (`SHEETS_WEBHOOK_URL`), `docs/sheets/contact-requests.gs` | Contact details; the free-text message may contain health information (only its shape and length are checked, `lib/marketing/contact.ts`) |
| Brevo email | Staff invitations and password recovery (`lib/staff/real-admin.ts`, `lib/messaging/brevo-email.ts`), clinic scheduling notices (`lib/real-booking/scheduling-notice.ts`), legacy outbox email; each has its own gate | Brevo (EU, France) | Code gates; `output/GO_LIVE_GATES.md` section 1 records staff email recovery as possibly live, unverified | Staff and clinic email addresses and message text; clinic notices can name a booking |
| Brevo SMS, Twilio SMS and Verify, Meta WhatsApp | Transports in `lib/messaging/` (`brevo.ts`, `twilio*.ts`, `meta.ts`) and the Supabase SMS auth hook; legacy outbox delivery documented as off (`docs/operations/messaging.md`) | Brevo: EU. Twilio, Meta: US/global | Code; deployment state not re-verified here | Phone numbers and message text when on |
| Vercel Blob | Not used | None | No `@vercel/blob` dependency | None |
| GitHub, CI servers (Hetzner `noreon-ci-1`, `-2`, Falkenstein, DE) | Code, synthetic test data | GitHub: US. Hetzner: Germany | `docs/operations/ci-runner.md` | No: CI uses local throwaway databases and fictional data |

## Flows that leave the EU

1. **AI model calls.** The Gateway forwards to whichever configured provider each tier uses
   (Anthropic and OpenAI by default; any catalog provider above if an admin picks it) without a
   pinned region or zero-data-retention option, so prompts may be processed in the US or elsewhere
   outside the EU. Redaction
   (`lib/zoe/redact.ts`) removes names and contact details from Zoe's text; lab reading sends
   the whole PDF. Before real members: BYOK keys with zero data retention, or provider
   pinning to EU endpoints where offered, and a DPA with each provider
   (`output/STANDARDS_BACKLOG.md` #2, architecture review ADR 5).
2. **Telegram.** Member messages live on Telegram's servers by the nature of the channel.
   The member chooses the channel; the privacy notice must say so.
3. **hCaptcha.** Device signals only.

4. **Report import (direct OpenAI)** when `NOREON_REPORT_IMPORT_ENABLED` is on: whole report
   files go to OpenAI in the US.
5. **Contact form**: Google Sheets and Gmail, region unknown; visitors' free text may contain
   health information.
6. **Twilio, Meta** if any of those transports is switched on.

The database, auth and stored files are in Frankfurt, as are the app's functions, Axiom logs
and Sentry errors. Vercel's runtime-log storage region is not recorded.

## Open items

- **Armenian law on cross-border health data:** whether consent is enough for processing in
  the EU and by US AI providers, and whether a copy must stay in Armenia. Legal question,
  listed in `output/STANDARDS_BACKLOG.md` #2.
- **Supabase backups and point-in-time recovery:** plan, retention and whether PITR is on are
  not recorded here; check in the Supabase dashboard (Database, Backups) and add a row.
- **Confirm the region in the dashboard** once (Project settings, General): the evidence above
  is the network address and the pooler, not the settings page.
- **Data processing agreements:** Supabase, Vercel, Axiom, Sentry, the AI providers, Google,
  Brevo. None are recorded in the repository.
- **Which optional flows are on in production** (report import, Brevo email paths, SMS): verify
  and record here; this document did not check production switches.
- **Shared-demo project**: delete it (and its stored objects) with the demo removal, or record its
  region from its dashboard.
