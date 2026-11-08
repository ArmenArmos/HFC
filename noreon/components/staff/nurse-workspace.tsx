import Link from "next/link";
import { toReport } from "@/lib/staff/reports";
import { extractionSchema } from "@/lib/reports/schema";
import type { WorkspaceCase } from "@/lib/staff/cases";
import type { ServiceWorkflow } from "@/lib/service-workflow/types";
import { fieldById } from "@/lib/clinical/seed/questions";
import { stamp, CareSection } from "@/components/patient-care/common";
import { CaseTabs, CasePanel } from "./case-sections";
export function NurseWorkspace({ item, workflow }: { item: WorkspaceCase; workflow: ServiceWorkflow }) {
  const assessment = item.state.state.assessment;
  return <>
    <header className="space-y-2"><p className="text-caption text-muted-foreground">Assigned member · nurse workspace</p><h1 className="text-h1">{item.state.state.profile?.name || "Member"}</h1><Link href="/staff/nurse" className="inline-flex min-h-11 items-center text-body2 underline">Back to assigned members</Link></header>
    <CaseTabs nurse />
    <CasePanel name="overview">
      <CareSection title="Care team"><p className="text-body2">Collect measurements and evidence, record contact, and refer clinical questions to the doctor.</p><p className="text-caption text-muted-foreground">Treatment changes and clinical approval belong to the assigned doctor.</p></CareSection>
      {assessment?.urgentRule && <p role="alert" className="rounded-lg border border-destructive p-4 text-body2">Urgent questionnaire guidance is active. Refer to the assigned doctor and follow the existing urgent pathway.</p>}
      <CareSection title="Current care"><p className="text-body2">{workflow.publication ? `Published plan version ${workflow.publication.version}` : "No published plan yet."}</p>{workflow.publication && <details><summary className="min-h-11 cursor-pointer text-body2">Read the published instructions</summary><p className="whitespace-pre-wrap text-body2">{workflow.publication.draft.instructions}</p><p className="whitespace-pre-wrap text-body2">{workflow.publication.draft.followUp}</p></details>}</CareSection>
    </CasePanel>
    <CasePanel name="results"><div className="grid gap-4 lg:grid-cols-2"><CareSection title="Recorded measurements">{item.state.measurements.length ? <ul className="divide-y">{item.state.measurements.map(m => <li key={m.id} className="py-3 text-body2">{m.systolic}/{m.diastolic} mmHg{m.pulse ? ` · Pulse ${m.pulse}` : ""}<span className="ml-3 text-caption text-muted-foreground">{stamp(m.measuredAt,"en")}</span></li>)}</ul> : <p className="text-body2">No measurements recorded.</p>}</CareSection>
      <CareSection title="Questionnaire evidence"><p className="text-body2">{assessment?.completedAt ? "Completed" : "Incomplete"}</p><details><summary className="min-h-11 cursor-pointer text-body2">Recorded answers</summary><dl className="divide-y">{Object.values(assessment?.answers || {}).map(answer => <div key={answer.fieldId} className="py-3"><dt className="text-caption text-muted-foreground">{fieldById(answer.fieldId)?.label.en || answer.fieldId}</dt><dd className="text-body2">{Array.isArray(answer.value) ? answer.value.join(", ") : String(answer.value)}</dd></div>)}</dl></details></CareSection>
      <CareSection title="Source reports">{item.reports.length ? <ul className="divide-y">{item.reports.map(row => { const report = toReport(row); const extracted = extractionSchema.safeParse(report.record.reviewed ?? report.record.extraction); return <li key={row.id} className="space-y-2 py-3"><p className="text-body2 font-medium">{typeof report.record.file_name === "string" ? report.record.file_name : "Source report"}</p>{report.objectPath ? <a href={`/staff/reports?caseId=${item.id}&original=${row.id}&preview=1`} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center text-body2 underline">Open original report</a> : <p className="text-caption text-muted-foreground">Original document unavailable.</p>}{extracted.success && <details><summary className="min-h-11 cursor-pointer text-body2">Recorded source values ({extracted.data.rows.length})</summary><ul className="space-y-2 text-body2">{extracted.data.rows.map((value, index) => <li key={index}>{value.name}: {value.literal} {value.unit || ""}{value.uncertain ? " · Needs clarification" : ""}</li>)}</ul></details>}</li>; })}</ul> : <p className="text-body2 text-muted-foreground">No source reports collected.</p>}</CareSection>
      <CareSection title="Ordered evidence"><ul className="divide-y">{workflow.tests.map(test => <li key={test.id} className="flex justify-between gap-3 py-3 text-body2"><span>{test.title}</span><span className="text-caption text-muted-foreground">{workflow.receivedTestIds.includes(test.id) ? "Received" : "Outstanding"}</span></li>)}</ul><p className="text-caption text-muted-foreground">Evidence notes do not approve these results.</p></CareSection>
    </div></CasePanel>
  </>;
}
