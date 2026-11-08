# Synthetic Zoe coaching implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement all four synthetic Yesai scenarios beside the daily routine, with deterministic behavior and honest outcome history.

**Architecture:** Pure library and reducer consume synthetic events and an injected clock. A server-gated client preview owns in-memory fixtures only; no real data, actions, storage or outbound adapters enter that boundary.

**Tech stack:** TypeScript, Next.js, React, existing tokens and EN/HY copy.

**Spec:** `docs/superpowers/specs/2026-10-12-synthetic-zoe-coaching-design.md`.

## Global constraints

One first suggestion and one requested alternative per Armenia day; declined intervention cooldown 14 days; proactive quiet hours 21:00–07:00. No migrations, prescription changes, real messages, clinical classifier or production activation. Member-initiated help bypasses quiet hours, not consent. Clinical concerns use simulated human support. Logs reject overflow and require explicit reset. Session ends on reload.

## Review focus

- Multiple barriers including a clinical concern must route to human support before behavioral selection.
- Same action ID with different payload must conflict, including after changing scenarios.
- Old actual timestamps reported after acceptance must never count as an outcome.
- Plan/day/consent changes must invalidate pending snoozes and stale actions.
- Preview-off server rendering must not load or expose a real member fixture.

## Task 1: Structured library and selection

Files: `lib/zoe-synthetic/library.ts`, `scripts/check-zoe-synthetic-library.ts`.
Interface: `selectIntervention({topic, barriers, excludedIds})` returns a typed intervention or an explicit withheld reason. Library records stable ID/version/source, eligible topics/barriers, kind, EN/HY copy, synthetic approval state. Unknown/multiple remain valid, no inferred classification.

- [x] Write and run failing checks for forgetfulness, anxiety, travel and importance, mixed clinical/routine barriers, unknown, alternatives and exhausted library.
- [x] Implement pure selection with clinical concerns taking precedence and stable deterministic ordering. No medicine timing/storage advice.
- [x] Run targeted check and root typecheck; commit library and tests.

Example assertions: `selectIntervention({topic:'bp',barriers:['forgot']}).intervention.kind === 'routine'`; `selectIntervention({topic:'medicine',barriers:['travel','symptoms']}).intervention.kind === 'human'`; an empty barrier list returns `unconfirmed`.

## Task 2: Deterministic state and outcome history

Files: `lib/zoe-synthetic/model.ts`, `scripts/check-zoe-synthetic-model.ts`.
Interfaces: `createSession(scenario, now)` returns synthetic state; `transition(state, action, now)` returns accepted state or typed rejection; `deriveOutcome(state)` returns eligible evidence IDs only. Actions carry unique IDs and event/plan identity. Model owns immutable ledger, explicit barriers/corrections, offer/accept/change/decline, settings, evidence report/correct/remove and snooze/handoff simulation.

- [x] Write failing transition tests for exact retry, payload conflict, daily caps, quiet boundaries, off/pause, 14-day cooldown, unknown/multiple/correction, handoff failure and log capacity.
- [x] Implement atomic transitions: validate first, then append history, never mutate input. Preserve invalid-action state. Keep attempts distinct from simulated delivery.
- [x] Write failing evidence tests: pre-acceptance actual time excluded; same event and plan required; duplicate prompts versus explicit separate readings; corrections/removal retract derived outcome without deleting logs; help does not mean skipped.
- [x] Implement evidence and snooze expiry for plan/day/preferences/completion; validate time and stale identities on every action.
- [x] Run targeted checks and types; commit tested model.

Example assertions: retry returns unchanged state; changed payload returns `conflict`; `deriveOutcome` excludes an observation with actual time before acceptance regardless of report time.

## Task 3: Contextual preview and release

Files: `components/patient-care/synthetic-zoe-preview.tsx`, `app/patient/dashboard/page.tsx`, preview documentation and boundary tests.
Interface: server checks `NOREON_SYNTHETIC_ZOE_PREVIEW === 'true'`; component receives locale only. Fixture selection creates its own event, never accepts actual care data. Controls provide four scenarios, help/barriers, suggestion responses, evidence reconciliation, snooze, pause, clock advance, failed handoff and explicit reset. Outcome log displays simulated scope and session-only persistence.

- [x] Add failing boundary checks for default-off gate and no actual writes/storage/provider imports.
- [x] Implement EN/HY contextual UI using existing tokens and accessible controls, preserving dashboard behavior when off.
- [x] Exercise rendered EN/HY four scenarios, retries and failure controls; verify accessible labels and small-screen layout.
- [x] Run root TS/SQL checks, typecheck, lint, build, token checks. Request one focused Claude review; resolve material findings.
- [ ] Open and attach PR, verify CI, merge exact reviewed SHA, verify app/core deployments with preview still disabled. Update roadmap and handoff with remaining live approval gates.

## Execution choice

Implement inline under the user's overnight delegation. Do not pause for routine plan approval. Claude reviews the concrete batch before merge/deploy. The full live roadmap remains active.

## Verification checkpoint

Implemented inline. 92 TS checks, 33 SQL checks, typecheck, build and tokens pass; lint has the two previously recorded warnings. Browser checked all four English scenarios, actual-time reconciliation/removal, Armenian interaction and failed handoff, and 390px layout. Fixed date-input synchronization and Armenian Intl hydration differences found during walkthrough. Claude reviewed important boundaries and confirmed Z1 historical outcome retention after a single focused follow-up. No temporary local route remains. Release/CI evidence is recorded separately in the overnight ledger.
