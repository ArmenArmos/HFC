import type { CareData, CareResult, DoseEvent } from "./types";
import { armeniaDate, dosesForDay } from "./model";
/** Counts only actual reports. Does not infer adherence or prescribed doses from missing data. */
export function medicineReportDays(
  events: (DoseEvent & { revision?: number })[],
  now: Date,
  care?: CareData,
) {
  const today = armeniaDate(now),
    end = Date.parse(`${today}T00:00:00+04:00`);
  const latest = new Map<string, DoseEvent & { revision?: number }>();
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00+04:00`)) && armeniaDate(new Date(`${day}T12:00:00+04:00`)) === day;
  const active = care?.plan?.medications.filter(m => m.active && m.planId === care.plan!.id) ?? [];
  const valid = active.filter(m => validDay(m.startDate) && (!m.endDate || (validDay(m.endDate) && m.endDate >= m.startDate)) && m.times.length > 0 && m.times.every(time => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) && Number.isFinite(Date.parse(m.effectiveAt ?? care!.plan!.publishedAt)));
  const scheduleUnknown = !care || valid.length !== active.length;
  // Use the same schedule/effective-publication boundary as dose entry. Cancelled
  // medicines cannot create inferred missing reports, but their real reports
  // remain in the independent event history below.
  const scheduledCare = care && { ...care, plan: care.plan && { ...care.plan, medications: valid } };
  for (const e of events) {
    if (
      !Number.isFinite(Date.parse(e.dueAt)) ||
      !Number.isFinite(Date.parse(e.recordedAt)) ||
      Date.parse(e.dueAt) > now.getTime() ||
      Date.parse(e.recordedAt) > now.getTime()
    )
      continue;
    const key = JSON.stringify([e.medicationId, Date.parse(e.dueAt)]),
      old = latest.get(key);
    if (
      !old ||
      (e.revision ?? 0) > (old.revision ?? 0) ||
      ((e.revision ?? 0) === (old.revision ?? 0) &&
        Date.parse(e.recordedAt) > Date.parse(old.recordedAt))
    )
      latest.set(key, e);
  }
  return Array.from({ length: 28 }, (_, i) => {
    const day = armeniaDate(new Date(end - (27 - i) * 86400000));
    const reports = [...latest.values()].filter(
      (e) => armeniaDate(new Date(e.dueAt)) === day,
    );
    const scheduled = scheduledCare ? dosesForDay(scheduledCare, new Date(`${day}T12:00:00+04:00`)).length > 0 : false;
    return {
      day,
      schedule: scheduled ? "scheduled" as const : scheduleUnknown ? "unknown" as const : "not-scheduled" as const,
      taken: reports.filter((e) => e.status === "taken").length,
      skipped: reports.filter((e) => e.status === "skipped").length,
    };
  });
}
/** Describes the source laboratory's interval, never a clinical target or diagnosis. */
export function labRange(
  r: Pick<CareResult, "value" | "referenceLow" | "referenceHigh">,
): { status: "above" | "below" | "within" | "unknown"; position: number | null } {
  const low = r.referenceLow,
    high = r.referenceHigh;
  if (
    (low === null && high === null) ||
    (low !== null && high !== null && low >= high)
  )
    return { status: "unknown" as const, position: null };
  const status =
    low !== null && r.value < low
      ? "below"
      : high !== null && r.value > high
        ? "above"
        : "within";
  if (low === null || high === null) return { status, position: null };
  const span =
    low !== null && high !== null
      ? high - low
      : Math.max(Math.abs(low ?? high ?? 1), 1);
  const start = (low ?? high! - span) - span / 2,
    end = (high ?? low! + span) + span / 2;
  return {
    status,
    position: Math.max(
      0,
      Math.min(100, ((r.value - start) / (end - start)) * 100),
    ),
  };
}
