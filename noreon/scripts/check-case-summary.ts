import {sourceBoundCaseSummary} from '@/lib/reports/source-bound-output';
import assert from "node:assert/strict";
import {
  caseSummaryPayloadSchema,
  caseSummarySchema,
  checkedCaseRows,
  validateCaseEvidence,
  validateCaseSummary,
  CASE_SUMMARY_INSTRUCTION,
  type CaseEvidence,
} from "@/lib/service-workflow/case-summary";
import { callReportModel } from "@/lib/reports/provider";
import { SAMPLE_EXTRACTION } from "@/lib/reports/demo";
const evidence: CaseEvidence = {
  findings: [
    {
      id: "finding-1",
      text: "Source finding",
      ruleIds: ["RF-01"],
      source: "NRN-CLIN-ALG-001",
    },
  ],
  bloodPressure: [
    {
      id: "bp-1",
      measuredAt: "2026-10-08T08:00:00Z",
      systolic: 120,
      diastolic: 80,
      pulse: null,
    },
  ],
  reportRows: [],
};
const draft = sourceBoundCaseSummary(evidence);
assert.deepEqual(validateCaseSummary(draft, evidence), draft);
assert.throws(() =>
  validateCaseSummary(
    {
      ...draft,
      considerations: [{ text: "Invented source", evidenceIds: ["invented"] }],
    },
    evidence,
  ),
);
assert.throws(() =>
  validateCaseSummary(
    {
      ...draft,
      considerations: [{ text: "Duplicate", evidenceIds: ["bp-1", "bp-1"] }],
    },
    evidence,
  ),
);
assert.throws(() =>
  validateCaseSummary(
    { ...draft, summary: "See https://invented.example" },
    evidence,
  ),
);
assert.throws(() => validateCaseEvidence({ ...evidence, personName: "Name" }));
assert.throws(() =>
  validateCaseEvidence({
    ...evidence,
    bloodPressure: Array.from({ length: 21 }, (_, i) => ({
      ...evidence.bloodPressure[0],
      id: `bp-${i}`,
    })),
  }),
);
assert.throws(() =>
  validateCaseEvidence({
    ...evidence,
    findings: [{ ...evidence.findings[0], id: "bp-1" }],
  }),
);
assert.throws(() =>
  validateCaseEvidence({
    ...evidence,
    findings: [{ ...evidence.findings[0], source: "Invented guideline" }],
  }),
);
assert.throws(() =>
  caseSummaryPayloadSchema.parse({
    op: "case-summary",
    consent: false,
    evidence,
  }),
);
const rows = checkedCaseRows([
  { id:"unchecked", state: "needs_review", reviewed: SAMPLE_EXTRACTION },
  { id:"checked", state: "confirmed", reviewed: SAMPLE_EXTRACTION },
]);
assert.equal(rows.length, 3);
assert.ok(!JSON.stringify(rows).includes("Mariam"));
assert.ok(!Object.hasOwn(rows[0], "snippet"));
assert.equal(rows[0].id, "report-checked-v0-row0");
assert.equal(
  checkedCaseRows(
    Array.from({ length: 50 }, (_,i) => ({
      id:`report-${i}`,
      state: "confirmed",
      reviewed: SAMPLE_EXTRACTION,
    })),
  ).length,
  100,
);
let calls = 0;
await callReportModel({
  key: "test",
  model: "test",
  instruction: CASE_SUMMARY_INSTRUCTION,
  content: [{ type: "input_text", text: JSON.stringify(evidence) }],
  schema: caseSummarySchema,
  transport: async (_url, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.store, false);
    assert.equal(request.text.format.strict, true);
    assert.ok(request.instructions.includes("Do not prescribe medication"));
    return Response.json({
      status: "completed",
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: JSON.stringify(draft) }],
        },
      ],
    });
  },
});
assert.equal(calls, 1);
console.log(
  "Case summary checks passed: bounded consent input, source matching, identity field exclusion, strict provider output and store:false.",
);
