"use server";
import { loggedAction } from "@/lib/observability/with-logging";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { patientIdentityForSave } from "@/lib/patient/auth";
import type { MedicinesRpc } from "./server";

export type MedicineResult = { status: "added" | "stopped" | "saved" | "not-found" | "not-due" | "conflict" | "invalid" | "limit" | "disabled" | "unavailable" | "signed_out"; revision?: number };
const KNOWN = new Set(["added", "stopped", "saved", "not-found", "not-due", "conflict", "invalid", "limit", "disabled"]);
const result = z.object({ status: z.string(), revision: z.number().int().optional() }).loose();

async function call(name: string, args: Record<string, unknown>): Promise<MedicineResult> {
  try {
    if (!(await patientIdentityForSave())) return { status: "signed_out" };
    const client = (await createClient()) as unknown as MedicinesRpc;
    const { data, error } = await client.rpc(name, args);
    if (error) return { status: "unavailable" };
    const parsed = result.safeParse(data);
    if (!parsed.success || !KNOWN.has(parsed.data.status)) return { status: "unavailable" };
    return { status: parsed.data.status as MedicineResult["status"], ...(parsed.data.revision !== undefined ? { revision: parsed.data.revision } : {}) };
  } catch {
    return { status: "unavailable" };
  }
}
const refresh = () => { revalidatePath("/patient/medicines"); revalidatePath("/patient/dashboard"); };

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const addInput = z.object({ requestId: z.uuid(), name: z.string().trim().min(1).max(120), dose: z.string().trim().max(120), times: z.array(time).min(1).max(6) }).strict()
  .refine(v => new Set(v.times).size === v.times.length);
export const addMyMedicine = loggedAction("addMyMedicine",async function addMyMedicine(input: unknown): Promise<MedicineResult> {
  const parsed = addInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const r = await call("member_medicine_add", { p_name: parsed.data.name, p_dose: parsed.data.dose || null, p_times: parsed.data.times, p_request_id: parsed.data.requestId });
  if (r.status === "added") refresh();
  return r;
});
// Gohar QA 99: the member's own medicines only. The database refuses anything not on the caller's own list.
const updateInput = z.object({ id: z.uuid(), dose: z.string().trim().max(120), expectedDose: z.string().max(120).nullable().optional(), times: z.array(time).min(1).max(6) }).strict()
  .refine(v => new Set(v.times).size === v.times.length);
export const updateMyMedicine = loggedAction("updateMyMedicine",async function updateMyMedicine(input: unknown): Promise<MedicineResult> {
  const parsed = updateInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const r = parsed.data.expectedDose !== undefined
    ? await call("member_medicine_update_times", { p_id: parsed.data.id, p_expected_dose: parsed.data.expectedDose, p_times: parsed.data.times })
    : await call("member_medicine_update", { p_id: parsed.data.id, p_dose: parsed.data.dose || null, p_times: parsed.data.times });
  if (r.status === "saved") refresh();
  return r;
});
export const stopMyMedicine = loggedAction("stopMyMedicine",async function stopMyMedicine(id: unknown): Promise<MedicineResult> {
  if (!z.uuid().safeParse(id).success) return { status: "invalid" };
  const r = await call("member_medicine_stop", { p_id: id });
  if (r.status === "stopped") refresh();
  return r;
});
const tickInput = z.object({ medicineId: z.uuid(), dueAt: z.iso.datetime({ offset: true }), status: z.enum(["taken", "skipped"]), revision: z.number().int().min(0) }).strict();
export const tickMyMedicine = loggedAction("tickMyMedicine",async function tickMyMedicine(input: unknown): Promise<MedicineResult> {
  const parsed = tickInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  const v = parsed.data;
  const r = await call("member_medicine_dose_report", { p_medicine: v.medicineId, p_due_at: v.dueAt, p_status: v.status, p_expected_revision: v.revision });
  if (r.status === "saved") refresh();
  return r;
});

// Zoe's missed-dose ask (item 5). The database checks the ask is the member's and still open.
export type AskResult = { status: "answered" | "sent" | "already" | "closed" | "not-found" | "invalid" | "disabled" | "unavailable"; next?: "reminders" | "refill" | "doctor" };
const ASK_KNOWN = new Set(["answered", "sent", "already", "closed", "not-found", "invalid", "disabled"]);
const askResult = z.object({ status: z.string(), next: z.enum(["reminders", "refill", "doctor"]).optional() }).loose();
async function askCall(name: string, args: Record<string, unknown>): Promise<AskResult> {
  try {
    if (!(await patientIdentityForSave())) return { status: "disabled" };
    const client = (await createClient()) as unknown as MedicinesRpc;
    const { data, error } = await client.rpc(name, args);
    if (error) return { status: "unavailable" };
    const parsed = askResult.safeParse(data);
    if (!parsed.success || !ASK_KNOWN.has(parsed.data.status)) return { status: "unavailable" };
    return { status: parsed.data.status as AskResult["status"], ...(parsed.data.next ? { next: parsed.data.next } : {}) };
  } catch {
    return { status: "unavailable" };
  }
}
const answerInput = z.object({ askId: z.uuid(), reason: z.enum(["forgot", "side_effect", "cost_or_availability", "ran_out", "decided_to_stop"]) }).strict();
export const answerMedicineAsk = loggedAction("answerMedicineAsk", async function answerMedicineAsk(input: unknown): Promise<AskResult> {
  const parsed = answerInput.safeParse(input);
  if (!parsed.success) return { status: "invalid" };
  return askCall("member_medicine_ask_answer", { p_ask: parsed.data.askId, p_reason: parsed.data.reason });
});
export const askCareTeamAboutRefill = loggedAction("askCareTeamAboutRefill", async function askCareTeamAboutRefill(askId: unknown): Promise<AskResult> {
  if (!z.uuid().safeParse(askId).success) return { status: "invalid" };
  return askCall("member_medicine_ask_care_team", { p_ask: askId });
});
export const dismissMedicineAsk = loggedAction("dismissMedicineAsk", async function dismissMedicineAsk(askId: unknown): Promise<AskResult> {
  if (!z.uuid().safeParse(askId).success) return { status: "invalid" };
  const r = await askCall("member_medicine_ask_dismiss", { p_ask: askId });
  if (r.status === "closed") refresh();
  return r;
});
