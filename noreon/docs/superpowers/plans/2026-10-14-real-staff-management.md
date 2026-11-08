# Real staff management

Audience: Noreon backoffice administrators; real Doctor/Nurse onboarding.
Target: backoffice.noreon.health, invitations on doctors.noreon.health; existing demo is the visual reference.

Acceptance:
- Explicit Doctor/Nurse invitations preserve immutable role through email verification/password activation.
- Edit changes name/clinic only, with versioned concurrency and exact idempotent request receipts.
- Remove revokes access, preserves clinical history, blocks removal/clinic transfer while cases remain assigned, hides removed entries by default.
- Doctor retains nursing abilities; Nurse cannot create/change/publish treatment.
- Populated desktop1280/mobile375, long clinic dropdown open, keyboard, empty/error/disabled and ambiguous-save states verified through actual Next/Auth/DB.
- No real staff/email/clinical fixtures in production; delivered-email rehearsal remains deferred until owner identifies a clinician.

Execution:
1. Complete generic server adapters and role-aware dispatch/email/finalization.
2. Forward-only correction for removed legacy status/name-only inactive clinic edit, fresh replay/generated types.
3. Actual isolated HTTP and rendered journey, including assignment and uncertain commit cases.
4. Focused self-check, Claude visual/source review, independent Astra security review; close evidenced findings.
5. Integrate current main hover fix, regression suites, PR/web+mobile CI.
6. Authorized normal merge, protected production migrations, exact deployment SHA and signed-in live screen verification.

Current branch: feat/real-staff-management in .worktrees/real-staff-management.
Current source changes are local and uncommitted; release not yet completed.
