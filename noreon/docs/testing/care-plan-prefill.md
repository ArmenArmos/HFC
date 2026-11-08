# Care-plan draft preparation

Implemented locally on 10 October 2026. Not deployed by this task.

The actual doctor review form automatically prepares its explanation, screening-protocol next steps and follow-up for an untouched completed case. Sources are the existing clinical rules, recorded manual measurements, receipt state and source-checked certain historical rows. Unknown answers and missing results remain explicit. No external AI call is required.

The supplied clinical rules are screening rules, not a medication-selection algorithm. Existing clinician-entered medicine fields are retained; new medication/dose decisions are not generated. Questionnaire findings remain labeled separately from later readings. Large evidence sets are bounded and the complete evidence remains in the case.

Saved/published and legacy custom drafts are not overwritten automatically. A durable draftSaved marker survives workflow history eviction; untouched-template comparison tolerates JSONB key order. Explicit preparation from current evidence is available when no unsaved changes exist. Editing retains the source fingerprint; if evidence changes, the edits stay visible but saving/publication is blocked until an updated draft is explicitly prepared.

A member checking transcription against a source is not clinician approval. Prefill includes certain source-checked rows and counts clinician approvals separately by current revision. The existing report/consultation and final-publication gates remain. Active urgent guidance or an incomplete questionnaire suppresses routine preparation.

Verification: scripts/check-care-plan-draft.ts covers source values, multiple reports, uncertainty, unknowns, medication retention, immutable inputs, save-schema limits, red overrides, save/publication separation, saved-history eviction, legacy custom drafts and JSONB property order. Existing member/service/report/clinical checks, lint, build and TypeScript passed. A lower-cost independent review identified two issues which were corrected and re-reviewed.

Browser test: temporary localhost-only fixture rendered the actual DoctorWorkspace and exercised real demo save/publication actions. Automatic fields appeared; an edited follow-up survived save/reload; the member saw no plan before approval and the saved text after explicit fictional publication. Fixtures were removed before build. This does not verify new behavior in a hosted staff session; live doctor/admin screens were separately inspected read-only.

Approval pack and evidence are retained at /Users/khikardanielyan/Code/Noreon/output/pdf/Noreon_Flow_Verification_and_Approval.pdf and /Users/khikardanielyan/Code/Noreon/output/flow-approval/. Batch upload was explicitly deferred. No deployment, real SMS, provider call, lab retrieval or real device ingestion was performed.
