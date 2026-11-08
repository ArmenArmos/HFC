/**
 * A reading's measured time may run at most this far ahead of the server clock (device clock
 * skew). The database trigger on patient_measurements uses the same 5 minutes. Compare
 * instants, never calendar dates in UTC against Asia/Yerevan.
 */
export const FUTURE_TOLERANCE_MS = 5 * 60_000;

/** True when the ISO instant is more than the tolerance ahead of now (or unparsable). */
export function isFutureMeasurement(measuredAt: string, now: number = Date.now()): boolean {
  const at = Date.parse(measuredAt);
  return !Number.isFinite(at) || at > now + FUTURE_TOLERANCE_MS;
}

/** Readings that clinical logic may use: measured at or before now. Future-dated rows are ignored. */
export function pastReadings<T extends { measuredAt: string }>(rows: readonly T[], now: number = Date.now()): T[] {
  return rows.filter((r) => { const at = Date.parse(r.measuredAt); return Number.isFinite(at) && at <= now; });
}

/** Armenia (UTC+4 all year) wall-clock "YYYY-MM-DDTHH:mm" for a datetime-local max. */
export function armeniaLocalNow(now: number = Date.now()): string {
  return new Date(now + 4 * 3600000).toISOString().slice(0, 16);
}
