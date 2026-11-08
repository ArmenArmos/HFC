import {isUnverifiedBp} from "@/lib/patient/bp-provenance";
import type { Measurement } from "@/lib/patient/types";
import { armeniaDate } from "@/lib/patient-care/model";
/** Descriptive recorded-value summary, not a diagnostic BP protocol. */
export function measurementOverview(rows: Measurement[], now: Date) {
  const today = armeniaDate(now);
  const midnight = Date.parse(`${today}T00:00:00+04:00`);
  const start = midnight - 6 * 86400000;
  const included = rows.filter(
    (r) =>
      !isUnverifiedBp(r) &&
      Date.parse(r.measuredAt) >= start &&
      Date.parse(r.measuredAt) <= now.getTime(),
  );
  const days = Array.from({ length: 7 }, (_, i) => {
    const day = armeniaDate(new Date(start + i * 86400000));
    return {
      day,
      count: included.filter((r) => armeniaDate(new Date(r.measuredAt)) === day)
        .length,
    };
  });
  return {
    average: included.length
      ? {
          systolic: Math.round(
            included.reduce((sum, r) => sum + r.systolic, 0) / included.length,
          ),
          diastolic: Math.round(
            included.reduce((sum, r) => sum + r.diastolic, 0) / included.length,
          ),
        }
      : null,
    count: included.length,
    todayCount: days[6].count,
    days,
  };
}
