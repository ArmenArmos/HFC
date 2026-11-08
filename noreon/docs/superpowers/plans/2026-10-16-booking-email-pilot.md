# Booking email pilot implementation plan

**Goal:** Real member/staff routes use durable email-pilot appointments and truthful unavailable/pending/failed/unknown states, while historical provider-flow records remain compatible.
**Owner/base:** Developer 3; new `feat/booking-email-pilot` worktree atop frozen search `b738c11e07568b4ed8b131a3d0591d498db4d3fc`. Settings/search stay frozen. D3 alone owns migrations/generated types.
**Reference:** Main's accepted booking contract and three clarifications, 16 October 2026; `output/overnight-mvp-2026-10-16/BOOKING_EMAIL_INTEGRATION_PLAN.md`; agreed MVP flow §§4–5. Main must clear the exact authority/reservation contract before mutation SQL.
**Architecture:** Private server-derived program seals and trusted offer/reservation receipts admit versioned appointments and immutable scheduling-notice intents. Browser inputs never carry authoritative test lists, recipients, preparation or capacity. Production ports default unavailable; synthetic adapters are injected by tests only.

## Non-negotiable acceptance

- Every new member booking uses `email-pilot-v1`, including a newly registered member with no records. Missing offers/configuration means unavailable, never old subset creation.
- Historical `legacy-provider-v1` rows remain readable. Existing mutation behavior/replay is retained only for existing, unconverted records. No new legacy request IDs, direct RPC bypass or silent conversion.
- The complete engine-derived program is sealed privately and rechecked against current sources; source/version strings alone cannot authenticate a client-supplied list. Actual visit coverage and explicitly unresolved follow-up remain separate from the full program.
- Home requires the chosen visit address. Clinic uses the trusted clinic address. No invented slots, duration, preparation, unsupported-procedure coverage or reservation/hold policy.
- Clinic and configured Noreon copy must both have transport acceptance for the exact immutable notice/envelope/attempt before confirmation. Provider acceptance is not delivery/read or clinic acknowledgment. No extra acceptance gate.
- Pending/failed/unknown reschedules retain previous recorded and proposed arrangements. Unknown outcomes cannot automatically resend; late receipts cannot replace a newer arrangement. Do not promise that the previous slot is still held.
- Repeated identical action/HTTP submissions retain the same command ID/revision and one recorded result: one appointment/version/notice and no extra send, including browser transport replay before response bytes.
- Current member ownership, assigned care/admin operational scope and managed-session guards remain. No admin clinical DTO expansion, new real sends, CI, push, billing or provider activation.

## Authority contract proposed for lead review

1. Existing trusted clinical engine is TypeScript (`clinicalReviewEngine`), not a DB-generated complete test list. `patient_test_booking_context()` provides source/evidence, and existing legacy creator trusts a service-only JSON list. Reusing that list/token alone would not seal a program.
2. Introduce private `booking_program_seals`: member, engine version, source/requirements tokens, canonical complete program including home tasks, issuing actor, source provenance and immutable ID. RLS enabled; no direct grants to browser or service role. A service-only `seal_booking_program` RPC registers a program after the server reads stored evidence and runs the engine. Its SQL rechecks the exact source token under current source locks. No exported action accepts a program JSON argument.
3. Only server-only authority code derives/registers seals, after `requirePatient` or the existing staff guard. Staff source retrieval is service-only, checks current admin/assigned scope, and returns evidence only to the trusted server. Member/staff read DTOs never expose that evidence. Authenticated RPC callers cannot register/modify a seal, even with valid tokens; admission reads the persisted seal rather than supplied test JSON.
4. `begin_booking_reservation` first persists a command-bound acquisition intent for one current trusted offer and program. Its service-only entry point validates scope, source/program/offer/config versions before external work. The configured source port receives the stable acquisition key. Tests inject a synthetic port; production has no fallback source.
5. A trusted offer snapshot identifies source/version, clinic, home/clinic mode, actual window/timezone, approved preparation version, covered program IDs and authorized follow-up for any remainder. Preserve the full program independently. An offer with uncovered items and no attributable approved follow-up stays unavailable. Only the source can supply capacity/reservation semantics; do not create a generic local capacity authority.
6. The source port returns accepted reservation reference plus documented expiry/contract, definite failure, or unknown. Persist outcomes against exact acquisition/attempt generation. A crashed acquisition becomes unknown, not available for silent reacquisition. No DB transaction spans network I/O. A reservation acquired before later admission/config failure remains explicit reconciliation work; do not invent automatic release.
7. Appointment admission consumes only a private seal and matching trusted reservation receipt. It rechecks source/program, actor/scope, offer, configuration and revision; it records the appointment version, command receipt and immutable notice intent atomically. The authenticated browser supplies only offer identity/version, command identity/revision and home address, never an authoritative program or envelope.

## Legacy cutover and deployment

- In a forward migration, rename existing creator/command implementations to private helpers and revoke all existing grants on those helpers. Keep public legacy creator signature as a service-only **existing-ID replay** wrapper; reject a new ID for every member, independent of whether an email-v1 row exists. Preserve the old creator's payload/context replay behavior for existing unconverted rows.
- Public legacy command wrapper rejects a converted record and otherwise delegates unchanged for historical records. Existing authenticated staff wrapper must also transitively use this boundary. Pilot admission refuses conflicting active legacy work unless explicit reviewed conversion is supplied; pending-change conversion stays blocked until reconciliation. Cancelled legacy records are historical and never revived.
- Four existing legacy test files use the creator to seed fixtures. Change only their initial privileged fixture creation to the private legacy helper; keep public replay/mismatch/permission tests, and add explicit new-ID denial. Do not weaken historical command assertions.
- Deploy migration before the new app. The old app's new legacy creation will then fail closed during the transition; it cannot create fallback subset requests. Preserve existing-row operations. Promote only after required migration/guard checks; verify actual member/staff unavailable/new-booking/history routes. Document the brief availability limitation instead of adding a hidden compatibility fallback.

## Files and boundaries

- New `lib/real-booking/program-authority.ts`: server-only complete-program derivation/registration, no browser payload authority.
- New `lib/real-booking/appointment-schema.ts`, `appointment-commands.ts`, `appointment-repository.ts`: strict versioned DTOs, validated action inputs, durable command/read seams.
- New `lib/real-booking/offer-source.ts`, `scheduling-notice.ts`: typed unavailable source and disabled email ports; exact evidence contracts. No provider package/config activation.
- Modify `lib/real-booking/actions.ts`, `repository.ts`, `schema.ts`: new creation only via pilot, historical parsing/mutations retained, real persisted read models.
- New `components/real-booking/appointment-status.tsx`; bounded changes to existing member/staff components and actual `/patient/service`, `/patient/dashboard`, `/patient/results`, `/staff/real/members/[id]` projections. Existing member-name lookup must use an authorized ID summary rather than the capped legacy queue.
- D3-only CLI-generated migration(s), then CLI-generated `lib/db/types.ts`. New protected program/reservation/appointment/version/command/notice/attempt tables; exact service-only write/config RPCs and guarded member/staff reads. Never edit applied migrations.
- Tests `scripts/check-booking-email-cutover.ts`, `check-booking-email-authority.ts`, `check-booking-email.sql`, `check-booking-email-concurrency.mjs`; narrow legacy fixture updates in the four existing booking tests only as required.

## Execution tasks

- [ ] Demonstrate actual current legacy fallback RED with new-member/unavailable context; write authority/reservation/duplicate-HTTP contract tests. No mutation SQL before lead clearance.
- [ ] After clearance, implement strict pure contracts and private derivation/sealing; show forged list/tokens fail, complete program retained, coverage separate.
- [ ] Create forward schema through CLI; implement grants/guards/receipts, legacy wrappers, acquisition/admission/notice/result transitions and exact lock order. Zero replay and generated types required.
- [ ] Implement real repositories/actions and member/staff UI. Missing integrations must show unavailable; synthetic offers can never appear in real configuration. No provider send worker activation.
- [ ] Test real local member/staff journeys and DB readback at EN/HY 375/1280, including empty/loading/error, complete program, home/clinic, prior/proposed arrangements and recovery.
- [ ] Run relevant full repository checks once; close actual failures, preserve valid earlier evidence, prepare frozen packet for fresh Opus and named SQL risk review if required by Main. No push/CI/release before coordinated handoff.

## Required failure matrix

New member with no records and unavailable ports; direct legacy new-ID RPC denial; authenticated/private seal write denial; valid token plus forged subset; other-member seal; source change between derivation/sealing/admission; unverified member/inactive or unassigned staff/revoked session; missing/stale source/config/preparation; partial coverage without approved follow-up; home versus clinic address; stable repeated HTTP command after lost response; concurrent selection and member/staff reschedule; incomplete recipient acceptance; definite failure/timeout/crash/expired lease; duplicate/out-of-order/stale receipt; config or clinical hold before claim; retained prior arrangement; no contradictory reminder projection; all historical statuses including office/start-only records.

**Not claimed by this slice:** actual capacity, real email delivery, approved preparation/privacy content, production sign-in, deployment, physical-device acceptance or clinical policy approval. Missing inputs block those integrations, not persistence, compatibility or synthetic end-to-end engineering.

## Accepted source refinement and milestones

Main accepted the manual/configured source refinement on 16 October. This supersedes the external acquisition stage above for this slice. Approved clinic operations supplies actual capacity, immutable capacity reference and actual validity. DB-atomic allocation and appointment/version/notice admission require no vendor API. Source versions share one capacity pool, so a new version cannot reset allocations. No expiry, email outcome or version change automatically releases old holds. External vendor acquisition adapters are future coding, not a prerequisite or a capability claim here.

The first authority/cutover migration was applied locally and is immutable. Existing legacy tests caught a compatibility regression from adding the new pilot guard to the historical command wrapper. A CLI-created forward migration removed that added guard and kept the untouched legacy delegate's original checks plus converted-row denial. Three original SQL scripts and original concurrency tests pass; only initial fixture creation uses the private helper. The private helper has no browser/service grant. Full new-schema replay remains required before final review.

Current public UI contract is pinned at 5a2c2b7. Main assigned only three new presentation files and their UI test to the freed PWA owner. D3 retains all backend/schema/types and existing route/component integration. No overlapping edits.
