import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LabRange } from "@/components/patient-care/lab-range";
import type { CareResult } from "@/lib/patient-care/types";

const result = (value: number, referenceLow: number | null, referenceHigh: number | null): CareResult => ({
  id: "result-1", testId: null, marker: "Example lab value",
  value, unit: "mmol/L", referenceLow, referenceHigh,
  collectedAt: "2026-10-10T08:00:00Z", receivedAt: "2026-10-10T10:00:00Z",
  source: "laboratory", sourceLabel: "Example source lab",
  reviewedAt: null, reviewedBy: null, explanation: null,
});
const cases = [
  { value: 5, low: null, high: 4, en: "Outside the lab’s reference range", hy: "Լաբորատոր միջակայքից դուրս" },
  { value: 4, low: null, high: 4, en: "Within the lab’s reference range", hy: "Լաբորատոր միջակայքում" },
  { value: 1, low: 2, high: null, en: "Outside the lab’s reference range", hy: "Լաբորատոր միջակայքից դուրս" },
  { value: 2, low: 2, high: null, en: "Within the lab’s reference range", hy: "Լաբորատոր միջակայքում" },
];
for (const locale of ["en", "hy"] as const) {
  for (const c of cases) {
    const html = renderToStaticMarkup(createElement(LabRange, { locale, result: result(c.value, c.low, c.high) }));
    assert.ok(html.includes(c[locale]), "A supplied one-sided interval still conveys its textual status");
    assert.ok(!html.includes('role="img"'), "A one-sided interval must not invent a plotted position");
  }
  for (const [low, high] of [[null, null], [5, 2]] as const) {
    const html = renderToStaticMarkup(createElement(LabRange, { locale, result: result(3, low, high) }));
    assert.ok(html.includes(locale === "en" ? "Not reported" : "Տրամադրված չէ"));
    for (const status of cases.map(c => c[locale])) assert.ok(!html.includes(status), "Unknown interval must not infer an in/out-of-range status");
    assert.ok(!html.includes('role="img"'));
  }
  const bounded = renderToStaticMarkup(createElement(LabRange, { locale, result: result(5, 2, 4) }));
  assert.ok(bounded.includes('role="img"'), "Two-sided interval retains its descriptive graphic");
  assert.ok(bounded.includes(locale === "en" ? "Outside the lab’s reference range" : "Լաբորատոր միջակայքից դուրս"));
}
console.log("Actual lab range renders show upper/lower-only status, suppress unknown status and avoid inventing one-sided positions in EN/HY.");
