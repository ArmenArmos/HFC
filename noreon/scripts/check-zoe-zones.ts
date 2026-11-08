import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { zoeAppV3Enabled } from "@/lib/patient/zoe-app-v3";
import {
  evaluateBp, evaluateLipids, evaluateLiverMuscle, evaluateGlycaemia, evaluateAdherence, evaluateRetest,
  labIsFresh, postApprovalLabs, isOutOfHours, outOfHoursDisclosure, queueForTask,
  slaDeadline, toMmol, type ZoneResult,
} from "@/lib/clinical/zones/evaluate";

/** Synthetic draft-rule checks only. No provider, database or application entry point. */
globalThis.fetch = (() => { throw Error("network used in a check"); }) as typeof fetch;
const clear = { chestPain: false, dyspnea: false, neuro: false, syncope: false };
const unknown = { chestPain: null, dyspnea: null, neuro: null, syncope: null };
const bp = (sbp: number, dbp: number, symptoms = clear) => evaluateBp({ readings: [{ sbp, dbp }], symptoms });
const provenance = (r: ZoneResult) => {
  assert.equal(r.ruleVersion, "zones-v1-2026-11-02");
  assert.equal(r.approval, "draft");
  if (r.zone === null) assert.ok(r.reasons.length, "undecidable results explain why");
};

// Each axis can raise the zone independently; low DBP alone has no defined band.
for (const [sbp, dbp, zone] of [
  [134, 84, "green"], [135, 85, "yellow"], [159, 99, "yellow"],
  [160, 100, "yellow"], [179, 109, "yellow"], [179, 110, "yellow"], [179, 119, "yellow"],
  [180, 109, "orange"], [180, 120, "orange"], [185, 60, "orange"],
  [89, 70, "orange"], [90, 60, "green"], [120, 59, null],
  [135, 70, "yellow"], [159, 70, "yellow"], [160, 70, "yellow"],
  [179, 70, "yellow"], [180, 70, "orange"], [120, 85, "yellow"],
  [120, 99, "yellow"], [120, 100, "yellow"], [120, 119, "yellow"],
  [120, 120, "orange"], [89, 120, "orange"], [160, 59, "yellow"],
  [89.5, 70, "orange"], [179.1, 80, "yellow"],
] as const) {
  const r = bp(sbp, dbp);
  assert.equal(r.zone, zone, `${sbp}/${dbp}`);
  provenance(r);
}
assert.ok(bp(120, 59).reasons.includes("bp_band_undefined"));
for (const [readings, zone] of [
  [[{ sbp: 141, dbp: 91 }, { sbp: 127, dbp: 77 }], "green"],
  [[{ sbp: 138, dbp: 88 }, { sbp: 132, dbp: 82 }], "yellow"],
  [[{ sbp: 141, dbp: 91 }, { sbp: 130, dbp: 80 }], "yellow"],
  [[{ sbp: 134, dbp: 84 }, { sbp: 135, dbp: 84 }], "yellow"],
  [[{ sbp: 120, dbp: 84 }, { sbp: 120, dbp: 85 }], "yellow"],
  [[{ sbp: 160, dbp: 100 }, { sbp: 120, dbp: 80 }, { sbp: 140, dbp: 90 }], "yellow"],
] as const) {
  const r = evaluateBp({ readings: [...readings], symptoms: clear });
  assert.equal(r.zone, zone);
  assert.equal(r.provisional, false);
  assert.ok(!r.requiredUi.includes("repeat_measure"));
}
for (const [sbp, dbp, repeat] of [[139, 89, false], [140, 80, true], [120, 90, true]] as const) {
  assert.equal(bp(sbp, dbp).provisional, repeat);
  assert.equal(bp(sbp, dbp).requiredUi.includes("repeat_measure"), repeat);
}
for (const key of Object.keys(clear) as (keyof typeof clear)[]) {
  const r = evaluateBp({ readings: [{ sbp: 90, dbp: 60 }], symptoms: { ...unknown, [key]: true } });
  assert.equal(r.zone, "red");
  assert.equal(r.provisional, false);
  assert.ok(r.reasons.includes(`bp_symptom_${key}`));
}
assert.equal(bp(183, 112, { ...clear, chestPain: true }).provisional, false);
{
  // Armen, 2 Nov: without symptoms a number never means 103.
  for (let sbp = 60; sbp <= 300; sbp += 5) for (let dbp = 30; dbp <= 200; dbp += 5)
    assert.notEqual(evaluateBp({ readings: [{ sbp, dbp }], symptoms: unknown }).zone, "red", `${sbp}/${dbp}`);
  const r = evaluateBp({ readings: [{ sbp: 183, dbp: 112 }], symptoms: unknown });
  assert.equal(r.zone, "orange");
  assert.equal(r.provisional, true);
  assert.deepEqual(r.requiredUi, ["repeat_measure", "bp_red_flags"]);
  assert.deepEqual(r.queues, ["nurse", "physician"]);
  assert.equal(r.slaHours, 4);
}
// Armen, 2 Nov: 180/110 needs a repeat to confirm it, then a doctor within 48 hours. Diastolic 120 or systolic 180 is the same day.
{
  const confirmed = evaluateBp({ readings: [{ sbp: 172, dbp: 112 }, { sbp: 170, dbp: 110 }], symptoms: clear });
  assert.deepEqual([confirmed.zone, confirmed.provisional, confirmed.queues, confirmed.slaHours], ["yellow", false, ["physician"], 48]);
  assert.deepEqual([bp(172, 112).provisional, bp(172, 112).requiredUi], [true, ["repeat_measure"]]);
  const sameDay = evaluateBp({ readings: [{ sbp: 182, dbp: 100 }, { sbp: 182, dbp: 100 }], symptoms: clear });
  assert.deepEqual([sameDay.zone, sameDay.provisional, sameDay.slaHours], ["orange", false, 4]);
}
// Armen, 2 Nov: known atrial fibrillation, pulse 140 and dizziness is 103. All three are needed, and none is assumed.
{
  const rhythm = { knownAf: true, pulse: 140, dizziness: true };
  const r = evaluateBp({ readings: [{ sbp: 120, dbp: 80 }], symptoms: clear, rhythm });
  assert.deepEqual([r.zone, r.provisional, r.reasons], ["red", false, ["af_fast_pulse_dizzy"]]);
  assert.equal(evaluateBp({ readings: [], symptoms: unknown, rhythm }).zone, "red");
  for (const change of [{ pulse: 139 }, { knownAf: false }, { dizziness: false }]) {
    const settled = evaluateBp({ readings: [{ sbp: 120, dbp: 80 }], symptoms: clear, rhythm: { ...rhythm, ...change } });
    assert.deepEqual([settled.zone, settled.provisional], ["green", false]);
  }
  // Part of it known, the rest unanswered: never a final green, and never 103 by assumption.
  for (const change of [{ pulse: null }, { knownAf: null }, { dizziness: null }, { knownAf: null, pulse: null }]) {
    const open = evaluateBp({ readings: [{ sbp: 120, dbp: 80 }], symptoms: clear, rhythm: { ...rhythm, ...change } });
    assert.deepEqual([open.zone, open.provisional, open.requiredUi], ["green", true, ["rhythm_questions"]]);
  }
  const blank = evaluateBp({ readings: [{ sbp: 120, dbp: 80 }], symptoms: clear, rhythm: { knownAf: null, pulse: null, dizziness: null } });
  assert.deepEqual([blank.zone, blank.provisional], ["green", false]);
}
// The low check is never rounded up.
for (const readings of [[{ sbp: 89, dbp: 70 }, { sbp: 90, dbp: 70 }], [{ sbp: 89, dbp: 59 }, { sbp: 90, dbp: 60 }]]) {
  const r = evaluateBp({ readings, symptoms: clear });
  assert.deepEqual([r.zone, r.reasons], ["orange", ["bp_low"]]);
}
assert.equal(evaluateBp({ readings: [{ sbp: 90, dbp: 70 }, { sbp: 90, dbp: 70 }], symptoms: clear }).zone, "green");
// Scenario B after Armen's answers: 166/98 is yellow. One reading is provisional; a repeat settles it, for the nurse within 48 hours.
{
  assert.deepEqual([bp(166, 98).zone, bp(166, 98).provisional, bp(166, 98).requiredUi], ["yellow", true, ["repeat_measure"]]);
  const r = evaluateBp({ readings: [{ sbp: 166, dbp: 98 }, { sbp: 164, dbp: 96 }], symptoms: clear });
  assert.deepEqual([r.zone, r.provisional, r.queues, r.slaHours], ["yellow", false, ["nurse"], 48]);
  assert.ok(evaluateBp({ readings: [{ sbp: 166, dbp: 98 }, { sbp: 164, dbp: 96 }], symptoms: unknown }).requiredUi.includes("bp_red_flags"));
}
assert.equal(bp(135, 85).slaHours, 48);
assert.equal(bp(89, 70).provisional, false);
assert.equal(evaluateBp({ readings: [], symptoms: unknown }).zone, null);
assert.equal(evaluateBp({ readings: [], symptoms: { ...clear, syncope: true } }).zone, "red");
// @ts-expect-error A reading must include both pressure axes.
const incompleteReading: Parameters<typeof evaluateBp>[0]["readings"][number] = { sbp: 150 };
void incompleteReading;

// A half-entered repeat never lowers a zone, on either axis, and always asks for a full repeat.
const sameDayTask = [4, ["nurse", "physician"]], lowTask = [4, ["nurse"]], nurseTask = [48, ["nurse"]];
for (const [readings, zone, task] of [
  [[{ sbp: 180, dbp: 80 }, { sbp: 120, dbp: NaN }], "orange", sameDayTask],
  [[{ sbp: 120, dbp: 120 }, { sbp: NaN, dbp: 70 }], "orange", sameDayTask],
  [[{ sbp: 160, dbp: 80 }, { sbp: 100, dbp: NaN }], "yellow", nurseTask],
  [[{ sbp: 120, dbp: 100 }, { sbp: NaN, dbp: 60 }], "yellow", nurseTask],
  [[{ sbp: 180, dbp: 80 }, { sbp: NaN, dbp: NaN }], "orange", sameDayTask],
  [[{ sbp: 85, dbp: 70 }, { sbp: NaN, dbp: 70 }], "orange", lowTask],
  [[{ sbp: 85, dbp: 70 }, { sbp: 120, dbp: NaN }], "orange", lowTask],
  [[{ sbp: 85, dbp: 70 }, { sbp: 90, dbp: NaN }], "orange", lowTask],
  [[{ sbp: 85, dbp: 70 }, { sbp: 185, dbp: NaN }], "orange", sameDayTask],
] as const) {
  const r = evaluateBp({ readings, symptoms: unknown });
  assert.equal(r.zone, zone);
  assert.equal(r.provisional, true);
  assert.ok(r.requiredUi.includes("repeat_measure"));
  assert.deepEqual([r.slaHours, r.queues], task);
  assert.ok(r.requiredUi.includes("bp_red_flags") === readings.some((x) => x.sbp >= 160 || x.dbp >= 100));
  provenance(r);
}
{
  const r = evaluateBp({ readings: [{ sbp: 120, dbp: 80 }, { sbp: 118, dbp: NaN }], symptoms: clear });
  assert.equal(r.zone, null, "a half-entered repeat is never green");
  assert.ok(r.requiredUi.includes("repeat_measure"));
  provenance(r);
}

const lipidInput = { ldlMmol: null, tcMmol: null, hdlMmol: null, tgMmol: null, baselineLdlMmol: null, targetMmol: null, reductionPct: null };
const lipids = (o: Partial<Parameters<typeof evaluateLipids>[0]> = {}) => evaluateLipids({ ...lipidInput, ...o });
assert.equal(Number(toMmol(190, "mg/dL", "ldl").toFixed(2)), 4.91);
assert.equal(lipids({ ldlMmol: toMmol(190, "mg/dL", "ldl") }).zone, "orange");
assert.ok(lipids({ ldlMmol: 4.9 }).reasons.includes("suspected_fh"));
assert.deepEqual(lipids({ ldlMmol: 4.9 }).queues, ["physician"]);
assert.equal(lipids({ ldlMmol: 4.89, tgMmol: 1 }).zone, "green");
for (const [tgMmol, zone] of [[5.59, "green"], [5.6, "orange"], [10, "orange"], [10.01, "red"]] as const)
  assert.equal(lipids({ ldlMmol: 1, tgMmol }).zone, zone);
assert.equal(lipids({ ldlMmol: 5, tgMmol: 10.01 }).zone, "red");
assert.equal(lipids().zone, null);
assert.equal(lipids({ ldlMmol: 1 }).zone, null);
assert.equal(lipids({ tgMmol: 1 }).zone, null);
assert.ok(Math.abs(lipids({ tcMmol: 6.4, hdlMmol: 1.1 }).nonHdl! - 5.3) < 1e-12);
assert.equal(lipids({ tcMmol: 6.4 }).nonHdl, null);
assert.equal(toMmol(88.57, "mg/dL", "tg"), 1);
assert.equal(toMmol(2.3, "mmol/L", "tg"), 2.3);
assert.equal(toMmol(38.67, "mg/dL", "tc"), 1);
assert.equal(toMmol(38.67, "mg/dL", "hdl"), 1);
assert.throws(() => toMmol(190, "g/L", "ldl"), /unit/i);
// Scenario C: no default target or ULN, and reduction is displayed to one decimal.
const c = lipids({ baselineLdlMmol: 4.2, ldlMmol: 2.2, targetMmol: 1.8, reductionPct: 50 });
assert.equal(c.ldlReductionPct, 47.6);
assert.equal(c.targetMet, false);
assert.equal(lipids({ ldlMmol: 1 }).targetMet, null);
assert.equal(lipids({ ldlMmol: 1, targetMmol: 1.8 }).targetMet, true);
assert.equal(lipids({ ldlMmol: 1.8, targetMmol: 1.8 }).targetMet, false);
assert.equal(lipids({ ldlMmol: 1, targetMmol: 1.8, reductionPct: 50 }).targetMet, null);
assert.equal(lipids({ ldlMmol: 1, baselineLdlMmol: 0 }).ldlReductionPct, null);
assert.equal(lipids({ ldlMmol: 1, baselineLdlMmol: 2, targetMmol: 1.8, reductionPct: 50 }).targetMet, true);
assert.equal(lipids({ ldlMmol: 1.0001, baselineLdlMmol: 2, targetMmol: 1.8, reductionPct: 50 }).targetMet, false, "rounding must not meet a reduction cut");

const noSams = { musclePain: false, weakness: false, darkUrine: false, fever: false, jaundice: false, rightUpperPain: false };
const liverInput = { alt: null, altUln: null, ck: null, ckUln: null, sams: noSams };
const liver = (o: Partial<Parameters<typeof evaluateLiverMuscle>[0]> = {}) => evaluateLiverMuscle({ ...liverInput, ...o });
assert.equal(liver({ alt: 26, altUln: 40 }).zone, null);
// Answers 11 and 12: no lab number alone means 103.
for (const [alt, zone, reason, slaHours] of [
  [40, null, "liver_muscle_no_zone_trigger", null], [41, "yellow", "alt_elevated", 48], [120, "yellow", "alt_elevated", 48],
  [121, "yellow", "alt_doctor_48h", 48], [200, "yellow", "alt_doctor_48h", 48], [201, "orange", "alt_same_day", 4], [2000, "orange", "alt_same_day", 4],
] as const) {
  const r = liver({ alt, altUln: 40, ck: 10, ckUln: 100 });
  assert.equal(r.zone, zone, `ALT ${alt}`);
  assert.equal(r.slaHours, slaHours);
  assert.ok(r.reasons.includes(reason), reason);
  if (zone) assert.deepEqual(r.queues, ["physician"]);
}
const muscleOn = { ...noSams, musclePain: true };
assert.equal(liver({ ck: 500, ckUln: 100 }).zone, null);
assert.deepEqual(liver({ ck: 501, ckUln: 100 }).reasons.filter((x) => x.startsWith("ck_")), ["ck_raised_no_muscle_symptoms"]);
assert.equal(liver({ ck: 501, ckUln: 100 }).zone, null);
assert.ok(liver({ ck: 501, ckUln: 100, sams: muscleOn }).reasons.includes("ck_same_day"));
assert.equal(liver({ ck: 500, ckUln: 100, sams: muscleOn }).reasons.includes("ck_same_day"), false);
{
  const r = liver({ ck: 1001, ckUln: 100 });
  assert.deepEqual([r.zone, r.slaHours, r.queues, r.mandatoryTemplateId], ["orange", 4, ["physician"], "NO_TITRATION"]);
  assert.equal(liver({ ck: 5000, ckUln: 100, alt: 5000, altUln: 40 }).zone, "orange", "no lab number alone is red");
  const ask = liver({ ck: 800, ckUln: 100, sams: { ...noSams, musclePain: null } });
  assert.deepEqual([ask.zone, ask.provisional, ask.requiredUi], [null, true, ["sams_questions"]]);
}
assert.equal(liver({ alt: 500, ck: 5000 }).zone, null);
assert.ok(liver({ alt: 500 }).reasons.includes("uln_missing"));
assert.equal(liver({ alt: 500, altUln: 0 }).zone, null);
assert.equal(liver({ alt: 201, altUln: 40, ck: 5000 }).zone, "orange", "missing CK ULN cannot erase a raised ALT");
for (const symptom of ["musclePain", "weakness"] as const) {
  const r = liver({ sams: { ...noSams, [symptom]: true } });
  assert.equal(r.zone, "orange");
  assert.deepEqual(r.queues, ["physician"], "answer 13: statin muscle pain goes to the doctor");
  assert.equal(r.mandatoryTemplateId, "NO_TITRATION");
  assert.deepEqual(r.requiredUi, [], "answered questions are not asked again");
  for (const flag of ["darkUrine", "fever", "jaundice"] as const) {
    const red = liver({ sams: { ...noSams, [symptom]: true, [flag]: true } });
    assert.equal(red.zone, "red");
    assert.equal(red.mandatoryTemplateId, "NO_TITRATION");
  }
}
{
  const r = liver({ sams: { ...noSams, musclePain: true, darkUrine: null } });
  assert.equal(r.zone, "orange");
  assert.equal(r.provisional, true);
  assert.deepEqual(r.requiredUi, ["sams_questions"]);
}
assert.equal(liver({ sams: { ...noSams, rightUpperPain: true } }).zone, null);
for (const flag of ["darkUrine", "fever", "jaundice"] as const) {
  const r = liver({ sams: { ...noSams, [flag]: true } });
  assert.equal(r.zone, null, "no invented zone without muscle symptoms");
  assert.ok(r.reasons.includes("sams_sign_without_muscle_rule_undefined"), "and not silent either");
}

// Armen, 2 Nov: HbA1c 9 or more is a doctor within a week, or 48 hours with thirst, weight loss or glucose 15+.
{
  const none = { hba1cPct: 9, thirst: false, weightLoss: false, glucoseMmol: 10 };
  assert.deepEqual([evaluateGlycaemia(none).zone, evaluateGlycaemia(none).queues, evaluateGlycaemia(none).slaHours], ["yellow", ["physician"], 168]);
  for (const change of [{ thirst: true }, { weightLoss: true }, { glucoseMmol: 15 }]) {
    const r = evaluateGlycaemia({ ...none, ...change });
    assert.deepEqual([r.zone, r.slaHours], ["orange", 48]);
  }
  assert.equal(evaluateGlycaemia({ ...none, glucoseMmol: 14.9 }).slaHours, 168);
  assert.equal(evaluateGlycaemia({ ...none, hba1cPct: 8.9 }).zone, null);
  assert.deepEqual(evaluateGlycaemia({ ...none, hba1cPct: null }).reasons, ["hba1c_missing"]);
  for (const change of [{ thirst: null }, { weightLoss: null }, { glucoseMmol: null }]) {
    const open = evaluateGlycaemia({ ...none, ...change });
    assert.deepEqual([open.zone, open.provisional, open.requiredUi], ["yellow", true, ["hba1c_symptom_questions"]]);
  }
  assert.equal(evaluateGlycaemia({ ...none, thirst: true, weightLoss: null }).provisional, false);
  assert.equal(slaDeadline(evaluateGlycaemia(none), "2026-11-02T00:00:00Z"), "2026-11-09T00:00:00.000Z");
  assert.equal(slaDeadline(evaluateGlycaemia({ ...none, thirst: true }), "2026-11-02T00:00:00Z"), "2026-11-04T00:00:00.000Z");
}

const adherence = { missedMeasurements: null, missedDoseDays: null, wantsToStopStatin: null };
assert.equal(evaluateAdherence(adherence).zone, null);
assert.equal(evaluateAdherence({ missedMeasurements: 2, missedDoseDays: 1, wantsToStopStatin: false }).zone, null);
for (const o of [{ missedMeasurements: 3 }, { missedDoseDays: 2 }, { wantsToStopStatin: true }]) {
  const r = evaluateAdherence({ ...adherence, ...o });
  assert.equal(r.zone, "yellow");
  assert.deepEqual(r.queues, ["nurse"]);
}
for (const weeksSinceChange of [6, 8]) {
  const r = evaluateRetest({ weeksSinceChange, ldlAboveTarget: true, complaints: false });
  assert.equal(r.zone, "yellow");
  assert.deepEqual(r.queues, ["physician"]);
}
for (const weeksSinceChange of [null, 5.99, 8.01])
  assert.equal(evaluateRetest({ weeksSinceChange, ldlAboveTarget: true, complaints: false }).zone, null);
assert.equal(evaluateRetest({ weeksSinceChange: 6, ldlAboveTarget: null, complaints: false }).zone, null);
assert.equal(evaluateRetest({ weeksSinceChange: 6, ldlAboveTarget: true, complaints: null }).zone, null);
assert.equal(evaluateRetest({ weeksSinceChange: 6, ldlAboveTarget: true, complaints: true }).zone, null);

const fresh = (collectedOn: string | null, today = "2026-11-02", medicineChangedSince: boolean | null = false) =>
  labIsFresh({ collectedOn, today, analyte: "lipids", medicineChangedSince });
assert.equal(fresh("2026-10-12").fresh, true); // A: 21 days old.
assert.equal(fresh("2026-07-02").fresh, false);
assert.equal(fresh("2026-08-02").fresh, true);
assert.equal(fresh("2026-08-01").fresh, false);
assert.equal(fresh("2026-01-31", "2026-04-30").fresh, true, "calendar-month end clamps");
assert.equal(fresh("2026-01-31", "2026-05-01").fresh, false);
assert.equal(fresh("2023-11-30", "2024-02-29").fresh, true);
assert.equal(fresh(null).fresh, false);
assert.equal(fresh("2026-10-12", undefined, true).fresh, false);
assert.equal(fresh("2026-10-12", undefined, null).fresh, false);
assert.equal(fresh("2026-02-30").fresh, false);
assert.equal(fresh("2026-11-03").fresh, false);
assert.equal(fresh("2026-10-12", "invalid").fresh, false);

for (const drugClass of ["ace_inhibitor", "arb", "diuretic"] as const) {
  const [r] = postApprovalLabs([{ drugClass, on: "2026-12-25" }]);
  assert.deepEqual(r.tests, ["creatinine", "eGFR", "K"]);
  assert.equal(r.fromOn, "2027-01-08");
  assert.equal(r.toOn, "2027-01-22");
  assert.equal(r.queue, "admin");
}
for (const drugClass of ["statin", "ezetimibe"] as const) {
  const [r] = postApprovalLabs([{ drugClass, on: "2026-11-02" }]);
  assert.deepEqual(r.tests, ["lipids", "ALT", "CK"]);
  assert.equal(r.fromOn, "2026-12-14");
  assert.equal(r.toOn, "2026-12-28");
}
assert.deepEqual(postApprovalLabs([]), []);
assert.throws(() => postApprovalLabs([{ drugClass: "statin", on: "2026-02-30" }]), /date/i);

const hours = [{ weekday: 1, opens: "09:00:00", closes: "17:00:00" }]; // ISO Monday, as in the migration.
for (const [at, expected] of [
  ["2026-11-02T04:59:59Z", true], ["2026-11-02T05:00:00Z", false],
  ["2026-11-02T12:59:59Z", false], ["2026-11-02T13:00:00Z", true],
  ["2026-11-01T20:00:00Z", true], ["2026-11-03T05:00:00Z", true],
] as const) assert.equal(isOutOfHours({ at, hours }), expected);
assert.equal(isOutOfHours({ at: "2026-11-01T21:30:00Z", hours: [{ weekday: 1, opens: "01:00", closes: "02:00" }] }), false, "Yerevan date crosses UTC midnight");
assert.equal(isOutOfHours({ at: "2026-11-08T05:00:00Z", hours: [{ weekday: 7, opens: "09:00", closes: "10:00" }] }), false);
assert.equal(isOutOfHours({ at: "2026-11-02T05:00:00Z", hours: [] }), true);
assert.throws(() => isOutOfHours({ at: "2026-11-02T09:00:00", hours }), /instant/i);
for (const zone of [null, "green", "yellow", "orange", "red"] as const) {
  assert.equal(outOfHoursDisclosure(zone, true), zone === "orange" || zone === "red");
  assert.equal(outOfHoursDisclosure(zone, false), false);
}
assert.deepEqual(queueForTask("clinical"), ["nurse", "physician"]);
assert.deepEqual(queueForTask("logistics"), ["admin"]);
assert.equal(slaDeadline(bp(135, 85), "2026-11-02T20:00:00Z"), "2026-11-04T20:00:00.000Z");
assert.equal(slaDeadline(bp(89, 70), "2026-11-02T20:00:00+04:00"), "2026-11-02T20:00:00.000Z");
assert.equal(slaDeadline(bp(120, 80, { ...clear, chestPain: true }), "2026-11-02T23:45:00Z"), "2026-11-03T00:15:00.000Z");
assert.equal(slaDeadline(bp(120, 80), "2026-11-02T20:00:00Z"), null);
assert.equal(slaDeadline(evaluateBp({ readings: [], symptoms: unknown }), "2026-11-02T20:00:00Z"), null);
for (const r of [lipids(), c, liver(), evaluateAdherence(adherence), evaluateRetest({ weeksSinceChange: null, ldlAboveTarget: null, complaints: null })]) provenance(r);

for (const value of [undefined, "", "false", "TRUE", "True", "1", " true", "true "])
  assert.equal(zoeAppV3Enabled({ NOREON_ZOE_APP_V3: value }), false);
assert.equal(zoeAppV3Enabled({ NOREON_ZOE_APP_V3: "true" }), true);
const source = readFileSync("lib/clinical/zones/evaluate.ts", "utf8");
assert.doesNotMatch(source, /process\s*\.\s*env|Date\s*\.\s*now/, "evaluation has no environment or ambient clock");
console.log("Draft Zoe zone checks passed.");
