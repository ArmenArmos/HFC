import 'server-only';
import {z} from 'zod';
import type {ClinicRpc} from '@/lib/clinic-portal/runtime';
import {clinicChangeRequestSchema,staffChangeRequestSchema,decisionInputSchema,decisionResultSchema,type RequestList,type DecisionOutcome} from './approvals-schema';
/** Only the authenticated RPC decides authorization and exposes a scoped summary. */
export async function readChangeRequests(rpc:ClinicRpc,clinicId:string|null,state:'pending'|'decided'='pending'):Promise<RequestList>{
 try{
  const result=await rpc.rpc(clinicId?'clinic_admin_change_requests':'staff_clinic_change_requests',{...(clinicId?{p_clinic:clinicId}:{}),p_state:state});
  if(result.error)return{status:result.error.code==='42501'?'refused':'unavailable'};
  const schema=z.union([z.strictObject({status:z.literal('disabled')}),z.strictObject({status:z.literal('ok'),requests:z.array(clinicId?clinicChangeRequestSchema:staffChangeRequestSchema).max(100)})]);
  const parsed=schema.safeParse(result.data);if(!parsed.success)return{status:'unavailable'};
  if(parsed.data.status==='disabled')return{status:'disabled'};
  if(clinicId&&parsed.data.requests.some(r=>r.clinicId!==clinicId))return{status:'unavailable'};
  if(parsed.data.requests.some(r=>state==='pending'?r.state!=='pending':r.state==='pending'))return{status:'unavailable'};
  return{status:'loaded',requests:parsed.data.requests.filter(r=>r.kind==='care_team')};
 }catch{return{status:'unavailable'};}
}
export async function decideChangeRequest(rpc:ClinicRpc,clinicId:string|null,input:unknown):Promise<DecisionOutcome>{
 const parsed=decisionInputSchema.safeParse(input);if(!parsed.success)return parsed.error.issues.some(i=>i.message==='reason_required')?'reason_required':'invalid';
 if(!clinicId&&parsed.data.decision==='cancel')return'refused';
 try{
  const result=await rpc.rpc(clinicId?'clinic_admin_change_decide':'staff_clinic_change_decide',{...(clinicId?{p_clinic:clinicId}:{}),p_request:parsed.data.requestId,p_decision:parsed.data.decision,p_note:parsed.data.note??null});
  if(result.error)return result.error.code==='42501'?'refused':'unavailable';
  const value=decisionResultSchema.safeParse(result.data);return value.success?value.data.status:'unavailable';
 }catch{return'unavailable';}
}
