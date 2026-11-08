import { redirect } from "next/navigation";
import { MemberHomeContent } from "@/components/patient/member-home-content";
import { memberChatDestination, memberChatOnlyEnabled } from "@/lib/patient/member-chat-config";
import { requireRegisteredForRender } from "@/lib/patient/render-data";
import { patientPresentation } from "@/lib/patient/presentation";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const params = await searchParams;
  if (memberChatOnlyEnabled() && params.view !== "classic") {
    const { assessment } = await requireRegisteredForRender();
    const destination = memberChatDestination({ enabled: true, complete: !!assessment.completedAt, ...patientPresentation(assessment) });
    if (destination) redirect(destination);
  }
  return <MemberHomeContent searchParams={Promise.resolve(params)} />;
}
