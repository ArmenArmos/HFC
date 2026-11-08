import {isUnverifiedBp} from "@/lib/patient/bp-provenance";
import { z } from "zod";

/** D1, the 7-day home BP week. The database fixes 7 days, 2 slots and 2 readings per slot. */
export const SLOTS = ["morning", "evening"] as const;
export type Slot = (typeof SLOTS)[number];

const reading = z.object({
  entrySource: z.string().nullable().optional(),
  id: z.uuid(),
  day: z.number().int().min(1).max(7),
  slot: z.enum(SLOTS),
  systolic: z.number().int(),
  diastolic: z.number().int(),
  pulse: z.number().int().nullable(),
  measuredAt: z.string(),
});
const device = z.object({ model: z.string(), serial: z.string(), since: z.string(), endedAt: z.string().nullable().optional() });
export const weekSchema = z.object({
  id: z.uuid(),
  startsOn: z.string(),
  days: z.literal(7),
  readingsPerSlot: z.literal(2),
  morningTime: z.string().regex(/^\d{2}:\d{2}$/),
  eveningTime: z.string().regex(/^\d{2}:\d{2}$/),
  reminders: z.boolean(),
  startedByRole: z.enum(["member", "nurse", "doctor"]),
  createdAt: z.string(),
  stoppedAt: z.string().nullable(),
  stopReason: z.string().nullable(),
  device: device.nullable(),
  readings: z.array(reading),
});
export const bpWeekReadSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal("bp-week-v1"), enabled: z.literal(false) }),
  z.object({
    version: z.literal("bp-week-v1"),
    enabled: z.literal(true),
    memberCanStart: z.boolean().optional(),
    today: z.string(),
    currentDevice: device.extend({ assignmentId: z.uuid().optional() }).nullable(),
    weeks: z.array(weekSchema),
  }),
]);
export type BpWeek = z.infer<typeof weekSchema>;
export type BpWeekRead = z.infer<typeof bpWeekReadSchema>;
export type BpReading = z.infer<typeof reading>;

const DAY = 86400000;
/** A Yerevan wall-clock time on a Yerevan date (Armenia keeps UTC+4 all year). */
export const yerevanInstant = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+04:00`);
export const yerevanDate = (at: Date) => new Date(at.getTime() + 4 * 3600000).toISOString().slice(0, 10);
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export type SlotState = "done" | "partial" | "due" | "upcoming" | "missed";
export type SlotView = { day: number; date: string; slot: Slot; time: string; readings: BpReading[]; state: SlotState };
export type WeekPhase = "not-started" | "running" | "finished" | "stopped";

export function weekPhase(week: BpWeek, now: Date): WeekPhase {
  if (week.stoppedAt) return "stopped";
  const today = yerevanDate(now);
  if (today < week.startsOn) return "not-started";
  return today > addDays(week.startsOn, week.days - 1) ? "finished" : "running";
}

/**
 * Every slot of the week. A slot is missed only once its day is over without its readings
 * (or the week was stopped first); before that it is due from its time and upcoming before.
 * A missing reading is never counted as a normal one: it is shown as missing.
 */
export function weekSlots(week: BpWeek, now: Date): SlotView[] {
  const today = yerevanDate(now), stopped = week.stoppedAt ? new Date(week.stoppedAt) : null;
  const out: SlotView[] = [];
  for (let day = 1; day <= week.days; day++) {
    const date = addDays(week.startsOn, day - 1);
    for (const slot of SLOTS) {
      const time = slot === "morning" ? week.morningTime : week.eveningTime;
      const readings = week.readings.filter(r => r.day === day && r.slot === slot);
      const at = yerevanInstant(date, time);
      const over = date < today || (stopped !== null && stopped <= at);
      const state: SlotState =
        readings.length >= week.readingsPerSlot ? "done"
          : over ? "missed"
            : readings.length > 0 ? "partial"
              : now >= at ? "due" : "upcoming";
      out.push({ day, date, slot, time, readings, state });
    }
  }
  return out;
}

export type WeekSummary = {
  expected: number;
  /** Verified readings eligible for the descriptive summary. */
  saved: number;
  reported: number;
  completeSlots: number;
  missedSlots: number;
  /** Plain mean of verified saved readings. Pending Armen: no averaging rule is approved. */
  plainAverage: { systolic: number; diastolic: number; count: number } | null;
};
export function weekSummary(week: BpWeek, now: Date): WeekSummary {
  const slots = weekSlots(week, now);
  const verified = week.readings.filter(r => !isUnverifiedBp(r));
  const n = verified.length;
  const mean = (k: "systolic" | "diastolic") => Math.round((verified.reduce((a, r) => a + r[k], 0) / n) * 10) / 10;
  return {
    expected: week.days * SLOTS.length * week.readingsPerSlot,
    saved: n,
    reported: week.readings.length - n,
    completeSlots: slots.filter(s => s.state === "done").length,
    missedSlots: slots.filter(s => s.state === "missed").length,
    plainAverage: n ? { systolic: mean("systolic"), diastolic: mean("diastolic"), count: n } : null,
  };
}

/** The week shown first: the open or upcoming one, else the most recent. */
export function currentWeek(read: BpWeekRead, now: Date): BpWeek | null {
  if (!read.enabled) return null;
  return read.weeks.find(w => ["running", "not-started"].includes(weekPhase(w, now))) ?? read.weeks[0] ?? null;
}

/** The next slot to act on today, for Home. */
export function nextSlot(week: BpWeek, now: Date): SlotView | null {
  if (weekPhase(week, now) !== "running") return null;
  const today = yerevanDate(now), slots = weekSlots(week, now).filter(s => s.date === today);
  return slots.find(s => s.state === "due" || s.state === "partial") ?? slots.find(s => s.state === "upcoming") ?? null;
}
