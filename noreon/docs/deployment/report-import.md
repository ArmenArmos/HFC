# Previous report import

The report API uses the existing verified Supabase phone session. It is disabled unless NOREON_REPORT_IMPORT_ENABLED=true and a server-only OPENAI_API_KEY exists. Demo mode never accepts files or calls OpenAI. The Results page links to /patient/reports.

Production setup:
- OPENAI_API_KEY: sensitive production secret, already saved in noreon-app.
- CRON_SECRET: independent sensitive production secret for hourly deletion cleanup, already saved in noreon-app.
- NOREON_REPORT_IMPORT_ENABLED: leave unset until phone registration, owner isolation and real-account acceptance are verified.
- OPENAI_REPORT_MODEL: defaults to pinned gpt-5.4-2026-03-05; evaluate replacements before changing it.

Migrations create private patient-reports storage, owner-readable report rows, service-only mutation RPCs and atomic quotas. Only the hosted migration workflow applies production changes. Requests allow at most 8 MB / ten PDF pages and 20 million decoded image pixels. Ten upload reservations per rolling day; five extraction attempts and five explanation attempts per member per UTC day; 50 global AI attempts per UTC day. Failed provider attempts consume quota. There is no automatic retry.

Deletion immediately tombstones the record and removes access. The authenticated cleanup route /api/internal/report-cleanup runs hourly and removes files again after three hours, covering two-hour signed-upload token expiry. Keep CRON_SECRET configured and inspect failed cron runs. Never mark storage cleanup complete based only on tombstoning.

Verification commands:
- pnpm typecheck; pnpm build; pnpm check:tokens
- node --import ./scripts/register-alias.mjs scripts/check-reports.ts
- node --import ./scripts/register-alias.mjs scripts/check-report-files.ts
- node --import ./scripts/register-alias.mjs scripts/check-report-provider.ts
- node scripts/check-report-db.mjs (local Supabase only)
- node scripts/check-report-api.mjs (isolated real-mode local server on 4175; local Supabase only)

An opt-in check, `NOREON_VALIDATE_AI=true pnpm check:ai` (no longer part of `pnpm build`), invokes actual OpenAI extraction on three explicitly fictional fixtures and an explanation. Builds never run it. It consumes API credit; do not turn it on routinely. Fixture output may be logged because every value is synthetic. Runtime provider output and uploaded health data must never be logged.

Evaluation limits: GPT-4.1 live PDF checks intermittently missed the literal/unit match and the collection date. The release candidate uses GPT-5.4 after these failures. A subsequent run passed the PDF and both PNG fixtures; the extraction instruction now explicitly separates literal value, units and reference. These are a small smoke-test set, not clinical validation or proof of Armenian/Russian document accuracy: the PNGs have multilingual headings with English marker labels. Review remains mandatory. Raw imaging/ECG interpretation is unsupported. AI explanations are educational; they do not publish clinician reviews, alter questionnaire answers, order tests or prescribe treatment.

Before enabling real uploads, finish actual SMS sign-in, verify the full browser upload/review/reload flow and PDF preview in a real session, agree the company processor/retention setup, and expand the fixture evaluation with clinician-approved representative documents. Never send real records merely to test configuration.
