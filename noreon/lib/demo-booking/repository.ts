import 'server-only';
import { evaluate } from '@/lib/clinical/rules/engine';
import { demoEnabled, readDemoSnapshot } from '@/lib/patient/demo';
import type { DemoState } from '@/lib/patient/demo-model';
import { workspaceAdmin } from '@/lib/staff/auth';
import { sharedDemoEnabled } from '@/lib/staff/cases';
import { workflowForDemo } from '@/lib/service-workflow/server';
import { bookingApplies } from '@/lib/service-workflow/reconciliation';
import type { MemberBookingData } from '@/lib/real-booking/schema';
import { DemoBookingError, demoBookingContext, getDemoStaffBookingRequests, type DemoBookingOperation } from './model';
export { getDemoStaffBookingRequests, type DemoBookingOperation } from './model';
export function requireStoredDemoBookingWorkflow(data:DemoState|null) {
  if(!demoEnabled()||!sharedDemoEnabled())throw new DemoBookingError('unavailable','Open the shared demo to arrange fictional provider tests.');
  if(!data?.state.profile||!data.state.consentAccepted)throw new DemoBookingError('unavailable','Complete your profile and consent first.');
  const workflow=workflowForDemo(data);
  if(!workflow)throw new DemoBookingError('unavailable','The recorded demo workflow is unavailable.');
  return workflow;
}
/** Cancellation never creates a new arrangement. Accepted replacements do. */
export function demoBookingNeedsClinicalEligibility(workflow:import('@/lib/service-workflow/types').ServiceWorkflow,command:DemoBookingOperation):boolean {
  if(command.operation==='cancel')return false;
  if(command.operation==='change-outcome')return command.outcome==='accepted' && workflow.bookingRequests?.find(request=>request.id===command.id)?.pendingChange?.kind==='reschedule';
  return true;
}
export function requireDemoBookingWorkflow(data:DemoState|null) {
  const workflow=requireStoredDemoBookingWorkflow(data);
  if(!data!.state.assessment?.completedAt)throw new DemoBookingError('unavailable','Complete your questionnaire first.');
  if(data!.state.assessment.urgentRule||evaluate({answers:data!.state.assessment.answers,observations:[]}).urgency==='red')throw new DemoBookingError('clinical-hold','Urgent health guidance takes priority. Review it before arranging routine tests.');
  if(workflow.recommendationsPending)throw new DemoBookingError('unavailable','Complete your current questionnaire first.');
  return workflow;
}
export async function getDemoMemberBookingData():Promise<MemberBookingData> {
  let recorded:MemberBookingData['requests']=[];
  try {
    const snapshot=await readDemoSnapshot();
    const saved=snapshot?.state.workflow;
    if(saved)recorded=getDemoStaffBookingRequests(saved);
    const workflow=requireDemoBookingWorkflow(snapshot?.state??null);
    const requests=getDemoStaffBookingRequests(workflow);
    // Retain legacy reservations and received results. They are not new pending requests.
    const requirements=workflow.tests.filter(t=>t.method!=='home-log'&&!workflow.receivedTestIds.includes(t.id)&&!workflow.bookings.some(b=>bookingApplies(workflow,b,t.id))).map(t=>({id:t.id,title:t.title,method:t.method as 'lab'|'clinic'}));
    const directory=await workspaceAdmin().from('workspace_clinics').select('id,name,address').eq('active',true).order('name');
    return {available:true,clinics:directory.error ? [] : directory.data,contextToken:demoBookingContext(workflow),requirements,homeTasks:workflow.tests.filter(t=>t.method==='home-log').map(t=>({id:t.id,title:t.title})),requests};
  }catch(error){return {available:false,message:error instanceof DemoBookingError?error.message:'Shared demo booking storage is unavailable. Try again.',requirements:[],homeTasks:[],requests:recorded};}
}
