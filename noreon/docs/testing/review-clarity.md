# Review clarity and stakeholder pack

10 October 2026. New review fixes are local; navigation optimizations are deployed.

- Original questionnaire findings explicitly retain their screening scope. Later test receipt is not inferred to resolve a clinical finding.
- Fictional result badges use the approved snapshot's test IDs. Published and newly received results can have different publication states.
- Published queue items have no workflow-review owner or generic waiting-on-member label. This says nothing about completion of daily care tasks.
- Report source checks, consultation decision and final plan approval are in the review panel. The historical report shortcut and doctor report hashes select that panel; admin report hashes retain their results panel.
- Automatically prepared review drafts exclude technical rule IDs, row IDs and raw measurement timestamps from member-facing explanation. Existing GP edits, medicine fields and published snapshots are preserved. This remains screening-based, not a medication algorithm.
- BP assignment permits readings from 15 minutes early through 60 minutes late, clamps the first window to local midnight and partitions close reminder windows at a midpoint. Half-open windows assign a tie to the later reminder. One reading cannot complete two reminders.

Regression scripts: check-reminders, check-reminder-ui, check-care-plan-draft, check-review-copy, check-work-queue, check-service-publication, check-service-workflow and check-staff-navigation.

Local browser verification used existing fictional doctor cases without editing or republishing: original questionnaire labels, per-result Published badges, report review destination and saved publication preservation. A 390px member entry capture verified the mobile entry layout. This was not a new single-case end-to-end publication.

The eight-page stakeholder PDF now uses one fictional narrative, booking/waiting responsibilities, draft boundaries, daily care, exception decisions and a private-access/verification appendix. Screenshots are representative cases, clearly labelled. Provider operations, automatic monitor ingestion, external notifications and nurse escalation remain unavailable. Credentials are excluded.

Second review: corrected stale queue-caption assertion; nine targeted scripts and TypeScript pass. Consultation completion, advance booking, no-tests route, current-day reminder rollover and live/local/planned availability are now explicit in the PDF.

Hosted walkthrough: Anna Demo Video, case 716e5ad3-1a25-4c8e-8d1e-1e39f60396a4, was created using fictional data. A one-page synthetic PDF was uploaded through the UI and real AI extraction returned its three literal markers correctly; educational explanation was generated and source checked. Member test/GP booking, administrator simulated receipt, doctor simulated consultation completion, reviewed draft save and publication, member results/care, BP entries/charts and skipped fictional medicine check-in were exercised. Bookings and completion were demo time jumps, not actual medical services. No real patient data or prescription was used.

A second explicit fictional publication changed the example medicine schedule to include an actionable18:00 slot. The edited video retains the same case throughout; it is captured-screen walkthrough footage, not continuous screen recording.

Follow-up copy finding: the historical shared report panel says extraction clears on reload even though the shared record is retained. The persistence worked across roles; this misleading caption needs a future correction.
