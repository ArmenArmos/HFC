import { MonitoringPanel } from "@/components/service-workflow/monitoring-panel";
import { testById } from "@/lib/clinical/seed/tests";
import { CaseSections, CasePanel } from "@/components/staff/case-sections";
import { caseHistory } from "@/lib/notifications/server";
import { CaseHistory } from "@/components/staff/case-history";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/staff/auth";
import { assignedCaseDoctor, getWorkspaceCase, sharedDemoEnabled } from "@/lib/staff/cases";
import { workflowForDemo } from "@/lib/service-workflow/server";
import { DoctorWorkspace } from "@/components/service-workflow/staff";
import { DemoReportsProvider } from "@/components/service-workflow/reports-provider";
import { listNurses, listDoctors } from "@/lib/staff/admin";
import { NurseAssignment } from "@/components/staff/nurse-assignment";
import { CareTasks } from "@/components/staff/care-tasks";
import { NurseWorkspace } from "@/components/staff/nurse-workspace";
import { demoStaffBookingCommand } from "@/lib/demo-booking/actions";
import { OpsCase } from "@/components/staff/ops-case";

export default async function StaffCasePage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff();
  const { id } = await params;
  const item = await getWorkspaceCase(id, staff);
  const workflow = workflowForDemo(item.state);
  const { profile, assessment } = item.state.state;
  if (!profile || !workflow) notFound();
  // The staff workspace is English; member language must not change staff labels.
  workflow.tests = workflow.tests.map(t => ({ ...t, title: testById(t.id)?.name.en ?? t.title }));
  const doctor = await assignedCaseDoctor(item);
  workflow.doctors = doctor ? [doctor] : [];
  workflow.assignedDoctorId = doctor?.id ?? "";
  const history = await caseHistory(id,staff);
  const nurses = staff.role === "admin" ? await listNurses() : [];
  const doctors = staff.role === "admin" ? await listDoctors(false) : [];
  const clinicId = doctors.find(d => d.id === item.assignedDoctorId)?.clinicId;
  const eligibleNurses = nurses.filter(n => n.active && n.clinicId === clinicId);
  return <>
    <CaseSections doctor={staff.role !== "admin"}>
    <DemoReportsProvider key={id} shared={sharedDemoEnabled()} caseId={id}>
      {staff.role === "doctor"
        ? <DoctorWorkspace key={id} workflow={workflow} profile={profile} assessment={assessment} measurements={item.state.measurements} care={item.state.care} />
        : staff.role === "nurse" ? <NurseWorkspace item={item} workflow={workflow} /> : <OpsCase workflow={workflow} memberName={profile.name} questionnaireComplete={!!assessment?.completedAt} bookingAction={demoStaffBookingCommand.bind(null, id)} />}
    {staff.role === "admin" && <CasePanel name="overview"><NurseAssignment id={id} revision={item.revision} assignedNurseId={item.assignedNurseId} nurses={eligibleNurses} /></CasePanel>}
    {staff.role !== "admin" && <CasePanel name="followup"><CareTasks id={id} revision={item.revision} notes={item.careNotes} /></CasePanel>}
    <CasePanel name={staff.role === "admin" ? "overview" : "followup"}><MonitoringPanel role={staff.role} caseId={id} caseRevision={item.revision} workflow={workflow} initial={item.monitoring} expiresAt={item.expiresAt}/></CasePanel>
    <CasePanel name="history"><CaseHistory initialHistory={history} /></CasePanel>
    </DemoReportsProvider>
    </CaseSections>
  </>;
}
