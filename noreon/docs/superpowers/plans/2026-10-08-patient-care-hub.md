# Patient care hub implementation plan

> Implement inline using executing-plans; use a fresh reviewer before release.

**Goal:** Finish a consistent member-facing care hub with visible, truthful next steps.
**Architecture:** Typed care domain and pure task derivation; normalized Supabase records with RLS and atomic dose reporting; shared server-fed UI with separate demo fixtures and stage controls.
**Tech stack:** Next.js 16, React 19, TypeScript, Supabase, Recharts, existing Noreon tokens.
**Spec:** docs/superpowers/specs/2026-10-08-patient-care-hub-design.md

## Global constraints
- Real data only on app; fictional demo only on demo. No SMS gate changes.
- Keep clinical source documents and thresholds unchanged.
- Existing design tokens, Armenian/English, no fabricated bookings, reviews or medications.
- Migrations created via CLI, hosted deployment via tracked GitHub workflow.

## Review focus
- Midnight/day boundaries and future doses: no early or duplicate check-ins.
- Stopped/replaced plans: cannot record against old prescriptions.
- Urgent answers: routine next steps do not displace urgent guidance.
- Empty records/errors: never replace failed real reads with demo data.
- Other accounts cannot read records or write clinical approvals.

## Task 1: Care domain and next-step engine
- [x] Add typed tests/results/plans/medications/appointments/events and bilingual action model in lib/patient-care/types.ts.
- [x] Write scripts/check-patient-care.ts covering urgent precedence, tests/review states, all due doses, Armenia midnight, plan dates, unknown/absent results.
- [x] Run failing tests; implement model.ts, demo.ts; rerun green.

## Task 2: Isolated persisted care records
- [x] Create migration via pnpm db:new patient_care_hub. Add normalized clinical records with member select-only policies and atomic own-dose RPC.
- [x] Implement repository.ts and server actions, with server-verified identity and demo-only controls.
- [x] Replay local schema, regenerate types; database checks for cross-account isolation, fake approvals, early/stale/duplicate doses.

## Task 3: Unified mobile UI
- [x] Implement Today hero/also-today, Results, My care and trends using shared shell and model. Keep provider operational details out of member UI.
- [x] Add five-tab navigation, profile questionnaire link, legacy journey redirect, isolated demo stage controls.
- [x] Walk tests-to-treatment stages and verify 390px mobile, keyboard, errors and empty states.

## Task 4: Review and release
- [x] Typecheck/build/lint/tokens/clinical/domain/DB checks.
- [x] Fresh branch review, fix important findings, rerun targeted checks.
- [ ] PR and tracked merge/deployment; verify deployed demo and real gate without adding fictional production records.
