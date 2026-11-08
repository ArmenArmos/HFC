# Publication integrity implementation plan

> Execute inline using superpowers:executing-plans. Claude Code in the user-selected chat reviews the plan and completed implementation.

**Goal:** Save and publish only deliberately reviewed current evidence, atomically.
**Architecture:** Database evidence revisions and case-first mutation RPCs establish the persistence boundary. A pure readiness model feeds server and UI. A single snapshot joins case state, reports and review metadata.
**Tech stack:** Existing Next.js/TypeScript, Supabase/PostgreSQL, Node assertion scripts, Docker psql.
**Spec:** ../specs/2026-10-11-publication-integrity-design.md

## Global constraints

Preserve clinical thresholds, report inclusion policy, published snapshots and design tokens. No hosted database push. Create migrations with CLI and regenerate types. Use fictional local cases. User authorized continuous execution and Claude reviews for all five stages; this plan implements stage one only and does not end the overall goal.

## Tasks

### Task 1: Readiness model and evidence classification

Files: lib/service-workflow/publication.ts (new), evidence.ts (new), model.ts, types.ts; scripts/check-publication-integrity.ts (new).
Interface: publicationBlockers(context) returns ordered code/message pairs; evidenceProjection(state) returns canonical evidence; command save-draft carries evidenceRevision and reportEvidenceRevision for local mode.

- [x] Write regressions against existing model: `assert.throws(() => applyServiceCommand(readyUnsaved, {type:'publish'}, now), /save/i)`; future completion must throw, valid past completion succeeds, missing doctor returns a deliberate blocker.
- [x] Run `node --import ./scripts/register-alias.mjs scripts/check-publication-integrity.ts`, confirm behavioral failures before implementation.
- [x] Add guards, typed saved evidence metadata and consultation attestation. Classify every field with `satisfies Record<keyof ServiceWorkflow, boolean>` and equivalent state maps. Validate positive/zero revisions without treating zero as missing.
- [x] Cover stale draft/report counter, malformed/default draft and valid no-test/no-consultation publication. Existing tests use explicit evidence-aware saves and elapsed fictional appointments.
- [x] Run workflow, care-plan and publication check scripts; commit.

### Task 2: Database boundary

Files: new CLI migration publication_integrity; scripts/check-publication-integrity.sql (new); lib/db/types.ts (generated).
Interfaces: workspace_case_snapshot, workspace_create_case, workspace_initialize_workflow, workspace_reset_review, workspace_write_report, workspace_delete_expired_case, workspace_save_review_draft, workspace_publish_review.

- [x] Write SQL behavioral checks with transaction rollback: saved placeholder rejection, generic protected-field rejection, report invalidation and valid atomic publication. Before migration the protected-field rejection test must fail.
- [x] `pnpm db:new publication_integrity`; add evidence/draft columns, evidence log with RLS, null-safe evidence triggers and fixed-path security-definer functions.
- [x] All report mutation RPCs lock case first and retain optimistic report revision; direct case/report DML is revoked from service_role. Narrow create/init/reset/expire functions cover existing callers. Cascade log trigger returns before inserting if parent update found no row.
- [x] Save RPC checks actor/revisions and draft shape; publish constructs snapshot, report keys and existing care reset from stored state. Case → staff → clinic → report locks; actor equals current assigned doctor under lock.
- [x] Replay migrations locally, run SQL checks with docker exec psql, generate types with `pnpm db:types`.

### Task 3: Route every caller and synchronize questionnaire state

Files: lib/staff/cases.ts, reports.ts; lib/patient/demo.ts, demo-model.ts; lib/service-workflow/server.ts; app/patient/service/actions.ts; app/api/internal/report-cleanup/route.ts; app/staff/reports/route.ts.

- [x] Add regression for retained publication key through completed questionnaire change and restart; incomplete partial saves never introduce fictional fallback tests.
- [x] Case read uses single snapshot RPC; generic save compares protected paths. Initialize absent workflows explicitly. Normalize assessment changes before one persistence call, keeping startedAt/draft/publication and updating questionnaireRevision on partial saves. No read-time in-memory rebuild in shared mode.
- [x] Draft/publish server commands use narrow RPCs and expected evidence revision from the displayed snapshot; reject missing input and stale state. Evaluate urgent rules against the exact case revision used for publication. Preserve existing error meanings and report redaction.
- [x] Report and cleanup paths call the new RPCs, preserve upload cleanup and original-file access. No secrets/logged member data.
- [x] Typecheck, script checks and SQL integration verification; commit.

### Task 4: Staff snapshot and review UI

Files: components/service-workflow/reports-provider.tsx, staff.tsx; staff case page; evidence/publication helpers.

- [x] Test refreshing cannot make saved stale evidence fresh, duplicate report changes do not double-apply local counters, publication-only updates do not invalidate evidence.
- [x] Provider exposes coherent case/report snapshot metadata; staff form uses that snapshot for both text and revision. Refresh after report mutations. Retain edits on a changed snapshot and provide an explicit review/resave action with evidence-change list.
- [x] Render domain blockers from publicationBlockers plus local dirty/loading/pending blockers. Consultation timing uses server clock validation, UI explanation and completedBy/completedAt fields.
- [x] Local reports reducer centralizes evidence counter and includes it with case counter for local draft association.
- [x] Check staff/member UI with fictional data and browser; changed-file lint and TypeScript; commit.

### Task 5: Concurrency harness and release verification

Files: scripts/check-publication-concurrency.mjs (new), scripts/publication-db-fixture.sql (new if needed), docs/reviews/2026-10-11-publication-integrity.md.

- [x] Spawn two persistent `docker exec -i supabase_db_noreon-core psql -X -v ON_ERROR_STOP=1` processes plus observer; use named sessions, explicit BEGIN/COMMIT and pg_stat_activity wait-state barriers with timeouts.
- [x] Force report insert/update/delete/approval and publication in both orders. Assert stale review rejects or publication is coherent at its commit order. Repeat with questionnaire, assignment, staff/clinic status and expiry cleanup. Test rollback and refreshed success.
- [x] Run local migration replay, SQL checks, applicable Node check scripts, typecheck, ESLint and build. Document exact results and any remaining limitations.
- [x] Ask Claude to review the complete diff, spec and test evidence. Verify findings, add regression fixes, rerun affected checks and commit. Stage one is done only when its spec requirements are supported by evidence.

## Review focus

- Legacy workflow and null draft metadata require explicit new save without hiding prior publication.
- Report changes must increment evidence only, not break unrelated member optimistic writes.
- Draft text must survive asynchronous report mutation and refresh.
- Red questionnaire changes supersede normal member next action while prior plan remains accessible.
- Local mode cannot substitute its counter for shared authority.

## Progress and rulings

- Base: fe09593. Existing isolated worktree reused.
- Prior goal turn: progress (reviewed spec committed); current state confirms no implementation yet.
- Execution: inline, Claude review. User explicitly requested continuous work through all five stages, replacing repeated human approval handoffs with the requested reviewer loop.

### Claude plan review incorporated

- Include app/patient/reports/shared/route.ts and member upload regression in Task 3.
- Update check-shared-reports-db.sql and check-workspace-activity.sql to use new RPCs or case-first owner setup, retaining prior assertions.
- SQL projection fixtures cover every listed path, exactly one bump/log event, locale/title and received-ID ordering equivalence, non-evidence writes, no trigger double bump and unaffected member case revision.
- Task 3 includes explicit legacy normalization persistence/conflict reload and urgent-first member display with retained publication/report/routine after a red answer.
- Set audit actor in all relevant RPCs and assert attribution, including an explicit identical-text evidence-review save event.
- Run common invalid-draft cases through TypeScript and SQL validation; include multi-report publication concurrency.
- Tasks 2–3 form one atomic implementation commit with runnable callers; do not ship the revokes alone.
- Claude verdict: ready to execute after these additions. Additions incorporated before implementation.

## Execution result

Implemented and verified; detailed evidence and reviewer verdict are in `docs/reviews/2026-10-11-five-stage-progress.md`. Database/caller changes are committed together. Claude final review found no shared-mode blockers. Three non-blocking observations were also addressed before the commit, including local counter session identity and client-refreshed history.
