# Synthetic Zoe preview

This is the approved synthetic Yesai demonstration, not live behavioral coaching. All four scenarios are present: BP forgetfulness, BP anxiety, medicine travel/routine disruption and low perceived importance. Clinical concerns use a simulated human-support route. No clinical classifier, dose recommendation, real recipient, database persistence or outbound call exists here.

The dashboard renders the preview beside the daily routine only when the server environment variable `NOREON_SYNTHETIC_ZOE_PREVIEW` is exactly `true`, the assessment is complete and the existing clinical engine has not selected an urgent route. It is off by default. Do not enable it on hosted environments as part of this release. The client receives only locale, not care records. Switching scenarios or resetting intentionally clears this synthetic session. Reloading loses its state; no browser storage is used.

The clock starts at a fixed synthetic Armenia day and advances only through visible example controls. Each event has a synthetic identity and plan version. Member-confirmed barriers select a versioned library entry; missing evidence never implies a barrier or skipped dose. The implementation deliberately makes no COM-B hypothesis rather than assigning an unverified diagnosis. Multiple nonclinical barriers request clarification. Clinical concerns take precedence.

One initial suggestion and one requested alternative are allowed per Armenia day, with a 14-day declined-entry cooldown. Proactive suggestions observe 21:00–07:00 quiet hours; explicit help remains available. Off/pause does not change the independent reminder preference or remove human support. Snoozes are simulated for 60 minutes and never delivered.

Actions have strict schemas and retry IDs. Exact retries return `retry`; conflicting payloads return `conflict`. The 200-action bound rejects further changes and asks for explicit reset. Prior evidence/acceptance snapshots remain in logs after corrections/removal. Outcomes require matching event/plan and actual time at or after acceptance; they are associations, not causal or ingestion claims. Repeated acceptance cannot move the original acceptance timestamp. Corrections use an expected revision.

Run the four `scripts/check-zoe-synthetic-*.ts` checks via `scripts/run-checks.mjs`, or with `node --conditions=noreon-server-test --import ./scripts/register-alias.mjs <script>`.

Before live use: obtain clinical/product copy approval; implement consent and retention policy, persisted authorization/audit, real clinical-context integration, supported event scheduling and evidence ingestion, operational ownership, delivery provider prerequisites and real-device acceptance. This session model must not be connected directly to production records as a shortcut.
