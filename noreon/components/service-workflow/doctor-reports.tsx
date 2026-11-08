"use client";
import type { ServiceWorkflow } from "@/lib/service-workflow/types";
import { HistoricalCharts } from "@/components/reports/historical-charts";
import { ReportWorkspace } from "@/components/reports/report-workspace";
export function DoctorReports({
  locale,
  doctorName,
  memberName,
  workflow,
}: {
  locale: "en" | "hy";
  doctorName: string;
  memberName: string;
  workflow: ServiceWorkflow;
}) {
  return (
    <section id="uploaded-reports" className="scroll-mt-6 border-t pt-8">
      <h2 className="text-h2">Historical reports</h2>
      <p className="mb-5 mt-2 text-body2 text-muted-foreground">
        These imported reports provide historical context. They do not replace
        or satisfy any current test ordered for this case.
      </p>
      <details className="mb-6">
        <summary className="min-h-11 cursor-pointer text-body2 font-medium">See historical charts</summary>
        <HistoricalCharts doctor locale={locale} />
      </details>
      <ReportWorkspace
        locale={locale}
        enabled={false}
        demo
        memberName={memberName}
        workflow={workflow}
        demoAi
        doctorName={doctorName}
      />
    </section>
  );
}
