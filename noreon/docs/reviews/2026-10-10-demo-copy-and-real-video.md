# Demo copy cleanup and real workflow recording

Simplified member, GP, backoffice, legacy demo and report copy. The member shell has one short demo notice; storage and privacy information is expandable. Explicit consent remains for report processing and private shared storage. Urgent guidance and accurate integration limits remain visible.

Live release: noreon-core deployment dpl_7YD3To4CSVTgpXBF7ewRH5v4pfuS, promoted 10 October 2026. This updates demo, doctor and backoffice portals; app.noreon.health is a separate deployment.

A fresh connected Anna Morgan case was exercised through the browser: registration, complete questionnaire, single previous-test PDF upload, real AI extraction, test booking, GP consultation decision, member booking, admin results receipt, original PDF download, checked report values, real AI explanation, consultation completion, refreshed review draft, GP edits, final publication, member acknowledgement, patient-owned reminder settings, manual BP entry and completion of the nearby reminder. The second BP reminder remained upcoming. The uploaded and downloaded source PDFs match. Published report values are LDL 3.2 mmol/L, HDL 1.3 mmol/L and HbA1c 5.8%.

The recording advances the demo timeline between booking and completion. Laboratory receipt is a demo action, not a provider integration. The medicine reminder was upcoming during recording; a medication intake check-in was not submitted. Automatic BP device syncing remains unavailable.

Recording uses continuous Chrome tab capture with MediaRecorder, including actual interactions and loading states. The final MP4 is made from the recorded WebM clips, with idle intervals trimmed. It is not a sequence of screenshots. Patient footage uses a mobile viewport; staff footage uses desktop.

Artifacts: output/video/noreon-actions/Noreon_Real_Flow_Mobile_and_Staff.mp4 in the parent workspace. Raw recordings, sample PDF and edit timeline are alongside it.

Validation: TypeScript and changed-file ESLint passed. Ten existing targeted workflow/report checks passed before final copy corrections; service workflow, work queue and reminder checks were rerun and passed after those corrections. Hosted builds passed. Browser recording also caught and corrected misleading completed-questionnaire copy and remaining appointment labels.

After a fresh navigation, the current laboratory result also appeared as Review published (LDL 3.1 mmol/L). The earlier awaiting-review wording was stale client content during the immediate publication handoff.
