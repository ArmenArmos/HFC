import { THRESHOLD } from "./thresholds";
import { bpVeryHigh } from "./bp-check";

/**
 * A home reading against the member's own target and the alert thresholds their physician set (member_bp_targets). With no
 * target on file the THRESHOLD defaults apply (usedPersonalTarget false). Pure and framework-free.
 *
 * The emergency rules come first and are never weakened: a reading in the crisis band (bp-check.ts, bpVeryHigh) is left to
 * the existing BP check, zone rules and 103 route, and this function only says so (ruleId personal_bp.crisis_band). A personal
 * threshold can add a same-day nurse task; it can never remove or soften one.
 *
 * Unknown is never normal: a missing or malformed number is "unknown", and a low reading whose symptoms are not known is
 * "unknown" rather than at target, because the low alert depends on the symptoms.
 */
export const PERSONAL_BP_VERSION = "personal-bp-1";
/** Stored with each physician confirmation: the defaults the form proposed. Bump when a THRESHOLD.personalBp* value changes. */
export const PERSONAL_BP_DEFAULTS_VERSION = "personal-bp-defaults-2026-11-08";

export type PersonalBpTarget = {
  homeSystolicTarget: number;
  homeDiastolicTarget: number;
  alertHighSystolic: number;
  alertHighDiastolic: number;
  alertHighConsecutive: number;
  alertLowSystolic: number;
  alertLowPulse: number;
};
export type PersonalBpReading = { systolic: number; diastolic: number; pulse: number | null; symptoms: boolean | "unknown" };
export type PersonalBpStatus = "at_target" | "above_target" | "alert_high" | "alert_low" | "unknown";
export const PERSONAL_BP_RULES = [
  "personal_bp.unknown",
  "personal_bp.crisis_band",
  "personal_bp.low_with_symptoms",
  "personal_bp.low_symptoms_unknown",
  "personal_bp.alert_high",
  "personal_bp.above_target",
  "personal_bp.at_target",
] as const;
export type PersonalBpRuleId = (typeof PERSONAL_BP_RULES)[number];
export type PersonalBpResult = { status: PersonalBpStatus; ruleId: PersonalBpRuleId; usedPersonalTarget: boolean };

/** The THRESHOLD defaults, in the shape of a stored target. */
export const DEFAULT_PERSONAL_BP_TARGET: PersonalBpTarget = {
  homeSystolicTarget: THRESHOLD.personalBpTargetSystolic,
  homeDiastolicTarget: THRESHOLD.personalBpTargetDiastolic,
  alertHighSystolic: THRESHOLD.personalBpAlertHighSystolic,
  alertHighDiastolic: THRESHOLD.personalBpAlertHighDiastolic,
  alertHighConsecutive: THRESHOLD.personalBpAlertHighConsecutive,
  alertLowSystolic: THRESHOLD.personalBpAlertLowSystolic,
  alertLowPulse: THRESHOLD.personalBpAlertLowPulse,
};

const known = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
const usable = (r: Pick<PersonalBpReading, "systolic" | "diastolic">) => known(r.systolic) && known(r.diastolic);

/** At or above either alert number. */
export const inAlertHighRange = (r: Pick<PersonalBpReading, "systolic" | "diastolic">, t: PersonalBpTarget) =>
  r.systolic >= t.alertHighSystolic || r.diastolic >= t.alertHighDiastolic;
/** At or above either target number: "below the target" means below both. */
export const aboveTarget = (r: Pick<PersonalBpReading, "systolic" | "diastolic">, t: PersonalBpTarget) =>
  r.systolic >= t.homeSystolicTarget || r.diastolic >= t.homeDiastolicTarget;
export const inLowRange = (r: Pick<PersonalBpReading, "systolic" | "pulse">, t: PersonalBpTarget) =>
  r.systolic <= t.alertLowSystolic || (known(r.pulse) && r.pulse <= t.alertLowPulse);

/**
 * previous: the member's earlier home readings, oldest first (the newest is the one just before this reading). A malformed
 * earlier reading ends the consecutive run, so it can never complete one.
 */
export function evaluatePersonalBp(reading: PersonalBpReading, previous: readonly PersonalBpReading[], target: PersonalBpTarget | null): PersonalBpResult {
  const usedPersonalTarget = target !== null;
  const t = target ?? DEFAULT_PERSONAL_BP_TARGET;
  const out = (status: PersonalBpStatus, ruleId: PersonalBpRuleId): PersonalBpResult => ({ status, ruleId, usedPersonalTarget });
  if (!usable(reading)) return out("unknown", "personal_bp.unknown");
  if (bpVeryHigh(reading)) return out("alert_high", "personal_bp.crisis_band");
  if (inLowRange(reading, t)) {
    if (reading.symptoms === true) return out("alert_low", "personal_bp.low_with_symptoms");
    if (reading.symptoms === "unknown") return out("unknown", "personal_bp.low_symptoms_unknown");
  }
  if (inAlertHighRange(reading, t)) {
    let run = 1;
    for (let i = previous.length - 1; i >= 0 && run < t.alertHighConsecutive; i--) {
      const p = previous[i];
      if (!usable(p) || !inAlertHighRange(p, t)) break;
      run++;
    }
    if (run >= t.alertHighConsecutive) return out("alert_high", "personal_bp.alert_high");
    return out("above_target", "personal_bp.above_target");
  }
  if (aboveTarget(reading, t)) return out("above_target", "personal_bp.above_target");
  return out("at_target", "personal_bp.at_target");
}

/** A clinician-set alert crossed that this function owns (the crisis band belongs to the emergency rules). */
export const personalAlertRaises = (r: PersonalBpResult) => (r.status === "alert_high" || r.status === "alert_low") && r.ruleId !== "personal_bp.crisis_band";

/** The newest readings above the target, counted back from the newest until one is not. */
export function aboveTargetStreak(readings: readonly Pick<PersonalBpReading, "systolic" | "diastolic">[], target: PersonalBpTarget | null): number {
  const t = target ?? DEFAULT_PERSONAL_BP_TARGET;
  let n = 0;
  for (let i = readings.length - 1; i >= 0; i--) {
    const r = readings[i];
    if (!usable(r) || !aboveTarget(r, t)) break;
    n++;
  }
  return n;
}
