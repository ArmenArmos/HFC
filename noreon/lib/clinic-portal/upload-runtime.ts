import 'server-only';
import{createHash}from'node:crypto';import{z}from'zod';import{readClinicBatch,type ClinicRpc}from'./runtime';import type{ClinicIdentity}from'./schema';import{CLINIC_UPLOAD_MAX_BYTES}from'./upload-limits';
const uuid=z.uuid();const privateTarget=z.strictObject({fileId:uuid,attemptId:uuid,executionId:uuid,actorId:uuid,sessionId:uuid,bucket:z.literal('clinic-originals'),objectKey:z.string().min(1).max(1024).refine(key=>!key.startsWith('/')&&!key.split('/').includes('..')),expectedSha256:z.string().regex(/^[a-f0-9]{64}$/),expectedSizeBytes:z.number().int().positive().max(8388608)});
export type ClinicUploadResult={status:'stored';fileId:string;batchId:string;revision:number}|{status:'access'|'invalid'|'unavailable'|'unknown'};
export type ClinicStorageService=ClinicRpc&{storage:{from:(bucket:string)=>{info:(key:string)=>PromiseLike<{data:unknown;error:unknown}>;upload:(key:string,bytes:Buffer,options:{contentType:string;upsert:false})=>PromiseLike<{data:unknown;error:unknown}>;download:(key:string)=>PromiseLike<{data:Blob|null;error:unknown}>}}};
type Context={rpc:ClinicRpc;identity:ClinicIdentity;execution:{actorId:string;sessionId:string};service:()=>ClinicStorageService|null};
const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** Service key is created only after scoped Auth read/capability. Private target
 * never leaves this server module. SQL separately rechecks original authority
 * after locks. Bytes stored privately are NOT claimed parsed/sanitized/released. */
export async function storeClinicOriginal(context:Context,input:{batchId:string;fileId:string;attemptId:string;bytes:Buffer}):Promise<ClinicUploadResult>{
 if(context.execution.actorId!==context.identity.userId)return{status:'access'};
 if(![input.batchId,input.fileId,input.attemptId].every(id=>uuid.safeParse(id).success)||!Buffer.isBuffer(input.bytes)||!input.bytes.length||input.bytes.length>CLINIC_UPLOAD_MAX_BYTES)return{status:'invalid'};
 const bytes=Buffer.from(input.bytes);if(bytes.subarray(0,5).toString('ascii')!=='%PDF-')return{status:'invalid'};
 const read=await readClinicBatch(context.rpc,context.identity,input.batchId);if(read.status!=='loaded'||!read.data.capabilities.upload)return{status:'unavailable'};
 let page=read.data,file=page.files.find(f=>f.id===input.fileId&&f.upload.attemptId===input.attemptId);const cursors=new Set<string>();
 while(!file&&page.nextCursor){if(cursors.size>=3||cursors.has(page.nextCursor))return{status:'unavailable'};cursors.add(page.nextCursor);const next=await readClinicBatch(context.rpc,context.identity,input.batchId,page.nextCursor);if(next.status!=='loaded'||next.data.batch.revision!==read.data.batch.revision||!next.data.capabilities.upload)return{status:'unavailable'};page=next.data;file=page.files.find(f=>f.id===input.fileId&&f.upload.attemptId===input.attemptId);}
 if(!file||file.upload.status==='rejected')return{status:'access'};
 if(bytes.length>read.data.limits.maxFileBytes)return{status:'invalid'};
 const checksum=digest(bytes);
 if(file.upload.status==='stored')return file.checksum===checksum&&file.sizeBytes===bytes.length?{status:'stored',fileId:file.id,batchId:input.batchId,revision:read.data.batch.revision}:{status:'invalid'};
 let service:ClinicStorageService|null;try{service=context.service();}catch{return{status:'unavailable'};}if(!service)return{status:'unavailable'};
 // Invoking target may durably claim execution even if its response is lost.
 // Only this handler's complete fresh acknowledgement can authorize an end.
 try{
  const raw=await service.rpc('clinic_upload_target',{p_file:input.fileId,p_actor:context.execution.actorId,p_session:context.execution.sessionId});if(raw.error)return{status:raw.error.code==='42501'?'access':'unknown'};
  const parsed=privateTarget.safeParse(raw.data);if(!parsed.success)return{status:'unknown'};const target=parsed.data;
  if(target.fileId!==file.id||target.attemptId!==input.attemptId||target.executionId!==input.attemptId||target.actorId!==context.execution.actorId||target.sessionId!==context.execution.sessionId)return{status:'access'};
  // No Storage operation has been invoked, and this response proves THIS
  // handler owns the fresh one-shot claim. Never derive this from known IDs.
  if(target.expectedSha256!==checksum||target.expectedSizeBytes!==bytes.length){
   const end=await service.rpc('clinic_upload_execution_end',{p_file:input.fileId,p_attempt:target.executionId,p_outcome:{kind:'not_invoked'}});
   return{status:end.error?'unknown':'invalid'};
  }
  const storage=service.storage.from(target.bucket);
  const uploaded=await storage.upload(target.objectKey,bytes,{contentType:'application/pdf',upsert:false});
  // An SDK error/timeout can leave an external write in flight. No readback,
  // new upload, execution_end or cleanup can turn that into a conclusive end.
  if(uploaded.error||typeof uploaded.data!=='object'||uploaded.data===null||!('path'in uploaded.data)||uploaded.data.path!==target.objectKey)return{status:'unknown'};
  const info=await storage.info(target.objectKey);if(info.error)return{status:'unknown'};
  const object=z.object({id:uuid}).safeParse(info.data);if(!object.success)return{status:'unknown'};
  if('id'in uploaded.data&&uploaded.data.id!==object.data.id)return{status:'unknown'};
  const downloaded=await storage.download(target.objectKey);if(downloaded.error||!downloaded.data)return{status:'unknown'};
  const endCompleted=()=>service.rpc('clinic_upload_execution_end',{p_file:input.fileId,p_attempt:target.executionId,p_outcome:{kind:'storage_completed',objectId:object.data.id}});
  // Positive upload ACK + exact info UUID are conclusive physical completion,
  // even if the subsequent local validation fails. This is never a finally.
  if(downloaded.data.size!==bytes.length){await endCompleted();return{status:'unknown'};}
  const actual=Buffer.from(await downloaded.data.arrayBuffer());if(actual.length!==target.expectedSizeBytes||digest(actual)!==target.expectedSha256){await endCompleted();return{status:'unknown'};}
  const result=await service.rpc('clinic_upload_finalize',{p_file:input.fileId,p_object:object.data.id,p_sha256:digest(actual),p_size:actual.length});
  // 55000: the attempt was retired while its bytes were being written (WP-11 review R1). The write
  // is proven complete above, so end it; the cleanup run then removes the original.
  if(result.error){if(result.error.code&&['42501','40001','22023','55P03','55000'].includes(result.error.code))await endCompleted();return{status:'unknown'};}
  const saved=z.strictObject({status:z.literal('stored'),fileId:uuid,revision:z.number().int().nonnegative().safe()}).safeParse(result.data);if(!saved.success||saved.data.fileId!==input.fileId)return{status:'unknown'};
  // Successful finalize ends its own execution. No second end acknowledgement.
  return{...saved.data,batchId:input.batchId};
 }catch{return{status:'unknown'};}
}
