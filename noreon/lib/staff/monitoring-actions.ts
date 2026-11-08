'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {z} from 'zod';
import {getStaff,workspaceAdmin} from './auth';
import {getWorkspaceCase,sharedDemoEnabled} from './cases';
import {readDemoSnapshot,refreshSharedDemoSession} from '@/lib/patient/demo';
const base={caseId:z.uuid(),caseRevision:z.number().int().nonnegative()};
const schema=z.discriminatedUnion('op',[
 z.object({...base,op:z.literal('create'),evidenceRevision:z.number().int().nonnegative(),requestId:z.uuid(),startsAt:z.iso.datetime({offset:true}),endsAt:z.iso.datetime({offset:true}),count:z.number().int().min(1).max(1000),instructions:z.string().trim().min(1).max(1500)}).strict(),
 z.object({...base,op:z.literal('cancel'),requirementId:z.uuid(),note:z.string().trim().min(1).max(1500)}).strict(),
 z.object({...base,op:z.literal('contact'),requirementId:z.uuid(),outcome:z.enum(['attempted','reached','unreachable','referred']),note:z.string().trim().min(1).max(1500)}).strict(),
]);
export const monitoringCommand=loggedAction("monitoringCommand",async function monitoringCommand(input:unknown):Promise<{ok:boolean;error?:string}> {
 if(!sharedDemoEnabled())return {ok:false,error:'Monitoring requirements are available in the shared demo.'};
 const parsed=schema.safeParse(input);
 if(!parsed.success)return {ok:false,error:'Check the monitoring details and enter an outcome note where required.'};
 const staff=await getStaff();
 if(!staff)return {ok:false,error:'Sign in to your staff workspace.'};
 if(parsed.data.op!=='contact'&&staff.role!=='doctor')return {ok:false,error:'Only the assigned doctor can change monitoring requirements.'};
 try {
  const p=parsed.data;
  await getWorkspaceCase(p.caseId,staff);
  const db=workspaceAdmin();
  const common={p_id:p.caseId,p_actor:staff.id,p_expected_revision:p.caseRevision};
  const result=p.op==='create'
   ? await db.rpc('workspace_create_monitoring',{...common,p_expected_evidence:p.evidenceRevision,p_request_id:p.requestId,p_start:p.startsAt,p_end:p.endsAt,p_count:p.count,p_instructions:p.instructions})
   : p.op==='cancel'
   ? await db.rpc('workspace_cancel_monitoring',{...common,p_requirement:p.requirementId,p_note:p.note})
   : await db.rpc('workspace_followup_contact',{...common,p_requirement:p.requirementId,p_outcome:p.outcome,p_note:p.note});
  if(result.error) {
   const message=result.error.message;
   return {ok:false,error:result.error.code==='23P01'?'This window overlaps an active monitoring requirement. Choose another period or cancel the earlier requirement.':message.includes('conflict')?'This case changed. Refresh and review it before saving.':message.includes('future window')?'Choose a future window within this demo case’s lifetime, a count from 1 to 1000 and instructions.':message.includes('no longer open')?'This follow-up is no longer open. Refresh to see its outcome.':'The monitoring change could not be saved. Refresh and check the current case.'};
  }
  return {ok:true};
 }catch{return {ok:false,error:'The monitoring change could not be saved. Refresh and try again.'};}
});
export const acknowledgeMonitoring=loggedAction("acknowledgeMonitoring",async function acknowledgeMonitoring(requirementId:string):Promise<{ok:boolean;error?:string}> {
 if(!sharedDemoEnabled()||!z.uuid().safeParse(requirementId).success)return {ok:false,error:'unavailable'};
 try {
  const snapshot=await readDemoSnapshot();
  if(!snapshot?.workspaceCase||!snapshot.state.state.profile||!snapshot.state.state.consentAccepted)return {ok:false,error:'unavailable'};
  await refreshSharedDemoSession(snapshot.state);
  const result=await workspaceAdmin().rpc('workspace_acknowledge_monitoring',{p_id:snapshot.state.userId,p_requirement:requirementId});
  return result.error?{ok:false,error:'unavailable'}:{ok:true};
 }catch{return {ok:false,error:'unavailable'};}
});
