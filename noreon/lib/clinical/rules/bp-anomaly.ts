import { THRESHOLD as T } from "./thresholds";
import { aboveTarget, DEFAULT_PERSONAL_BP_TARGET, type PersonalBpTarget } from "./personal-bp";
import { bpVeryHigh } from "./bp-check";

/**
 * Trends in home BP against the member's own target, for the care team's queue (app/api/internal/clinical-anomalies). Pure.
 * Findings become yellow or orange care-queue tasks, never care alerts: the emergency rules (bp-check, zone rules) own every
 * red decision, and a crisis-band reading is never re-labelled here. Every cut is in THRESHOLD (draft, pending sign-off).
 * Each finding names a window, so the sweep raises one task per member, rule and window however often it runs.
 */
export const BP_ANOMALY_VERSION = "bp-anomaly-1";
export const BP_ANOMALY_RULES = [
  "bp_anomaly.sustained_above_target",
  "bp_anomaly.sudden_rise",
  "bp_anomaly.high_variability",
  "bp_anomaly.low_with_symptoms",
  "bp_anomaly.low_symptoms_unknown",
] as const;
export type BpAnomalyRuleId = (typeof BP_ANOMALY_RULES)[number];
export type BpAnomalyReading = { systolic: number; diastolic: number; pulse: number | null; measuredAt: string; symptoms?: boolean | "unknown" };
export type BpAnomaly = { ruleId: BpAnomalyRuleId; queue: "nurse" | "physician"; zone: "yellow" | "orange"; window: string; facts: Record<string, number> };

const DAY = 86_400_000;
/** The Asia/Yerevan calendar day (UTC+4, no daylight saving). */
const yerevanDay = (ms: number) => new Date(ms + 4 * 3_600_000).toISOString().slice(0, 10);
const dayIndex = (ms: number) => Math.floor((ms + 4 * 3_600_000) / DAY);
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

function usable(readings: readonly BpAnomalyReading[], now: Date) {
  return readings
    .map(r => ({ ...r, at: Date.parse(r.measuredAt) }))
    .filter(r => Number.isFinite(r.at) && r.at <= now.getTime() && Number.isFinite(r.systolic) && Number.isFinite(r.diastolic) && r.systolic > 0 && r.diastolic > 0)
    .sort((a, b) => a.at - b.at);
}

export function detectBpAnomalies(readings: readonly BpAnomalyReading[], target: PersonalBpTarget | null, now: Date): BpAnomaly[] {
  const t = target ?? DEFAULT_PERSONAL_BP_TARGET;
  const rows = usable(readings, now);
  const today = dayIndex(now.getTime());
  const found: BpAnomaly[] = [];
  // Fixed windows keyed by their first day, so a daily sweep finds the same window again rather than a new one.
  const bucket = (days: number) => yerevanDay((Math.floor(today / days) * days) * DAY - 4 * 3_600_000);

  // 1. Sustained: the day's mean above the target on N of the last M days.
  const sustained = rows.filter(r => dayIndex(r.at) > today - T.bpAnomalySustainedWindowDays);
  const byDay = new Map<number, typeof rows>();
  for (const r of sustained) byDay.set(dayIndex(r.at), [...(byDay.get(dayIndex(r.at)) ?? []), r]);
  const daysAbove = [...byDay.values()].filter(day => aboveTarget({ systolic: mean(day.map(r => r.systolic)), diastolic: mean(day.map(r => r.diastolic)) }, t)).length;
  if (daysAbove >= T.bpAnomalySustainedDays)
    found.push({ ruleId: "bp_anomaly.sustained_above_target", queue: "physician", zone: "yellow", window: bucket(T.bpAnomalySustainedWindowDays), facts: { daysAbove, daysMeasured: byDay.size } });

  // 2. Sudden rise: the recent mean against the member's own baseline just before it.
  const recent = rows.filter(r => dayIndex(r.at) > today - T.bpAnomalyRiseRecentDays);
  const baseline = rows.filter(r => dayIndex(r.at) <= today - T.bpAnomalyRiseRecentDays && dayIndex(r.at) > today - T.bpAnomalyRiseRecentDays - T.bpAnomalyRiseBaselineDays);
  if (recent.length >= T.bpAnomalyRiseMinRecent && baseline.length >= T.bpAnomalyRiseMinBaseline) {
    // Integer sums across denominators, as bp-trend.ts: a mean difference just under the cut must not round up.
    const rise = recent.reduce((s, r) => s + r.systolic, 0) * baseline.length - baseline.reduce((s, r) => s + r.systolic, 0) * recent.length;
    if (rise >= T.bpAnomalyRiseSystolic * recent.length * baseline.length)
      found.push({ ruleId: "bp_anomaly.sudden_rise", queue: "physician", zone: "yellow", window: bucket(T.bpAnomalyRiseRecentDays), facts: { riseSystolic: Math.round(rise / (recent.length * baseline.length)) } });
  }

  // 3. Variability: the spread of systolic readings over the window.
  const spread = rows.filter(r => dayIndex(r.at) > today - T.bpAnomalyVariabilityDays);
  if (spread.length >= T.bpAnomalyVariabilityMinReadings) {
    const m = mean(spread.map(r => r.systolic));
    const sd = Math.sqrt(spread.reduce((s, r) => s + (r.systolic - m) ** 2, 0) / (spread.length - 1));
    if (sd >= T.bpAnomalyVariabilitySdSystolic)
      found.push({ ruleId: "bp_anomaly.high_variability", queue: "nurse", zone: "yellow", window: bucket(T.bpAnomalyVariabilityDays), facts: { sdSystolic: Math.round(sd) } });
  }

  // 4. Low readings: with symptoms the nurse checks the same day; with symptoms unknown the nurse asks.
  const low = rows.filter(r => dayIndex(r.at) > today - T.bpAnomalyLowWindowDays && !bpVeryHigh(r)
    && (r.systolic <= t.alertLowSystolic || (r.pulse !== null && Number.isFinite(r.pulse) && r.pulse > 0 && r.pulse <= t.alertLowPulse)));
  if (low.some(r => r.symptoms === true))
    found.push({ ruleId: "bp_anomaly.low_with_symptoms", queue: "nurse", zone: "orange", window: bucket(T.bpAnomalyLowWindowDays), facts: { lowReadings: low.length } });
  else if (low.length >= T.bpAnomalyLowReadings)
    found.push({ ruleId: "bp_anomaly.low_symptoms_unknown", queue: "nurse", zone: "yellow", window: bucket(T.bpAnomalyLowWindowDays), facts: { lowReadings: low.length } });
  return found;
}
