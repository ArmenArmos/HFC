import { redirect } from "next/navigation";
import type { Route } from "next";
import { MemberHomeContent } from "@/components/patient/member-home-content";
import { memberChatDestination, memberChatOnlyEnabled } from "@/lib/patient/member-chat-config";
import { requireRegisteredForRender } from "@/lib/patient/render-data";
import { patientPresentation } from "@/lib/patient/presentation";
import { patientIdentity } from "@/lib/patient/auth";
import { caregiversEnabled } from "@/lib/caregivers/schema";
import { caregiverLanding, sessionLandingReads } from "@/lib/caregivers/server";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const params = await searchParams;
  // WP F: sign-in lands here. A phone account that is no member but helps someone, or has an invitation waiting, goes to
  // its caregiver page instead of the member sign-up (dark unless NOREON_CAREGIVERS).
  if (caregiversEnabled()) {
    const who = await patientIdentity().catch(() => null);
    const caring = await caregiverLanding(who ? await sessionLandingReads(who.userId).catch(() => null) : null);
    if (caring) redirect(caring as Route);
  }
  if (memberChatOnlyEnabled() && params.view !== "classic") {
    const { assessment } = await requireRegisteredForRender();
    const destination = memberChatDestination({ enabled: true, complete: !!assessment.completedAt, ...patientPresentation(assessment) });
    if (destination) redirect(destination);
  }
  return <MemberHomeContent searchParams={Promise.resolve(params)} />;
}
