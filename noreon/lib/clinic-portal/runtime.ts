import 'server-only';
import{z}from'zod';
import{clinicBatchesSchema,clinicCommandSchema,clinicCommandResultSchema,clinicSnapshotSchema,clinicRefreshSchema,type ClinicIdentity,type ClinicCommandResult,type ClinicRefreshResult}from'./schema';
import{CLINIC_UPLOAD_MAX_BYTES}from'./upload-limits';
/** Authenticated user's RPC only; no table/service-role fallback or browser actor argument. */
export type ClinicRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
const validCursor=z.string().min(1).max(1024).nullable();
export async function readClinicBatches(rpc:ClinicRpc,identity:ClinicIdentity,cursor:string|null=null){
 if(!validCursor.safeParse(cursor).success)return{status:'unavailable' as const};
 try{const r=await rpc.rpc('clinic_batches_page',{p_clinic_id:identity.clinicId,p_cursor:cursor,p_limit:50});if(r.error)return{status:'unavailable' as const};const p=clinicBatchesSchema.safeParse(r.data);return p.success&&p.data.clinicId===identity.clinicId?{status:'loaded' as const,data:p.data}:{status:'unavailable' as const};}catch{return{status:'unavailable' as const};}
}
export async function readClinicBatch(rpc:ClinicRpc,identity:ClinicIdentity,batchId:string,cursor:string|null=null){
 if(!z.uuid().safeParse(batchId).success||!validCursor.safeParse(cursor).success)return{status:'unavailable' as const};
 try{const r=await rpc.rpc('clinic_batch_read',{p_clinic_id:identity.clinicId,p_batch_id:batchId,p_cursor:cursor,p_limit:50});if(r.error)return{status:'unavailable' as const};const p=clinicSnapshotSchema.safeParse(r.data);return p.success&&p.data.batch.id===batchId&&p.data.batch.clinicId===identity.clinicId?{status:'loaded' as const,data:p.data}:{status:'unavailable' as const};}catch{return{status:'unavailable' as const};}
}
export async function runClinicCommand(rpc:ClinicRpc,identity:ClinicIdentity,input:unknown):Promise<ClinicCommandResult>{
 const p=clinicCommandSchema.safeParse(input);if(!p.success||p.data.clinicId!==identity.clinicId)return{status:'invalid'};
 // New reservations obey the transport limit; stored commands keep the wider database contract for recovery.
 if(p.data.op==='reserve-upload'&&p.data.declaredSizeBytes>CLINIC_UPLOAD_MAX_BYTES)return{status:'invalid'};
 try{const r=await rpc.rpc('clinic_batch_command',{p_command:p.data});if(r.error)return{status:'unknown'};const result=clinicCommandResultSchema.safeParse(r.data);if(!result.success)return{status:'unknown'};const value=result.data;if('submissionId'in value&&value.submissionId!==p.data.submissionId)return{status:'unknown'};if(value.status==='committed'&&(value.batchId!==p.data.batchId||(p.data.op==='reserve-upload'&&value.revision<p.data.revision)))return{status:'unknown'};return value;}catch{return{status:'unknown'};}
}
export async function refreshClinicCommand(rpc:ClinicRpc,identity:ClinicIdentity,input:unknown):Promise<ClinicRefreshResult>{
 const p=clinicCommandSchema.safeParse(input);if(!p.success||p.data.clinicId!==identity.clinicId)return{status:'unavailable'};
 try{const r=await rpc.rpc('clinic_batch_refresh',{p_clinic_id:identity.clinicId,p_batch_id:p.data.batchId,p_command:p.data});if(r.error)return{status:'unavailable'};const result=clinicRefreshSchema.safeParse(r.data);if(!result.success||(result.data.snapshot!==null&&(result.data.snapshot.batch.clinicId!==identity.clinicId||result.data.snapshot.batch.id!==p.data.batchId))||result.data.receipt.submissionId!==p.data.submissionId)return{status:'unavailable'};const receipt=result.data.receipt;if(receipt.status==='committed'&&(!result.data.snapshot||receipt.batchId!==p.data.batchId||receipt.revision>result.data.snapshot.batch.revision))return{status:'unavailable'};return result.data;}catch{return{status:'unavailable'};}
}
