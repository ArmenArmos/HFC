import assert from "node:assert/strict";
import { sampleReports } from "@/lib/reports/demo";
import { applyReportExplanation } from "@/lib/service-workflow/report-memory";
import { createWorkflow } from "@/lib/service-workflow/model";
import { clientWorkflow } from "@/lib/service-workflow/client-projection";
const [report, other] = sampleReports();
const explanation = {
  summary: "Checked explanation",
  attention: [],
  questions: [],
  items: [],
};
assert.deepEqual(
  applyReportExplanation([], report.id, report.revision, explanation),
  [],
);
const changed = { ...report, revision: report.revision + 1 };
assert.deepEqual(
  applyReportExplanation([changed], report.id, report.revision, explanation),
  [changed],
);
const updated = applyReportExplanation(
  [report, other],
  report.id,
  report.revision,
  explanation,
);
assert.equal(updated[0].explanation, explanation);
assert.equal(updated[0].revision, report.revision + 1);
assert.equal(updated[1], other);
const workflow = createWorkflow([]);
workflow.draft.explanation = "PRIVATE DRAFT";
workflow.draft.medicationName = "PRIVATE MEDICINE";
assert.ok(!JSON.stringify(clientWorkflow(workflow)).includes("PRIVATE"));
assert.equal(workflow.draft.explanation, "PRIVATE DRAFT");
console.log(
  "Publication checks passed: late responses, deletion, stale revisions and client draft isolation.",
);

const { reportPublication } = await import(
  "@/lib/service-workflow/report-memory"
);
const approval = {
  revision: report.revision,
  at: "2030-01-01T00:00:00Z",
  doctor: "Example GP",
  report,
};
const snapshot = reportPublication("case:5", [report], {
  [report.id]: approval,
});
assert.equal(snapshot.key, "case:5");
assert.equal(snapshot.reports[report.id].report.revision, report.revision);
approval.report = { ...report, revision: 10 };
assert.equal(snapshot.reports[report.id].report.revision, report.revision);
assert.deepEqual(
  reportPublication("case:6", [], { [report.id]: approval }).reports,
  {},
);
assert.deepEqual(
  reportPublication("case:7", [{ ...report, revision: 11 }], {
    [report.id]: approval,
  }).reports,
  {},
);
console.log(
  "Explicit report publication snapshots ignore clock skew and preserve the prior published revision.",
);
