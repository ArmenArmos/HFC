# Approved PWA design implementation

Audience: real members and care staff using responsive web/PWA. Reference: output/app-design-system-2026-10-14, final64219b39; original Home/journey references retained. Source baseline origin/main59d8da2 includes Developer3 released149/151. Meta source89d1394 is separate, paused and untouched. No native implementation.

Acceptance: migrate the reviewed compact hierarchy, actionable icon/button rows, four core navigation destinations, explicit unavailable states, real Care plan/medicine/visit content, readable result/report rows and BP/pulse continuous scroll wheels into the existing working product. Preserve existing real actions, authentication, clinical engine, consent, idempotency, booking status/preparation/acceptance and all original clinician instructions. No fictional values or provider confirmations in real mode. Existing server UI input bounds remain authoritative; draft bounds are not clinical approvals.

Execution ownership in one isolated shared branch; disjoint files, root integrates/commits:
1. Root: shell/shared styling, Me/reminders, booking integration and verification environment.
2. BP agent: measurement-form/entry-dialog, new scroll control and behavior checks only.
3. Care agent: app/patient/care/page and care-layout plus private new Care tabs component only.
4. Progress/report agent: Progress/reports/results presentation and own result-row component only; no backend/repository changes.

Verify baseline, focused behavior checks, combined type/lint/token/build checks. Run actual synthetic member/staff entry points against a local test environment, compare screenshots with matching approved reference screens at375/desktop and narrowHY/enlarged. Exercise loading/empty/error/unavailable and previous failing paths. Use one canonical finding list with severity/evidence/disposition. Claude visual review and independent Astra substantive review after concrete rendered evidence. No passing-suite-only completion claim. Real recipient/provider/clinician/phone checks that cannot be performed remain explicit pending dependencies.

Developer3 owns pilot catalogue/quotes in .worktrees/pilot-rehearsal PR150, coordination message sent; do not change lib/pilot-* or their Trello cards. Canonical product pending list remains output/Noreon_Customer_UX_Backlog_2026-10-13.md (workspace root). Do not create a second product backlog. Plan progress lives in the root handoff/backlog and branch verification report.

Release: implementation and local acceptance first, reviewed PR next; no automatic deployment/hosted migrations/messages/provider activation from UI work. Meta can resume after stable first batch and coordination, using saved state and remaining account decisions. No invented clinical answers, actual provider slot or live staff identity.
