import assert from "node:assert/strict";
import { LDL_CATEGORY_GOALS, LDL_STATUS_SOURCES } from "@/lib/ldl/constants";
import { assessLdl, formatMmol, formatPercent, ldlObservations, type LdlGoal, type RawLdlObservation } from "@/lib/ldl/status";

/** SYNTHETIC checks for the LDL goal status: one definition, unrounded comparisons, no imputed baseline. */
globalThis.fetch = (() => { throw Error("network used in a check"); }) as typeof fetch;

const obs = (id: string, value: number, on: string, source: RawLdlObservation["source"] = "clinic_result", unit = "mmol/L", name: string | null = "LDL-C"): RawLdlObservation =>
  ({ id, value, unit, on, source, name: source === "member" || source === "upload_checked" ? null : name, memberVisible: source !== "clinic_reviewed" });
const goal = (o: Partial<LdlGoal> = {}): LdlGoal => ({
  version: 1, category: "very_high", thresholdMmol: 1.4, reductionRule: true, reductionPct: 50,
  baseline: { kind: "pre_treatment", mmol: 3.8, on: "2026-08-20", source: "document" }, nextTestOn: null, setAt: "2026-10-29T10:00:00+04:00", ...o,
});

// Defaults pending Armen/Yesayi: very high 1.4 with 50%; status sources exclude member-typed values.
assert.deepEqual(LDL_CATEGORY_GOALS.very_high, { thresholdMmol: 1.4, reductionPct: 50 });
assert.ok(!(LDL_STATUS_SOURCES as readonly string[]).includes("member"));

// No goal: goal_not_set whatever the values say.
assert.equal(assessLdl({ goal: null, observations: [obs("a", 1.0, "2026-10-01")] }).status, "goal_not_set");

// No counted value: not assessable (a value the member typed is shown but does not decide).
{
  const r = assessLdl({ goal: goal(), observations: [obs("m", 1.1, "2026-10-01", "member")] });
  assert.equal(r.status, "not_assessable");
  assert.equal(r.latest, null);
  assert.equal(r.newest?.id, "m");
  assert.equal(r.observations.length, 1);
}

// Strict and unrounded: 1.39 is at goal, 1.4 is above, 1.40001 is above, 1.399 is at goal.
for (const [v, s] of [[1.39, "at_goal"], [1.4, "above_goal"], [1.40001, "above_goal"], [1.399, "at_goal"]] as const)
  assert.equal(assessLdl({ goal: goal(), observations: [obs("x", v, "2026-10-20")] }).status, s, `value ${v}`);

// mg/dL converts unrounded: 54 mg/dL = 1.396 mmol/L, at goal; 55 mg/dL = 1.422, above.
assert.equal(assessLdl({ goal: goal(), observations: [obs("x", 54, "2026-10-20", "clinic_result", "mg/dL")] }).status, "at_goal");
assert.equal(assessLdl({ goal: goal(), observations: [obs("x", 55, "2026-10-20", "clinic_result", "мг/дл")] }).status, "above_goal");

// The latest counted value wins, not the lowest: 1.2 then 1.9 is above goal.
assert.equal(assessLdl({ goal: goal(), observations: [obs("a", 1.2, "2026-09-01"), obs("b", 1.9, "2026-10-20")] }).status, "above_goal");

// Reduction from a documented untreated baseline only; shown separately from the status.
{
  const r = assessLdl({ goal: goal(), observations: [obs("b", 1.3, "2026-10-20")] });
  assert.equal(r.status, "at_goal");
  assert.equal(r.reduction.state, "met");
  if (r.reduction.state === "met") assert.ok(Math.abs(r.reduction.percent - (1 - 1.3 / 3.8) * 100) < 1e-9);
  // Threshold met, reduction not: 1.3 from 2.0 is 35%. Status stays "at goal" (threshold only, pending); the reduction says not met.
  const r2 = assessLdl({ goal: goal({ baseline: { kind: "pre_treatment", mmol: 2.0, on: "2026-08-20", source: "lab_result" } }), observations: [obs("b", 1.3, "2026-10-20")] });
  assert.equal(r2.status, "at_goal");
  assert.equal(r2.reduction.state, "not_met");
}
// Unrounded at the 50% edge: 1.9 from 3.8 is exactly 50% (met); 1.9001 is not.
assert.equal(assessLdl({ goal: goal(), observations: [obs("b", 1.9, "2026-10-20")] }).reduction.state, "met");
assert.equal(assessLdl({ goal: goal(), observations: [obs("b", 1.9001, "2026-10-20")] }).reduction.state, "not_met");

// Never imputed: unknown baseline, on-treatment baseline, or no value after the baseline date.
assert.deepEqual(assessLdl({ goal: goal({ baseline: { kind: "unknown", mmol: null, on: null, source: null } }), observations: [obs("b", 1.3, "2026-10-20")] }).reduction,
  { state: "not_assessable", why: "baseline_unknown" });
assert.deepEqual(assessLdl({ goal: goal({ baseline: { kind: "on_treatment", mmol: 2.4, on: "2026-09-10", source: "document" } }), observations: [obs("b", 1.3, "2026-10-20")] }).reduction,
  { state: "not_assessable", why: "on_treatment" });
assert.deepEqual(assessLdl({ goal: goal(), observations: [obs("b", 3.8, "2026-08-20")] }).reduction, { state: "not_assessable", why: "no_later_value" });
assert.deepEqual(assessLdl({ goal: goal(), observations: [] }).reduction, { state: "not_assessable", why: "no_later_value" });
// No reduction rule (moderate risk): not applicable.
assert.deepEqual(assessLdl({ goal: goal({ category: "moderate", thresholdMmol: 2.6, reductionRule: false, reductionPct: null }), observations: [obs("b", 2.0, "2026-10-20")] }).reduction, { state: "not_applicable" });
// Baseline already below the threshold is flagged for the doctor.
assert.equal(assessLdl({ goal: goal({ baseline: { kind: "pre_treatment", mmol: 1.3, on: "2026-08-20", source: "document" } }), observations: [] }).baselineBelowThreshold, true);

// Observations: VLDL and ratios are not LDL; implausible and unknown units dropped; same-day duplicates merged to the better source.
{
  const o = ldlObservations([
    obs("v", 0.5, "2026-10-10", "clinic_result", "mmol/L", "VLDL cholesterol"),
    obs("r", 2.5, "2026-10-10", "clinic_result", "", "LDL/HDL ratio"),
    obs("i", 40, "2026-10-10", "clinic_result", "mmol/L"),
    obs("u", 1.5, "2026-10-10", "clinic_result", "g/L"),
    obs("ru", 1.9, "2026-10-12", "clinic_result", "ммоль/л", "Холестерин ЛПНП"),
    obs("la", 1.9, "2026-10-12", "clinic_reviewed"),
    obs("bad", 1.2, "2026-02-30"),
  ]);
  assert.deepEqual(o.map((x) => x.id), ["la"], "only the LDL value remains, kept from the reviewed reading");
  assert.equal(o[0].memberVisible, true, "visible because the published copy is");
}
// Same day, different sources: the counted one decides even if the member typed another value that day.
assert.equal(assessLdl({ goal: goal(), observations: [obs("c", 1.6, "2026-10-20"), obs("m", 1.2, "2026-10-20", "member")] }).status, "above_goal");

// Astra LDL-02: distinct same-day values are never merged, and the result does not depend on input order:
// 1.399 and 1.401 on one day is above goal (the higher one) whichever comes first.
for (const order of [[obs("x", 1.399, "2026-10-20"), obs("y", 1.401, "2026-10-20")], [obs("y", 1.401, "2026-10-20"), obs("x", 1.399, "2026-10-20")]]) {
  const r = assessLdl({ goal: goal(), observations: order });
  assert.equal(r.observations.length, 2);
  assert.equal(r.status, "above_goal");
  assert.equal(r.latest?.id, "y");
}
// Exactly equal values merge whatever the order, keeping the more authoritative source.
assert.deepEqual(ldlObservations([obs("la", 1.9, "2026-10-12", "clinic_reviewed"), obs("cr", 1.9, "2026-10-12")]).map((x) => x.id), ["la"]);
assert.deepEqual(ldlObservations([obs("cr", 1.9, "2026-10-12"), obs("la", 1.9, "2026-10-12", "clinic_reviewed")]).map((x) => x.id), ["la"]);

// Display never contradicts the status (Astra LDL-03: 1.3999 is "1.3999", never "1.400").
assert.equal(formatMmol(1.3999, 1.4), "1.3999");
for (const t of [1.0, 1.4, 1.8, 2.6, 3.0]) for (const v of [t - 0.1, t - 0.01, t - 0.0001, t - 0.000001, t, t + 0.0001]) {
  const shown = Number(formatMmol(v, t));
  assert.equal(shown < t, v < t, `${v} against ${t} shows ${formatMmol(v, t)}`);
}
assert.equal(formatMmol(1.36, 1.4), "1.36");
assert.equal(formatMmol(1.3964, 1.4), "1.396");
assert.equal(formatMmol(2.34, 1.4), "2.3");
assert.equal(formatMmol(1.44, 1.4), "1.4"); // above, shown as 1.4: "not below 1.4" still holds
assert.equal(formatPercent(49.6, 50), "49");
assert.equal(formatPercent(65.8, 50), "66");
console.log("LDL status checks passed.");
