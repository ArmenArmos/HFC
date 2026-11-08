import "server-only";
import {redirect} from "next/navigation";
import {createDatabasePatientStore} from "@/lib/patient/database-store";
import type {PatientState} from "@/lib/patient/types";
import {createClient as supabase} from "@supabase/supabase-js";
import type {Database} from "@/lib/db/types";
import {createClient} from "@/lib/supabase/server";
export async function reportContext() {
  // Existing records and originals do not depend on new import/AI availability.
  const client = await createClient();
  const verified = await client.auth.getUser();
  if (verified.error) {
    const status = verified.error.status;
    throw new Error(status && status >= 400 && status < 500 && status !== 408 && status !== 429 ? "unauthorized" : "unavailable");
  }
  const user = verified.data.user;
  if (!user?.phone || !user.phone_confirmed_at) throw new Error("unauthorized");
  const identity = {userId: user.id, phone: user.phone};
  const profile = await client.from("profiles").select("id,locale").maybeSingle();
  if (profile.error) throw new Error("unavailable");
  if (!profile.data) throw new Error("unauthorized");
  const admin = supabase<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  return { identity, client, admin, locale: profile.data.locale === "hy" ? "hy" as const : "en" as const };
}
export type ReportContext = Awaited<ReturnType<typeof reportContext>>;
/** Real reports reuse this request's verified Auth identity and RLS client.
 * Full registration still requires profile, current consent and assessment.
 */
export async function registeredReportState(ctx: ReportContext) {
  const state = await createDatabasePatientStore(async () => ctx.client, () => ctx.admin).read(ctx.identity.userId);
  if (!state.profile || !state.consentAccepted || !state.assessment) redirect("/patient/profile");
  return state as PatientState & {profile: NonNullable<PatientState["profile"]>; assessment: NonNullable<PatientState["assessment"]>};
}

