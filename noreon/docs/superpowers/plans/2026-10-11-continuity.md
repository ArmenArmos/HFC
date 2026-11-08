# Continuity implementation plan

Design: ../specs/2026-10-11-continuity-design.md. User approved continuous execution with Claude review. Baseline 0c6b07e.

- [x] Reproduce medication identity/check-in loss, booking restart/replacement loss and midday dose disappearance with independent fixtures.
- [x] Review design against actual storage, SQL publication, dose timing and booking consumers; resolve Claude's design findings explicitly.
- [x] Implement medication/publication continuity pure transition and legacy import. Verify unchanged, changed, stopped, restarted, schedule-order equivalence and midday effective-time cases.
- [x] Implement recommendation/receipt/booking reconciliation plus consultation context equivalence. Verify incomplete/complete/re-added/mixed and no-op/clinical-demographic cases.
- [x] Implement version-specific acknowledgement and preserved dose context; unify local reads and storage preflight; shared session envelope compatibility tests.
- [x] Create forward migration with SQL-owned publication continuity, protected paths and narrow member-care writes. Match TS/SQL fixtures; run both orders of forced publication/member-write races and rollback tests.
- [x] Wire member/staff current/history views and affected booking resolution. Show recoverable errors and verify actual browser workflows.
- [x] Replay all migrations in isolated local database; regenerate types; relevant regression scripts, lint, tsc and production build.
- [x] Send complete implementation with test evidence to Claude; verify and resolve findings, then commit. No broad product-reliability claim.
