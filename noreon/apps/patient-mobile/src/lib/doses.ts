import {
  armeniaDate,
  canReportDose,
  dosesForDay,
} from "../../../../lib/patient-care/model.ts";
import type {
  CareData,
  DoseEvent,
  DueDose,
} from "../../../../lib/patient-care/types";
import type { Database } from "../../../../lib/db/types";
type Tables = Database["public"]["Tables"];
type Plan = Pick<
  Tables["patient_care_plans"]["Row"],
  "id" | "clinician" | "instructions" | "published_at" | "acknowledged_at"
>;
type Medicine = Pick<
  Tables["patient_care_medications"]["Row"],
  "id" | "name" | "dose" | "instructions" | "times" | "start_date" | "end_date"
>;
type Event = Pick<
  Tables["patient_dose_events"]["Row"],
  "medication_id" | "due_at" | "status" | "revision" | "recorded_at"
>;
export function nativeDoseCare(
  plan: Plan | null,
  medications: Medicine[],
  events: Event[],
): CareData {
  if (
    events.some(
      (e) =>
        !["taken", "skipped"].includes(e.status) ||
        !Number.isSafeInteger(e.revision) ||
        e.revision < 1,
    )
  )
    throw Error("Records unavailable");
  return {
    tests: [],
    results: [],
    appointments: [],
    plan: plan
      ? {
          id: plan.id,
          clinician: plan.clinician,
          instructions: plan.instructions,
          publishedAt: plan.published_at,
          acknowledgedAt: plan.acknowledged_at,
          medications: medications.map((m) => ({
            id: m.id,
            planId: plan.id,
            name: m.name,
            dose: m.dose,
            instructions: m.instructions,
            times: m.times.map((t) => t.slice(0, 5)),
            startDate: m.start_date,
            endDate: m.end_date,
            active: true,
          })),
        }
      : null,
    events: events.map((e) => ({
      medicationId: e.medication_id,
      dueAt: e.due_at,
      status: e.status as DoseEvent["status"],
      revision: e.revision,
      recordedAt: e.recorded_at,
    })),
  };
}
export function nativeDoses(care: CareData, now: Date, offset: -15 | 0 | 15) {
  const today = dosesForDay(care, now);
  // A +15 reminder can keep the preceding day's final dose reportable after midnight.
  const previous = dosesForDay(care, new Date(now.getTime() - 86400000)).filter(
    (d) => canReportDose(care, d.medication.id, d.dueAt, now, offset),
  );
  return [...previous, ...today].map((dose) => ({
    dose: {
      ...dose,
      status: (dose.status === "taken" || dose.status === "skipped"
        ? dose.status
        : Date.parse(dose.dueAt) <= now.getTime()
          ? "due"
          : "upcoming") as DueDose["status"],
    },
    canReport: canReportDose(care, dose.medication.id, dose.dueAt, now, offset),
  }));
}
export function doseReadWindow(now: Date) {
  const start = Date.parse(`${armeniaDate(now)}T00:00:00+04:00`);
  return {
    from: new Date(start - 86400000).toISOString(),
    to: new Date(start + 86400000).toISOString(),
  };
}
export function reminderOffset(value: unknown): -15 | 0 | 15 {
  if (!value || typeof value !== "object") return 0;
  const offset = (value as Record<string, unknown>).medicationOffsetMinutes;
  return offset === -15 || offset === 15 ? offset : 0;
}
export type DoseDraft = {
  medicationId: string;
  dueAt: string;
  status: "taken" | "skipped";
  revision: number;
};
export type DoseOutcome = "saved" | "conflict" | "invalid" | "unavailable";
export async function submitDose(
  input: DoseDraft,
  run: (
    input: DoseDraft,
  ) => PromiseLike<{ data: number | null; error: { message: string } | null }>,
): Promise<DoseOutcome> {
  if (
    !Number.isSafeInteger(input.revision) ||
    input.revision < 0 ||
    !["taken", "skipped"].includes(input.status) ||
    !Number.isFinite(Date.parse(input.dueAt))
  )
    return "invalid";
  try {
    const result = await run(input);
    if (!result.error && Number.isSafeInteger(result.data) && result.data! > 0)
      return "saved";
    if (result.error?.message === "dose revision conflict") return "conflict";
    if (
      [
        "invalid dose report",
        "dose outside schedule",
        "medication unavailable",
        "plan unavailable",
      ].includes(result.error?.message ?? "")
    )
      return "invalid";
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export function doseSnapshotUsable(readAt: string, now: Date, failed: boolean) {
  const at = new Date(readAt);
  return (
    !failed &&
    Number.isFinite(at.getTime()) &&
    armeniaDate(at) === armeniaDate(now)
  );
}
