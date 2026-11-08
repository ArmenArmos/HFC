import { URGENCY_RANK, type Urgency } from "@/lib/clinical/types";
import { LDL_MG_DL_PER_MMOL } from "@/lib/ldl/constants";
import { ZONE_RULES_V1 as rules } from "./config-v1";

export type ZoneResult = {
  zone: Urgency | null;
  provisional: boolean;
  reasons: string[];
  requiredUi: ("confirm_card" | "repeat_measure" | "bp_red_flags" | "sams_questions" | "rhythm_questions" | "hba1c_symptom_questions")[];
  queues: ("nurse" | "physician" | "admin")[];
  slaHours: number | null;
  mandatoryTemplateId: "DOCTOR_IN_LOOP" | "NO_TITRATION" | "OUT_OF_HOURS" | null;
  ruleVersion: string;
  approval: "draft" | "approved";
};
type Answer = boolean | null;
type BpSymptoms = { chestPain: Answer; dyspnea: Answer; neuro: Answer; syncope: Answer };
type Sams = { musclePain: Answer; weakness: Answer; darkUrine: Answer; fever: Answer; jaundice: Answer; rightUpperPain: Answer };
const provenance = () => ({ ruleVersion: rules.version, approval: rules.approval });
const present = (n: number | null): n is number => n !== null && Number.isFinite(n);

function empty(): ZoneResult {
  return { zone: null, provisional: false, reasons: [], requiredUi: [], queues: [], slaHours: null, mandatoryTemplateId: null, ...provenance() };
}

function raise(r: ZoneResult, zone: Urgency, reason: string, queues: ZoneResult["queues"] = []) {
  if (r.zone === null || URGENCY_RANK[zone] > URGENCY_RANK[r.zone]) r.zone = zone;
  r.reasons.push(reason);
  r.queues = [...new Set([...r.queues, ...queues])];
  r.slaHours = rules.slaHours[r.zone];
}

function finish(r: ZoneResult, undecidedReason: string): ZoneResult {
  if (r.zone === null && !r.reasons.length) r.reasons.push(undecidedReason);
  return r;
}

export function evaluateBp({ readings, symptoms, rhythm }: {
  readings: readonly { sbp: number; dbp: number }[];
  symptoms: BpSymptoms;
  rhythm?: { knownAf: Answer; pulse: number | null; dizziness: Answer };
}): ZoneResult {
  const r = empty();
  for (const key of Object.keys(symptoms) as (keyof BpSymptoms)[]) {
    if (symptoms[key] === true) raise(r, "red", `bp_symptom_${key}`, ["nurse", "physician"]);
  }
  // All three are needed for 103. If some are yes and none is a no, ask rather than call the result final.
  const rhythmSigns = rhythm ? [rhythm.knownAf, rhythm.dizziness, present(rhythm.pulse) ? rhythm.pulse >= rules.bp.fastPulseWithAf : null] : [];
  if (rhythmSigns.length && rhythmSigns.every((s) => s === true)) raise(r, "red", "af_fast_pulse_dizzy", ["nurse", "physician"]);
  // Symptoms decide immediately, including without a pressure reading.
  if (r.zone === "red") return r;
  if (!readings.length) return finish(r, "bp_readings_missing");
  const incomplete = readings.some((x) => !present(x.sbp) || !present(x.dbp));
  // A half-entered repeat can't average anything away: use the worst value seen, high or low, and ask for a full repeat.
  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const values = (axis: "sbp" | "dbp") => readings.map((x) => x[axis]).filter(present);
  const pick = (axis: "sbp" | "dbp") => {
    const v = values(axis);
    if (!v.length) return null;
    if (incomplete) return Math.max(...v);
    return readings.length === 1 ? v[0] : Math.ceil(mean(v));
  };
  const sbp = pick("sbp"), dbp = pick("dbp");
  // Rounding up is the safe side for high pressure and the unsafe side for low, so the low check is never rounded.
  const sbps = values("sbp");
  const lowSbp = !sbps.length ? null : incomplete ? Math.min(...sbps) : mean(sbps);
  const atLeast = (band: { sbp: number; dbp: number }) =>
    (sbp !== null && sbp >= band.sbp) || (dbp !== null && dbp >= band.dbp);
  // A number alone never reaches red: 103 needs a symptom, handled above.
  if (atLeast(rules.bp.sameDay)) raise(r, "orange", "bp_same_day", ["nurse", "physician"]);
  else if (lowSbp !== null && lowSbp < rules.bp.systolicLow) raise(r, "orange", "bp_low", ["nurse"]);
  else if (atLeast(rules.bp.doctor48h)) raise(r, "yellow", "bp_doctor_48h", ["physician"]);
  else if (atLeast(rules.bp.yellow)) raise(r, "yellow", "bp_yellow", ["nurse"]);
  else if (!incomplete && sbp !== null && dbp !== null && sbp >= rules.bp.systolicLow && dbp >= rules.bp.diastolicLow) raise(r, "green", "bp_green");
  if (incomplete) {
    r.reasons.push("bp_reading_incomplete");
    r.provisional = true;
  }
  if (incomplete || (readings.length === 1 && atLeast(rules.bp.repeat))) {
    r.requiredUi.push("repeat_measure");
    r.provisional = true;
  }
  if (atLeast(rules.bp.redFlagCheck) && Object.values(symptoms).some((s) => s !== false)) {
    r.requiredUi.push("bp_red_flags");
    r.provisional = true;
  }
  if (rhythmSigns.some((s) => s === true) && !rhythmSigns.includes(false) && rhythmSigns.includes(null)) {
    r.requiredUi.push("rhythm_questions");
    r.provisional = true;
  }
  return finish(r, "bp_band_undefined");
}

export function toMmol(value: number, unit: string, analyte: "ldl" | "tc" | "hdl" | "tg"): number {
  if (unit === "mmol/L") return value;
  if (unit === "mg/dL") return value / (analyte === "tg" ? rules.lipids.triglycerideMgDlPerMmol : LDL_MG_DL_PER_MMOL);
  throw new Error("Unsupported lipid unit");
}

export function evaluateLipids(input: {
  ldlMmol: number | null; tcMmol: number | null; hdlMmol: number | null; tgMmol: number | null;
  baselineLdlMmol: number | null; targetMmol: number | null; reductionPct: number | null;
}): ZoneResult & { nonHdl: number | null; ldlReductionPct: number | null; targetMet: boolean | null } {
  const r = empty();
  const { ldlMmol: ldl, tcMmol: tc, hdlMmol: hdl, tgMmol: tg, baselineLdlMmol: baseline, targetMmol: target, reductionPct } = input;
  const nonHdl = present(tc) && present(hdl) ? tc - hdl : null;
  const reduction = present(ldl) && present(baseline) && baseline > 0 ? (1 - ldl / baseline) * 100 : null;
  const ldlReductionPct = reduction === null ? null : Math.round(reduction * 10) / 10;
  const targetMet = !present(target) || !present(ldl) ? null
    : reductionPct !== null && reduction === null ? null
    : ldl < target && (reductionPct === null || reduction! >= reductionPct);
  if (present(ldl) && ldl >= rules.lipids.suspectedFhMmol) raise(r, "orange", "suspected_fh", ["physician"]);
  if (present(tg) && tg > rules.lipids.tgRedAboveMmol) raise(r, "red", "tg_red", ["nurse", "physician"]);
  else if (present(tg) && tg >= rules.lipids.tgOrangeMmol) raise(r, "orange", "tg_orange", ["nurse", "physician"]);
  if (!present(ldl) || !present(tg)) r.reasons.push("lipids_missing");
  else if (r.zone === null) raise(r, "green", "lipids_below_zone_thresholds");
  return { ...finish(r, "lipids_missing"), nonHdl, ldlReductionPct, targetMet };
}

export function evaluateLiverMuscle({ alt, altUln, ck, ckUln, sams }: {
  alt: number | null; altUln: number | null; ck: number | null; ckUln: number | null; sams: Sams;
}): ZoneResult {
  const r = empty();
  const muscle = sams.musclePain === true || sams.weakness === true;
  const multiple = (value: number | null, uln: number | null, analyte: "alt" | "ck") => {
    if (!present(value)) { r.reasons.push(`${analyte}_missing`); return null; }
    if (!present(uln) || uln <= 0) {
      if (!r.reasons.includes("uln_missing")) r.reasons.push("uln_missing");
      return null;
    }
    return value / uln;
  };
  const altTimes = multiple(alt, altUln, "alt"), ckTimes = multiple(ck, ckUln, "ck");
  const m = rules.liverMuscle;
  if (altTimes !== null) {
    if (altTimes > m.altSameDayUlnMultiple) raise(r, "orange", "alt_same_day", ["physician"]);
    else if (altTimes > 1) raise(r, "yellow", altTimes > m.altDoctor48hUlnMultiple ? "alt_doctor_48h" : "alt_elevated", ["physician"]);
  }
  const ckAskMuscle = ckTimes !== null && ckTimes > m.ckSameDayWithSymptomsUlnMultiple && ckTimes <= m.ckSameDayUlnMultiple && !muscle;
  if (ckTimes !== null && (ckTimes > m.ckSameDayUlnMultiple || (ckTimes > m.ckSameDayWithSymptomsUlnMultiple && muscle))) {
    raise(r, "orange", "ck_same_day", ["physician"]);
    r.mandatoryTemplateId = "NO_TITRATION";
  } else if (ckAskMuscle) r.reasons.push("ck_raised_no_muscle_symptoms");
  const signs = [sams.darkUrine, sams.fever, sams.jaundice];
  const sign = signs.some((s) => s === true);
  if (muscle) {
    raise(r, sign ? "red" : "orange", sign ? "sams_red" : "sams_orange", sign ? ["nurse", "physician"] : ["physician"]);
    r.mandatoryTemplateId = "NO_TITRATION";
    if (!sign && signs.some((s) => s === null)) {
      r.requiredUi.push("sams_questions");
      r.provisional = true;
    }
  } else if (sign) {
    // The prompt defines these signs only with muscle symptoms. Say so rather than look like nothing was found.
    r.reasons.push("sams_sign_without_muscle_rule_undefined");
  }
  if (ckAskMuscle && (sams.musclePain === null || sams.weakness === null)) {
    r.requiredUi.push("sams_questions");
    r.provisional = true;
  }
  if (sams.rightUpperPain === true) r.reasons.push("right_upper_pain_rule_undefined");
  return finish(r, "liver_muscle_no_zone_trigger");
}

export function evaluateGlycaemia({ hba1cPct, thirst, weightLoss, glucoseMmol }: {
  hba1cPct: number | null; thirst: Answer; weightLoss: Answer; glucoseMmol: number | null;
}): ZoneResult {
  const r = empty();
  if (!present(hba1cPct)) return finish(r, "hba1c_missing");
  if (hba1cPct < rules.glycaemia.hba1cPct) return finish(r, "glycaemia_no_zone_trigger");
  const signs = [thirst, weightLoss, present(glucoseMmol) ? glucoseMmol >= rules.glycaemia.symptomaticGlucoseMmol : null];
  const symptomatic = signs.includes(true);
  raise(r, symptomatic ? "orange" : "yellow", symptomatic ? "hba1c_high_symptoms" : "hba1c_high", ["physician"]);
  r.slaHours = symptomatic ? rules.glycaemia.symptomaticSlaHours : rules.glycaemia.slaHours;
  if (!symptomatic && signs.includes(null)) {
    r.requiredUi.push("hba1c_symptom_questions");
    r.provisional = true;
  }
  return r;
}

export function evaluateAdherence({ missedMeasurements, missedDoseDays, wantsToStopStatin }: {
  missedMeasurements: number | null; missedDoseDays: number | null; wantsToStopStatin: Answer;
}): ZoneResult {
  const r = empty();
  if (present(missedMeasurements) && missedMeasurements >= rules.adherence.missedMeasurements) raise(r, "yellow", "missed_measurements", ["nurse"]);
  if (present(missedDoseDays) && missedDoseDays >= rules.adherence.missedDoseDays) raise(r, "yellow", "missed_doses", ["nurse"]);
  if (wantsToStopStatin === true) raise(r, "yellow", "wants_to_stop_statin", ["nurse"]);
  return finish(r, "adherence_no_zone_trigger");
}

export function evaluateRetest({ weeksSinceChange, ldlAboveTarget, complaints }: {
  weeksSinceChange: number | null; ldlAboveTarget: Answer; complaints: Answer;
}): ZoneResult {
  const r = empty();
  if (present(weeksSinceChange) && weeksSinceChange >= rules.retest.fromWeeks && weeksSinceChange <= rules.retest.toWeeks && ldlAboveTarget === true && complaints === false)
    raise(r, "yellow", "ldl_retest_review", ["physician"]);
  return finish(r, "retest_criteria_not_met");
}

// Date-only inputs are already Asia/Yerevan calendar dates. UTC is used only
// as an arithmetic container, so the machine's local timezone never matters.
function calendarDate(on: string | null): Date | null {
  if (on === null || !/^\d{4}-\d{2}-\d{2}$/.test(on)) return null;
  const d = new Date(`${on}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === on ? d : null;
}

function plusMonths(d: Date, months: number): string {
  const day = d.getUTCDate();
  const end = new Date(d);
  end.setUTCDate(1);
  end.setUTCMonth(end.getUTCMonth() + months + 1);
  end.setUTCDate(0);
  end.setUTCDate(Math.min(day, end.getUTCDate()));
  return end.toISOString().slice(0, 10);
}

export function labIsFresh({ collectedOn, today, analyte, medicineChangedSince }: {
  collectedOn: string | null; today: string; analyte: string; medicineChangedSince: Answer;
}): { fresh: boolean; reason: string; ruleVersion: string; approval: "draft" | "approved" } {
  const collected = calendarDate(collectedOn);
  let reason: string;
  if (collectedOn === null) reason = "collection_date_missing";
  else if (!collected || !calendarDate(today)) reason = "lab_date_invalid";
  else if (collectedOn > today) reason = "collection_date_future";
  else if (medicineChangedSince !== false) reason = medicineChangedSince === true ? "medicine_changed" : "medicine_change_unknown";
  else {
    const months = rules.labFreshness.monthsByAnalyte[analyte] ?? rules.labFreshness.defaultMonths;
    reason = today <= plusMonths(collected, months) ? "fresh_result_available" : "lab_expired";
  }
  return { fresh: reason === "fresh_result_available", reason, ...provenance() };
}

type DrugClass = (typeof rules.postApproval)[keyof typeof rules.postApproval]["drugClasses"][number];
type LabFollowUp = { tests: string[]; fromOn: string; toOn: string; queue: "admin"; ruleVersion: string; approval: "draft" | "approved" };
export function postApprovalLabs(changes: readonly { drugClass: DrugClass; on: string }[]): LabFollowUp[] {
  return changes.map(({ drugClass, on }) => {
    const d = calendarDate(on);
    if (!d) throw new Error("Invalid medicine change date");
    const schedule = Object.values(rules.postApproval).find((s) => (s.drugClasses as readonly string[]).includes(drugClass));
    if (!schedule) throw new Error("Unsupported medicine class");
    const plusWeeks = (weeks: number) => {
      const day = new Date(d);
      day.setUTCDate(day.getUTCDate() + weeks * 7);
      return day.toISOString().slice(0, 10);
    };
    return { tests: [...schedule.tests], fromOn: plusWeeks(schedule.fromWeeks), toOn: plusWeeks(schedule.toWeeks), queue: "admin", ...provenance() };
  });
}

function instant(at: string): Date {
  const d = new Date(at);
  if (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(at) || !Number.isFinite(d.getTime())) throw new Error("Invalid ISO instant");
  return d;
}

export function isOutOfHours({ at, hours }: {
  at: string; hours: readonly { weekday: number; opens: string; closes: string }[];
}): boolean {
  const d = instant(at);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: rules.timeZone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(d);
  const part = (name: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === name)!.value;
  const weekday = new Date(`${part("year")}-${part("month")}-${part("day")}T00:00:00Z`).getUTCDay() || 7;
  const seconds = (s: string) => {
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(s)) throw new Error("Invalid clinic hours");
    const [h, m, sec = 0] = s.split(":").map(Number);
    return h * 3600 + m * 60 + sec;
  };
  const now = seconds(`${part("hour")}:${part("minute")}:${part("second")}`);
  // clinic_schedule_hours uses ISO weekdays (Monday first), and closes > opens.
  return !hours.some((h) => h.weekday === weekday && now >= seconds(h.opens) && now < seconds(h.closes));
}

export function outOfHoursDisclosure(zone: Urgency | null, outOfHours: boolean): boolean {
  return outOfHours && (zone === "orange" || zone === "red");
}

export function queueForTask(kind: "clinical" | "logistics"): ZoneResult["queues"] {
  return kind === "clinical" ? ["nurse", "physician"] : ["admin"];
}

export function slaDeadline({ slaHours }: Pick<ZoneResult, "slaHours">, atIso: string): string | null {
  return slaHours === null ? null : new Date(instant(atIso).getTime() + slaHours * 60 * 60 * 1000).toISOString();
}
