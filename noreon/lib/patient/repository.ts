import "server-only";
import { readAllPages } from "@/lib/patient-care/pagination";
import { createClient as supabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/db/types";
import type { PatientState, Measurement } from "./types";
import type { PatientStore } from "./service";
import { requirePatient } from "./auth";
import { redirect } from "next/navigation";
import { createDatabasePatientStore } from "./database-store";
function writer() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY,
    url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!key || !url) throw new Error("Patient storage unavailable");
  return supabaseClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function patientStore(): PatientStore {
  return createDatabasePatientStore(createClient, writer);
}

export async function getPatientState(options?: { coherentProfile?: boolean }) {
  const user = await requirePatient();
  return patientStore().read(user.userId, options);
}
export async function requireRegistered() {
  const state = await getPatientState();
  if (!state.profile || !state.consentAccepted || !state.assessment)
    redirect("/patient/profile");
  return state as PatientState & {
    profile: NonNullable<PatientState["profile"]>;
    assessment: NonNullable<PatientState["assessment"]>;
  };
}
export async function getMeasurements(): Promise<Measurement[]> {
  await requirePatient();
  const client = await createClient();
  const data = await readAllPages((from, to) =>
    client
      .from("patient_measurements")
      .select("*")
      .order("measured_at", { ascending: false })
      .order("id", { ascending: false })
      .range(from, to),
  );
  return data.map((m) => ({
    id: m.id,
    submissionId: m.submission_id,
    systolic: m.systolic,
    diastolic: m.diastolic,
    pulse: m.pulse ?? undefined,
    measuredAt: m.measured_at,
    source: "manual",
    entrySource: m.entry_source,
  }));
}
