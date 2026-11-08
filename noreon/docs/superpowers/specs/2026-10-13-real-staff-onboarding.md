# Real staff administration and doctor onboarding

## Outcome and authorization

Real backoffice administrators can see and add clinics, see doctors and send password-setting invitations. A doctor verifies the invitation, chooses a password and enters the existing assigned-member workspace. Nurses retain their existing restricted clinical permissions. The user explicitly delegated full onboarding from Noreon development (2); their later reply defers the actual clinician invitation/rehearsal, not implementation. Do not create a real doctor or send a rehearsal email until that identity is supplied.

## Scope

Use the primary project and real staff cookie. Add Clinics and Doctors navigation for administrators only. Preserve member queue, booking code, demo workspaces, clinical evidence rules and publication holds. Lists have useful empty states and visible Add controls, compact forms and explicit pending/error states. Use existing Noreon tokens and type scale; never import demo repositories into these screens.

## Identity and invitation protocol

1. Authenticated admin RPC reserves normalized email, fixed doctor role, clinic, generation, request/operation ID and a randomly generated expected Auth UUID. Reject unrelated existing Auth identities and memberships.
2. One service-only dispatch claim owns external work for the current operation. Admin createUser uses the reserved UUID, no password and email_confirm:false. Local GoTrue v2.196.0 / SDK2.112.4 probe verified explicit UUID enforcement and same-account invite/recovery generation. Ambiguous creation may be reconciled only by this reserved UUID, never an email/time/metadata guess.
3. Bind the exact identity and create inactive doctor membership before generating an invite link. Store only a SHA-256 digest of the redeemable hashed_token. Deliver fixed invitation content through Brevo transactional API with a configured verified sender. Invitation URL has fixed doctor origin and fragment token; no arbitrary next/host input.
4. GET landing does not redeem the token. Explicit Continue POST validates current generation/digest, verifies OTP and authenticates exact reserved identity. Issue a short-lived HMAC proof of successful verification and record verification via service RPC. Failed DB recording can resume using that proof and live matching session; neither alone suffices.
5. Password action requires current verified proof and matching live session, calls auth.updateUser and upgrades proof to password_set only after unambiguous success. Service finalization then atomically marks accepted and activates membership after clinic/inviter/identity checks. Password-success/DB-failure resumes using signed proof plus session; lost response fails closed and repeats setup.
6. Proof includes fixed purpose, key version, invitation ID, generation, user ID, issued/expiry time and stage. Dedicated server secret, bounded parsing, timing-safe signature, host-only Secure/HttpOnly/SameSite cookie. Expiry no later than invitation expiry. Reissue invalidates all earlier generations. Already accepted invitations never reactivate subsequently deactivated doctors.

## Failure and access boundaries

One-hour invitation expiry, bounded by configured primary Auth lifetime; 60-second resend cooldown. Pending dispatch cannot reissue during a two-minute in-flight window. Provider timeout is unknown, with explicit reissue only; no automatic retries. Failed/unknown delivery leaves membership inactive. Clinic and issuing admin must remain active through privileged steps. Service RPCs are revoked from PUBLIC/anon/authenticated. Browser admin RPCs derive actor from auth.uid(), never submitted IDs. Ledger and audit tables have RLS from creation; no raw tokens, passwords, links or health data in logs/audit rows.

Email readiness is a separate server gate. Missing verified sender, email API credential or dedicated proof secret disables sending while clinic administration and doctor listings remain usable. No changes to SMS budget, Supabase native phone provider or global SMTP.

## Acceptance

- Actual real admin UI has Clinics/Doctors navigation and Add clinic/Add doctor controls at desktop and 375px mobile; no demo rows/default accounts.
- Admin-only server actions and DB RPCs reject doctor, nurse, member, anonymous and wrong-host requests.
- Inactive clinic, unrelated duplicate email, conflicting repeated request and concurrent dispatch cannot grant access or replace a role.
- Valid local invitation -> explicit verification -> password -> activation -> doctor login works with captured local mail. Invalid, expired, superseded and wrong-user proofs fail; GET never consumes a token.
- Delivery failure/timeout, DB failure after OTP/password and accepted-then-deactivated account stay safe and recoverable.
- Fresh isolated migration replay, regenerated types, relevant SQL/concurrency checks, full CI, one independent Astra security review and actual rendered journey are required before release.
- Live Brevo delivery and real clinician review -> publication -> member view are distinct pending checks until the user supplies a clinician and the clinician approves required rules.
