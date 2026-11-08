# Message dispatch ledger

Implements the next section of the approved messaging design with executing-plans and TDD. Delivery remains inactive; this batch adds no network transport or live scheduler.

## Decisions

One durable submission attempt per plan job. A service-only begin RPC rechecks identity, phone, consent revision/version, profile eligibility, care consent, active/published/unacknowledged source, expiry and member quiet hours. It locks identity, preference, plan, reminder settings, then job; concurrent workers cannot receive the same destination. It creates an attempt and moves the job to submitted before returning a phone to the server. No browser has access to attempts or dispatch RPCs. Quiet hours use Asia/Yerevan and existing preferences, default 22:00–07:00; equal start/end means no quiet interval, a provisional delivery choice (the prior in-app model stored but did not dispatch these values). A stale job is cancelled; a quiet-hours job stays queued.

This is the irreversible submission boundary: a preference change completed before it prevents dispatch; a later change cannot retract a provider request. The future worker must call begin immediately before the request. A crash or timeout after begin never returns the job to queued. After two minutes, unfinished attempts become unknown, requiring provider reconciliation. A definitive acceptance/failure can resolve unknown; accepted/failed are terminal and conflicting responses are rejected. Acceptance does not mean delivered or read.

Attempts retain only job/owner references, opaque provider reference, channel/template and timestamps, never phone/body/clinical values. Owner/job deletion sets references null instead of erasing submission evidence. This is a provisional technical preservation choice; retention/deletion policy and pruning must be resolved before activation. No UI claims sent/delivered.

## Work

- [x] SQL regressions: privilege boundaries, quiet hours, source/phone revocation, one begin, unknown recovery and monotonic results.
- [x] Forward migration, source parity, isolated replay and generated types.
- [x] Concurrent begin and revoke race checks with real SQL.
- [ ] Full checks/typecheck/build, Claude important-issue review, CI and production migration verification.

Subsequent batch: bounded source producer, configured provider adapter, signed callbacks and operator reconciliation. No provider activation in this batch.

Evidence:50 migrations replayed cleanly with byte parity;generatedtypes;26SQL and75TS checks;typecheck/lint/build passed (two existing warnings). Claude batch8 report ready. A1 resolved in parent spec: submission and delivery remain separate histories; a returned resource ID means accepted submission even with immediate failed delivery. No schema change required. CI/release checks pending.
