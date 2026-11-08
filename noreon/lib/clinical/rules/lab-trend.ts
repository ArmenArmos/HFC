import { THRESHOLD as T } from "./thresholds";

/**
 * LDL-C trends for the physician queue (app/api/internal/clinical-anomalies). Pure. Takes the counted observations that
 * lib/ldl/status.ts ldlObservations() produced (catalogue-matched, converted to mmol/L, plausible), oldest first, and the
 * physician's goal. Findings are yellow physician tasks, never alerts. Cuts are in THRESHOLD (draft, pending sign-off).
 * The window of each finding is the newest observation it is about, so one result raises one task.
 */
export const LAB_TREND_VERSION = "lab-trend-1";
export const LAB_TREND_RULES = ["lab_trend.ldl_rising", "lab_trend.ldl_not_at_goal"] as const;
export type LabTrendRuleId = (typeof LAB_TREND_RULES)[number];
export type LdlPoint = { id: string; mmol: number; on: string; counts: boolean };
export type LabTrendFinding = { ruleId: LabTrendRuleId; queue: "physician"; zone: "yellow"; window: string; facts: Record<string, number> };

const WEEK = 7 * 86_400_000;

export function detectLdlTrends(points: readonly LdlPoint[], goal: { thresholdMmol: number; setAt: string; version: number } | null, now: Date): LabTrendFinding[] {
  const counted = points.filter(p => p.counts && Number.isFinite(p.mmol) && /^\d{4}-\d{2}-\d{2}$/.test(p.on) && Date.parse(`${p.on}T00:00:00Z`) <= now.getTime());
  const found: LabTrendFinding[] = [];
  const latest = counted.at(-1);
  if (!latest) return found;
  const previous = counted.filter(p => p.on < latest.on).at(-1);
  if (previous) {
    // Compared in hundredths, so 2.6 - 2.3 is a rise of 0.3 and not 0.29999.
    const rise = Math.round(latest.mmol * 100) - Math.round(previous.mmol * 100);
    if (rise >= Math.round(T.labTrendLdlRiseMmol * 100))
      found.push({ ruleId: "lab_trend.ldl_rising", queue: "physician", zone: "yellow", window: latest.id, facts: { riseMmol: rise / 100 } });
  }
  if (goal && Number.isFinite(goal.thresholdMmol)) {
    const setAt = Date.parse(goal.setAt);
    if (Number.isFinite(setAt) && now.getTime() - setAt >= T.labTrendLdlNotAtGoalWeeks * WEEK && latest.mmol >= goal.thresholdMmol)
      found.push({ ruleId: "lab_trend.ldl_not_at_goal", queue: "physician", zone: "yellow", window: `g${goal.version}:${latest.id}`, facts: { weeksSinceGoal: Math.floor((now.getTime() - setAt) / WEEK) } });
  }
  return found;
}
