"use server";
import {loggedAction} from '@/lib/observability/with-logging';
import { revalidatePath } from "next/cache";
import { requireRegistered } from "@/lib/patient/repository";
import { createClient } from "@/lib/supabase/server";
import { getCareData } from "@/lib/patient-care/repository";
import { canReportDose } from "@/lib/patient-care/model";
export const reportDose=loggedAction("reportDose",async function reportDose(
  medicationId: string,
  dueAt: string,
  status: "taken" | "skipped",
  planId: string,
  expectedRevision: number,
) {
  await requireRegistered();
  if (!Number.isSafeInteger(expectedRevision) || expectedRevision<0 || !["taken", "skipped"].includes(status)) return { ok: false };
  try {
    const { getReminderPreferences } = await import('@/lib/patient-care/reminder-repository');
    const [data, settings] = await Promise.all([getCareData(), getReminderPreferences()]);
    const current=data.plan?.id===planId&&canReportDose(data,medicationId,dueAt,new Date(),settings.preferences.medicationOffsetMinutes);
    const historical=data.events.some(event=>event.medicationId===medicationId&&event.dueAt===dueAt&&event.planId===planId);
    // Historical corrections still pass the native schedule window and revision CAS.
    if(!current&&!historical)return {ok:false};
    const client = await createClient();
    const { error } = await client.rpc("report_patient_dose_versioned", {
      p_medication_id: medicationId,
      p_due_at: dueAt,
      p_status: status,
      p_expected_revision: expectedRevision,
    });
    if (error) return { ok: false, reason: error.message === "dose revision conflict" ? "conflict" : "unavailable" };
    revalidatePath("/patient", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The change could not be saved." };
  }
});
export const acknowledgePlan=loggedAction("acknowledgePlan",async function acknowledgePlan(planId: string) {
  await requireRegistered();
  try {
    const client = await createClient();
    const { error } = await client.rpc("acknowledge_patient_plan", {
      p_plan_id: planId,
    });
    if (error) return { ok: false };
    revalidatePath("/patient", "layout");
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "The change could not be saved." };
  }
});
export const saveReminderPreferences=loggedAction("saveReminderPreferences",async function saveReminderPreferences(input: unknown, expectedRevision: number) {
  const { persistReminderPreferences } = await import('@/lib/patient-care/reminder-repository');
  const result = await persistReminderPreferences(input, expectedRevision);
  if (result.ok) revalidatePath('/patient', 'layout');
  return result;
});
