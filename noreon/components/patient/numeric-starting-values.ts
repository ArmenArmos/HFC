// Where an unanswered number control starts: the unset slider's thumb, the
// first arrow key and the first − or + press. A typical adult value, so the
// member moves a short way instead of from the lower bound.
//
// UI only. These are never saved and never reach a rule: the answer stays
// empty (UNKNOWN when declined) until the member acts. They are not clinical
// thresholds and must not be read as normal ranges.
export const NUMERIC_STARTING_VALUES: Readonly<Record<string, number>> = {
  "q1.age": 40,
  "q2.height": 170,
  "q2.weight": 75,
  "q2.waist": 90,
  "q2.activity_minutes": 150,
  "q3.years": 10,
  "q3.per_day": 10,
  "q3.quit_years_ago": 5,
  "q4.volume_ml": 330,
  "q5.last_reading.systolic": 120,
  "q5.last_reading.diastolic": 80,
  "q6.diabetes_years": 5,
  "q6.hba1c": 5.5,
  "q8.sleep_quality": 5,
  "q8.sleep_hours": 7,
  "q8.neck": 38,
};

/** The listed value inside the bounds, else the snapped midpoint. Never the lower bound by default. */
export function numericStartingValue(id: string, min?: number, max?: number, step = 1): number | undefined {
  const listed = NUMERIC_STARTING_VALUES[id];
  const clamp = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  if (listed !== undefined) return clamp(listed);
  if (min === undefined || max === undefined) return undefined;
  return Number(clamp(min + Math.round((max - min) / 2 / step) * step).toFixed(6));
}
