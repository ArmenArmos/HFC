# Continuity of recommendations, bookings and treatment

Stage two of the five-stage objective. Stage one is committed as `0c6b07e`.
The user authorized implementation and delegated review to the existing Claude Code chat.

## Outcome and evidence

Correcting questionnaire answers and publishing a revised explanation must not erase existing care. Current instructions remain available while new evidence awaits review. Medication changes must be explicit, historical records retain their original context, and each published version needs its own acknowledgement.

Baseline tests in `scripts/check-continuity.ts` currently reproduce two failures: explanation-only publication changes medication identity, and questionnaire restart drops an existing booking. Inspection also found publication clears dose events and acknowledgement, booking replacement deletes the old record, browser-only workflow reconstruction loses prior publication, and the shared session serializes all case data into a bounded cookie after the database commit.

These are observed defects, not evidence of a measured defect rate elsewhere in the product.

## Persistence and boundaries

Keep continuity records in the existing case JSON, under the existing case revision and parent-row lock. This fits the current seven-day fictional workspace and avoids introducing a second source of truth. Production patient-care tables remain separate; no live prescribing or clinical integration is enabled by this work.

Add publication history, stable medication orders, version-specific acknowledgements, recommendation reconciliation records and booking snapshots. Publication history contains prior published snapshots; current publication remains the single current plan. The published snapshot references a stable medication order. Keep original order creation plan/version and timestamp, with retirement timestamp when replaced or stopped.

Protect publication history and medication orders in the generic case save RPC, alongside existing draft/publication protection. Publish creates history and updates the current publication atomically. Initialization and reset validate that protected history is empty. Explicit authorized reset alone may erase fictional continuity.

Shared session cookies carry identity and expiry only, retaining compatibility with existing encrypted sessions. Case history belongs in the database. Browser-only demo still uses bounded encrypted storage: preflight serialized and decompressed-size limits before accepting a write, return a recoverable storage error instead of truncating history. It does not provide cross-tab transactional concurrency; shared mode is the authoritative collaborative implementation.

## Medication and acknowledgement transitions

An unchanged medicine means identical name, dose, instructions and scheduled times after the existing input normalization; compare times as a sorted set. Do not use fuzzy matching. Explanation, general instructions and follow-up edits alone retain the active medication order identity and original start date. Dose eligibility uses the order effective timestamp, not the latest explanation publication time: the existing dosesForDay filter currently hides earlier doses after a midday republication. Preserve the original no-pre-order dose rule; a new or changed order starts at its publication instant, while an unchanged order keeps its original effective instant. Keep current-plan association for rendering separately from the immutable originating plan on the order and event.

A changed medication name, dose, medication instructions or schedule retires the previous order and creates a new one. Empty medication name explicitly stops the prior order. Restoring a stopped medicine creates a new order rather than reactivating its historical identity. Preserve all previous dose events, including events for retired orders, and retain their original plan context. Do not silently keep only the last sixty events. Show historical events separately from today's active medication schedule.

For a legacy publication with no order reference, its existing `workflow-medication-<version>` identity becomes the imported order identity, preserving existing event links. Lost earlier versions cannot be reconstructed; do not fabricate them. Historical records missing plan context are marked as legacy/unknown rather than assigned to the newest version.

Every new plan is initially unacknowledged. Store acknowledgements by publication version/plan ID with the actual acknowledgement timestamp. Repeating an acknowledgement is idempotent. A legacy acknowledged boolean becomes an acknowledgement with unknown timestamp, not the publication timestamp. Patient UI distinguishes acknowledged time unknown from awaiting acknowledgement.

Member dose and acknowledgement writes use the same loaded case and expected revision used for validation. Concurrent publication must cause conflict/reload, never silently associate a dose or acknowledgement with the wrong plan. Shared narrow commands revalidate current order/plan under the parent lock and preserve the existing dose timing rules. Errors retain the member's current screen and expose retry; a retry must revalidate the current plan.

## Questionnaire reconciliation

Use one reconciliation function for shared persistence and browser-only workflow derivation. Preserve doctors/assignment, existing publication/history, draft metadata, bookings, prior receipts and care history. Recompute only recommendations and readiness. A clinical demographic change participates in reconciliation; locale/name-only edits do not reset clinical work.

Store the last completed recommendation snapshot independently from currently incomplete questionnaire recommendations. On restart, current readiness becomes incomplete and publication remains blocked, but bookings and receipts stay available as history. On completion, compare stable test ID and method against the prior completed snapshot. Label recommendations added, removed or unchanged; method changes are changed requirements. Preserve receipt applicability only for unchanged requirements. Removed or changed receipts stay historical and cannot satisfy a later re-added requirement automatically.

Booking records retain their original test titles/methods, date, location and ID. Unaffected bookings remain scheduled. A booking containing a removed or changed requirement remains visible with a needs-review reason; it is not silently cancelled or rewritten. A questionnaire in progress uses a pending-reconciliation notice rather than asserting the booking is invalid. Mixed bookings retain all original items. Show which items changed; confirmation/replacement explicitly resolves the affected reservation. Replacing a booking marks the old booking cancelled/replaced and creates a new record; never delete it. Existing grouped laboratory and three-calendar-day consultation rules remain unchanged.

A new clinical questionnaire revision resets the consultation decision to undecided while retaining the appointment record and completion attestation. A fresh doctor decision is required. An earlier completion remains historical and must not automatically satisfy a newly required consultation: retain its original attestation and distinguish it from completion for the current assessment. If a still-scheduled appointment remains compatible with current scheduling rules it can be retained after the doctor decision; otherwise mark needs-reschedule with the existing reasons. No new clinical window or deadline is introduced.

## Views

Member: current plan and active medication stay primary; prior plans, acknowledgements and retired medication check-ins are reachable in history. Show affected bookings and the action required without claiming an external provider was contacted. Historical results remain visible independently of current recommendation readiness.

Staff: display recommendation changes and affected bookings alongside current evidence. Published versions and medication changes are inspectable with author/time. Stage three will add the persistent review task; stage two must not claim that task already exists.

## Verification requirements

- Explanation-only republish retains order ID, start date and dose events; dose/name/instructions/time changes create a new order and retire the old; stop and restart preserve both histories.
- Version-specific acknowledgement preserves the actual old timestamp; new version awaits acknowledgement; legacy unknown timestamp remains unknown.
- More than sixty dose events survive publication; all events retain original order/plan references.
- Restart/recomplete with identical, added, removed, changed-method and re-added tests preserves unaffected reservations, retains historical receipts, and does not reuse removed receipts as new completion.
- Mixed booking resolution, cancellation and replacement retain original details and audit history. Reconciliation is idempotent and agrees between shared/local modes.
- Clinical demographics trigger reconciliation; name/locale do not. Urgent actions remain first and old plan/history remain readable.
- Concurrent acknowledgement/publication and dose/publication in both orders cannot lose records or assign them to the wrong version; stale writes fail cleanly. Publish rollback preserves all prior records.
- Generic save, initialize and reset cannot forge protected history; authorization and stage-one evidence freshness protections remain intact.
- Shared cookies remain small with a large case history. Browser-only storage overflow is rejected before mutation and preserves the prior valid session.
- Actual browser flows cover revised plan, new acknowledgement, historical dose visibility, retained/affected bookings and recoverable conflict/read failure.
- Replay migrations in an isolated local database, regenerate types, run relevant existing checks and production build, then request Claude's implementation review with evidence.

## Implementation sequence

1. Add pure continuity/reconciliation transitions and focused failure fixtures, including legacy cases.
2. Add authoritative database publication and member-care commands, protections and concurrency tests; adapt shared/local persistence and session envelopes.
3. Wire member/staff history and booking resolution UI; verify complete browser workflows and failure recovery.
4. Run regression/build/replay verification and send the concrete diff to Claude. Address findings against evidence before committing stage two.

## Concrete transition contracts

Shared publication remains SQL-owned: replace `workspace_publish_review` in a new migration. It derives the order comparison, retirement/creation and publication history from locked stored state and removes its existing care reset. Browser-only mode uses the matching pure TypeScript transition. Common fixtures compare both outputs (excluding generated timestamps/transport revisions) for unchanged, changed, stopped, restarted and legacy medication cases. No caller-supplied publication object is trusted.

`ServiceWorkflow.publicationHistory` is an array of prior publication objects; each publication has optional `medicationOrderId`. `medicationOrders` records `{id, originatingPlanId, effectiveAt, retiredAt, name, dose, instructions, times}`. Current publication references its current order; history references the corresponding earlier order. A current `Medication` view uses the current plan ID for existing view consumers, with separate originating-plan metadata. Dose events gain optional `planId` for the plan actually acknowledged/displayed when recorded; legacy events can lack it. Acknowledgements are `{planId, at: string | null}`; legacy null means acknowledged with unknown time.

`receivedTestIds` remains the compatibility/current-readiness projection, containing only receipts applicable to current requirements. Add receipt history `{testId, method, requirementId, receivedAt: string | null}` and recommendation records `{requirementId, test, introducedAtRevision, retiredAtRevision: number | null}`. Unchanged ID/method retains requirement identity; removed or method-changed requirements retire. Re-adding creates a new requirement ID even if the test ID matches a retired requirement. Legacy receipt dates are unknown, not fabricated. On incomplete questionnaires, history remains but current received IDs and allResultsAt clear; recompletion repopulates current IDs only from matching active requirement identities. The last completed requirements survive incomplete drafts. The receive command appends/idempotently recognizes receipts for current requirement IDs, then derives current readiness. TS and SQL evidence projections include active requirement identity plus applicable receipt identities so replacing a requirement cannot look unchanged merely because its test ID matches. Historical-only records do not bump current evidence. Update SQL publication readiness, both projections and receive tests together, preserving exactly one evidence bump per transaction.

Appointments gain `completedForQuestionnaireRevision`. Completion records the current assessment revision. TypeScript publication blockers and SQL publication require an exact current-revision match for required consultations. Legacy completions without a matching revision cannot authorize a new publication until explicitly re-attested after review. Prior attestation is copied to appointment history before a new appointment/re-attestation replaces it. The existing published plan is unaffected.

Bookings keep `scheduled | cancelled` status plus `review: {reason, changedTestIds} | null` and optional `replacedBy`. The review flag retains the real reservation without falsely claiming provider cancellation. Scheduling/receipt helpers treat only scheduled, review-free, currently applicable bookings as satisfying current requirements. Affected reservations still occupy their original test IDs for duplicate prevention until explicitly cancelled/replaced/confirmed. Confirmation may only retain the unchanged applicable subset after showing the original items and the proposed retained items; it archives the original snapshot and records who/when confirmed. A changed-method item requires replacement. New booking limits count scheduled reservations, including ones awaiting review, not historical cancelled records. Remove the existing filter that deletes all cancelled bookings. All booking consumers use shared classification helpers rather than testing status alone.

## Design review resolution

Claude reviewed the design against the current code on 11 October. The concrete contracts above resolve the SQL ownership, receipt projection, assessment-specific attestation and booking-classification concerns. Keep the reservation status and review flag separate: a review flag does not imply external cancellation.

Consultation reconsideration follows actual clinical evidence changes, not every transport revision and not only the screening engine output. Persist a canonical decision context comprising clinical questionnaire answers and clinical demographics (excluding locale/name). If unchanged, retain the decision and attestation applicability; no-op saves must not invalidate it. If changed, reset the decision and require a new attestation context for a required consultation. Store the context key on completion and compare it in TS/SQL readiness, rather than relying solely on numeric questionnaire revision; the numeric revision is retained for attribution. An unchanged engine result is insufficient evidence that a GP's discretionary consultation decision is still valid. This explicitly rejects reviewer suggestion 6's output-only equivalence.

Member-care RPCs are `workspace_report_dose` and `workspace_acknowledge_plan`. Inputs include case ID and expected case revision; dose additionally carries expected plan ID, order ID, due time and status. The server derives member identity from the encrypted session, never a caller-selected case ID. Validate the order, plan, schedule and reminder-day timing under the case lock, and write actual server recording time. Acknowledgement validates the current plan ID under the same lock. Generic saves protect care events and acknowledgements once these commands are wired. Reconciliation records remain writable through the revision-checked normalization path; receive remains an authorized staff operation with expected case revision, with all derived receipt/readiness fields updated together. Its command-specific audit action is retained.

The new cookie envelope has a distinct schema version and `kind: shared-session`, case ID and expiry. Shared readers accept old valid full-state cookies only as case references, load the database, and rewrite the envelope at the next save. They never recreate missing cases. Local readers reject shared-session envelopes. Preflight local writes enforce both encrypted size and the 100000-byte decoded limit; show “Local demo storage is full. Your previous records are still available.” Shared writes preflight their small envelope before database mutation.

Published results use receipt identity as their stable result identity; multiple plan explanations may refer to one result without cloning it as a new measurement. Legacy publication results are retained with provenance identifying the original available publication; later publication does not change their collection/receipt time. Because these are generated fictional values, label them as such and do not present a guessed date as a verified laboratory collection time. No history predating retained records is invented.
