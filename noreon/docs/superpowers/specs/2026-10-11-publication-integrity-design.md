# Publication integrity

Date: 11 October 2026
Status: Reviewed with Claude Code in the user-selected chat. Final verdict: ready for planning after the questionnaire revision clarification below, now incorporated. Implementation scope approved by the user; no application code changed.

## Outcome

A doctor can publish only a deliberately saved, valid draft covering the current evidence. A report changing during publication cannot escape the check. The interface explains the same domain blockers as the server. Valid publication continues to produce the existing member-visible snapshot.

This work precedes the separately planned continuity changes. It does not change clinical rules, report inclusion policy, medication-history retention across republication, review queues or reminder delivery. One necessary compatibility slice of questionnaire handling is included: keep publication identity and its existing member-visible plan/routine while updating evidence, with urgent guidance first. Broader recommendation/booking reconciliation remains the next release.

## Inspected baseline

Checkout: `.worktrees/patient-webapp`, branch `fix/review-workflow-integrity`, commit `cce18c1`.

- `lib/service-workflow/model.ts` publishes without checking `draftSaved`; consultation completion does not check appointment time.
- `components/service-workflow/staff.tsx` tracks evidence freshness only in local edited state. A refresh loses that association.
- `app/patient/service/actions.ts` validates identity, command permissions, questionnaire completion and urgent guidance before applying commands.
- `workspace_save_case_audited` delegates to `workspace_save_case`; publication checks report approval revisions, but not the evidence used for the saved draft.
- Report writes have their own optimistic revisions and do not advance the case revision. A case-only optimistic check cannot exclude concurrent report changes.
- Existing staff authentication and assignment checks remain necessary; a shared validation helper does not replace them.

## Design

### 1. Database-managed evidence revision

Add a monotonically increasing `evidence_revision` to each shared case through a CLI-created migration. Advance it when questionnaire/assessment data, measurements, required test definitions or received test IDs change, or when reports are inserted, edited, approved or deleted. Include profile identity changes because evidence belongs to a specific member. Do not advance it for draft saves, publication, acknowledgement, UI locale alone, bookings or consultation administration.

Use explicit comparisons of relevant stored fields, not timestamps or browser-generated hashes. Report approval changes count even if the extracted record revision is unchanged. Published report snapshot updates alone do not count, so publication does not invalidate itself.

Evidence mutations and publication serialize on the same parent-case row lock. Report mutations must acquire that lock before modifying a report; publication takes the parent lock before inspecting reports. Audit report insert/update/delete paths and enforce this ordering at the database write boundary, including service-role operations, to prevent both missed updates and reversed lock-order deadlocks.

The staff evidence loader uses a read-only SQL function with one SELECT that assembles the case, its reports, saved-draft metadata and evidence revision in one statement snapshot. Preserve existing server-side case access checks. After a report action reload the complete snapshot; never combine a fresh revision with older displayed evidence.

### 2. Save the reviewed evidence association

The save-draft command submits the revision associated with the displayed evidence. In one transaction, reject a mismatch, validate the draft, then store the draft together with dedicated nullable case columns `draft_evidence_revision`, `draft_saved_by` and `draft_saved_at`. The client cannot choose the actor or independently update the stored evidence association.

A save explicitly records review of the displayed evidence. Merely refreshing must not mark old text as reviewed. If evidence changed after editing, retain the text, identify that review is required, and require an explicit review action before saving against the new revision. Do not silently refresh the revision underneath retained edits.

Legacy drafts without an evidence association require a deliberate new review/save before their next publication. Existing published snapshots remain readable.

### 3. Publish atomically

Publication loads authoritative state and requires:

1. Authenticated active assigned doctor and active clinic.
2. Completed questionnaire and no overriding urgent guidance.
3. All required results received.
4. Explicit consultation decision and, if required, completed consultation.
5. Deliberately saved valid draft, including medication field consistency, with no untouched default placeholder instructions.
6. Saved draft evidence revision equal to the current database evidence revision.
7. Current approval for every imported report, preserving the existing policy.

Keep application checks for actionable errors. In the publication transaction, recheck assignment/active status, the saved-draft evidence association, current report approvals and optimistic case revision before committing the plan and report snapshots together. Reject any intervening mutation; never silently retry publication using a newer evidence revision.

Use an explicit publication RPC/command boundary so generic case persistence cannot accept an independently modified publication or evidence association. Keep service-role-only RPC permissions. Existing clinical-engine evaluation remains the source of urgent guidance; do not transcribe its thresholds into SQL.

### 4. Shared blocker descriptions

Introduce a pure domain readiness helper returning stable blocker codes and ordered descriptions. The server builds its inputs from authenticated, authoritative data; the staff view uses the corresponding loaded evidence snapshot. Include missing/inactive assignment, results, consultation, saved draft, outdated evidence and report approvals.

Keep browser-only state separate: unsaved edits, pending requests, failed report loading and unavailable evidence revision. These still block the local action but are not treated as trusted server facts. Preserve nearby actions for resolving blockers.

### 5. Consultation completion

Reject completion when the appointment timestamp is invalid or later than server time. Use no early-completion grace period. Record completion time and authenticated attesting doctor; completion remains a staff attestation, not proof of attendance.

Do not add a production simulation bypass. Tests use an injected clock and fictional appointments whose times have passed. Legacy completion records with a future appointment cannot satisfy publication until time has elapsed. Missing legacy attestation metadata is not invented or backfilled as fact.

## Compatibility and boundaries

- Shared case mode gets the database revision. Local fictional mode uses a persisted model evidence counter, defaulting to zero for legacy state. Compare the same classified evidence fields at its save boundary and advance the counter for report mutations in the local report store. Save the counter with the draft; missing draft association requires a new deliberate save. A local counter is never accepted as authority in shared mode.
- Existing published member views remain available; this release does not republish cases automatically.
- Existing clinical documents, thresholds, design tokens and report approval policy remain unchanged.
- No hosted database push or production deployment is part of local implementation verification.
- The migration is created with `pnpm db:new`, replayed in an isolated local database, and followed by generated database types. Never hand-edit generated types.

## Verification

Write failing regression tests before implementation, then verify:

- Direct save/publish requests reject missing, forged and outdated evidence revisions.
- Unsaved/template drafts cannot publish; a valid saved draft can.
- Report insertion, edit, reapproval and deletion invalidate an older saved draft.
- Questionnaire, identity, measurement and result-receipt changes invalidate it; unrelated bookings and draft writes do not.
- A refresh cannot erase the saved evidence association or silently approve retained text.
- Two-session database tests serialize publication against report changes and case changes without deadlocks or a mismatched published snapshot.
- Missing/inactive/reassigned doctor and inactive clinic produce explicit rejection, including changes during publication.
- Future or invalid consultation completion is rejected; elapsed appointments can be attested; required consultation remains a publication gate.
- Existing published snapshots remain visible after a rejected publication.
- Existing no-tests, no-consultation and required-consultation valid paths continue to pass.

Run the relevant workflow, publication, care-plan and client-redaction checks, TypeScript, changed-file lint, production build and migration replay. Review the staff flow with fictional data, including stale evidence after a second session changes a report. Record any verification unavailable in this environment explicitly.

## Follow-on work

Continuity remains the next release: reconcile questionnaire changes, preserve medication events and published history, then create durable reassessment work. None of those is bundled into this change.


## Review resolutions and implementation requirements

These details refine the design above and are part of its acceptance criteria.

### Lock order and report mutations

Choose case-first RPCs for all report writes (review option b). The existing `lock_workspace_case_for_report_change` BEFORE-row trigger cannot establish that order for UPDATE/DELETE, which already acquire the report tuple lock. Move every insert/update/approval/delete in `lib/staff/reports.ts` into case-first RPCs, preserving report optimistic revisions and audit behavior. Publication follows the same order. Revoke direct report INSERT/UPDATE/DELETE from `service_role`; grant execution on narrowly scoped SECURITY DEFINER functions with a fixed search path. Do not use a caller-set session flag as a bypass.

The cleanup route actually deletes `workspace_cases` and cascades to reports. Route this through an expiry-checking case-first deletion RPC; retain storage cleanup behavior. A report-delete trigger must tolerate a parent already being deleted by cascade. Multiple-case operations lock cases in ID order, then reports in ID order. Database-owner maintenance must follow the same convention; application-role guarantees do not constrain the database owner.

Do not choose report-first publication alone: it does not reconcile case deletion and inserts with the selected universal order. Existing lock inversion is a potential deadlock/error, not proof of observed data corruption. Reproduce it in the concurrency harness before claiming a runtime reproduction.

### Evidence revision ownership and classified paths

Create `evidence_revision bigint not null default 0`, including existing rows. An AFTER INSERT/UPDATE/DELETE report trigger increments it for changed `record` or `approval`, including insertion/deletion. Ignore updates limited to `published`/`updated_at`. Report case ID and report ID are immutable.

A BEFORE UPDATE trigger on `workspace_cases` compares the following null-safe evidence projections and increments the column once per case-state mutation. A trigger is chosen over comparisons only inside generic save so all permitted write functions share the same behavior:

- `state #> '{state,assessment}'`
- `state #> '{measurements}'`
- `(state #> '{state,profile}') - 'locale'`
- `state #> '{state,consentAccepted}'`
- `state #> '{workflow,tests}'`, removing localized `title` from each test
- `state #> '{workflow,receivedTestIds}'`, normalized as a sorted set
- `state #> '{workflow,allResultsAt}'`

Consent and all-results state are included because they affect readiness. A report trigger updating only the revision does not trigger another increment. A locale-only edit, including translated test titles, does not invalidate evidence.

Add exhaustive TypeScript evidence/non-evidence field maps using `satisfies Record<keyof ..., ...>` for DemoState, PatientState, PatientProfile and ServiceWorkflow. SQL fixtures must exercise the projections. New fields require deliberate classification. Non-evidence fields include version/expiry/identifiers, workspace transport revision, reminder preferences, care events, bookings, assignment, consultation, draft/publication and workflow audit events. Authorization, expiry and consultation prerequisites are independently validated at publication.

### Protect whole-state saves

Real metadata columns are necessary but insufficient by themselves: generic persistence must also reject modifications to `workflow.draft`, `workflow.draftSaved`, `workflow.startedAt` and `workflow.publication`. Compare these paths null-safely against stored state. The generic RPC accepts no metadata arguments. Save-draft and publish RPCs validate and write those fields themselves; there is no client-selectable bypass parameter.

Revoke direct application-role writes on cases; replace initial creation and expired deletion with narrow RPCs. Creation initializes unsaved metadata and rejects supplied publications/saved drafts. Existing assignment/audit RPCs keep their limited purpose. Explicit admin reset gets an authorized reset path that clears draft metadata and performs the existing reset. Generic member saves cannot reset protected paths.

Workflow reconstruction must preserve protected fields until an authorized transition; it cannot incidentally erase them through generic persistence. This compatibility constraint is necessary here; the broader reconciliation of questionnaire recommendations and bookings remains continuity work. Cover existing case initialization and questionnaire-change saves in regression checks.

### BP changes and intelligible review

For this release every accepted new, corrected or removed measurement invalidates the draft, including replacement caused by the bounded measurement list. Duplicate idempotent submissions do not. Restricting freshness to the single reading selected by the summary would allow unseen evidence to pass publication; that is not the chosen tradeoff.

Add a small case-scoped evidence-change table: revision, kind, reference ID and database time. Both triggers append entries in their mutation transaction, without duplicating report contents. Several entries may share a revision when multiple fields change. Enable RLS and restrict access to the authorized server boundary in the same migration. Retain entries for the case lifetime; cascade on deletion. Show changes since the saved revision, preserve all prose, and require explicit review/resave. If history is unavailable, state that clearly rather than claiming there were no changes.

A daily reading can therefore require another review, but never forces wholesale regeneration. Review and save are deliberate; neither refresh nor background autosave advances the draft's evidence association.

### Publication authorization and urgent changes

After the case lock, lock the assigned staff row and its clinic row with FOR SHARE, verify their active state and assignment, and hold these locks through commit. Use one documented order across affected functions: case, staff, clinic, reports. Audit administrative update transactions for reverse acquisitions. Case locking alone does not protect these other tables.

Publication submits the case/evidence revisions associated with the server's clinical-engine evaluation. A concurrent questionnaire change, including a red answer, changes those revisions and rejects that publication. If publication commits first, a later answer is a subsequent event; this release cannot retroactively reject a completed transaction. New urgent guidance still follows the existing route. No clinical thresholds are duplicated in SQL.

### Verification harness and compatibility

Use the repository's `scripts/check-*.ts` and SQL conventions, not an assumed test runner. Name the new harness `scripts/check-publication-concurrency.mjs`: use two persistent `docker exec -i <local-supabase-db-container> psql -X -v ON_ERROR_STOP=1` processes against the isolated local database, coordinated by the Node child-process API and database lock-state observation, with bounded timeouts and teardown. No correctness assertion may depend only on sleeping for an arbitrary interval. Use a third read-only observer connection where needed to prove a session is blocked before releasing the other.

Cover publication versus report insert/update/delete/approval, questionnaire changes, doctor/clinic deactivation and expired-case deletion, in both orders. Include multiple reports, rollback, and subsequent successful retry from refreshed evidence. Verify no deadlock, mismatched snapshot, partial publication or duplicate evidence increment. No hosted database is used.

Existing evidence revisions initialize to zero and saved metadata to null. Missing local counters normalize to zero. Legacy published snapshots remain visible; legacy unsafely attributable drafts need a new review/save before republishing. Run field-classification checks, SQL fixtures and the concurrency harness after full local migration replay.


## Second review resolutions

### N1: Questionnaire normalization and stable publication identity

Protect `workflow.startedAt` alongside draft and publication. Retain it across questionnaire changes; only initial workflow creation or explicit admin reset establishes a new value. Therefore existing report publication keys remain valid.

Choose synchronous normalization, not an admin-reset blocker. When a questionnaire mutation would cause `workflowForDemo` to reconstruct a workflow, compute its new ordinary workflow fields in the authenticated server using the existing clinical engine and persist them with the assessment in the same optimistic case-state transaction. Carry forward the stored startedAt, draft, draftSaved and publication verbatim. Keep the old saved evidence association, which now becomes stale when the evidence trigger increments the revision. Do not recertify that draft.

Move this normalization out of the read helper for shared cases: reads cannot invent unpersisted tests that later appear during a booking/save command. Route questionnaire completion, restart and applicable demographic changes through this boundary, preserving the existing deliberate demographic-update behavior where it does not rebuild recommendations. Rebuild recommendations on completed assessments; on restart explicitly clear current tests, received IDs and allResultsAt while preserving protected fields. Partial saves of an incomplete assessment update the assessment and workflow.questionnaireRevision only, leaving the restart-cleared operational state intact. In shared mode every persisted assessment change, partial saves included, sets workflow.questionnaireRevision to assessment.revision in the same write; the shared read helper never rebuilds for either member or staff reads, and any mismatch follows the explicit legacy normalization path before returning actionable state. Initial incomplete cases use no tests. Shared-mode normalization must never use the fictional fallback tests from workflowForDemo. Every changed answer still advances evidence freshness, even when recommendations are not rebuilt. For pre-migration mismatched cases, perform an explicit server normalization write with expected case revision before returning an actionable staff evidence snapshot; reload after conflicts and never normalize as an incidental draft/publication write. Protected values come from stored state, not a reconstructed client workflow.

This work preserves the current reconstruction policy for the remaining fields; preserving unaffected bookings and reconciling changed recommendations remains the next continuity release. Test that publication key and report visibility survive normalization, that changed tests invalidate the saved draft exactly once with the assessment, and that later bookings do not perform a second normalization or evidence bump.

### N2: Narrow draft and publication RPC contracts

Choose narrow command inputs and SQL-built publication rather than accepting a full next-state blob for these two operations:

- `workspace_save_review_draft(p_id, p_actor, p_expected_revision, p_expected_evidence_revision, p_draft)` locks the case, verifies active assigned doctor/clinic, checks both expected revisions, validates the draft's structural/content constraints, writes only workflow.draft/draftSaved, draft metadata, workflow command event and optimistic revisions. It preserves every other stored state field. An identical-text resave still refreshes metadata and records an explicit review event.
- `workspace_publish_review(p_id, p_actor, p_expected_revision, p_expected_evidence_revision)` accepts no draft or publication object. It locks and validates authoritative state, checks saved evidence metadata and readiness, and builds publication from the stored draft, stored received IDs, locked doctor name, database timestamp, incremented version and incremented workflow revision. It updates report snapshots with the stable startedAt/revision key in the same transaction.

Publication also performs the existing care reset atomically: retain the current care stage (or profile default), set events to an empty list and acknowledged to false. Changing that reset policy is continuity work; do not accidentally split it into another request. Retain existing result snapshot/client projection semantics and workflow event records. Both RPCs call `workspace_set_actor`; preserve current audit events and add an explicit saved-evidence review event for identical-text resaves rather than relying on the draft-diff trigger to notice them.

The application evaluates urgent clinical rules against the same case revision submitted to publication. SQL rechecks persisted readiness facts, consent and recorded urgent state; case/evidence mismatch rejects any intervening questionnaire change. SQL does not duplicate the clinical algorithm. The service-role-only function is an application trust boundary, not a claim to protect against a compromised backend that fabricates clinical evaluation.

Generic case initialization needs one controlled exception for creating an absent workflow: construct an unsaved default workflow server-side, validate absence of existing workflow and publication, and use an explicit initialization RPC. It may not pass arbitrary saved metadata or a publication. All subsequent generic saves preserve protected fields.

### N3: Cascading evidence-log deletion

In the report AFTER-change trigger, use the parent revision UPDATE with RETURNING to obtain the new evidence revision. If it updates no parent row, return OLD for DELETE (NEW otherwise) immediately, before inserting any evidence-log entry. This is the expected cascade case. Never insert a log row referencing an absent parent. Standalone report mutation RPCs require a live parent and cannot use this cascade behavior to create orphan records.

### N4: Available concurrency mechanism

Host psql is absent; Docker is installed. Run persistent psql sessions inside the local Supabase database container discovered through Docker/Supabase status for project `noreon-core`; do not guess or target a hosted database. The harness uses Node child processes for two sessions and an observer, bounded lock-state polling and explicit transaction barriers. Verify the local engine/container is available during setup, and report inability to execute database checks if it is not. Installing another database driver is not needed for the selected mechanism.

### Additional precision

Report RPCs advance evidence_revision and their report revision, not the case's general optimistic revision. Parent case evidence mutations still increment the normal case revision through their command path. Tests cover successful unrelated member saves after a report mutation without allowing an outdated draft to publish.

Local report state is owned by `components/service-workflow/reports-provider.tsx`, using helpers in `lib/service-workflow/report-memory.ts`. Put its report-evidence counter updates in one provider mutation reducer; cover add/edit/approve/delete and exclude publication-only changes. The local association includes that counter plus the persisted case evidence counter. This remains an explicitly fictional browser-state mechanism, not an authoritative substitute for shared database evidence.

Storage cleanup ordering is an existing separate limitation. Keep the existing behavior in this release and record it for follow-up; deleting database records first without a durable storage-deletion retry record would introduce a different orphan risk. Do not expand publication integrity into storage lifecycle redesign.


### Final focused review clarifications

Retaining publication intentionally keeps the previously approved plan, published report snapshots and existing medication routine available after questionnaire changes. This is the minimal compatibility slice included in publication integrity. It does not claim those instructions have been reassessed against the new answers. A red answer must still put urgent guidance first in member next steps and block routine publication; retention cannot suppress or downgrade that guidance. Add a regression exercising a published member case, a restart/partial save, a completed changed assessment and a red answer, checking stable publication key, retained plan/report/routine and urgent-first ordering. Broader continuity policy remains separate.

Both save-draft and publication RPCs compare `p_actor = assigned_doctor_id` under the case lock and check the locked staff/clinic status. Pre-lock application authorization is not sufficient.


Review record: Claude Code, “Noreon workflow optimization review”, 11 October 2026. Three review exchanges checked the revised spec against source. Final response stated that only the questionnaireRevision clarification remained and nothing else blocked planning. That exact requirement is now in N1. Review is design analysis, not an implementation or runtime verification.
