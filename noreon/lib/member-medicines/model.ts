import { z } from "zod";

/** D2. Two kinds, never mixed: the doctor's plan medicines and the member's own self-reported list. */
const dose = z.object({ dueAt: z.string(), status: z.enum(["taken", "skipped"]), recordedAt: z.string(), revision: z.number().int().optional() });
const hhmm = z.string().regex(/^\d{2}:\d{2}$/);
export const selfMedicineSchema = z.object({
  id: z.uuid(),
  source: z.literal("self-reported"),
  name: z.string(),
  dose: z.string().nullable(),
  /** Empty only on a medicine named in chat: when it is taken is unknown, so nothing is due and no reminder goes. */
  times: z.array(hhmm),
  /** Named in the chat with Zoe and confirmed by the member: their statement, for the doctor to check. Absent before 20261102182738. */
  fromChat: z.boolean().optional(),
  startedOn: z.string(),
  createdAt: z.string(),
  stoppedAt: z.string().nullable(),
  /** Set on a row that replaced an earlier schedule (QA 99): no dose slot before it counts. Absent before 20261023063738. */
  effectiveAt: z.string().nullable().optional(),
  /** On a row a schedule change stopped: the row with the new times (QA 118). Absent before 20261026190426. */
  replacedBy: z.uuid().nullable().optional(),
  doses: z.array(dose),
});
export const planMedicineSchema = z.object({
  id: z.uuid(),
  source: z.literal("plan"),
  name: z.string(),
  dose: z.string(),
  times: z.array(hhmm).min(1),
  startedOn: z.string(),
  endDate: z.string().nullable(),
  effectiveAt: z.string().nullable(),
  doses: z.array(dose),
});
export const memberMedicinesReadSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal("member-medicines-v1"), enabled: z.literal(false) }),
  z.object({ version: z.literal("member-medicines-v1"), enabled: z.literal(true), medicines: z.array(selfMedicineSchema) }),
]);
export const staffMedicinesReadSchema = z.discriminatedUnion("enabled", [
  z.object({ version: z.literal("member-medicines-v1"), enabled: z.literal(false) }),
  z.object({
    version: z.literal("member-medicines-v1"),
    enabled: z.literal(true),
    today: z.string(),
    days: z.number().int(),
    now: z.string(),
    self: z.array(selfMedicineSchema),
    plan: z.array(planMedicineSchema),
  }),
]);
export type SelfMedicine = z.infer<typeof selfMedicineSchema>;
export type PlanMedicine = z.infer<typeof planMedicineSchema>;
export type MemberMedicinesRead = z.infer<typeof memberMedicinesReadSchema>;
export type StaffMedicinesRead = z.infer<typeof staffMedicinesReadSchema>;

const DAY = 86400000;
export const yerevanDate = (at: Date) => new Date(at.getTime() + 4 * 3600000).toISOString().slice(0, 10);
const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const instant = (date: string, time: string) => new Date(`${date}T${time}:00+04:00`);

export type DoseSlot = { medicineId: string; dueAt: string; time: string; status: "taken" | "skipped" | "due" | "upcoming"; revision: number };
const slot = (m: SelfMedicine, at: Date, time: string, now: Date): DoseSlot => {
  const d = m.doses.find(x => Date.parse(x.dueAt) === at.getTime());
  const status = d?.status ?? (at.getTime() - 60 * 60000 <= now.getTime() ? "due" : "upcoming");
  return { medicineId: m.id, dueAt: at.toISOString(), time, status, revision: d?.revision ?? 0 };
};
/**
 * The slot of a kept time before a schedule change (QA 118). It stays on the row the change stopped, with its tick, and a
 * tick for it goes to that row; earlier changes the same day are followed back while each one kept the time.
 */
function keptSlot(m: SelfMedicine, at: Date, time: string, list: SelfMedicine[], now: Date, depth = 0): DoseSlot | null {
  const prev = list.find(p => p.replacedBy === m.id);
  if (!prev || depth > 20 || !prev.times.includes(time) || prev.startedOn > yerevanDate(at)) return null;
  if (prev.stoppedAt && Date.parse(prev.stoppedAt) <= at.getTime()) return null;
  if (prev.effectiveAt && at.getTime() < Date.parse(prev.effectiveAt)) return keptSlot(prev, at, time, list, now, depth + 1);
  return slot(prev, at, time, now);
}
/**
 * Today's doses of a self-reported medicine. A tick opens 60 minutes before the time (as the database allows).
 * `list` is the member's whole list, stopped rows included, so a time kept through a change today keeps its slot.
 */
export function todaysDoses(m: SelfMedicine, now: Date, list: SelfMedicine[] = []): DoseSlot[] {
  const today = yerevanDate(now);
  if (m.startedOn > today) return [];
  return m.times.flatMap(time => {
    const at = instant(today, time);
    if (m.stoppedAt && Date.parse(m.stoppedAt) <= at.getTime()) return [];
    if (m.effectiveAt && at.getTime() < Date.parse(m.effectiveAt)) {
      const kept = keptSlot(m, at, time, list, now);
      return kept ? [kept] : [];
    }
    return [slot(m, at, time, now)];
  });
}

export type Adherence = { expected: number; taken: number; skipped: number; noReport: number; days: number };
/**
 * Doses whose time has passed in the last `days` days (Yerevan), within the medicine's own dates:
 * how many the member reported taken, reported skipped, or did not report. A count, never a rating:
 * no missed-dose rule is approved (pending Armen).
 */
export function adherence(m: SelfMedicine | PlanMedicine, days: number, now: Date): Adherence {
  const today = yerevanDate(now);
  const end = "endDate" in m && m.endDate ? m.endDate : null, stopped = "stoppedAt" in m && m.stoppedAt ? Date.parse(m.stoppedAt) : null;
  // A plan medicine counts only from when it was in force (its plan's publication), never before.
  const from = "effectiveAt" in m && m.effectiveAt ? Date.parse(m.effectiveAt) : null;
  let expected = 0, taken = 0, skipped = 0;
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    if (date < m.startedOn || (end && date > end)) continue;
    for (const time of m.times) {
      const at = instant(date, time).getTime();
      if (at > now.getTime() || (stopped !== null && at >= stopped) || (from !== null && at < from)) continue;
      expected++;
      const d = m.doses.find(x => Date.parse(x.dueAt) === at);
      if (d?.status === "taken") taken++;
      else if (d?.status === "skipped") skipped++;
    }
  }
  return { expected, taken, skipped, noReport: expected - taken - skipped, days };
}
