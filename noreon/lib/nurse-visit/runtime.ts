import 'server-only';
import {z} from 'zod';
import {log} from '@/lib/observability/logger';
import {nurseVisitListSchema,nurseVisitListEnvelopeSchema,nurseVisitListRowSchema,nurseVisitDetailSchema,nurseVisitMarkCommandSchema,nurseVisitCompleteCommandSchema,nurseVisitMarkResultSchema,nurseVisitCompleteResultSchema,nurseVisitRecordSchema,nurseVisitStepCommandSchema,nurseVisitStepResultSchema,memberNurseVisitSchema,
 type NurseVisitList,type NurseVisitDetail,type NurseVisitMarkResult,type NurseVisitCompleteResult,type NurseVisitRecord,type NurseVisitStepResult,type MemberNurseVisit,type NurseVisitSource} from './schema';

import {nurseVisitCollectCommandSchema,nurseVisitCollectResultSchema,type NurseVisitCollectResult} from './schema';

export type NurseVisitRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};

/** The nurse's visits. Throws on an unreadable answer; the page shows it as unavailable. */
export async function readNurseVisits(client:NurseVisitRpc):Promise<NurseVisitList>{
 const r=await client.rpc('nurse_visit_list');
 if(r.error)throw Object.assign(Error('Nurse visits are unavailable.'),{code:r.error.code});
 const envelope=nurseVisitListEnvelopeSchema.safeParse(r.data);if(!envelope.success)throw Error('Nurse visits are unavailable.');
 if(!envelope.data.enabled)return envelope.data;
 // One malformed visit is skipped and logged by id, so it cannot blank the whole list (review F5).
 const visits=envelope.data.visits.flatMap(row=>{
  const parsed=nurseVisitListRowSchema.safeParse(row);if(parsed.success)return [parsed.data];
  const ids=z.object({source:z.string().max(40),id:z.uuid()}).safeParse(row);
  log.warn('Nurse visit row skipped',{source:ids.success?ids.data.source:null,visit_id:ids.success?ids.data.id:null});
  return [];
 });
 return nurseVisitListSchema.parse({...envelope.data,visits});
}
export async function readNurseVisit(client:NurseVisitRpc,memberId:string,source:NurseVisitSource,id:string):Promise<NurseVisitDetail>{
 const r=await client.rpc('nurse_visit_detail',{p_member:memberId,p_source:source,p_id:id});
 if(r.error)throw Object.assign(Error('Nurse visit is unavailable.'),{code:r.error.code});
 const parsed=nurseVisitDetailSchema.safeParse(r.data);if(!parsed.success)throw Error('Nurse visit is unavailable.');
 if('visit'in parsed.data&&parsed.data.visit.memberId!==memberId)throw Error('Nurse visit is unavailable.');
 return parsed.data;
}
export async function sendNurseVisitMark(client:NurseVisitRpc,raw:unknown):Promise<NurseVisitMarkResult>{
 const command=nurseVisitMarkCommandSchema.safeParse(raw);if(!command.success)return{status:'invalid'};
 try{
  const r=await client.rpc('nurse_visit_mark',{p_command:command.data});
  if(r.error)return{status:'outcome-unknown'};
  const parsed=nurseVisitMarkResultSchema.safeParse(r.data);if(!parsed.success)return{status:'outcome-unknown'};
  if(parsed.data.status==='saved'&&parsed.data.submissionId!==command.data.submissionId)return{status:'outcome-unknown'};
  return parsed.data;
 }catch{return{status:'outcome-unknown'};}
}
export async function sendNurseVisitComplete(client:NurseVisitRpc,raw:unknown):Promise<NurseVisitCompleteResult>{
 const command=nurseVisitCompleteCommandSchema.safeParse(raw);if(!command.success)return{status:'invalid'};
 try{
  const r=await client.rpc('nurse_visit_complete',{p_command:command.data});
  if(r.error)return{status:'outcome-unknown'};
  const parsed=nurseVisitCompleteResultSchema.safeParse(r.data);if(!parsed.success)return{status:'outcome-unknown'};
  if(parsed.data.status==='saved'&&(parsed.data.submissionId!==command.data.submissionId||parsed.data.visitId!==command.data.visitId))return{status:'outcome-unknown'};
  return parsed.data;
 }catch{return{status:'outcome-unknown'};}
}
export async function sendNurseVisitStep(client:NurseVisitRpc,raw:unknown):Promise<NurseVisitStepResult>{
 const command=nurseVisitStepCommandSchema.safeParse(raw);if(!command.success)return{status:'invalid'};
 try{
  const r=await client.rpc('nurse_visit_step',{p_command:command.data});
  if(r.error)return{status:'outcome-unknown'};
  const parsed=nurseVisitStepResultSchema.safeParse(r.data);if(!parsed.success)return{status:'outcome-unknown'};
  if(parsed.data.status==='saved'&&parsed.data.submissionId!==command.data.submissionId)return{status:'outcome-unknown'};
  return parsed.data;
 }catch{return{status:'outcome-unknown'};}
}
/** Doctor, nurse or admin: the member's nurse visits with timeline, items and comments; null when the
 * read failed or was refused. */
export async function readNurseVisitRecord(client:NurseVisitRpc,memberId:string):Promise<Extract<NurseVisitRecord,{enabled:boolean}>|null>{
 try{
  const r=await client.rpc('nurse_visit_record',{p_member:memberId});
  if(r.error)return null;
  const parsed=nurseVisitRecordSchema.safeParse(r.data);
  if(!parsed.success||!('enabled'in parsed.data))return null;
  if(parsed.data.visits.some(v=>v.visit.memberId!==memberId))return null;
  return parsed.data;
 }catch{return null;}
}
/** Member: the latest completed nurse visit since the latest plan. undefined when the read failed,
 * so a failed read never moves the member's next step. */
export async function readMemberNurseVisit(client:NurseVisitRpc):Promise<MemberNurseVisit|undefined>{
 try{
  const r=await client.rpc('patient_member_nurse_visit');
  if(r.error)return undefined;
  const parsed=memberNurseVisitSchema.safeParse(r.data);return parsed.success?parsed.data.visit:undefined;
 }catch{return undefined;}
}

export async function sendNurseVisitCollect(client:NurseVisitRpc,raw:unknown):Promise<NurseVisitCollectResult>{
 const command=nurseVisitCollectCommandSchema.safeParse(raw);if(!command.success)return{status:'invalid'};
 try{
  const response=await client.rpc('nurse_visit_collect',{p_command:command.data});
  if(response.error)return{status:'outcome-unknown'};
  const result=nurseVisitCollectResultSchema.safeParse(response.data);
  if(!result.success||result.data.status==='saved'&&result.data.submissionId!==command.data.submissionId)return{status:'outcome-unknown'};
  return result.data;
 }catch{return{status:'outcome-unknown'};}
}
