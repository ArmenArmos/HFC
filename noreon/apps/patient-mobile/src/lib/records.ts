import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../../lib/db/types";
import { readAllPages } from "../../../../lib/patient-care/pagination";
import { reminderSnapshot } from "./reminders";
import { readMeasurementHistory, readResultHistory } from "./history";
import { doseReadWindow, nativeDoseCare, reminderOffset } from "./doses";
export async function readRecords(
  client: SupabaseClient<Database>,
  signal: AbortSignal,
) {
  // RLS owns member filtering. Never ship service credentials to this client.
  const startedAt = new Date();
  const window = doseReadWindow(startedAt);
  const [
    profile,
    consent,
    assessment,
    plan,
    measurements,
    results,
    events,
    reminders,
  ] = await Promise.all([
    client
      .from("profiles")
      .select("display_name,birth_date,biological_sex,locale")
      .abortSignal(signal)
      .maybeSingle(),
    client
      .from("patient_consents")
      .select("version")
      .eq("version", "patient-pilot-v1")
      .abortSignal(signal)
      .maybeSingle(),
    client
      .from("patient_assessments")
      .select("id")
      .abortSignal(signal)
      .maybeSingle(),
    client
      .from("patient_care_plans")
      .select("id,clinician,instructions,published_at,acknowledged_at")
      .eq("active", true)
      .lte("published_at", new Date().toISOString())
      .abortSignal(signal)
      .maybeSingle(),
    readMeasurementHistory(client, signal),
    readResultHistory(client, signal),
    readAllPages((from, to) =>
      client
        .from("patient_dose_events")
        .select("medication_id,due_at,status,revision,recorded_at")
        .gte("due_at", window.from)
        .lt("due_at", window.to)
        .order("due_at")
        .order("medication_id")
        .range(from, to)
        .abortSignal(signal),
    ),
    client
      .from("patient_reminder_preferences")
      .select("revision,preferences")
      .abortSignal(signal)
      .maybeSingle(),
  ]);
  if ([profile, consent, assessment, plan, reminders].some((r) => r.error))
    throw Error("Records unavailable");
  const publishedPlan = plan.data;
  const medications = publishedPlan
    ? await readAllPages((from, to) =>
        client
          .from("patient_care_medications")
          .select("id,name,dose,instructions,times,start_date,end_date")
          .eq("plan_id", publishedPlan.id)
          .eq("active", true)
          .order("id")
          .range(from, to)
          .abortSignal(signal),
      )
    : [];
  return {
    profile: profile.data,
    registered: Boolean(
      consent.data &&
        assessment.data &&
        profile.data?.display_name &&
        profile.data.birth_date &&
        profile.data.biological_sex,
    ),
    plan: plan.data,
    medications,
    care: nativeDoseCare(plan.data, medications, events),
    reminders: reminderSnapshot(reminders.data),
    reminderOffset: reminderOffset(reminders.data?.preferences),
    readAt: startedAt.toISOString(),
    measurements,
    results,
  };
}
export type Records = Awaited<ReturnType<typeof readRecords>>;
