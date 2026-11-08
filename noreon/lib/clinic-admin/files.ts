import 'server-only';
import{z}from'zod';
import type{ClinicRpc}from'@/lib/clinic-portal/runtime';
import{readClinicBatch,runClinicCommand}from'@/lib/clinic-portal/runtime';
import type{ClinicIdentity}from'@/lib/clinic-portal/schema';
import{CLINIC_UPLOAD_MAX_BYTES}from'@/lib/clinic-portal/upload-limits';
import{attachInputSchema,attachResultSchema,memberFilesSchema,memberUploadAttemptSchema,type AttachResult,type ReserveResult}from'./files-schema';
const id=z.uuid(),hash=z.string().regex(/^[a-f0-9]{64}$/);
const fileInput=z.strictObject({name:z.string().trim().min(1).max(180),size:z.number().int().positive().max(CLINIC_UPLOAD_MAX_BYTES),fingerprint:hash});
const registerSchema=z.strictObject({status:z.enum(['registered','refused','invalid','disabled','not_enrolled'])});
const label=(now=new Date())=>`Results upload ${new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',dateStyle:'medium',timeStyle:'short',hourCycle:'h23'}).format(now)}`;
export async function readMemberFiles(rpc:ClinicRpc,clinicId:string,memberId:string){
 if(!id.safeParse(memberId).success)return{status:'missing' as const};
 try{const r=await rpc.rpc('clinic_admin_member_files',{p_clinic:clinicId,p_member:memberId});
  if(r.error)return{status:r.error.code==='42501'?'forbidden' as const:'unavailable' as const};
  const p=memberFilesSchema.safeParse(r.data);if(!p.success)return{status:'unavailable' as const};
  if(!p.data.enabled)return{status:'disabled' as const};
  if(p.data.status==='refused')return{status:'missing' as const};
  return{status:'loaded' as const,data:p.data};
 }catch{return{status:'unavailable' as const};}
}
/** Starts one upload action: an implicit batch (the existing create-batch command), registered for this member. */
export async function beginMemberUpload(rpc:ClinicRpc,identity:ClinicIdentity,memberId:string,input:unknown={submissionId:crypto.randomUUID(),batchId:crypto.randomUUID(),name:label()}):Promise<{status:'started';batchId:string}|{status:'refused'|'invalid'|'unavailable'|'disabled'|'not_enrolled'}>{
 const attempt=memberUploadAttemptSchema.safeParse(input);
 if(!id.safeParse(memberId).success||!attempt.success)return{status:'invalid'};
 const {batchId}=attempt.data;
 const created=await runClinicCommand(rpc,identity,{version:'clinic-command-v1',op:'create-batch',...attempt.data,clinicId:identity.clinicId});
 if(created.status!=='committed')return{status:'unavailable'};
 try{const r=await rpc.rpc('clinic_admin_member_upload_register',{p_clinic:identity.clinicId,p_member:memberId,p_batch:batchId});
  if(r.error)return{status:r.error.code==='42501'?'refused':'unavailable'};
  const p=registerSchema.safeParse(r.data);if(!p.success)return{status:'unavailable'};
  return p.data.status==='registered'?{status:'started',batchId}:{status:p.data.status};
 }catch{return{status:'unavailable'};}
}
/** Reserves one file in the upload's batch (the existing reserve-upload command). The browser then sends the
 * bytes to the existing batch file route, which stores and checks them. */
export async function reserveMemberFile(rpc:ClinicRpc,identity:ClinicIdentity,batchId:string,input:unknown):Promise<ReserveResult>{
 const file=fileInput.safeParse(input);if(!id.safeParse(batchId).success||!file.success)return{status:'invalid'};
 const read=await readClinicBatch(rpc,identity,batchId);
 if(read.status!=='loaded'||!read.data.capabilities.upload)return{status:'unavailable'};
 const fileId=crypto.randomUUID(),attemptId=crypto.randomUUID();
 const r=await runClinicCommand(rpc,identity,{version:'clinic-command-v1',op:'reserve-upload',submissionId:crypto.randomUUID(),clinicId:identity.clinicId,batchId,revision:read.data.batch.revision,
  logicalKey:crypto.randomUUID(),fileId,attemptId,name:file.data.name,mime:'application/pdf',declaredSizeBytes:file.data.size,fingerprint:file.data.fingerprint});
 return r.status==='committed'?{status:'reserved',batchId,fileId,attemptId}:{status:r.status==='invalid'?'invalid':'unavailable'};
}
export async function attachMemberFile(rpc:ClinicRpc,clinicId:string,memberId:string,input:unknown):Promise<AttachResult>{
 const a=attachInputSchema.safeParse(input);if(!id.safeParse(memberId).success||!a.success)return{status:'invalid'};
 try{const r=await rpc.rpc('clinic_admin_member_file_attach',{p_clinic:clinicId,p_member:memberId,p_file:a.data.fileId,p_submission:a.data.submissionId,p_confirm:a.data.confirm,
   p_reason:a.data.reason||null,p_appointment:a.data.appointmentId??null});
  if(r.error)return r.error.code==='42501'?{status:'refused'}:{status:'outcome-unknown'};
  const p=attachResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};
 }catch{return{status:'outcome-unknown'};}
}
