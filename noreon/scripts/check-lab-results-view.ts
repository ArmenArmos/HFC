import assert from "node:assert/strict";
import { analytes, changeText, formatResult, rangeStatus, type MemberResultValue } from "@/lib/member-history/lab-results";
import { LAB_RESULTS_COPY, type ResultsLocale } from "@/lib/member-history/lab-results-copy";
import { approveCommandSchema, approveValueAction, draftInterpretation } from "@/lib/lab-ai/member-approval";

// Member results from their files after the doctor's check (Armen, 20 Oct 2026; 20261021070050).

// 1. Range status against the printed range: inside, near a bound, outside, or no range.
assert.equal(rangeStatus({ value: 4.5, refLow: 3, refHigh: 6 }), "in");
assert.equal(rangeStatus({ value: 3.2, refLow: 3, refHigh: 6 }), "borderline", "within 10% of the width above the low bound");
assert.equal(rangeStatus({ value: 5.8, refLow: 3, refHigh: 6 }), "borderline", "within 10% of the width below the high bound");
assert.equal(rangeStatus({ value: 6, refLow: 3, refHigh: 6 }), "borderline", "the bound itself is inside");
assert.equal(rangeStatus({ value: 6.01, refLow: 3, refHigh: 6 }), "out");
assert.equal(rangeStatus({ value: 2.9, refLow: 3, refHigh: 6 }), "out");
assert.equal(rangeStatus({ value: 4, refLow: null, refHigh: 5.2 }), "in", "one-sided upper range");
assert.equal(rangeStatus({ value: 5, refLow: null, refHigh: 5.2 }), "borderline");
assert.equal(rangeStatus({ value: 5.3, refLow: null, refHigh: 5.2 }), "out");
assert.equal(rangeStatus({ value: 1.05, refLow: 1, refHigh: null }), "borderline", "one-sided lower range");
assert.equal(rangeStatus({ value: 1.5, refLow: 1, refHigh: null }), "in");
assert.equal(rangeStatus({ value: null, refLow: 1, refHigh: 2 }), "none", "no number");
assert.equal(rangeStatus({ value: 3, refLow: null, refHigh: null }), "none", "no range");
assert.equal(rangeStatus({ value: 3, refLow: 5, refHigh: 2 }), "none", "an inverted range decides nothing");

// 2. Grouping by analyte, change between the two latest dates in the same unit, out-of-range first.
let n = 0;
const v = (testName: string, value: number | null, date: string | null, extra: Partial<MemberResultValue> = {}): MemberResultValue => ({
  valueId: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`, documentId: "00000000-0000-4000-8000-000000000000", testName, catalogueRef: null,
  valueText: value === null ? "negative" : String(value), value, unit: "mmol/L", refLow: 0, refHigh: 3, refText: "0 - 3", date, checked: true, doctorEdited: false, ...extra,
});
const list = analytes([
  v("LDL cholesterol", 3.4, "2026-03-01"), v("LDL-C", 2.9, "2026-09-01"), v("HbA1c", 5.4, "2026-09-01", { unit: "%", refLow: 4, refHigh: 6 }),
  v("Glucose", 7.1, "2026-09-01", { refLow: 3.9, refHigh: 6.1 }), v("Urine protein", null, "2026-09-01", { refLow: null, refHigh: null }),
  v("Cholesterol", 200, "2026-01-01", { unit: "mg/dL" }), v("Cholesterol", 5.0, "2026-09-01", { refHigh: 5.2 }),
]);
const by = (k: string) => list.find((a) => a.key === k)!;
assert.equal(by("ldl_c").points.length, 2, "printed names group by catalogue analyte");
assert.deepEqual(by("ldl_c").change && { d: by("ldl_c").change!.direction, a: by("ldl_c").change!.absolute, p: by("ldl_c").change!.percent }, { d: "down", a: -0.5, p: -15 });
assert.equal(changeText(by("ldl_c").change!), "−0.5 (−15%)");
assert.equal(by("total_cholesterol").change, null, "no change across different units");
assert.equal(by("total_cholesterol").series.length, 1, "the chart keeps the latest unit only");
assert.equal(by("hba1c").change, null, "one date, no change");
assert.equal(list[0]!.latest.status, "out", "out of range first");
assert.equal(by("printed:urine protein").latest.status, "none");
const up = analytes([v("HbA1c", 5.0, "2026-01-01", { unit: "%" }), v("HbA1c", 5.5, "2026-06-01", { unit: "%" })])[0]!;
assert.equal(changeText(up.change!), "+0.5 (+10%)");
// Small values keep their precision and their change (Astra R-02): TSH 0.001 -> 0.004.
const tsh = analytes([v("TSH", 0.001, "2026-01-01", { unit: "mIU/L", refLow: 0.4, refHigh: 4 }), v("TSH", 0.004, "2026-06-01", { unit: "mIU/L", refLow: 0.4, refHigh: 4 })])[0]!;
assert.deepEqual({ d: tsh.change!.direction, a: tsh.change!.absolute, p: tsh.change!.percent }, { d: "up", a: 0.003, p: 300 });
assert.equal(changeText(tsh.change!), "+0.003 (+300%)");
assert.equal(formatResult(0.004), "0.004");
assert.equal(formatResult(140), "140");

// 3. The doctor's draft names counts and analytes only; no advice, diagnosis or reassurance; both languages.
const draft = draftInterpretation([
  { testName: "LDL-C", catalogueRef: "ldl_c", value: 3.4, refLow: 0, refHigh: 3, collectedOn: "2026-09-01", removed: false },
  { testName: "HbA1c", catalogueRef: "hba1c", value: 5.9, refLow: 4, refHigh: 6, collectedOn: "2026-09-01", removed: false },
  { testName: "Sodium", catalogueRef: null, value: 140, refLow: 136, refHigh: 145, collectedOn: "2026-09-01", removed: true },
]);
assert.match(draft.en, /01\.09\.2026/);
assert.match(draft.en, /1 of 2/);
assert.match(draft.en, /Outside the lab's range: LDL-C\./);
assert.match(draft.en, /edge of the range: HbA1c\./);
assert.doesNotMatch(draft.en, /Sodium/, "a removed value is not mentioned");
assert.match(draft.hy, /ՑԽԼ/);
for (const text of [draft.en, draft.hy]) assert.doesNotMatch(text, /[!—]|normal|nothing to worry|medicine|treat|diagnos|դեղ|բուժ|ախտորոշ/iu);

// Astra N1-5: unreadable numbers can be corrected, while an empty qualitative result stays printed.
assert.deepEqual(approveValueAction("", null), { action: "keep" });
assert.deepEqual(approveValueAction("  ", null), { action: "keep" });
assert.deepEqual(approveValueAction("1234", null), { action: "correct", value: 1234 });
assert.deepEqual(approveValueAction("5,2", null), { action: "correct", value: 5.2 });
assert.deepEqual(approveValueAction("0", null), { action: "correct", value: 0 });
assert.equal(approveValueAction("Infinity", null), null);
assert.equal(approveValueAction("S.2", null), null);
assert.equal(approveValueAction("1 234", null), null);
assert.equal(approveValueAction("", 5.2), null);
assert.deepEqual(approveValueAction("5.2", 5.2), { action: "keep" });
assert.deepEqual(approveValueAction("5.3", 5.2), { action: "correct", value: 5.3 });

// 4. The command shape the database expects.
const cmd = { version: "member-upload-approve-v1", submissionId: crypto.randomUUID(), memberId: crypto.randomUUID(), jobId: crypto.randomUUID(), basedOn: null,
  values: [{ valueId: crypto.randomUUID(), action: "keep" }], interpretationHy: "Տեքստ", interpretationEn: "Text", interpretationEdited: false };
assert.ok(approveCommandSchema.safeParse(cmd).success);
assert.ok(!approveCommandSchema.safeParse({ ...cmd, values: [{ valueId: crypto.randomUUID(), action: "correct" }] }).success, "a correction carries a value");
assert.ok(!approveCommandSchema.safeParse({ ...cmd, interpretationEn: "  " }).success, "both texts are required");

// 5. Copy: complete in hy, en and ru, and follows the voice guide.
const locales: ResultsLocale[] = ["hy", "en", "ru"];
const lines = (l: ResultsLocale) => Object.values(LAB_RESULTS_COPY[l]).flatMap((x) =>
  typeof x === "function" ? [(x as (...a: unknown[]) => string)("X", "1 Sep 2026"), (x as (...a: unknown[]) => string)(null, "1 Sep 2026")] : typeof x === "string" ? [x] : Object.values(x as Record<string, string>));
for (const l of locales) {
  assert.equal(lines(l).length, lines("en").length, `${l}: every line present`);
  for (const line of lines(l)) {
    assert.ok(line.trim().length > 0, `${l}: no empty line`);
    assert.doesNotMatch(line, /[!—]/u, `${l}: no exclamation marks or em dashes: ${line}`);
    assert.doesNotMatch(line, /\p{Extended_Pictographic}/u, `${l}: no emoji: ${line}`);
    assert.doesNotMatch(line, /\b(patient|user)\b/i, `${l}: say "you": ${line}`);
  }
}
assert.match(LAB_RESULTS_COPY.en.waitingTitle, /^Waiting for your doctor to check$/);
console.log("lab results view checks passed");
