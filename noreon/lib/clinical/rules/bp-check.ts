import { THRESHOLD } from "./thresholds";

/**
 * The one blood pressure check, for every way a reading comes in: Zoe chat and Telegram text (lib/zoe/bp-chat.ts), the reading
 * form, the BP week and the chat cards (lib/patient/bp-after-save.ts), and the nurse and doctor screens (BpHighWarning). The
 * database's send to the doctor (_bp_check_level, 20261103100100_bp_one_rule.sql) repeats these cuts because a trigger cannot call
 * this file; scripts/check-bp-one-rule.ts fails if the two drift.
 *
 * Tasks 4 and 5 of Armen's 2 Nov list, and his answers in team group message 588: a confirmed reading in the band is a doctor
 * within 48 hours, 180/120 the same day, 103 only with symptoms. The re-measure wording is still STAGING. Either number counts
 * (answers file, item 15): systolic 180 or more, or diastolic 120 or more, is the same day, so 185/115 confirmed is the same day and
 * the 48-hour band is diastolic 110 to 119 with systolic below 180.
 */
export const BP_CHECK_VERSION = "bp-one-rule-1";

/** The rest before a repeat, and how long after the first reading a repeat still counts as one. */
export const BP_REPEAT = { restMinutes: 5, withinMinutes: 120 } as const;

export type BpNumbers = { systolic: number; diastolic: number };
/** minutesAgo: before the reading being checked. */
export type BpEarlier = BpNumbers & { minutesAgo: number };
export type BpSymptoms = "yes" | "no" | "unknown";
export type BpStep = "routine" | "remeasure" | "doctor_48h" | "doctor_today" | "call_103";

export const bpVeryHigh = (r: BpNumbers) => r.systolic >= THRESHOLD.crisisSystolic || r.diastolic >= THRESHOLD.crisisDiastolic;
export const bpDoctorToday = (r: BpNumbers) => r.systolic >= THRESHOLD.bpDoctorTodaySystolic || r.diastolic >= THRESHOLD.bpDoctorTodayDiastolic;
/** An earlier very high reading taken after the rest and inside the window makes this one a repeat. */
export const bpIsRepeat = (earlier: readonly BpEarlier[]) =>
  earlier.some(r => bpVeryHigh(r) && r.minutesAgo >= BP_REPEAT.restMinutes && r.minutesAgo <= BP_REPEAT.withinMinutes);

/**
 * Any symptom goes to 103 whatever else is known. Otherwise nothing is sent before a repeat: the first reading asks for rest and
 * a second one. Unknown symptoms on a repeat still send to the doctor, and every prompt names the symptoms.
 */
export function bpCheck(r: BpNumbers, c: { repeat: boolean; symptoms?: BpSymptoms }): BpStep {
  if (!bpVeryHigh(r)) return "routine";
  if (c.symptoms === "yes") return "call_103";
  if (!c.repeat) return "remeasure";
  return bpDoctorToday(r) ? "doctor_today" : "doctor_48h";
}
export const bpCheckReadings = (r: BpNumbers, earlier: readonly BpEarlier[], symptoms: BpSymptoms = "unknown") => bpCheck(r, { repeat: bpIsRepeat(earlier), symptoms });
/**
 * A first reading at the same-day cut does not vanish if nobody repeats it: a quiet note to the doctor at once, no alert and no 103
 * (lead, 2 Nov). The 180/110 band below that stays repeat-first. A repeat raises the alert in its place.
 */
export const bpQuietNote = (r: BpNumbers, step: BpStep) => step === "remeasure" && bpDoctorToday(r);
/** A step that asks the member to do something, so a save does not end on the ordinary saved line. */
export const bpNeedsAction = (s: BpStep | undefined) => !!s && s !== "routine";
