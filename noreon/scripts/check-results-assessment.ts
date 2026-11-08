import assert from "node:assert/strict";
import { resultsAssessment, type ResultsAssessmentInput } from "@/lib/clinical/rules/results-assessment";
import type { Answers, FieldValue } from "@/lib/clinical/types";

const dated = <T>(value: T, on = "2026-11-02") => ({ value, on });
function answers(values: Record<string, FieldValue>): Answers {
  return Object.fromEntries(Object.entries(values).map(([fieldId, value]) => [fieldId, { fieldId, value, source: "manual", answeredAt: "2026-11-02" }]));
}
function input(patch: Partial<ResultsAssessmentInput> = {}): ResultsAssessmentInput {
  return { answers: answers({ "q6.conditions": ["none"], "q3.status": "never", "q5.diagnosed": "no" }), questionnaireComplete: true, age: 45,
    labs: { totalCholesterol: dated(4.8), hdl: dated(1.5), ldl: dated(2.7), egfr: null, uacr: null, hba1c: null }, latestTotalCholesterol: dated(4.8),
    entries: { score2Percent: dated(2), potassium: null, ecgLvh: null, ecgIschaemia: null, echoDone: null, ahi: null }, awaitingReview: 0, ...patch };
}
const base = input();
const assess = (patch: Partial<ResultsAssessmentInput> = {}) => resultsAssessment(input(patch));
const tc01 = assess();
assert.deepEqual(tc01.nonHdl, { value: 3.3 });
assert.deepEqual(tc01.category, { level: "low_moderate", rule: "score2_table" });
assert.equal(tc01.ldlTarget?.mmol, 3);
assert.equal(tc01.ldlTarget?.below, true);
assert.equal(tc01.hmod.status, "unknown");
assert.equal(tc01.score2.state, "applicable");

// Table 5 boundaries, including the age transitions on both sides.
for (const [age, high, veryHigh] of [[40, 2.5, 7.5], [49, 2.5, 7.5], [50, 5, 10], [69, 5, 10], [70, 7.5, 15], [80, 7.5, 15]]) {
  for (const [percent, level] of [[high - 0.01, "low_moderate"], [high, "high"], [veryHigh - 0.01, "high"], [veryHigh, "very_high"]] as const) {
    assert.equal(assess({ age, entries: { ...base.entries, score2Percent: dated(percent) } }).category?.level, level, `age ${age}, SCORE2 ${percent}`);
  }
}
assert.equal(assess({ age: 39 }).category, null);
assert.ok(assess({ age: 39 }).score2.reasons.includes("under_40"));
assert.equal(assess({ age: 40 }).score2.state, "applicable");
for (const age of [null, 45]) {
  const r = assess({ age, questionnaireComplete: false });
  assert.equal(r.category, null); assert.equal(r.score2.state, "undecided");
}
for (const a of [null, answers({ "q6.conditions": "unknown" }), answers({})]) {
  assert.equal(assess({ answers: a }).category, null);
  assert.ok(assess({ answers: a }).gates.includes("conditions_unknown"));
}
assert.equal(assess({ age: null }).category, null);

// Same-day pairing is required; independent latest TC still triggers rule 8.
assert.equal(assess({ labs: { ...base.labs, hdl: dated(1.5, "2026-11-01") } }).nonHdl, null);
assert.ok(assess({ labs: { ...base.labs, totalCholesterol: null } }).gates.includes("lipids_incomplete"));
for (const [ldl, level] of [[4.899, "low_moderate"], [4.9, "high"]] as const) {
  assert.equal(assess({ labs: { ...base.labs, ldl: dated(ldl) } }).category?.level, level);
}
for (const [tc, level] of [[8, "low_moderate"], [8.001, "high"]] as const) {
  assert.equal(assess({ latestTotalCholesterol: dated(tc) }).category?.level, level);
}
assert.equal(assess({ entries: { ...base.entries, score2Percent: null } }).category, null);
assert.ok(assess({ entries: { ...base.entries, score2Percent: null } }).gates.includes("score2_missing"));

for (const [egfr, level, rule] of [[29.999, "very_high", "egfr_under_30"], [30, "high", "egfr_30_59"], [59.999, "high", "egfr_30_59"], [60, "low_moderate", "score2_table"]] as const) {
  const r = assess({ labs: { ...base.labs, egfr: dated(egfr) } });
  assert.deepEqual(r.category, { level, rule });
}
for (const [uacr, status] of [[2.999, "absent"], [3, "present"]] as const) {
  assert.equal(assess({ labs: { ...base.labs, egfr: dated(60), uacr: dated(uacr) }, entries: { ...base.entries, ecgLvh: dated("no") } }).hmod.status, status);
}
const hmod = assess({ labs: { ...base.labs, egfr: dated(55), uacr: dated(12) }, entries: { ...base.entries, ecgLvh: dated("yes"), potassium: dated(5.3) } });
assert.deepEqual(hmod.hmod.reasons, ["ecg_lvh", "uacr", "egfr"]);
assert.equal(hmod.score2.percent, null);
assert.ok(hmod.gates.includes("lvh_without_echo"));
assert.equal(hmod.facts.potassium?.value, 5.3);
for (const condition of ["ascvd", "stroke", "heart_failure", "kidney", "familial_hypercholesterolaemia", "diabetes"]) {
  const r = assess({ answers: answers({ "q6.conditions": [condition] }) });
  assert.equal(r.score2.state, "off", condition); assert.equal(r.score2.percent, null);
}
assert.deepEqual(assess({ answers: answers({ "q6.conditions": ["stroke"] }) }).category, { level: "very_high", rule: "ascvd" });
assert.equal(assess({ answers: answers({ "q6.conditions": ["none"], "q7.conditions": ["familial_hypercholesterolaemia"] }) }).score2.state, "applicable");

const diabetes = answers({ "q6.conditions": ["diabetes"], "q6.diabetes_years": 9.99, "q3.status": "never", "q5.diagnosed": "no", "q5.last_reading.systolic": 116, "q5.last_reading.diastolic": 68 });
const dm = input({ answers: diabetes, labs: { ...base.labs, egfr: dated(60), uacr: dated(2.99) }, entries: { ...base.entries, ecgLvh: dated("no") } });
assert.deepEqual(resultsAssessment(dm).category, { level: "moderate", rule: "diabetes_short" });
for (const patch of [ { age: 50 }, { answers: { ...diabetes, ...answers({ "q6.diabetes_years": 10 }) } }, { answers: { ...diabetes, ...answers({ "q3.status": "unknown" }) } }, { answers: { ...diabetes, ...answers({ "q5.diagnosed": "treated" }) } }, { answers: { ...diabetes, ...answers({ "q5.last_reading.systolic": 140 }) } }, { labs: { ...dm.labs, uacr: null } } ]) {
  assert.equal(resultsAssessment({ ...dm, ...patch }).category?.rule, "diabetes_other");
}
assert.equal(resultsAssessment({ ...dm, age: 49 }).category?.rule, "diabetes_short");
assert.equal(resultsAssessment({ ...dm, labs: { ...dm.labs, uacr: dated(3) } }).category?.rule, "diabetes_organ_damage");
assert.equal(resultsAssessment({ ...dm, entries: { ...dm.entries, ecgLvh: dated("yes") } }).category?.rule, "diabetes_other");
const missingDm = assess({ answers: answers({ "q6.conditions": ["diabetes"] }) });
assert.equal(missingDm.category?.rule, "diabetes_other");
assert.ok(missingDm.gates.includes("uacr_missing")); assert.ok(missingDm.gates.includes("diabetes_duration_unknown"));
for (const [hba1c, gate] of [[6.499, false], [6.5, true]] as const) {
  assert.equal(assess({ labs: { ...base.labs, hba1c: dated(hba1c) } }).gates.includes("diabetes_unconfirmed"), gate);
}
for (const [level, age, percent, target, reduction] of [["low_moderate", 45, 2, 3, null], ["high", 52, 6, 1.8, 50], ["very_high", 56, 11, 1.4, 50]] as const) {
  for (const [ldl, below] of [[target - 0.001, true], [target, false], [target + 0.001, false]] as const) {
    const r = assess({ age, labs: { ...base.labs, ldl: dated(ldl) }, entries: { ...base.entries, score2Percent: dated(percent) } });
    assert.equal(r.category?.level, level); assert.equal(r.ldlTarget?.below, below); assert.equal(r.ldlTarget?.reductionPct, reduction);
  }
}
assert.equal(assess({ labs: { ...base.labs, ldl: null } }).ldlTarget?.below, null);
assert.equal(assess({ labs: { ...base.labs, ldl: null } }).ldlTarget?.latest, null);
assert.equal(assess({ awaitingReview: 2 }).gates.at(-1), "values_awaiting_review");

// Remaining supplied cases exercise realistic combinations rather than isolated cuts.
const tc02 = assess({ age: 56, answers: answers({ "q6.conditions": ["none"], "q3.status": "current", "q5.diagnosed": "untreated" }),
  labs: { ...base.labs, totalCholesterol: dated(6.2), hdl: dated(1.1), ldl: dated(4.1), egfr: dated(82), uacr: dated(1.5), hba1c: dated(5.9) },
  entries: { ...base.entries, ecgLvh: dated("no"), score2Percent: dated(11) } });
assert.equal(tc02.nonHdl?.value, 5.1); assert.equal(tc02.hmod.status, "absent"); assert.equal(tc02.category?.level, "very_high");
const tc10 = assess({ age: 48, labs: { ...base.labs, totalCholesterol: null, hdl: null, ldl: dated(3.9) }, entries: { ...base.entries, score2Percent: null } });
assert.equal(tc10.nonHdl, null); assert.equal(tc10.category, null); assert.ok(tc10.gates.includes("score2_missing"));
const tc11 = assess({ labs: { ...base.labs, totalCholesterol: dated(8.4), hdl: dated(1.2), ldl: dated(5.8) }, latestTotalCholesterol: dated(8.4), entries: { ...base.entries, score2Percent: dated(1.5) } });
assert.equal(tc11.nonHdl?.value, 7.2); assert.equal(tc11.category?.rule, "ldl_tc_high");
const tc12 = assess({ age: 58, entries: { ...base.entries, score2Percent: dated(8), ahi: dated(22) } });
assert.equal(tc12.category?.level, "high"); assert.equal(tc12.ldlTarget?.mmol, 1.8); assert.equal(tc12.facts.ahi?.value, 22);
// Quit under five years ago, or an unknown quit date, still counts as a factor.
for (const [quit, level] of [[5, "moderate"], [4, "high"]] as const) assert.equal(resultsAssessment({ ...dm, answers: { ...diabetes, ...answers({ "q3.status": "former", "q3.quit_years_ago": quit }) } }).category?.level, level);
assert.equal(resultsAssessment({ ...dm, answers: { ...diabetes, ...answers({ "q3.status": "former" }) } }).category?.level, "high");
// High lipids or recorded dyslipidaemia are factors; missing lipids are not reassurance.
assert.equal(resultsAssessment({ ...dm, labs: { ...dm.labs, ldl: dated(4.9) } }).category?.rule, "diabetes_other");
assert.equal(resultsAssessment({ ...dm, latestTotalCholesterol: dated(8.01) }).category?.rule, "diabetes_other");
assert.equal(resultsAssessment({ ...dm, labs: { ...dm.labs, ldl: null } }).category?.rule, "diabetes_other");
assert.equal(resultsAssessment({ ...dm, answers: { ...diabetes, ...answers({ "q6.conditions": ["diabetes", "dyslipidaemia"] }) } }).category?.rule, "diabetes_other");
assert.equal(resultsAssessment({ ...dm, labs: { ...dm.labs, egfr: null } }).category?.rule, "diabetes_other");
assert.equal(resultsAssessment({ ...dm, entries: { ...dm.entries, ecgLvh: null } }).category?.rule, "diabetes_other");
for (const [field, cut] of [["q5.last_reading.systolic", 140], ["q5.last_reading.diastolic", 90]] as const) {
  assert.equal(resultsAssessment({ ...dm, answers: { ...diabetes, ...answers({ [field]: cut - 0.01 }) } }).category?.rule, "diabetes_short");
  assert.equal(resultsAssessment({ ...dm, answers: { ...diabetes, ...answers({ [field]: cut }) } }).category?.rule, "diabetes_other");
}
assert.equal(resultsAssessment({ ...dm, labs: { ...dm.labs, ldl: dated(2.599) } }).ldlTarget?.below, true);
assert.equal(resultsAssessment({ ...dm, labs: { ...dm.labs, ldl: dated(2.6) } }).ldlTarget?.below, false);
assert.equal(assess({ questionnaireComplete: false, labs: { ...base.labs, egfr: dated(29) } }).score2.state, "off");
assert.equal(assess({ questionnaireComplete: false, labs: { ...base.labs, egfr: dated(29) } }).category, null);
assert.equal(resultsAssessment({ ...dm, answers: { ...diabetes, ...answers({ "q5.last_reading.systolic": "unknown" }) } }).category?.rule, "diabetes_other");
const allGates = assess({ answers: answers({ "q6.conditions": ["diabetes", "unknown"], "q5.diagnosed": "treated" }), questionnaireComplete: false, age: null,
  labs: { ...base.labs, totalCholesterol: null }, entries: { ...base.entries, ecgLvh: dated("yes") }, awaitingReview: 1 });
assert.deepEqual(allGates.gates, ["questionnaire_incomplete", "conditions_unknown", "age_unknown", "uacr_missing", "diabetes_duration_unknown", "lipids_incomplete", "lvh_without_echo", "egfr_missing", "values_awaiting_review"]);
console.log("Results assessment checks passed");
