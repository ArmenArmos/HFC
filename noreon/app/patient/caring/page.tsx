import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { parseLocale } from "@/lib/locale";
import { patientIdentity } from "@/lib/patient/auth";
import { caregiversEnabled } from "@/lib/caregivers/schema";
import { readCaredMembers, readCaregiverInvitations, sessionCaregiverRpc } from "@/lib/caregivers/server";
import { CaringView } from "@/components/chat-v2/caring-view";
import "@/components/chat-v2/chat.css";

export const metadata = { title: "Noreon · People you help" };

/**
 * The caregiver surface (WP F, dark behind NOREON_CAREGIVERS): any account signed in with a confirmed phone number,
 * member or not. The database decides what it sees: invitations sent to this number and active links only.
 */
export default async function CaringPage() {
  if (!caregiversEnabled()) notFound();
  const who = await patientIdentity();
  if (!who) redirect("/patient?next=/patient/caring");
  const locale = parseLocale((await cookies()).get("noreon_locale")?.value, "hy");
  const rpc = await sessionCaregiverRpc();
  const [invitations, members] = await Promise.all([readCaregiverInvitations(rpc), readCaredMembers(rpc)]);
  const ok = invitations.ok && members.ok;
  return <CaringView locale={locale} status={ok ? "ok" : "unavailable"} invitations={invitations.ok ? invitations.data.invitations : []} members={members.ok ? members.data.members : []} />;
}
