import { THRESHOLD as T } from "./thresholds";
import { aboveTarget, DEFAULT_PERSONAL_BP_TARGET, inAlertHighRange, type PersonalBpTarget } from "./personal-bp";

/**
 * Deterministic member risk tier for ordering the care team's work. Not a diagnosis and never shown to the member. Every
 * point and cut is in THRESHOLD (draft, pending clinical sign-off). An unknown input is never read as a normal one: it adds
 * the small "unknown" points and its own reason, so a member with no data does not sink to the bottom of the list.
 */
export const RISK_TIER_VERSION = "risk-tier-1";
export const RISK_TIERS = ["very_high", "high", "moderate", "low"] as const;
export type RiskTier = (typeof RISK_TIERS)[number];
export const RISK_TIER_RULES = [
  "risk.open_urgent",
  "risk.red_flag",
  "risk.secondary_prevention",
  "risk.history_unknown",
  "risk.bp_alert_range",
  "risk.bp_above_target",
  "risk.bp_unknown",
  "risk.ldl_above_goal",
  "risk.ldl_unknown",
  "risk.adherence_low",
  "risk.contact_stale",
] as const;
export type RiskTierRuleId = (typeof RISK_TIER_RULES)[number];

export type RiskTierInput = {
  /** Prior MI, ischaemic stroke or revascularisation. "unknown" when no completed assessment or record says either way. */
  secondaryPrevention: boolean | "unknown";
  /** Mean of the last RISK window's home readings, or null when there are none. */
  bpAverage: { systolic: number; diastolic: number } | null;
  /** The member's physician-set target; null means the THRESHOLD defaults. */
  bpTarget: PersonalBpTarget | null;
  /** Latest counted LDL-C (mmol/L) and the physician's goal; null when either is missing. */
  ldlLatestMmol: number | null;
  ldlGoalMmol: number | null;
  /** Open care alerts plus open orange or red care-queue tasks. */
  openUrgent: number;
  /** Doses taken of doses expected over the window, as a percentage; null when nothing was expected. */
  adherencePct: number | null;
  /** A red flag from the questionnaire engine (the assessment's urgent rule). */
  redFlag: boolean;
  /** Days since the care team last reached the member; null when never. */
  daysSinceContact: number | null;
};
export type RiskTierResult = { tier: RiskTier; score: number; reasons: RiskTierRuleId[]; version: typeof RISK_TIER_VERSION };

export function riskTier(i: RiskTierInput): RiskTierResult {
  const reasons: RiskTierRuleId[] = [];
  let score = 0;
  const add = (rule: RiskTierRuleId, points: number) => { reasons.push(rule); score += points; };
  if (i.openUrgent > 0) add("risk.open_urgent", T.riskTierPointsOpenUrgent);
  if (i.redFlag) add("risk.red_flag", T.riskTierPointsRedFlag);
  if (i.secondaryPrevention === true) add("risk.secondary_prevention", T.riskTierPointsSecondaryPrevention);
  else if (i.secondaryPrevention === "unknown") add("risk.history_unknown", T.riskTierPointsUnknown);
  const target = i.bpTarget ?? DEFAULT_PERSONAL_BP_TARGET;
  const bp = i.bpAverage && Number.isFinite(i.bpAverage.systolic) && Number.isFinite(i.bpAverage.diastolic) ? i.bpAverage : null;
  if (!bp) add("risk.bp_unknown", T.riskTierPointsUnknown);
  else if (inAlertHighRange(bp, target)) add("risk.bp_alert_range", T.riskTierPointsBpAlertRange);
  else if (aboveTarget(bp, target)) add("risk.bp_above_target", T.riskTierPointsBpAboveTarget);
  if (i.ldlGoalMmol !== null) {
    if (i.ldlLatestMmol === null || !Number.isFinite(i.ldlLatestMmol)) add("risk.ldl_unknown", T.riskTierPointsUnknown);
    else if (i.ldlLatestMmol >= i.ldlGoalMmol) add("risk.ldl_above_goal", T.riskTierPointsLdlAboveGoal);
  }
  if (i.adherencePct !== null && i.adherencePct < T.riskTierAdherenceLowPct) add("risk.adherence_low", T.riskTierPointsAdherenceLow);
  if (i.daysSinceContact === null || i.daysSinceContact > T.riskTierContactStaleDays) add("risk.contact_stale", T.riskTierPointsContactStale);
  const tier: RiskTier = score >= T.riskTierVeryHighScore ? "very_high" : score >= T.riskTierHighScore ? "high" : score >= T.riskTierModerateScore ? "moderate" : "low";
  return { tier, score, reasons, version: RISK_TIER_VERSION };
}

/** Secondary prevention from the questionnaire conditions and the doctor's recorded index events. */
export function secondaryPrevention(conditions: readonly string[], events: readonly string[]): boolean | "unknown" {
  if (conditions.includes("ascvd") || conditions.includes("stroke") || events.includes("acs_mi") || events.includes("ischaemic_stroke")) return true;
  return conditions.length === 0 && events.length === 0 ? "unknown" : false;
}

const DAY = 86_400_000;
/** The mean of the readings in the last `days` days (default the risk window), or null when there are none. */
export function bpAverage(readings: readonly { systolic: number; diastolic: number; measuredAt: string }[], now: Date, days: number = T.riskTierWindowDays) {
  const since = now.getTime() - days * DAY;
  const rows = readings.filter(r => {
    const at = Date.parse(r.measuredAt);
    return Number.isFinite(at) && at > since && at <= now.getTime() && Number.isFinite(r.systolic) && Number.isFinite(r.diastolic) && r.systolic > 0 && r.diastolic > 0;
  });
  if (!rows.length) return null;
  return { systolic: rows.reduce((s, r) => s + r.systolic, 0) / rows.length, diastolic: rows.reduce((s, r) => s + r.diastolic, 0) / rows.length };
}

/** Whole days between an instant and now; null for no contact. */
export const daysSince = (at: string | null, now: Date) => {
  if (!at) return null;
  const t = Date.parse(at);
  return Number.isFinite(t) ? Math.max(0, Math.floor((now.getTime() - t) / DAY)) : null;
};
