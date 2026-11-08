import { abortableRequest, boundedRequest } from "./request";
import { submitDose, type DoseDraft } from "./doses";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../../lib/db/types";
import { validMeasurement } from "../../../../lib/patient/validation";
import { config, getAuthClient } from "./supabase";
import { verifiedActionClient } from "./action-identity";
export async function clientFor(userId: string, signal: AbortSignal) {
  const supabase = getAuthClient();
  if (!supabase || !config) throw Error("unavailable");
  const settings = config,
    auth = supabase.auth;
  return abortableRequest(
    () =>
      verifiedActionClient(
        userId,
        auth,
        (token) =>
          createClient<Database>(settings.url, settings.key, {
            global: { headers: { Authorization: `Bearer ${token}` } },
            auth: {
              persistSession: false,
              autoRefreshToken: false,
              detectSessionInUrl: false,
            },
          }),
        signal,
      ),
    signal,
  );
}
export async function saveNativeMeasurement(
  userId: string,
  input: unknown,
): Promise<"saved" | "conflict" | "invalid" | "unavailable"> {
  if (!validMeasurement(input)) return "invalid";
  try {
    const result = await boundedRequest(async (signal) => {
      const client = await clientFor(userId, signal);
      return client
        .rpc("record_patient_measurement", {
          p_submission_id: input.submissionId,
          p_systolic: input.systolic,
          p_diastolic: input.diastolic,
          // Generated SQL argument types omit nullability; pulse is optional in SQL.
          p_pulse: (input.pulse ?? null) as unknown as number,
          p_measured_at: input.measuredAt,
        })
        .abortSignal(signal);
    });
    if (!result.error && result.data) return "saved";
    return result.error?.message === "measurement conflict"
      ? "conflict"
      : result.error?.message === "invalid measurement"
        ? "invalid"
        : "unavailable";
  } catch {
    return "unavailable";
  }
}
export async function acknowledgeNativePlan(
  userId: string,
  planId: string,
): Promise<boolean> {
  try {
    const { error } = await boundedRequest(async (signal) => {
      const client = await clientFor(userId, signal);
      return client
        .rpc("acknowledge_patient_plan", { p_plan_id: planId })
        .abortSignal(signal);
    });
    return !error;
  } catch {
    return false;
  }
}

export async function reportNativeDose(userId: string, input: DoseDraft) {
  return submitDose(input, async (draft) => {
    return boundedRequest(async (signal) => {
      const client = await clientFor(userId, signal);
      return client
        .rpc("report_patient_dose_versioned", {
          p_medication_id: draft.medicationId,
          p_due_at: draft.dueAt,
          p_status: draft.status,
          p_expected_revision: draft.revision,
        })
        .abortSignal(signal);
    });
  });
}
