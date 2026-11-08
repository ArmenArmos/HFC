# Separate staff workspaces implementation plan

**Goal:** Keep the customer demo customer-only, provide separate authenticated doctor and backoffice sites, and manage clinics and doctor accounts centrally.

**Approved direction:** The user requested a fixed backoffice login, no public registration, backoffice-created doctors, clinic membership, a seeded test doctor, and instructed implementation to begin. Execute inline with cheaper agents for isolated work and verification.

**Architecture:** Reuse Next.js and Supabase. Staff identities use Supabase Auth password sign-in with server-created accounts; staff role and clinic membership come from database records, never browser input. Dedicated demo workspace tables hold shared fictional cases with revision checks. Production patient records are not queried by these portals. Host checks separate customer, doctor and backoffice routes. Staff cookies remain host-only. Credentials are generated outside source control and stored locally with restricted access; the UI never exposes stored passwords.

## Scope and boundaries

- `demo.noreon.health`: customer interface only; no role switch, staff links or operational controls.
- `doctors.noreon.health`: sign-in and assigned cases, existing review/approval workflow.
- `backoffice.noreon.health`: fixed administrator sign-in; clinic create/edit/deactivate; doctor create/activate/deactivate; assignments and case progress.
- A doctor belongs to one clinic initially. Deactivated staff or clinics cannot access cases or publish. Cases have an explicit doctor assignment.
- Shared demo data expires after seven days. Existing browser demo cookies can identify their own case; staff never receives the customer's cookie. New shared storage must be explicitly disclosed. No silent migration of uploaded medical files from memory.
- Report uploads retain their existing consent boundary. Shared report storage and original-file access must use authenticated ownership/assignment checks before cross-site review is enabled.
- No public staff signup, plaintext database passwords, role selection at login, or default credentials in source code. Test credentials must be randomly generated and handed over via a restricted local file.
- Existing real app and marketing remain separate. Live booking, lab integration and urgent alert dispatch remain out of scope.

## Implementation tasks

1. Add CLI-created migration: clinics, staff role/membership, demo cases with revision, expiry and assignment. Enable RLS with explicit deny-by-default behavior. Add staff-only session helpers and server-side admin client. Test role and inactive-clinic boundaries, assignment isolation and stale writes.
2. Build staff sign-in/sign-out and administration actions. Admin creates confirmed auth accounts without sending mail; staff creation validates clinic and compensates if profile creation fails. No passwords returned by listing APIs. Add login throttling using database counters. Test invalid credentials, role mismatch, disabled identities and duplicate account cleanup.
3. Build separate portal pages and clinic/doctor management forms. Doctors list only assigned cases. Backoffice can assign cases and see progression. Preserve source evidence and doctor approval gates from the current workflow.
4. Connect fictional customer workflow to shared backend using opaque per-browser identity and compare-and-swap revisions. Restrict customer commands to bookings; staff commands require role and assignment. Reject all unpublished data in customer props/API projections. Test two customers, two doctors, admin and stale updates.
5. Separate hosts/routes and remove staff/operational controls from customer demo. Configure DNS/Vercel aliases only after code is ready. Keep wrong-host pages and actions unavailable. Test host matrix and direct URL/API attempts.
6. Seed one fictional clinic, admin and doctor using an idempotent script with generated credentials stored outside git. Run migration replay, type generation, lint/build, workflow/security regression tests and browser walkthrough before deployment. Provide exact links and credential handover path.

## Review focus

- Authenticated but inactive or wrong-role identities; no access after deactivation.
- Doctor assigned to a different clinic/member; no cross-case reads or writes.
- Concurrent customer and doctor changes; stale writes fail rather than overwrite.
- Customer-origin attempts to publish results or modify doctor assignment.
- Shared report data consent, original files, expiry, and approval snapshots.

## Verification record

Implementation and release results will be recorded as each task completes.

### Local verification, 9 October 2026

- Local migrations replayed and generated database types updated.
- Staff SQL tests passed: RLS, role isolation, login throttling, assignment revisions and RPC permissions.
- Shared-report SQL tests passed: stale/unapproved publication rejection and immutable published snapshots.
- Host matrix, service scheduling and publication regression scripts passed; 5,248 clinical conformance checks passed (existing declared coverage limits remain).
- Browser walkthrough: fixed admin login, seeded clinic/doctor, client registration and explicit shared consent, assignment, persisted two-report import, doctor extraction check and approval, grouped test booking, operations receipt, GP consultation decision, draft save and package publication. Customer received published current and historical results; drafts remained hidden before publication.
- Independent Luna security review completed. Fixed administrator report-write permissions, unfinished-questionnaire readiness wording and stale report refresh on customer navigation.
- Hosted deployment and DNS verification pending.

### Hosted preparation

- Production build and both Vercel preview builds passed. PR #50 contains the implementation.
- doctors.noreon.health and backoffice.noreon.health are attached to noreon-core; GoDaddy CNAME records verified by Vercel.
- Workspace credentials and cleanup secret configured on core; NOREON_SHARED_DEMO remains off until migration succeeds.
- Staging migration blocked because existing GitHub token grants access only to noreon-production. A separate staging-token review is prepared in Chrome; user creation required. Staging workflow now accepts SUPABASE_STAGING_ACCESS_TOKEN without replacing production access.
- Hosted staff accounts are not provisioned yet. Local test credentials are outside the repository in ~/.config/noreon/local-staff-credentials.json.

### Release preparation complete

- User created the staging-only token; stored in GitHub secret SUPABASE_STAGING_ACCESS_TOKEN. Production token remains unchanged.
- Staging migration run 37974758725 passed after selecting its verified IPv4 session pooler.
- Shared-demo production flag enabled for the next core deployment. Hosted credentials are stored outside git in ~/.config/noreon/staff-demo-credentials.json.
