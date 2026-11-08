import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { MeasurementInput } from "@/lib/patient/types";
export class MeasurementConflict extends Error {}
export async function persistMeasurement(
  client: SupabaseClient<Database>,
  userId: string,
  input: MeasurementInput,
): Promise<void> {
  const { error } = await client.from("patient_measurements").insert({
    user_id: userId,
    submission_id: input.submissionId,
    systolic: input.systolic,
    diastolic: input.diastolic,
    pulse: input.pulse ?? null,
    measured_at: input.measuredAt,
    // Only a photo-confirmed reading names its source here. An empty source lets the save trigger label dictated voice readings and the zone step default the rest to typed.
    ...(input.photoConfirmed === true ? { entry_source: "patient_photo_confirmed" } : {}),
  });
  if (!error) return;
  if (error.code !== "23505") throw new Error("Patient save failed");
  const { data, error: readError } = await client
    .from("patient_measurements")
    .select("systolic,diastolic,pulse,measured_at")
    .eq("user_id", userId)
    .eq("submission_id", input.submissionId)
    .single();
  if (readError || !data) throw new Error("Patient save failed");
  if (
    data.systolic !== input.systolic ||
    data.diastolic !== input.diastolic ||
    data.pulse !== (input.pulse ?? null) ||
    Date.parse(data.measured_at) !== Date.parse(input.measuredAt)
  )
    throw new MeasurementConflict(
      "Submission already saved with different values",
    );
}
