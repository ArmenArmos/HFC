import assert from "node:assert/strict";
import {
  extractionSchema,
  validateReview,
  repairExtractionDate,
  trendPoints,
} from "@/lib/reports/schema";
const row = {
  name: "LDL cholesterol",
  literal: "3,2",
  unit: "mmol/L",
  reference: "<3.0",
  page: 1,
  snippet: "LDL 3,2 mmol/L",
  uncertain: false,
};
const report = {
  reportDate: "2024-02-29",
  personName: "Fictional Example",
  laboratory: "Example lab",
  summary: "",
  warnings: [],
  rows: [row],
};
assert.equal(extractionSchema.parse(report).rows[0].literal, "3,2");
assert.throws(() =>
  extractionSchema.parse({ ...report, rows: [{ ...row, page: 0 }] }),
);
assert.throws(() => validateReview({ ...report, reportDate: "2024-02-30" }));
const review = validateReview(report);
assert.equal(trendPoints(review)[0].value, 3.2);
assert.equal(trendPoints({ ...review, reportDate: null }).length, 0);
for (const literal of [
  "<5",
  ">5",
  "negative",
  "trace",
  "3-5",
  "1,000.2",
  "NaN",
])
  assert.equal(
    trendPoints({ ...review, rows: [{ ...row, literal }] }).length,
    0,
    literal,
  );
assert.equal(
  trendPoints({ ...review, rows: [{ ...row, unit: "unknown" }] }).length,
  0,
);
assert.equal(
  trendPoints({ ...review, rows: [{ ...row, name: "Unknown marker" }] }).length,
  0,
);
assert.equal(
  trendPoints({ ...review, rows: [{ ...row, uncertain: true }] }).length,
  0,
);
assert.throws(() => validateReview({ ...report, reportDate: "9999-01-01" }));
console.log("report validation checks passed");

const repaired = repairExtractionDate({
    ...report,
    reportDate: "2025-02-30",
    warnings: Array(20).fill("check"),
  });
assert.equal(repaired.reportDate,null);
assert.ok(repaired.warnings.length<=20);
assert.ok(repaired.warnings.some(w=>w.includes("date")));
assert.ok(!repaired.warnings.includes("check"),"Untrusted model warning prose is replaced by bounded source-check notices");
