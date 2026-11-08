# Messaging spending controls implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent unconfigured, unsupported-route, over-segment and over-reservation-budget message attempts before provider I/O.

**Architecture:** Preflight fixed message bodies against a versioned database policy; atomically reserve a conservative amount with begin. Keep callbacks/recovery independently usable. No provider prices or live settings are supplied by this change.

**Tech stack:** TypeScript/Zod, PostgreSQL forward migration, Supabase RPC, current Twilio adapter.

**Spec:** `docs/superpowers/specs/2026-10-12-message-spend-controls-design.md`.

## Global constraints

Delivery stays disabled. Integer micro-units only; no automatic refunds. Provider maxPrice is obsolete and must not be used. Preserve dispatch-control-first lock order, verified-phone consent, plan expiry, quiet hours and review/recovery semantics. Rates/currency/allowlisted prefixes require later operator configuration. No schema edits to previously applied migrations.

## Review focus

- Competing workers cannot pass the last reservation slot together.
- Expired/racing policy and stale workers fail closed before provider calls.
- A rejected or uncertain attempt does not release money or permit free retries.
- Currency changes cannot reinterpret totals or reset today's allowance.
- Unicode/GSM escape boundaries and long URLs cannot undercount SMS segments.

## Task 1: Segment and policy preflight

Files: `lib/messaging/spend.ts`, `scripts/check-message-spend.ts`.
Interfaces: `countSmsSegments(body)` returns encoding, units, segments using conservative multipart capacities; `parseSpendPolicy(value,now)` validates active policy; `assertMessagePreflight(config,policy)` builds both fixed SMS locale bodies and checks against policy segment allowance. Policy fields include revision, currency, daily_limit_micros, sms_segment_ceiling_micros, whatsapp_message_ceiling_micros, max_sms_segments, allowed_prefixes, valid_until, enabled.

- [x] Write failing checks for GSM160/161, Unicode70/71, extension escape and surrogate-boundary packing, malformed text, EN/HY body and long URL, expired/disabled policy and numeric bounds.
- [x] Implement deterministic counting by per-character unit packing; never split a two-unit escape/surrogate across segments. Reserve conservative 152/66 multipart capacities for all routes.
- [x] Validate both generated SMS variants against the configured maximum before creating a transport or beginning work. Unit ceilings are operator-supplied estimates, not billing claims.
- [x] Run targeted checks, root types and commit.

Example assertions: `countSmsSegments('a'.repeat(160)).segments === 1`, `countSmsSegments('ա'.repeat(71)).segments === 2`; `assertMessagePreflight` rejects a URL causing more segments than the policy permits.

## Task 2: Atomic database policy and reservation

Files: CLI-generated migration, `scripts/check-message-spend.sql`, `scripts/check-message-spend-concurrency.ts`, generated `lib/db/types.ts`.

- [x] Create migration with `pnpm db:new message_spend_controls`. Add RLS-protected policy, policy audit, daily totals and immutable per-attempt reservations, all with no direct write grants. Initial singleton policy is disabled and unconfigured.
- [x] Add attributed revision-checked configure RPC. Positive safe-integer micro-unit ceilings, explicit uppercase three-letter currency, 1–10 segment bound, strict destination-prefix list, and future validity required to enable. Freeze currency once any reservation exists, including across days; changing currency requires a separately designed migration instead of relabelling old money. Budget reductions retain already-reserved totals.
- [x] Revoke old `begin_patient_message_submission(uuid)` and retain it as a private routine. Add `begin_patient_message_submission_budgeted(uuid,bigint)` taking expected policy revision. Lock dispatch control first, then policy; revalidate enabled/expiry/revision; invoke existing guarded begin in the same transaction. Check actual returned destination against configured prefixes, reserve `max_sms_segments * sms_segment_ceiling_micros` for SMS or WhatsApp per-message ceiling, then commit attempt and reservation together. An error rolls both back. Nonqueued old jobs return without spending again. Never release reservations during finish, callbacks or recovery.
- [x] Test no direct writes or old RPC access, all rejection rollbacks, exact last-slot concurrency, retained failed/unknown reservations, currency immutability, policy audit and daily rollover. Seed fictional policy inside isolated existing messaging tests so prior safety tests still exercise the guarded path.
- [x] Clean isolated replay and regenerate types; never edit migration after applying it.

## Task 3: Wire dispatch and operator tooling

Files: `lib/messaging/{dispatch,store,worker,operations}.ts`, existing messaging regression scripts and operator documentation.

- [x] Read/parse policy before transport creation. Preflight both locale bodies, pass expected revision into budgeted store begin. Recognize policy/budget/route admission errors as explicit halted reasons. Keep callback/recovery entry points independent of policy activation.
- [x] Add CLI status for policy/reservations and configure command with strict validated JSON file and operator attribution; never accept rates from member requests. Show currency, conservative reservations, remaining allowance and expiry without recipient values. No automatic activation.
- [x] Test dispatch cannot call provider or begin when preflight fails, configured worker passes exact revision, policy races halt, and recovery still works with sending disabled.
- [ ] Run full TS/SQL/concurrency/type/build/lint checks and clean replay. Claude reviews important financial/race boundaries. Merge exact verified SHA only after CI; verify migration and production deployments while delivery stays off.

## Execution

Inline under overnight delegation. This plan covers software safeguards; actual business account, tariff validation and activation remain external prerequisites. Full roadmap continues after this batch.

## Verification checkpoint

95 application checks (including last monetary slot concurrency),34 SQL checks, typecheck/build/lint and clean isolated64-migration replay pass. Lint retains two known unrelated warnings. Generated types are compared after replay. Claude review is underway; no PR/release or live activation yet.

Claude S1: Added a forward migration for explained terminal cancellation of unsupported destinations, so a blocked queue head cannot starve allowed jobs. SQL covers the queue head, cancellation/audit and rollback; worker regression verifies continuation.

Final local verification: 95 application checks, 34 SQL checks, typecheck/build/lint and clean isolated 65-migration replay pass. Generated types match replay. Claude confirms S1 resolved and approves merge with messaging disabled. Two pre-existing lint warnings remain. CI and production verification follow.
