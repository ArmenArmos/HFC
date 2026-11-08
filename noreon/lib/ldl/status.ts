import { analyteByKey, matchAnalyte, toCanonical } from "@/lib/lab-ai/catalogue";
import { LDL_ASCVD_EVENTS, LDL_AT_GOAL_REQUIRES_REDUCTION, LDL_PILOT_EXCLUDED_EVENTS, LDL_STATUS_SOURCES, type LdlCategory } from "./constants";

/**
 * The one place that decides the LDL goal status (lib/ldl/constants.ts holds every default). Pure: it reads
 * what doctor_ldl_read / member_ldl_read return and computes the latest value, the baseline, the reduction and
 * the status. Values are compared unrounded; rounding is for display only.
 */
export type LdlSource = "member" | "upload_checked" | "clinic_result" | "clinic_reviewed";
export type RawLdlObservation = { id: string; value: number; unit: string; on: string; source: LdlSource; name: string | null; memberVisible: boolean };
export type LdlObservation = { id: string; mmol: number; on: string; source: LdlSource; memberVisible: boolean; counts: boolean };
export type LdlBaseline = { kind: "pre_treatment" | "on_treatment" | "unknown"; mmol: number | null; on: string | null; source: "document" | "lab_result" | "doctor_entered" | null };
export type LdlGoal = { version: number; category: LdlCategory; thresholdMmol: number; reductionRule: boolean; reductionPct: number | null; baseline: LdlBaseline; nextTestOn: string | null; setAt: string };

export type LdlStatus = "goal_not_set" | "not_assessable" | "at_goal" | "above_goal";
export type LdlReduction =
  | { state: "not_applicable" }
  /** baseline_unknown: no documented untreated value; on_treatment: the baseline was already on treatment;
   * no_later_value: nothing counted after the baseline date. A percentage is never imputed. */
  | { state: "not_assessable"; why: "baseline_unknown" | "on_treatment" | "no_later_value" }
  | { state: "met" | "not_met"; percent: number; requiredPct: number };
export type LdlAssessment = {
  status: LdlStatus;
  /** Every usable value, oldest first (the trend). */
  observations: LdlObservation[];
  /** The newest value that counts for the status, if any. */
  latest: LdlObservation | null;
  /** The newest value of any source, which may not count (shown, labelled). */
  newest: LdlObservation | null;
  reduction: LdlReduction;
  /** The documented baseline is already below the threshold: a % reduction is then a weak guide (doctor view). */
  baselineBelowThreshold: boolean;
};

const ldl = analyteByKey("ldl_c")!;
const sourceRank: Record<LdlSource, number> = { clinic_reviewed: 3, clinic_result: 2, upload_checked: 1, member: 0 };
const counted = new Set<LdlSource>(LDL_STATUS_SOURCES);
/**
 * Review and publication are separate. A clinic result not yet published holds no status where the read cannot tell whether a
 * doctor reviewed it (doctor_ldl_read) or the reader is a member. `reviewedList` is for a list already limited to reviewed
 * values (_ldl_response_observations): the response loop and the lipid planner, where such a result counts.
 */
export type LdlReadScope = { reviewedList?: boolean };
const countsFor = (r: RawLdlObservation, scope: LdlReadScope) => counted.has(r.source) && (scope.reviewedList === true || !(r.source === "clinic_result" && !r.memberVisible));
const isDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * Usable LDL values: a clinic result must name LDL-C in the lab catalogue; the unit must convert to mmol/L;
 * the value must be plausible. Only an exactly equal value on the same day from two sources (a clinic reading
 * and its published copy, say) is one value, kept from the more authoritative source and visible to the member
 * if either copy is; different values are never merged. Order: day, then value, then source, then id, so the
 * result does not depend on input order.
 */
export function ldlObservations(raw: RawLdlObservation[], scope: LdlReadScope = {}): LdlObservation[] {
  const byKey = new Map<string, LdlObservation>();
  for (const r of raw) {
    if (!Number.isFinite(r.value) || !isDay(r.on)) continue;
    if ((r.source === "clinic_result" || r.source === "clinic_reviewed") && r.name !== null && matchAnalyte(r.name) !== "ldl_c") continue;
    const converted = toCanonical(ldl, r.value, r.unit);
    if (converted === null || converted < ldl.plausible[0] || converted > ldl.plausible[1]) continue;
    // Floating-point noise only (2.4 * 1 stays 2.4); a lab's own precision is kept.
    const mmol = Number(converted.toPrecision(12));
    const o: LdlObservation = { id: r.id, mmol, on: r.on, source: r.source, memberVisible: r.memberVisible, counts: countsFor(r, scope) };
    const key = `${r.on}:${mmol}`;
    const prior = byKey.get(key);
    if (!prior) byKey.set(key, o);
    else {
      const keep = sourceRank[o.source] > sourceRank[prior.source] || (sourceRank[o.source] === sourceRank[prior.source] && o.id > prior.id) ? o : prior;
      byKey.set(key, { ...keep, counts: prior.counts || o.counts, memberVisible: prior.memberVisible || o.memberVisible });
    }
  }
  return [...byKey.values()].sort((a, b) => a.on.localeCompare(b.on) || a.mmol - b.mmol || sourceRank[a.source] - sourceRank[b.source] || a.id.localeCompare(b.id));
}

export function assessLdl(input: { goal: LdlGoal | null; observations: RawLdlObservation[] } & LdlReadScope): LdlAssessment {
  const observations = ldlObservations(input.observations, input);
  const newest = observations.at(-1) ?? null;
  // Newest by date; two different counted values on that day: the higher one (the sort puts it last), the
  // conservative choice until the clinicians say otherwise.
  const latest = observations.filter((o) => o.counts).at(-1) ?? null;
  const goal = input.goal;
  if (!goal) return { status: "goal_not_set", observations, latest, newest, reduction: { state: "not_applicable" }, baselineBelowThreshold: false };
  const reduction = reductionOf(goal, latest);
  const b = goal.baseline;
  const baselineBelowThreshold = b.kind === "pre_treatment" && b.mmol !== null && b.mmol < goal.thresholdMmol;
  if (!latest) return { status: "not_assessable", observations, latest, newest, reduction, baselineBelowThreshold };
  const belowThreshold = latest.mmol < goal.thresholdMmol;
  const status: LdlStatus = !LDL_AT_GOAL_REQUIRES_REDUCTION
    ? belowThreshold ? "at_goal" : "above_goal"
    : !belowThreshold ? "above_goal" : reduction.state === "not_met" ? "above_goal" : reduction.state === "not_assessable" ? "not_assessable" : "at_goal";
  return { status, observations, latest, newest, reduction, baselineBelowThreshold };
}

function reductionOf(goal: LdlGoal, latest: LdlObservation | null): LdlReduction {
  if (!goal.reductionRule || goal.reductionPct === null) return { state: "not_applicable" };
  const b = goal.baseline;
  if (b.kind === "on_treatment") return { state: "not_assessable", why: "on_treatment" };
  if (b.kind === "unknown" || b.mmol === null || b.on === null || b.mmol <= 0) return { state: "not_assessable", why: "baseline_unknown" };
  if (!latest || latest.on <= b.on) return { state: "not_assessable", why: "no_later_value" };
  const percent = (1 - latest.mmol / b.mmol) * 100;
  return { state: percent >= goal.reductionPct ? "met" : "not_met", percent, requiredPct: goal.reductionPct };
}

/**
 * Task 19 (rules not signed yet): who the LDL pilot is for, as _ldl_pilot_excluded decides it in SQL. A haemorrhagic stroke with no
 * qualifying event excludes; with a heart attack or an ischaemic event as well the member is eligible and the doctor is warned. "other"
 * does not qualify. The stored type does not say whether an ischaemic stroke was atherosclerotic: rule LR-14's question asks that.
 */
export function ldlPilotEligibility(events: readonly { type: string }[]): "eligible" | "eligible_with_warning" | "excluded" | "unknown" {
  const haemorrhagic = events.some((e) => (LDL_PILOT_EXCLUDED_EVENTS as readonly string[]).includes(e.type));
  const qualifying = events.some((e) => (LDL_ASCVD_EVENTS as readonly string[]).includes(e.type));
  return qualifying ? (haemorrhagic ? "eligible_with_warning" : "eligible") : haemorrhagic ? "excluded" : "unknown";
}
/** The reduction is a part of the goal the member sees only when it can be judged: with no pre-treatment value they see only the threshold. */
export const ldlReductionShown = (goal: { reductionRule: boolean; reductionPct: number | null }, a: LdlAssessment) =>
  goal.reductionRule && goal.reductionPct !== null && !(a.reduction.state === "not_assessable" && a.reduction.why !== "no_later_value");
/** Below the threshold and the reduction judged and short: not "below your goal". */
export const ldlOnePartMet = (a: LdlAssessment) => a.status === "at_goal" && a.reduction.state === "not_met";

/**
 * Display only, never fed back into a comparison. mmol/L with as few decimals as possible (at least one), but
 * enough that the shown number sits on the same side of the threshold as the real one: 1.36 against 1.4 shows
 * "1.36", not "1.4" next to "below your goal of 1.4".
 */
export function formatMmol(mmol: number, thresholdMmol?: number) {
  for (let d = 1; d <= 6; d++) {
    const shown = Number(mmol.toFixed(d));
    if (thresholdMmol === undefined || (shown < thresholdMmol) === (mmol < thresholdMmol)) return mmol.toFixed(d);
  }
  // Closer than a millionth: the full value (ldlObservations keeps 12 significant digits).
  return String(Number(mmol.toPrecision(12)));
}
/** A whole percentage, but never rounded up to the required one: 49.6 against 50 shows "49". */
export function formatPercent(percent: number, requiredPct?: number) {
  const r = Math.round(percent);
  return String(requiredPct !== undefined && r >= requiredPct && percent < requiredPct ? Math.floor(percent) : r);
}
