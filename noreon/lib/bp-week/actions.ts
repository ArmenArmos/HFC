"use server";
import { loggedAction } from "@/lib/observability/with-logging";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { patientIdentityForSave } from "@/lib/patient/auth";
import { requireRealStaff } from "@/lib/patient-care/clinical-case-repository";
import type { BpWeekRpc } from "./server";
import { isFutureMeasurement } from "@/lib/patient/measured-at";
import { bpStepAfterSave, type BpRead } from "@/lib/patient/bp-after-save";
import type { BpStep } from "@/lib/clinical/rules/bp-check";

export type BpWeekResult = { status: "started" | "stopped" | "saved" | "replayed" | "open-week" | "not-open" | "slot-full" | "outside-week" | "not-today" | "conflict" | "invalid" | "disabled" | "busy" | "not-member" | "not-found" | "unavailable" | "signed_out"; bp?: BpStep };
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const startInput = z.object({ startsOn: z.iso.date(), morning: time, evening: time }).strict();
const result = z.object({ status: z.string() }).loose();
const KNOWN = new Set<BpWeekResult["status"]>(["started", "stopped", "saved", "replayed", "open-week", "not-open", "slot-full", "outside-week", "not-today", "conflict", "invalid", "disabled", "busy", "not-member", "not-found"]);

async function call(client: BpWeekRpc, name: string, args: Record<string, unknown>): Promise<BpWeekResult> {
  try {
    const { data, error } = await client.rpc(name, args);
    if (error) return { status: error.code === "55P03" ? "busy" : "unavailable" };
    const parsed = result.safeParse(data);
    const status = parsed.success ? parsed.data.status : "";
    return { status: KNOWN.has(status as BpWeekResult["status"]) ? (status as BpWeekResult["status"]) : "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}
async function memberClient() {
  const identity = await patientIdentityForSave();
  return identity ? ((await createClient()) as unknown as BpWeekRpc) : null;
}
const refreshMember = () => { revalidatePath("/patient/bp-week"); revalidatePath("/patient/dashboard"); revalidatePath("/patient/measurements"); };

export const startMyBpWeek = loggedAction("startMyBpWeek",async function startMyBpWeek(input: unknown): Promise<BpWeekResult> {
  const parsed = startInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const client = await memberClient();
  if (!client) return { status: "disabled" };
  const r = await call(client, "bp_week_start", { p_member: null, p_starts_on: parsed.data.startsOn, p_morning: parsed.data.morning, p_evening: parsed.data.evening });
  if (r.status === "started") refreshMember();
  return r;
});
export const stopMyBpWeek = loggedAction("stopMyBpWeek",async function stopMyBpWeek(weekId: unknown): Promise<BpWeekResult> {
  if (!z.uuid().safeParse(weekId).success) return { status: "invalid" };
  const client = await memberClient();
  if (!client) return { status: "disabled" };
  const r = await call(client, "bp_week_stop", { p_week: weekId, p_reason: null });
  if (r.status === "stopped") refreshMember();
  return r;
});
export const setMyBpWeekReminders = loggedAction("setMyBpWeekReminders",async function setMyBpWeekReminders(weekId: unknown, on: unknown): Promise<BpWeekResult> {
  if (!z.uuid().safeParse(weekId).success || typeof on !== "boolean") return { status: "invalid" };
  const client = await memberClient();
  if (!client) return { status: "disabled" };
  const r = await call(client, "bp_week_set_reminders", { p_week: weekId, p_on: on });
  if (r.status === "saved") revalidatePath("/patient/bp-week");
  return r;
});

// The server bounds of record_patient_measurement (the UI's entry ranges sit inside them).
const [sMin, sMax, dMin, dMax, pMin, pMax] = [60, 300, 30, 200, 20, 250];
const readingInput = z.object({
  photoConfirmed: z.boolean().optional(),
  weekId: z.uuid(),
  slot: z.enum(["morning", "evening"]),
  submissionId: z.uuid(),
  systolic: z.number().int().min(sMin).max(sMax),
  diastolic: z.number().int().min(dMin).max(dMax),
  pulse: z.number().int().min(pMin).max(pMax).nullable(),
  measuredAt: z.iso.datetime({ offset: true }),
}).strict().refine(v => v.diastolic < v.systolic && !isFutureMeasurement(v.measuredAt));
export const recordBpWeekReading = loggedAction("recordBpWeekReading",async function recordBpWeekReading(input: unknown): Promise<BpWeekResult> {
  const parsed = readingInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const client = await memberClient();
  if (!client) return { status: "signed_out" };
  const v = parsed.data;
  const r = await call(client, v.photoConfirmed === true ? "bp_week_record_sourced" : "bp_week_record", { ...(v.photoConfirmed === true ? { p_entry_source: "patient_photo_confirmed" } : {}), p_week: v.weekId, p_slot: v.slot, p_submission: v.submissionId, p_systolic: v.systolic, p_diastolic: v.diastolic, p_pulse: v.pulse, p_measured_at: v.measuredAt });
  if (r.status !== "saved" && r.status !== "replayed") return r;
  refreshMember();
  const read: BpRead = (name, args) => Promise.resolve(client.rpc(name, args)).then(x => { if (x.error) throw new Error("Reading read failed"); return x.data; });
  return { ...r, bp: await bpStepAfterSave(read, null, v) };
});

/** Assigned nurse or doctor starts or stops a member's week; the database checks the assignment. */
export const staffStartBpWeek = loggedAction("staffStartBpWeek",async function staffStartBpWeek(memberId: string, input: unknown): Promise<BpWeekResult> {
  const parsed = startInput.safeParse(input);
  if (!z.uuid().safeParse(memberId).success || !parsed.success) return { status: "invalid" };
  const { client, identity } = await requireRealStaff();
  if (identity.role !== "nurse" && identity.role !== "doctor") return { status: "invalid" };
  const r = await call(client as unknown as BpWeekRpc, "bp_week_start", { p_member: memberId, p_starts_on: parsed.data.startsOn, p_morning: parsed.data.morning, p_evening: parsed.data.evening });
  if (r.status === "started") revalidatePath(`/staff/real/members/${memberId}`);
  return r;
});
export const staffStopBpWeek = loggedAction("staffStopBpWeek",async function staffStopBpWeek(memberId: string, weekId: unknown, reason: unknown): Promise<BpWeekResult> {
  if (!z.uuid().safeParse(memberId).success || !z.uuid().safeParse(weekId).success) return { status: "invalid" };
  const why = typeof reason === "string" && reason.trim() ? reason.trim().slice(0, 300) : null;
  const { client, identity } = await requireRealStaff();
  if (identity.role !== "nurse" && identity.role !== "doctor") return { status: "invalid" };
  const r = await call(client as unknown as BpWeekRpc, "bp_week_stop", { p_week: weekId, p_reason: why });
  if (r.status === "stopped") revalidatePath(`/staff/real/members/${memberId}`);
  return r;
});
