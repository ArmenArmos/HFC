import { RowLink, copy } from "@/components/patient-care/common";
import {ArrowLeft} from "lucide-react";
import { redirect } from "next/navigation";
import { PatientShell } from "@/components/patient/patient-shell";
import { ReportWorkspace } from "@/components/reports/report-workspace";
import {reportContext,registeredReportState} from "@/lib/reports/context";
import {reportsEnabled} from "@/lib/reports/enabled";
export async function ReportsContent({embedded=false}:{embedded?:boolean}) {
  let context;
  try { context = await reportContext(); }
  catch (error) {
    if (error instanceof Error && ["unauthorized", "disabled"].includes(error.message)) redirect("/patient");
    throw new Error("Reports are temporarily unavailable.");
  }
  const {profile} = await registeredReportState(context);
  const body = (
    <>
      {!embedded&&<div className="mb-5"><RowLink href="/patient/results" icon={ArrowLeft}>{copy(profile.locale,"Back to tests","Վերադառնալ հետազոտություններին", "Вернуться к анализам")}</RowLink></div>}
      <ReportWorkspace
        embedded={embedded}
        locale={profile.locale}
        demo={false}
        enabled={reportsEnabled()}
        memberName={profile.name}
      />
    </>
  );
  return embedded ? <section className="member-chat-card min-w-0 space-y-4" data-member-chat-card="reports">{body}</section> : <PatientShell locale={profile.locale}>{body}</PatientShell>;
}

