# Real staff onboarding implementation plan

> For agentic workers: execute the authorized implementation continuously with bounded independent SQL/UI delegation and one whole-result Astra review.

**Goal:** Add real clinic/doctor administration and safe Brevo invitations with member access held until password setup completes.

**Architecture:** Primary-project authenticated admin RPCs reserve a fixed Auth identity and serialize invitations. Server orchestration uses Supabase Auth and Brevo; signed stage proofs permit safe resumption. Existing clinical identity and assignment/publication guards remain unchanged.

**Tech stack:** Next16.3, React19, Supabase Auth/Postgres, Brevo transactional API, Node crypto.

**Spec:** `docs/superpowers/specs/2026-10-13-real-staff-onboarding.md`

## Constraints and review focus

- Existing Noreon tokens/copy; no clinical/vendor source edits, booking changes, default production rows or password emails.
- Duplicate account creation and external timeouts: fixed reserved UUID plus one dispatch claim, fail closed on uncertain ownership.
- Reissued invitations and already accepted/deactivated accounts: current generation checks; idempotency must never reactivate access.
- Consumed token followed by DB outage: verification proof plus live matching session resumes without replaying the OTP.
- Password saved followed by DB outage: password_set proof resumes activation; lost proof repeats setup.
- Missing/failed email configuration: sending stays disabled, list/clinic management remains usable; live delivery is not inferred from API acceptance.

## Task 1: Database authorization and invitation ledger

Own new CLI-created migration, generated types and new SQL checks. Add narrow admin directory/create/reserve/reissue RPCs; add service-only claim/bind/token/submission/verification/finalize RPCs. Ledger stores fixed doctor identity, expected Auth UUID, operation/generation, email/name/clinic/issuer, expiry, token digest, lifecycle and send outcome. Audit stores bounded event metadata only.

- [x] Write SQL authorization/concurrency cases for role/clinic/duplicate/accepted-deactivated boundaries; run before implementation and confirm missing functions fail.
- [x] Create migration with `pnpm db:new real_staff_onboarding`; implement locked, explicitly granted RPCs.
- [x] Replay in a NEW isolated project, never reset the existing primary/demo/private-SMS stacks; generate `lib/db/types.ts` from that exact replay.
- [x] Run SQL and concurrency checks; report exact RPC signatures for integration.

## Task 2: Real admin screens

Own review layout, clinics/doctors pages and components/real-review/admin-forms.tsx. Consume `requireRealAdmin()`, `getRealClinics()`, `getRealDoctors()` from lib/staff/real-admin.ts and actions `createRealClinic`, `inviteRealDoctor`, `reissueRealDoctorInvitation` from lib/staff/real-admin-actions.ts. Action state is `{ok:boolean,message:string}`. Form fields clinic(name,address); doctor(name,email,clinicId,requestId); resend(invitationId,generation,requestId). Name/email/clinic values stay in the form on errors; duplicate clicks share one requestId. Generate request IDs server-side with crypto.randomUUID.

- [x] Add focused rendered form/navigation checks for role visibility, empty/error/pending and disabled invitation states.
- [x] Implement compact role-aware navigation and actual lists/forms using existing controls/tokens.
- [x] Inspect desktop/mobile renders against the existing Noreon staff design; remove long explanatory copy.

## Task 3: Server orchestration, email and stage proof

Own lib/staff/real-admin.ts, real-admin-actions.ts, real-invitations.ts, invitation-proof.ts and lib/messaging/brevo-email.ts. Admin wrapper requires live realStaff identity role=admin on backoffice host. Typed DB schemas validate all RPC responses. Email config requires explicit readiness flag, verified fixed sender, API key and dedicated proof secret; do not touch global Auth SMTP.

- [x] Test rejected/accepted/unknown Brevo outcomes with captured fetch, no automatic retry and no raw credential/link logging.
- [x] Test HMAC proof wrong purpose/stage/user/generation, bounded decoding, invalid signature and expiry before implementation.
- [x] Implement reserve -> service claim -> create/reconcile exact reserved UUID -> bind inactive membership -> generate same-ID link -> digest -> send -> record outcome.
- [x] Check each current operation before sending; stale operation cannot record a newer send state or grant access. No email-based account recovery for unrelated users.
- [x] Run `pnpm exec eslint` on touched modules and `pnpm typecheck`; close errors before UI integration.

## Task 4: Doctor invitation and password journey

Own public /staff/real/invite and /staff/real/set-password pages outside active-staff layout, invitation forms and server actions. Use fixed doctors host and real staff cookie only; token travels in URL fragment and explicit POST. Verification proof is issued after successful verifyOtp; password_set proof only after successful authenticated updateUser. Finalizer requires proof plus matching live user; accepted/deactivated account is not updated.

- [x] Test passive GET, invalid/expired/reissued token, wrong session user and both resumption stages.
- [x] Implement explicit Continue, choose-password and retry-activation actions with bounded messages and no password emails.
- [x] Run actual isolated Next server-action HTTP invitation -> password -> activation -> login with captured local email, and inspect desktop/mobile screens in the browser. Synthetic password submission uses the API; real clinician password entry is deferred. No real account/email created.

## Task 5: Review and release

- [x] Run fresh 104-migration replay/type comparison, relevant TypeScript/SQL/concurrency tests and production build.
- [x] Collect rendered desktop/mobile evidence and one finding list; independent Astra reviewed concrete diff, migrations and actual HTTP journey evidence. Actual Claude UI/email review findings were checked and corrected.
- [ ] Fix concrete findings with failing/passing regressions, push/attach PR, wait required web/mobile CI and deployment checks.
- [ ] Release only latest main after protected production migrations; preserve provider/budget/domain flags and inspect exact deployed SHA plus actual admin/sign-in routes.
- [ ] Keep live invitation delivery and clinical publication rehearsal pending until the deferred real clinician identity/provider requirements are supplied. Report implemented, enabled and actually rehearsed results separately.

## Verified session and failure boundaries

The fixed UUID remains inactive until current-generation OTP/password setup succeeds. HMAC proof version2 binds both stages to the exact Auth session UUID obtained from a remotely validated access token and verified claims. Activation stores a live accepted session ID; managed clinical entry points require that live session or a later legitimate login session. Deleted/superseded cached JWTs fail identity, care, draft and review-command boundaries. Existing unmanaged staff and service paths remain compatible.

Actual local Next actions verified lost verification-record writes, lost finalization writes, context outages, explicit retry and one activation audit. Auth-service failure before a verified proof is issued may require a new invitation; this is distinct from the supported guarded DB-write recovery. Captured email tests cover accepted/failed/unknown without automatic resend. Production sender API status is active and transactional relay enabled; domain authentication and real delivered-email rehearsal remain separate pending checks.
