import 'server-only';
import{z}from'zod';
import{visitCommandSchema,visitCommandResultSchema,visitReadSchema,visitRefreshInputSchema,visitRefreshResultSchema,type VisitCommand,type VisitCommandResult,type VisitRead,type VisitRefreshInput,type VisitRefreshResult}from'./visit-evidence-schema';
import{isFutureMeasurement}from'@/lib/patient/measured-at';
export type VisitRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null;status?:number}>};
type Context={memberId:string;client:VisitRpc};
const uncertain=():VisitCommandResult=>({status:'outcome-unknown'});
const unavailable=():VisitRefreshResult=>({status:'unavailable'});
function invalid():VisitCommandResult{return{status:'invalid',issues:[{path:'',message:'Check the visit details.'}]};}
function receiptIdentity(command:VisitCommand,receipt:{submissionId:string;visitId:string;revision:number;entryIds:string[]}){
 return receipt.submissionId===command.submissionId&&receipt.visitId===command.visitId&&receipt.revision===command.revision+1
  &&receipt.entryIds.length===(command.op==='open-visit'?0:command.entries.length)&&new Set(receipt.entryIds).size===receipt.entryIds.length;
}
/** Uses only the authenticated scoped client; no service writer or actor argument. */
export async function readVisitEvidence(context:Context):Promise<VisitRead>{
 const response=await context.client.rpc('patient_staff_visit_workspace',{p_member:context.memberId});
 if(response.error)throw Object.assign(Error('Visit evidence is unavailable.'),{code:response.error.code});
 const parsed=visitReadSchema.safeParse(response.data);
 if(!parsed.success||parsed.data.memberId!==context.memberId)throw Error('Visit evidence is unavailable.');
 return parsed.data;
}
export async function saveVisitEvidence(context:Context,raw:unknown):Promise<VisitCommandResult>{
 const parsed=visitCommandSchema.safeParse(raw);if(!parsed.success)return invalid();
 const command=parsed.data;if(command.id!==context.memberId||!z.uuid().safeParse(context.memberId).success)return{status:'access'};
 // A future observed time would make a reading count as "latest" for days; the DB trigger refuses it too.
 if(command.op==='append-evidence'&&command.entries.some(e=>isFutureMeasurement(e.observedAt)))return{status:'invalid',issues:[{path:'entries',message:'An observed time is in the future.'}]};
 try{
  const response=await context.client.rpc('patient_staff_visit_command',{p_command:command});
  if(response.error){
   if(response.error.code==='42501')return{status:'access'};
   if(response.error.code==='40001')return{status:'stale'};
   if(response.error.code==='55P03')return{status:'unavailable'};
   if(['22023','22P02','23514'].includes(response.error.code??''))return invalid();
   return uncertain();
  }
  const result=visitCommandResultSchema.safeParse(response.data);if(!result.success)return uncertain();
  if(result.data.status==='saved'&&!receiptIdentity(command,result.data))return uncertain();
  return result.data;
 }catch{return uncertain();}
}
/** Recovery is a distinct RPC. No branch invokes save/execute, claims a receipt
 * from an ordinary read, or substitutes a local serialized flag for DB durability. */
export async function refreshVisitEvidence(context:Context,raw:unknown):Promise<VisitRefreshResult>{
 const parsed=visitRefreshInputSchema.safeParse(raw);if(!parsed.success)return unavailable();
 const input:VisitRefreshInput=parsed.data;if(input.id!==context.memberId)return{status:'access'};
 try{
  const response=await context.client.rpc('patient_staff_visit_refresh',{p_member:context.memberId,p_visit:input.visitId,p_command:input.command});
  if(response.error)return response.error.code==='42501'?{status:'access'}:unavailable();
  const parsedResult=visitRefreshResultSchema.safeParse(response.data);if(!parsedResult.success)return unavailable();
  const result=parsedResult.data;if(result.status!=='loaded')return result;
  if(result.data.memberId!==context.memberId)return unavailable();
  const receipt=result.receipt,command=input.command;
  if(!command)return receipt===null?result:unavailable();
  if(!receipt||receipt.submissionId!==command.submissionId)return unavailable();
  if(receipt.status==='committed'){
   if(!receiptIdentity(command,receipt)||result.data.revision<receipt.revision)return unavailable();
   const visit=result.data.visits.find(v=>v.id===command.visitId);if(!visit)return unavailable();
   if(!receipt.entryIds.every(id=>visit.entries.some(e=>e.id===id&&e.submissionId===command.submissionId)))return unavailable();
  }else if(receipt.status==='not-recorded'&&result.data.visits.some(v=>v.entries.some(e=>e.submissionId===command.submissionId)))return unavailable();
  return result;
 }catch{return unavailable();}
}
