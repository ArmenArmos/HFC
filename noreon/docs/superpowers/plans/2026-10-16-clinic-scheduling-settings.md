# Clinic scheduling email settings implementation plan

> Execute inline with superpowers:executing-plans; Main arranges one fresh Opus review after source freeze.

**Goal:** an existing authorized Noreon administrator can persist/read back a clinic
scheduling mailbox and Noreon copy mailbox, with stale-update protection and
idempotent/audited writes. Existing clinics start unconfigured. No delivery,
booking confirmation, rescheduling, clinic portal or clinical policy changes.

Reference: agreed MVP flow section5 (16 October 2026) and
/Users/khikardanielyan/Code/Noreon/output/numeric-step-feedback-2026-10-16/CLINIC_EMAIL_GAP_DESIGN.txt.
Base: 2d5af5cf76606aad16d3243746df08cc27e2e824. Include prior local C7 copy
commit3c7bed6 in the eventual batch. Developer3 owns migrations/generated types;
Main owns independent review and integration scheduling. Anamnez release lock
and existing main CI dependency remain until explicit clearance.

Architecture (lead accepted, 16 October 2026)
- Nullable scheduling_email + integer scheduling_revision on workspace_clinics.
- New singleton workspace_scheduling_settings row for nullable copy_email/revision,
  with RLS and no direct client grants. No server-env parser or default recipient.
- Two admin-only write RPCs and one copy-settings read RPC; extend existing
  clinic read RPC with scheduling fields. Preserve existing clinic-create RPC.
- Immutable request receipts bind request UUID/actor/operation/canonical input
  and original result. Check current actor access even on replay. Row locks plus
  expected revision prevent lost updates; update/audit/receipt commit atomically.
- Reuse existing admin identity/host checks, with DB admin enforcement independent
  of UI. No new role or direct table grant. Existing audit kinds retained.
- Dedicated schemas, server action and client forms integrated in real Clinics
  page. Missing/unavailable/stale/uncertain persistence remains explicit.

Acceptance
- Admin can set/change/clear one valid mailbox and read back the new revision.
- Doctor/nurse/member/anon/inactive admin/direct table writes are denied.
- Empty existing settings are clearly unconfigured, never assigned a fallback.
- Malformed/CRLF/multiple/too-long email is rejected before persistence.
- Idempotent replay returns the original receipt; different request payload or
  actor cannot reuse a request UUID. Stale writes cannot overwrite later values.
- Failed tx leaves no update/audit/receipt. Concurrent same-revision writes have
  one winner; concurrent replay has one audit event and stable outcome.
- Actual EN/HY375/1280 form interaction covers pending/error/unknown/saved state;
  invalid drafts survive failed saves; unknown outcomes demand readback.
- No network send, provider activation, health-data write or hosted DB mutation.

Tasks
1. [x] Review current SQL/role/receipt patterns and obtain lead acceptance of
   the singleton copy configuration and file boundary before implementation.
2. [x] Write meaningful TS schema/action/form and transactional SQL/concurrency
   checks; demonstrate new behavior missing before implementation.
3. [x] Generate migration with pnpm db:new; implement constraints, settings,
   receipts, admin RPCs and audit semantics. Never edit an applied migration.
4. [x] Use one explicitly owned local database, replay all migrations from zero,
   run permission/replay/stale/rollback/concurrency checks and generate DB types
   through the CLI. Coordinate/stop owned runtime; never reset shared QA state.
5. [x] Implement schema/read/action/client forms and clinic page integration.
   Preserve existing clinic creation, staff invitations and role/host patterns.
6. [x] Typecheck, focused regressions and inspect rendered real forms in EN/HY
   at375/1280, including failure/unavailable/pending/uncertain states. Distinguish
   isolated form fixtures from full signed-in database-entry-point acceptance.
7. [ ] Freeze source/evidence, maintain one finding list, send Main for fresh
   Claude Opus5.5 independent review; close concrete findings. No extra broad
   review or duplicate successful suites without new changes or concerns.
8. [ ] Leave clean local commits/evidence and stop owned services/DB/Colima.
   No push/CI/merge until Main batch coordination and release dependency clear.

Files (final names may adjust within the same owned boundary)
- CLI-generated supabase/migrations/*_clinic_scheduling_settings.sql
- lib/db/types.ts (CLI generation only)
- lib/staff/clinic-scheduling-schema.ts
- lib/staff/real-clinic-scheduling-actions.ts
- lib/staff/real-admin.ts (admin clinic schema/read integration)
- components/real-review/clinic-scheduling-form.tsx
- app/staff/real/(review)/clinics/page.tsx
- scripts/check-clinic-scheduling*.ts/.sql/.mjs (focused behavior/DB races)

Open findings start empty. Design acceptance and required fresh review are
separate from implementation, hosted CI, merge, deployment and live acceptance.

## Verification checkpoint

Full local replay and generated-type equality, transactional SQL/legacy
compatibility, five actual session races, actual action exports and page branches
with mocked IO, local database-backed EN/HY375/1280 UI, clinical5250 checks,
typecheck/lint/actionlint and normal production build passed. Temporary routes
and server removed. Full production sign-in browser gate, physical devices and
real delivery remain outside this local proof. R1–R4 closed locally; R5 browser
fill caveat retained, native-key stale and unknown-before-write retention passed.
No push/CI/merge/deploy. Owned DB/VM kept briefly for immediate independent review,
then must stop. Queued assigned-member search starts only after frozen handoff.
