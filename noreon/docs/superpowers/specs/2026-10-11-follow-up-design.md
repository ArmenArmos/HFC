# Ongoing follow-up and capability boundaries

Revised after Claude’s first engineering review. Not implemented. Stage three committed as 708ad0d; stage four is in implementation verification.

## Scope

Implement a durable loop for a clinician-approved BP measurement requirement, separate from personal reminder preferences. The user explicitly chose that routine readings advance an open clinical review rather than create a new review for every reading. Follow-up can open new review work from an explicit clinician-approved schedule. No clinical cadence, numerical alert threshold, escalation deadline, nurse authority, external provider or device integration may be invented.

The current product has doctor and admin roles. Doctors approve measurement requirements and interpret evidence; admins can coordinate missed work within existing case access. Do not introduce a nurse role or imply clinical delegation. Existing urgent guidance remains independent of follow-up workers and AI.

## Proposed bounded first loop

The assigned active doctor records a requirement against the current approved publication: explicit start/end times, required number of accepted BP readings, member instructions, and source publication/evidence revision. There are no automatically selected clinical defaults. A future approved-template registry is outside this stage; direct attributed doctor requirements are sufficient. Requirement history retains approving doctor, time and publication. Superseding or cancelling a requirement records an outcome and preserves history; disabling a reminder does not change it.

A deterministic, idempotent reconciliation command observes accepted readings within the required window, using distinct measurement IDs. Receipt completeness is a count of evidence, never an interpretation of BP values. Late recording of a qualifying in-window measurement can resolve missing-evidence status; readings outside the interval cannot. One reading cannot satisfy overlapping requirement slots without an explicit approved policy; a database exclusion constraint disallows overlapping active windows for the same case.

At the doctor-set end time, reconciliation opens/advances the existing clinical review task once for the requirement, whether the series is complete or incomplete. It also creates one operational follow-up for missing evidence. The unique requirement/event key prevents repeated scheduler calls from reopening a review after it has been completed. A later doctor request is a new attributed requirement. Existing plan and medication remain visible throughout.

The operational follow-up identifies the missing requirement, owner/coverage, due source and latest outcome. Admin or doctor can record contact attempted, reached or unreachable, with a bounded note. Contact alone never marks required readings received. Evidence arrival resolves missing-evidence work with measurement IDs; clinician cancellation/supersession is an explicit separate outcome, not successful completion. Unassigned/inactive coverage stays visibly unassigned. Do not synthesize a new response deadline.

## Persistence and concurrency

Use CLI-created forward migrations with RLS and service-role read-only tables. Mutations are narrow authenticated commands that lock the case first, validate role/assignment/clinic as appropriate, then lock requirement/follow-up rows. Caller-supplied expected revisions reject stale edits. Scheduler reconciliation reuses the same case-lock order and uniqueness constraints. Outcomes include current publication reference and exact evidence IDs. Generic JSON writes cannot create or complete requirements.

The authenticated scheduled route uses the existing CRON_SECRET pattern, bounded batches, idempotent repeats and visible failure counts. Queue reads may invoke the same bounded reconciliation as a recovery path, so a missed scheduler run catches up. An outage never marks work complete. Requirements tied to a superseded publication must be explicitly retained/reapproved or marked superseded; a new plan must not silently keep obsolete tasks. Doctor-approved retained requirements are not reconstructed from free-text follow-up instructions.

## Member and staff UI

Show the approved monitoring requirement and its progress alongside the current plan and existing reminder preferences. Explain missing readings without interpreting nonresponse as nonadherence. Existing urgent instructions take precedence. The doctor sees the source requirement, qualifying readings and review task; operations sees contact/coverage work with explicit outcomes. Keep clinical interpretation separate from evidence receipt. English and Armenian member copy must describe actual state.

## External delivery and devices

Expose an honest capability model: in-app available; external delivery and device sync unavailable until a real adapter, configuration and applicable consent exist. Do not mark an external message sent or a device reading imported when no provider ran. Implement typed adapter/result boundaries and fake-adapter verification only; no outbound real messages, credentials, subscriptions or device claims. A missing configuration returns an explicit unavailable result and leaves in-app/manual paths functional. Secrets stay server-side. Real activation is a separate deployment/configuration step, not a fabricated completion of integration.

## Verification

Prove a fictional approved requirement, window expiry, one clinical task plus one missing-evidence follow-up, repeated/out-of-order dispatch without duplicates, contact attempted/unreachable remaining unresolved, valid evidence arrival, and attributed resolution. Test disabled reminders, overlapping windows, future/late/out-of-window measurements, superseded plan, inactive owner, no coverage, stale writes, unauthorized caller, transaction rollback and scheduler outage/recovery. Test external-disabled results and fake adapter success/failure without real delivery. Review the complete implementation with Claude after own tests, clean migration replay, browser verification and build.

## Questions for engineering review

Confirm the publication/requirement supersession contract can be enforced atomically without requiring an unsupported clinical template. Confirm the single-window model avoids arbitrary reading-allocation policy. Determine whether direct doctor requirements in the fictional demo are sufficient for this stage or a disabled approved-template registry must be delivered too. No real-member protocol activation is assumed.

## Resolved engineering contracts (F1–F4)

### F1: Accepted readings survive the bounded display list

The existing 20-reading JSON display list cannot be the evidence source. Introduce a durable accepted-measurement table scoped to case, with unique submission ID, measurement ID, measuredAt, server acceptedAt and validated values. A narrow member measurement command locks the case and persists the accepted reading before trimming the display list. Existing request validation and measured-time constraints remain authoritative; no new clinical range or cadence policy is introduced. A retried submission returns its existing acceptance and never counts twice, including after display-list eviction. Legacy readings remain context; do not backfill fabricated acceptance times or count them toward new requirements.

Requirement creation permits start at or after creation, preventing retrospective collection policy. Match durable readings with measuredAt in half-open [start,end) and acceptedAt at or after requirement creation. Requirement-evidence links retain measurement and acceptance timestamp, with late = acceptedAt >= end. Match during acceptance and idempotent reconciliation, before any display-list trimming. A trigger on bounded case JSON alone is insufficient because a new backdated reading can already have been discarded. A PostgreSQL exclusion constraint prevents overlapping non-cancelled/non-superseded windows even under concurrent writes. Completed evidence windows remain reserved until explicitly superseded/cancelled, avoiding ambiguous late allocation.

### F2: Publication changes require explicit decisions

Keep the existing seven-key treatment draft unchanged. Narrow commands record retain/supersede decisions for each non-cancelled/non-superseded requirement against the exact current saved draft JSON, evidence revision and publication version. Draft edits or evidence changes invalidate decisions. Retain is attributed doctor reapproval, preserving original source publication, start/end/count and evidence links. Supersede resolves operational work as superseded, never successfully received.

The publish boundary locks the case, verifies every decision, publishes and applies decisions atomically. No second publication JSON update and no duplicate publication activity. Retention history references the new publication; original provenance remains. Both UI and SQL reject missing/stale decisions. No-change review completion leaves requirements unchanged. Window-ended requirements may be retained to finish incomplete collection or explicitly superseded, never silently dropped.

### F3: Follow-up evidence appears on the review task

A review-task/requirement event link has unique (requirement,event). End-time dispatch opens or advances a clinical task and attaches window-ended even if the existing task was opened for another reason. Show linked requirement, period, completeness and late evidence. Due time is the doctor-set end, separate from dispatch time. Repeated/delayed dispatch cannot reopen a completed task for the same event. Sufficient qualifying readings resolve missing-evidence work independently; they never automatically close clinical review.

### F4: Operational outcomes have explicit meaning

Contact attempted, reached and unreachable append history only. Omit vague “escalated”. A separate “Refer to assigned doctor” command creates one referral link on an open/new review task, never marks readings received. Inactive/missing coverage is visibly unassigned and work stays open. Cancellation/supersession is doctor-only; admins coordinate within current access.

### Acknowledgement, reset and scheduling

Each new requirement has its own member acknowledgement keyed by requirement ID, separate from plan acknowledgement and receipt. Retaining unchanged requirements does not require another acknowledgement; changing instructions/count/window requires a new requirement and explicit supersession. Member copy identifies the doctor-added requirement while retaining the approved plan.

Use existing scheduled-job infrastructure hourly, plus bounded queue-read catch-up. Stored due remains end time; processing can lag up to an hour or longer in outages. Do not imply immediate monitoring. Reset explicitly supersedes active requirements with reason workflow.reset and retains history. Expiry cascades case-scoped follow-up rows. No real-member protocol activation or external delivery occurs in verification.

## Final review resolutions S1–S5

S1: Every newly accepted durable measurement advances case evidence exactly once, even if immediately excluded from the latest-20 display list. Use a server-owned monotonic acceptance marker in the evidence projection, changed atomically with the bounded display list; avoid double bumps from independent acceptance and JSON triggers. Record measurements as the change kind and advance any open task without creating one for routine readings. Doctor requirement views query durable qualifying evidence, including backdated readings omitted from the main display. Review/AI freshness must include this same evidence revision. No evidence can count toward completeness without being inspectable by the doctor.

S2: Protect both measurements and the acceptance marker from generic shared save writes, alongside the existing protected care records. Shared measurement submissions exclusively use the narrow acceptance command. Preserve explicit initialization/reset contracts, with a documented legacy seed path for initial context only; generic writes cannot create new accepted evidence or rewrite it. Audit all measurement callers and adapt tests to the new boundary rather than permitting a bypass.

S3: Monitoring requirements are shared-demo-only. Local fictional mode explicitly displays “Monitoring requirements are available in the shared demo”; server actions reject outside shared mode. Existing local manual readings and personal reminders remain functional. Do not emulate durable acceptance, scheduler or exclusion constraints inside cookies.

S4: Install btree_gist in extensions through the forward migration and test the partial per-case tstzrange exclusion constraint from a clean replay.

S5: Adopt the workload improvement: extend the narrow saved-draft command with an optional, separate requirement-decision argument, leaving the seven-key draft schema unchanged. The doctor deliberately chooses retain/supersede per requirement in the review form and saves both the draft and decisions atomically. Missing decisions can allow draft preservation but block publication; stale requirements/evidence reject the submitted choices. Editing evidence still requires review and a deliberate re-save, with visible previously selected choices rather than silent reuse. The publication transaction verifies the saved decision set against exact saved draft, evidence and publication. Existing callers with no active requirements stay compatible.

Claude’s final verdict permits implementation after S1–S3 are recorded and S4 included; these resolutions close those conditions. S5 is accepted as an efficiency improvement, not a clinical policy change.
