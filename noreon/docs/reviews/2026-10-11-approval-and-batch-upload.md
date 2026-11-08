# Approval guidance and multiple report uploads

Live deployment: dpl_Ewn82o1Q8wN4ASXGbUUNoPj88Rve, promoted to the demo, doctor and backoffice portals on 11 October 2026.

Approval now names the next required action beside preview and disabled approval controls. When unsaved edits block consultation decisions, a nearby Save draft and unlock decision action saves the same review draft. Clinical publication prerequisites remain enforced.

The shared demo report uploader accepts multiple selected PDF, JPEG and PNG files. Processing is sequential, each file is stored independently, and failures do not discard successful files. Per-file statuses remain visible after completion. Successful files cannot be resubmitted from the same selection; retry means selecting failed files again. The existing 10-report case limit, 2 MB per-file limit, 10 PDF-page limit and AI quota remain.

Chart exclusions now name each test and source row with its reason in an expandable list. Excluded values remain in reports and do not block approval. Supported tests, units, specimen rules and clinical publication requirements are unchanged.

Verification:
- TypeScript, changed-file ESLint and diff checks passed.
- Batch processing and static upload UI tests passed, including success/failure/success ordering and consent gating.
- Historical chart tests passed, including source identity, units, dates, specimen exclusion, duplicate provenance and individual exclusion reasons.
- Existing care-plan draft, service workflow and publication checks passed.
- Live browser upload selected three PDFs together. The first and third sample PDFs were extracted and stored; the invalid middle PDF failed. Both successful reports remained in the case.
- Live GP browser edit showed the new unsaved-draft guidance. Save draft and unlock decision saved successfully, restored consultation controls and preserved Published version 1. New unchecked reports remained a publication prerequisite.
- Live chart inspection showed 33 individual exclusions and the new report-only explanation.

Scope: the active shared demo upload flow is updated. Verified-account uploads on app.noreon.health remain unavailable, as before. New historical graphs still require source checking and the existing publication stage.
