import {isUnverifiedBp} from "@/lib/patient/bp-provenance";
import type { Measurement } from "@/lib/patient/types";
import type { CareData } from "./types";
import type { ReminderPreferences } from "./reminder-preferences";
import { dailyReminders } from "./reminders";
import { dosesForDay } from "./model";

/** Read-only presentation. Reminder preferences never become clinical targets. */
export function homeDashboard(
  care: CareData,
  readings: Measurement[],
  preferences: ReminderPreferences,
  now: Date,
) {
  const measurements = readings
    .filter((row) => !isUnverifiedBp(row) && Date.parse(row.measuredAt) <= now.getTime())
    .toSorted((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt));
  const today = dosesForDay(care, now);
  // A completed day advances to tomorrow's actual prescription, not a fabricated schedule.
  const medicine =
    today.find((d) => d.status === "due" || d.status === "upcoming") ??
    dosesForDay(care, new Date(now.getTime() + 86400000)).find(
      (d) => d.status === "due" || d.status === "upcoming",
    ) ??
    null;
  const normalizedMedicine = medicine
    ? {
        ...medicine,
        status:
          Date.parse(medicine.dueAt) > now.getTime()
            ? ("upcoming" as const)
            : medicine.status,
      }
    : null;
  const bpToday = dailyReminders(care, measurements, preferences, now).filter(
    (r) => r.kind === "blood-pressure",
  );
  const bp =
    bpToday.find((r) => r.status === "due" || r.status === "upcoming") ??
    dailyReminders(
      care,
      measurements,
      preferences,
      new Date(now.getTime() + 86400000),
    ).find(
      (r) =>
        r.kind === "blood-pressure" &&
        (r.status === "due" || r.status === "upcoming"),
    ) ??
    null;
  return {
    medicine: normalizedMedicine,
    bp,
    measurements,
    latest: measurements.at(-1) ?? null,
    completed:
      today.filter((d) => d.status === "taken").length +
      bpToday.filter((r) => r.status === "completed").length,
    total: today.length + bpToday.length,
    medicineTaken: today.filter((d) => d.status === "taken").length,
    medicineTotal: today.length,
    bpCompleted: bpToday.filter((r) => r.status === "completed").length,
    bpTotal: bpToday.length,
  };
}
