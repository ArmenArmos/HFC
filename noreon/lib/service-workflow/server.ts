import { clinicalLocale } from '@/lib/locale';
import {memberReviewStatus} from "@/lib/patient-care/review-status";
import { testById } from "@/lib/clinical/seed/tests";
import "server-only";
import { notFound } from "next/navigation";
import { readDemo, readDemoSnapshot, demoEnabled } from "@/lib/patient/demo";
import type { DemoState } from "@/lib/patient/demo-model";
type DemoSnapshot = NonNullable<Awaited<ReturnType<typeof readDemoSnapshot>>>;
import { normalizeSharedWorkflow } from "./normalization";
import { earliestAppointmentDay } from "./model";
import type { ServiceWorkflow } from "./types";
import { assignedCaseDoctor, sharedDemoEnabled } from "@/lib/staff/cases";
/** Read-only initialization; only explicit commands persist a workflow. */
export function workflowForDemo(data: DemoState): ServiceWorkflow | null {
  if (sharedDemoEnabled()) return data.workflow ? structuredClone(data.workflow) : null;
  const derived = structuredClone(data);
  normalizeSharedWorkflow(derived);
  const workflow = derived.workflow;
  if (!workflow) return null;
  const locale = clinicalLocale(data.state.profile?.locale ?? "en");
  workflow.tests = workflow.tests.map(t => ({...t, title:testById(t.id)?.name[locale] ?? t.title}));
  if (workflow.appointment?.status === "scheduled" && !workflow.allResultsAt && earliestAppointmentDay(workflow) === null)
    workflow.appointment.status = "needs-reschedule";
  return workflow;
}
export async function getServiceContext() {
  if (!demoEnabled()) return {workflow:null,pendingReview:null};
  const snapshot=await readDemoSnapshot();
  return serviceContextFromSnapshot(snapshot);
}
async function serviceContextFromSnapshot(snapshot: DemoSnapshot | null) {
  const workflow=snapshot ? workflowForDemo(snapshot.state) : null;
  if (workflow && snapshot?.workspaceCase) {
    const doctor=await assignedCaseDoctor(snapshot.workspaceCase);
    workflow.doctors=doctor ? [doctor] : [];
    workflow.assignedDoctorId=doctor?.id ?? "";
  }
  return {workflow,pendingReview:memberReviewStatus(snapshot?.workspaceCase?.reviewTasks??snapshot?.state.reviewTasks??[])};
}
export async function getServiceWorkflow(): Promise<ServiceWorkflow | null> {
  return (await getServiceContext()).workflow;
}
/** RSC presentation only; actions and route handlers must use fresh readers. */
export async function getServiceContextForRender() {
  if (!demoEnabled()) return {workflow:null,pendingReview:null};
  return serviceContextFromSnapshot(await readDemoSnapshot());
}
export async function getServiceWorkflowForRender(): Promise<ServiceWorkflow | null> {
  return (await getServiceContextForRender()).workflow;
}
export async function getStaffWorkflow() {
  if (!demoEnabled()) notFound();
  const data = await readDemo();
  if (!data?.state.profile || !data.state.consentAccepted) notFound();
  const workflow = workflowForDemo(data);
  if (!workflow) notFound();
  return {
    workflow,
    profile: data.state.profile,
    assessment: data.state.assessment,
    measurements: data.measurements,
    care: data.care,
    reviewTasks: data.reviewTasks,
  };
}
