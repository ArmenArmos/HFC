# Care-plan draft prefill implementation plan

Goal: automatically prepare the doctor's existing care-plan fields from recorded evidence, without publishing or inventing treatment.

User-authorized scope: skip batch upload; implement draft preparation, verify existing flows, then create the approval PDF. Work inline in the existing isolated patient-webapp worktree.

1. Add a pure, bounded builder under lib/service-workflow/care-plan-draft.ts. Consume completed assessment, deterministic clinical findings, recorded manual BP, workflow receipt state and checked historical rows. Preserve the existing medication fields. Use the clinical engine's existing next steps and consultation window, not new medical rules. Do not prepare routine drafts for active urgent findings or incomplete questionnaire.
2. Test first: recorded values/provenance, multiple checked reports, unchecked/uncertain values excluded, missing evidence remains unknown, original medicines preserved, text fits save schema, urgent and incomplete blocked, save/publication separation.
3. In the actual DoctorWorkspace, automatically prefill only a new untouched draft after report loading. Preserve saved/published and local edits. Offer explicit preparation for saved drafts only when there are no unsaved edits. Existing save, permission, stale revision and publication controls remain.
4. Browser-test actual component in a temporary localhost-only fictional fixture; verify prepared fields, edits, saving/persistence and member isolation. Remove fixture before build/commit. Fresh read-only hosted staff checks cannot show this local-only change; label accordingly.
5. Run relevant workflow/clinical/report regression checks, lint, typecheck, production build, and a lower-cost independent review. Create a visually verified approval PDF with actual screenshots, current versus target behavior, tested scope and limitations.

No hosted data or deployment changes. Medication selection/dosing is not present in the supplied screening protocol, so the prefill retains clinician-entered medication values and leaves new medicine decisions to clinical review. The existing separate report/consultation gates are not removed in this change.
