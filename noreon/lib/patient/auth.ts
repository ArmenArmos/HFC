import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { authServiceUnavailable } from "@/lib/supabase/auth-availability";
import { noteActor } from "@/lib/observability/context";
import { MEMBER_BINDING_HEADER, accountChanged } from "@/lib/patient/account-binding";
/**
 * The signed-in member, or null. An auth service that is slow or failing throws instead of reading as "signed out"
 * (QA M-09, A1-obs): a page lands on its error screen with a retry, and a save answers "try again". A session that
 * really ended is still null. Screens that must open without auth catch the error.
 */
export async function patientIdentity() {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  )
    return null;
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (authServiceUnavailable(error)) throw new Error("Auth temporarily unavailable");
  // The proxy already refuses this; it lets Zoe's chat action through while auth is down (lib/supabase/session.ts).
  if (accountChanged((await headers()).get(MEMBER_BINDING_HEADER), data.user)) throw new Error("Another account is signed in");
  const identity = error || !data.user?.phone || !data.user.phone_confirmed_at
    ? null
    : { userId: data.user.id, phone: data.user.phone };
  noteActor(identity ? "member" : "anon", identity?.userId);
  return identity;
}
export const patientIdentityForSave = patientIdentity;
export async function requirePatient() {
  const user = await patientIdentity();
  if (!user) redirect("/patient");
  return user;
}
