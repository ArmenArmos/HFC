import { requireStaff } from "@/lib/staff/auth";
import { listCases } from "@/lib/staff/admin";
import { CaseQueue } from "@/components/staff/case-queue";
import { queueItem } from "@/lib/staff/queue";
import { workflowForDemo } from "@/lib/service-workflow/server";
import type { DemoState } from "@/lib/patient/demo-model";
export default async function DoctorHomePage() {
  await requireStaff("doctor");
  const {cases,monitoringWarning} = await listCases();
  const now = new Date();
  const items = cases.map(item => {
    const data = item.state as unknown as DemoState;
    return queueItem(item.id, data, workflowForDemo(data), now, item.reviewTask);
  }).sort((a, b) => a.priority - b.priority || (a.due ?? "").localeCompare(b.due ?? "") || a.name.localeCompare(b.name));
  return <>
    <header className="mb-7"><h1 className="text-h1">Your members</h1><p className="mt-2 text-body2 text-muted-foreground">Assigned cases, ordered by priority.</p></header>
    {monitoringWarning&&<p role="alert" className="mb-5 rounded-lg border p-4 text-body2">{monitoringWarning}</p>}
    <CaseQueue items={items} />
  </>;
}
