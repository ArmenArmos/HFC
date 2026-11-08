# Product review follow-up — 10 October 2026

Scope: verified bug fixes and member-facing clarity, without changing the approved service flow. Questionnaire-based test planning and booking stay automatic. No new GP approval gate, consultation requirement, reminder provider, monitoring target or clinical escalation rule is introduced.

## Confirmed and addressed

- Demo profile saves increased the assessment revision even for language/name edits. The workflow then regenerated against the new revision, losing the visible booked/published case. Presentation edits now leave the assessment unchanged. Demographic corrections retain existing workflow snapshots rather than silently discarding bookings/publications. Editing shows Save changes, does not request registration consent again, and returns to Profile.
- Booked tests were projected as ordered/To arrange. The care projection now has a booked state and includes test bookings in My care appointments. Cancellation restores ordered status and removes the active appointment.
- Demo Results repeated source fasting instructions while Booking warned that preparation was unapproved. Booking, booked details and Results now share one explicit provider-confirmation message. Clinical source files and actual provider instructions are unchanged.
- The annual BP screening message ignored known hypertension. It is now suppressed for both treated and untreated diagnosed hypertension. No personal target or assertion that treatment is working is inferred. Existing urgent and untreated-hypertension rules remain.
- The first compatible test/group is selected automatically. Once all tests are booked, the booking form is replaced by confirmation/details; rescheduling and cancellation remain available.
- Today no longer repeats the care counters and a second set of charts. Its next action, required tasks, service stages, report prompt and available health overview remain. Detailed charts remain in My health.
- Results has fewer report links. Health profile does not repeat an unbooked draft test list when an active service plan exists or falsely say answers are never shared.
- The questionnaire keeps Back and Finish later without competing bottom navigation. The unknown-number button is secondary when values have been entered. Helper copy and punctuation were clarified.
- Empty My health charts become a first-reading prompt. The published doctor's explanation is visible in My care.
- Staff draft status distinguishes the untouched example from a saved review. Successful draft save/publication has explicit feedback. Staff test/report labels remain English regardless of member language; member test labels follow the member's language.
- Staff hosts now allow their manifest and named icon assets without widening patient/API access. GP assignment button names its action.
- Standalone component checks now load TSX and extensionless imports, removing the previously reported test-runner blocker.

## Already addressed / not reproduced in current source

The external review cited PR #58. Main already included #59: registration-language persistence, Results suggestion deduplication, opt-in fictional history and no default medication. Backoffice reset is already under collapsed Demo controls in Overview, with confirmation; it is not in Shared reports.

## Verification

- Failing regression reproduced the profile revision mismatch before the fix.
- Regression cases cover name/language edits of a published workflow, demographic correction preservation, booked/cancelled projections, test appointments and diagnosed-hypertension screening suppression.
- 20 targeted scripts pass: profile-preservation, review-consistency, patient-service, patient-demo, patient-review, service-workflow, service-publication, patient-care, care-actions, work-queue, operations-queue, result-review, staff-hosts, connected-journey, story-review, health-overview, patient-transport, patient-sign-out, demo-restart, care-history.
- Clinical conformance: 5,248 checks pass; existing documented unimplemented branches/catalogue coverage remain.
- TypeScript, changed-file ESLint and production build pass.
- Local browser walkthrough: English login and registration; completed fictional treated-hypertension questionnaire at 130/82; automatic single-test selection; saved booking; matching Results status/preparation; language edit to Armenian; completed assessment and booked date still present afterward.
- Published-plan preservation is covered by the service/store regression. This is not a claim that a fresh live three-portal publication or real clinical pilot was exercised.

## Deliberately outside this change

Doctor approval before booking, structured BP targets, drift/escalation thresholds, extra medical-history questions and phone reminder delivery require separate product/clinical work. WhatsApp setup is paused at the user's request. No AI/report/chart functionality was removed.
