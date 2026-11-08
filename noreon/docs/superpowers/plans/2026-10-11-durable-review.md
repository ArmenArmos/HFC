# Durable Review Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans. User selected continuous native implementation with Claude desktop review.

**Goal:** Keep one durable, owned review task for unreviewed evidence while preserving the current approved care plan.

**Architecture:** SQL task table and case watermarks own shared transitions under the existing case lock. A pure TypeScript transition mirrors task lifecycle for bounded local sessions. Queue and detail read models consume tasks explicitly, and no-change/publication commands complete exact revisions atomically.

**Tech Stack:** Next.js 16, TypeScript, Supabase PostgreSQL, existing staff authorization and activity system.

**Spec:** ../specs/2026-10-11-durable-review-design.md, including design-review resolutions.

## Global constraints

No clinical thresholds, escalation deadlines or provider availability invented. The user selected routine BP evidence advancing existing tasks only; follow-up creates routine new tasks. Never edit applied migrations. Use CLI-created forward migrations, clean isolated replay, generated types, no hosted push. Preserve published care and stage-one/two integrity. Claude reviews design and final implementation in the existing authorized chat.

## Review focus

- A task closes while a report arrives: force both lock orders; new evidence must never disappear.
- A report is deleted after publication: no-change must reject even though no current row remains to compare.
- Assignment changes or doctor becomes inactive: closure must revalidate current ownership and coverage.
- Reset or legacy migration erases apparent freshness: keep completed history and an explicit verification task.
- Member logs a dose or edits language: avoid opening clinical work or making completed review falsely stale.

## Task 1: Task lifecycle and evidence coverage primitives

Files: create lib/service-workflow/review-task.ts and scripts/check-review-task.ts; extend types only where consumed.

Interfaces: `ReviewTask` includes id, status, openedEvidenceRevision, targetEvidenceRevision, ownerId, openedAt, updatedAt, completedAt, completedBy, completedEvidenceRevision, outcome, completionNote, reason. `advanceReviewTask(current, input)` accepts current task or null and explicit `opensTask` boolean, revision, owner, timestamp and id. It preserves task identity/opened time while advancing evidence; returns null when no task exists and opening is false. `completeReviewTask(task, input)` rejects non-open/stale revision, returns a completed immutable record. Task-opening policy is injected rather than hardcoded in these primitives.

- [ ] Add failing lifecycle fixtures: advance 3→4 keeps id; nonopening change without task returns null; completion at 3 rejects a target of 4; completed task remains unchanged when caller starts a new task; completion retains actor/outcome/note.
- [ ] Implement immutable transitions and validate revision monotonicity. No SQL/network dependencies.
- [ ] Add coverage comparison fixtures for added/deleted/changed report IDs/revisions/approvals and changed receipt requirement IDs. No-change requires exact current and published coverage. Missing legacy manifest returns false.
- [ ] Run `node --import ./scripts/register-alias.mjs scripts/check-review-task.ts`; preserve real failures before fixes.

## Task 2: Shared persistence, exact completion and history

Files: CLI-created migration, scripts/check-review-tasks.sql, scripts/check-review-task-concurrency.mjs, generated lib/db/types.ts.

Interfaces: internal lifecycle `workspace_reconcile_review_task(uuid,boolean,text)` plus evidence-kind dispatcher; narrow `workspace_complete_review_no_change(p_id uuid,p_actor uuid,p_expected_revision integer,p_task_id uuid,p_expected_evidence_revision bigint,p_note text) returns integer`; existing publication RPC signature unchanged.

- [ ] Create table with constraints, RLS, SELECT-only service-role grant, no browser policies, partial unique open-task index, case FK cascade and completed-history retention. Add reviewed_evidence_revision case column.
- [ ] Build transactional SQL fixtures for deduplication, target advancement, owner changes, nonopening changes, reset and idempotent legacy backfill. Apply the explicit BP decision: readings advance open tasks only.
- [ ] Wire case-state changes by comparing OLD/NEW projection; report trigger calls reconciliation only after its evidence log insert. Avoid duplicate calls from report counter-only case updates.
- [ ] Extend publication to stamp evidence and report-coverage manifest and complete task in the same transaction. Add activity outcomes. Preserve existing validator/locking behavior.
- [ ] Implement no-change with current doctor/clinic, revision and task checks; current publication, complete nonurgent assessment, current results/consultation/report approvals, current saved draft equal to published draft, exact coverage and bounded nonblank note. Complete task and watermark atomically without exposing new report data.
- [ ] Verify report deletion coverage, failed publication rollback, stale task closure, forged generic writes and inactive/reassigned actors. Force both evidence/completion orders with observed database locks, not sleeps.
- [ ] Replay isolated database and regenerate types only after migrations complete.

## Task 3: Coherent server/local reads and commands

Files: lib/staff/cases.ts, lib/staff/admin.ts, lib/staff/types.ts, lib/staff/actions.ts, lib/service-workflow/server.ts, app/patient/service/actions.ts, lib/patient/demo-model.ts and demo.ts.

- [ ] Extend coherent snapshot with current task and completed task history. Embedded list select includes evidence counters and task rows in one statement. Pass explicit task objects to consumers.
- [ ] Map database snake_case to ReviewTask at one boundary. Keep case-column watermark/task table outside generic JSON saves.
- [ ] Integrate pure lifecycle into bounded local writes and preserve completed task history in session. Local report evidence must explicitly participate rather than relying on a server counter that does not exist. Verify storage preflight remains before mutation.
- [ ] Add staff action for no-change, preserving stale/failure errors and refreshing the same coherent snapshot. No automatic retry of a clinical decision against unseen evidence.

## Task 4: Queue, member status and doctor completion UX

Files: lib/staff/queue.ts, operations.ts, components/staff/case-queue.tsx, doctor/page.tsx, components/service-workflow/staff.tsx, client.tsx, lib/service-workflow/next-action.ts, app/patient/care/page.tsx and relevant scripts.

- [ ] Reproduce published-case omission with evidence 8 and draft 3: current code reports owner None/no action. Add task-aware regression expecting pending review while publication stays visible.
- [ ] Doctor/admin queues show open task before published status, along with prerequisite blockers and missing coverage. Existing urgent status stays first. Keep task age distinct from existing result-based deadline.
- [ ] Show task owner, evidence changes and attributed outcomes in case view/history. No-change note stays typed on stale/failure; refresh requires re-review before submission. Hide/disable no-change with a clear publication-required explanation when coverage differs.
- [ ] Member views show pending review alongside approved care, without hiding medication/report history or claiming unpublished results are released.
- [ ] Browser-test original care preserved, deduplicated task on repeated evidence, stale/failure recovery, no-change rejection for new results, successful no-change and publication outcomes, and next evidence reopening work.

## Task 5: Verify, review and commit

- [ ] Run all TypeScript/SQL checks, publication and review concurrency suites, scoped lint and production build in dependency order.
- [ ] Check spec requirements against persisted rows and actual browser outcomes; distinguish model checks from integration evidence.
- [ ] Send entire stage-three diff, untracked files and verification ledger to Claude. Reproduce and fix findings; obtain final review verdict.
- [ ] Commit stage three and continue stages four and five. Full five-stage objective remains active.
