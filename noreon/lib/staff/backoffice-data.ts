import "server-only";
import { listCases, listClinics, listDoctors } from "./admin";
import { operationsItem } from "./operations";
import { workflowForDemo } from "@/lib/service-workflow/server";
import type { DemoState } from "@/lib/patient/demo-model";
export async function backofficeData() {
  const [clinics, doctors, caseList] = await Promise.all([
    listClinics(),
    listDoctors(false),
    listCases(),
  ]);
  const {cases,monitoringWarning}=caseList;
  const activeClinics = clinics.filter((c) => c.active);
  const activeDoctors = doctors.filter(
    (d) => d.active && activeClinics.some((c) => c.id === d.clinicId),
  );
  const queue = cases
    .map((c) =>
      operationsItem(
        c.id,
        c.state as unknown as DemoState,
        workflowForDemo(c.state as unknown as DemoState),
        c.assignedDoctorId,
        doctors.find((d) => d.id === c.assignedDoctorId)?.name ?? "Unassigned",
        activeDoctors.some((d) => d.id === c.assignedDoctorId),
        new Date(),
        c.reviewTask,
      ),
    )
    .sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const followups=cases.flatMap(c=>(c.followups??[]).map(work=>({caseId:c.id,requirementId:work.requirementId,dueAt:work.dueAt,name:(c.state as unknown as DemoState).state.profile?.name??"Unnamed case",owner:activeDoctors.find(d=>d.id===c.assignedDoctorId)?.name??"Unassigned or inactive coverage"}))).sort((a,b)=>a.dueAt.localeCompare(b.dueAt));
  return { clinics, doctors, cases, activeClinics, activeDoctors, queue,followups,monitoringWarning };
}
