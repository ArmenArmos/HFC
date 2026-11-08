# Real test requests and staff hosting implementation plan

> For agentic workers: implement in the existing isolated checkout; use executing-plans for inline work and bounded delegation for the concurrency/security backend. One independent substantive review follows concrete self-checks and rendered journeys.

Goal: real members request preferred arrangements; authorized operations records actual named-provider confirmation and preparation; both staff hosts serve the real member project while demo staff remains separate.

Architecture: persist requests separately from demo workflow JSON and separately from clinical orders/results. Use the existing authenticated member and real-staff identities, owner RLS, active assignment checks, immutable request/provider snapshots, CAS revisions and idempotency. Do not change clinical thresholds, source receipt acceptance, orange/crisis holds or publication rules. No external provider is contacted by these commands.

Stack: Next16.3.8 server actions, React19, Zod, Supabase/Postgres functions and RLS; existing Noreon tokens and EN/HY copy.

Accepted human decisions on13October: preferred-time requests followed by provider confirmation; backoffice.noreon.health and doctors.noreon.health become real. User subsequently confirmed reuse of the existing backoffice administrator account/password only. Armen is CEO, not a doctor. Doctor invitations/password setup and Brevo templates are next scope. The larger receipt/protocol design requires an actual clinical approver; these operational choices do not approve clinical rules.

## 1. Persistent operational requests
- [x] Backend implementer first proposes exact exported schemas/RPC/action signatures, then writes the migration with `pnpm db:new real_test_requests`; no applied migration edits.
- [x] Separate `lib/real-booking/` pure request models, server repository and server actions. Derive available tests from stored completed profile/assessment and the existing clinical engine; preserve all current urgency/context holds. A recommendation/request is not a physician-issued order. Home logs remain measurement tasks, not fake provider visits.
- [x] Persist immutable selected test/assessment/algorithm/preferred-time/mode/address snapshots. Routine member writes require verified identity/current consent and authoritative matching assessment revision. Client-provided owner/clinical labels are never authoritative.
- [x] Member reads use owner RLS. Authenticated users cannot directly insert/update/delete rows. Staff projections reveal operational request data only; private treatment drafts and unrelated source evidence are not exposed to administrators.
- [x] Request creation enrolls a real clinical case atomically when needed; failures do not leave phantom bookings. Active administrators coordinate; nurses/doctors require current appropriate assignment and active clinic. Commands derive actor from authenticated context.
- [x] Named-provider confirmation stores obtained-at/channel/source and the exact offered slot/mode/address/tests/preparation. Every external provider proposal requires member acceptance before status becomes confirmed. Confirmation is an attributed staff record, not API-verified availability.
- [x] Unconfirmed cancellation is immediate. Confirmed cancellation/rescheduling remains pending until actual provider acceptance is recorded; retain the existing arrangement visibly. Corrections append audit history and invalidate the relevant acceptance/preparation snapshot.
- [x] Use explicit CAS revisions, per-owner request IDs and same-payload replay semantics; reject stale/different replay/changed assessment/revoked assignment. Use canonical lock order and bounded conflict errors.
- [x] Replay all migrations in a newly owned isolated database. Never reset existing local54321/57621/58721 fixtures. Regenerate lib/db/types.ts from that replay, not by hand.

Required behavior examples:
```ts
// Public DTOs never contain service credentials or private clinical drafts.
// Exact field names are finalized in the backend contract before UI integration.
expect(memberB.read(requestA)).toBeDenied();
expect(duplicateCreateSamePayload).toReturnOriginalRequest();
expect(staleProviderConfirmation).toBeConflict();
expect(cancelConfirmedVisit).toKeepCurrentVisitUntilProviderRecordsCancellation();
expect(changedProviderTerms).toRequireMemberAcceptance();
```

## 2. Member and staff UI
- [x] Introduce a dedicated real booking component/repository branch in /patient/service; leave all existing demo commands/data on demo mode. Real feature enablement checks readiness rather than returning a demo workflow.
- [x] Member UI shows one clear next action, preferred time labelled as a request, flat test rows, explicit current status and complete provider preparation in one disclosure. No fictional clinic, generated capacity or generic fasting/medicine advice.
- [x] Integrate real request status/entry in Tests and Home without labelling requests doctor-approved orders or results. Preserve historical and published-source precedence.
- [x] Add operational request counts/entry to /staff/real/members and scoped booking detail controls for administrators and assigned clinical staff. Require complete actual provider attribution before confirming.
- [x] Render EN/HY at320/390 and desktop1280. Exercise request/save/reload, changed terms/acceptance, cancel/change pending, full preparation text, empty/loading/error/retry and stale conflicts. Use named synthetic staging fixtures only for controlled negative cases.

## 3. Real staff domains and demo entry
- [ ] Audit current app/staff primary Supabase alignment, deployed migrations and active intended staff accounts without printing credentials or medical records.
- [x] Keep real staff role/host restrictions and distinct real/demo cookie names. Permit a separate explicitly demo-gated staff entry on demo.noreon.health, with existing role/assignment authorization unchanged. Real app hosts must not expose legacy demo staff routes.
- [ ] Verify demo staff entry and real staff login/queue/case route rules locally before domain changes. Unknown/app patient hosts remain denied for staff routes; a requested portal never grants a role.
- [ ] Provision/verify the existing real backoffice administrator only, preserving current sign-in where possible. No doctor/Armen account provisioning, invented clinic membership or invitation emails in this increment. Keep secrets in approved server configuration.
- [ ] Enable matching real review/request configuration only after schemas and actual staff readiness. Move doctors/backoffice domains to the verified real deployment, preserving a working demo staff entry; verify actual hosts and correct role redirects. Do not move marketing or demo patient aliases.

## 4. Review, release and rehearsal
- [x] Focused self-checks and actual isolated RPC concurrency/ownership tests before independent Astra review. Maintain one finding list; review rendered member/staff screens too.
- [ ] Normal PR, required web/mobile CI and production migration workflow; no hosted manual db:push or admin bypass. Confirm exact release SHA/aliases and actual host flows.
- [ ] Real rehearsal requires production phone registration, completed member questions, actual provider confirmation/preparation, actual source report, assigned doctor verification and publication, then the same member’s exact plan/source view. Private SMS and synthetic operations are labelled separately.
- [ ] Keep clinic/home-log receipt validation, orange consultation and crisis resolution held until an accountable clinician approves the missing evidence/protocol decisions; Armen is CEO. Do not manufacture answers, provider confirmations or clinical completion for the deadline.

Review focus: cross-owner reads/writes; stale context between derive/create and provider confirmation; revoked staff assignment; replay/pending external cancellation; real/demo host and cookie separation. Each has an owning test above. This operational increment cannot alone prove the larger clinical publication pathway.

## Completion evidence before release
Source is frozen after99 CLI-created forward migrations. Fresh owned replay59422 succeeded with generated types; admitted browser59321 fixtures preserved. Actual local member email/password and real staff product login (synthetic, no OTP delivery) exercised request/provider proposal/preparation/acceptance, retained current slot through replacement and actual provider outcome, HY save/reload, stale-source fresh requests, rejected past time with corrected retry, and two-tab stale cancellation/reload. Rendered320/390/1280; no nested disclosures/overflow; HY deterministic dates have no new hydration errors. Real HTTP host matrix passes. Five independent Astra findings closed with exact evidence. Final production build94534, typecheck67035 and focusedlint46937 exit0. Queue uses one scoped aggregated RPC, no per-case requests. CI adds real booking concurrency and discovers new pure/SQL checks.

Hosted activation still depends on matching primary project configuration, intended backoffice identity, protected schema deployment and real CAPTCHA/authentication verification. Existing password API probe was CAPTCHA-blocked, so it proves neither valid nor invalid credentials. Source real staff CAPTCHA already exists. Public SMS/provider compliance remains the original Noreon development chat’s dependency. Doctor onboarding/Brevo invitation templates remain next scope. No hosted fake provider confirmations, doctor accounts or clinical publications were created.
