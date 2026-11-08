import type { DemoState } from '@/lib/patient/demo-model';
import type { ServicePublication } from './types';
import {workflowCare} from './model';
import {canReportDose} from '@/lib/patient-care/model';

export function careAfterPublication(care: DemoState['care'], prior: ServicePublication | null): NonNullable<DemoState['care']> {
  const next: NonNullable<DemoState["care"]>=structuredClone(care ?? {stage:'profile',events:[],acknowledged:false});
  next.acknowledgements ??= prior && next.acknowledged ? [{planId:`workflow-plan-${prior.version}`,at:null}] : [];
  next.acknowledged=false;
  return next;
}
function requireCurrentPlan(data: DemoState, planId: string) {
  if (!data.workflow?.publication || `workflow-plan-${data.workflow.publication.version}` !== planId)
    throw new Error('Your care plan changed. Refresh and review the current plan.');
  return data.workflow;
}
function ensureCare(data: DemoState) {
  const care=data.care ??= {stage:'profile',events:[],acknowledged:false};
  care.acknowledgements ??= care.acknowledged && data.workflow?.publication ? [{planId:`workflow-plan-${data.workflow.publication.version}`,at:null}] : [];
  return care;
}
export function acknowledgeDemoPlan(data: DemoState, planId: string, now: Date) {
  requireCurrentPlan(data,planId);
  const care=ensureCare(data);
  if (!care.acknowledgements!.some(a=>a.planId===planId)) care.acknowledgements!.push({planId,at:now.toISOString()});
  care.acknowledged=true;
}
export function recordDemoDose(data: DemoState, planId: string, medicationId: string, dueAt: string,
  status: 'taken' | 'skipped', now: Date, offset: -15 | 0 | 15) {
  const workflow=requireCurrentPlan(data,planId);
  if (status!=='taken' && status!=='skipped') throw new Error('Choose taken or skipped.');
  const care=ensureCare(data);
  if (!canReportDose(workflowCare(workflow,care.events,care.acknowledgements!),medicationId,dueAt,now,offset))
    throw new Error('This dose is not available for check-in. Refresh the current schedule.');
  const existing=care.events.find(e=>e.medicationId===medicationId && Date.parse(e.dueAt)===Date.parse(dueAt));
  if (existing?.status===status) return;
  care.events=care.events.filter(e=>e!==existing);
  care.events.push({medicationId,planId:existing ? existing.planId : planId,dueAt:new Date(dueAt).toISOString(),status,recordedAt:now.toISOString()});
}
