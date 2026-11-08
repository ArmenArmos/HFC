import { notFound, redirect } from "next/navigation";
import { MemberOverview } from "@/components/chat-v2/overview";
import { readOverview } from "@/lib/patient/overview-server";
import { patientPresentation } from "@/lib/patient/presentation";
import { requireRegisteredForRender } from "@/lib/patient/render-data";
import { memberOverviewEnabled } from "@/lib/patient/zoe-app-v3";
import { zoeEmergencyCardEnabled } from "@/lib/zoe/member-screen";
import "@/components/chat-v2/chat.css";
import "@/components/chat-v2/overview.css";

export const metadata = { title: "Noreon overview" };

export default async function MemberOverviewPage() {
  if (!memberOverviewEnabled()) notFound();
  const { profile, assessment } = await requireRegisteredForRender();
  // A read-only view must not stand in front of the urgent route.
  if (patientPresentation(assessment).urgent) redirect(zoeEmergencyCardEnabled() ? "/patient/chat" : "/patient/urgent");
  const data = await readOverview({ locale: profile.locale, name: profile.name, questionnaireComplete: !!assessment.completedAt });
  return <MemberOverview locale={profile.locale} data={data} />;
}
