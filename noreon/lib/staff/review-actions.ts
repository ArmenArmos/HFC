'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {z} from 'zod';
import {getStaff,workspaceAdmin} from './auth';
import {getWorkspaceCase,sharedDemoEnabled} from './cases';
const requestSchema=z.object({caseId:z.uuid(),taskId:z.uuid(),caseRevision:z.number().int().nonnegative(),evidenceRevision:z.number().int().nonnegative(),note:z.string().trim().min(1).max(1500)}).strict();
export const completeReviewNoChange=loggedAction("completeReviewNoChange",async function completeReviewNoChange(input:unknown):Promise<{ok:boolean;error?:string}> {
  const parsed=requestSchema.safeParse(input);
  if (!parsed.success) return {ok:false,error:'Enter a review note and refresh the current case before completing review.'};
  if (!sharedDemoEnabled()) return {ok:false,error:'Not available in this browser-only demo. Publish the reviewed plan instead.'};
  const staff=await getStaff();
  if (!staff || staff.role!=='doctor') return {ok:false,error:'Sign in as the assigned doctor.'};
  try {
    const p=parsed.data;
    await getWorkspaceCase(p.caseId,staff);
    const result=await workspaceAdmin().rpc('workspace_complete_review_no_change',{p_id:p.caseId,p_actor:staff.id,p_task_id:p.taskId,p_expected_revision:p.caseRevision,p_expected_evidence_revision:p.evidenceRevision,p_note:p.note});
    if (result.error) throw new Error(result.error.message);
    // The client refreshes its coherent snapshot; never replace its retained editor on read failure.
    return {ok:true};
  } catch(error) {
    const message=error instanceof Error ? error.message : '';
    return {ok:false,error:message.includes('conflict') ? 'This case changed. Refresh and review the current evidence before submitting again.' : message || 'Review was not completed. Refresh and try again.'};
  }
});
