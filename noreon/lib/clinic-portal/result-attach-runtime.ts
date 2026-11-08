import 'server-only';
import{z}from'zod';
import type{ClinicRpc}from'./runtime';
import{resultAttachCommandSchema,resultAttachPageSchema,resultAttachResultSchema,resultDetachCommandSchema,resultDetachResultSchema,clinicResultVisitsSchema,clinicResultAttachCommandSchema,clinicResultAttachResultSchema,type ResultAttachResult,type ResultDetachResult,type ClinicResultAttachResult}from'./result-attach-schema';
/** Authenticated Noreon-admin RPCs only; the database enforces admin and clinic scope. */
export async function readResultAttachPage(rpc:ClinicRpc,clinicId:string){
 if(!z.uuid().safeParse(clinicId).success)return{status:'unavailable' as const};
 try{const r=await rpc.rpc('clinic_result_attach_page',{p_clinic:clinicId});if(r.error)return{status:'unavailable' as const};
  const p=resultAttachPageSchema.safeParse(r.data);return p.success&&p.data.clinic.id===clinicId?{status:'loaded' as const,data:p.data}:{status:'unavailable' as const};}catch{return{status:'unavailable' as const};}
}
/** Resending the same command is safe: an attach to the current visit changes nothing new. */
export async function runResultAttach(rpc:ClinicRpc,input:unknown):Promise<ResultAttachResult>{
 const command=resultAttachCommandSchema.safeParse(input);if(!command.success)return{status:'invalid'};
 try{const r=await rpc.rpc('clinic_result_attach_command',{p_command:command.data});
  if(r.error)return r.error.code==='42501'?{status:'access'}:r.error.code==='55P03'?{status:'unavailable'}:{status:'outcome-unknown'};
  const p=resultAttachResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};}catch{return{status:'outcome-unknown'};}
}
export async function runResultDetach(rpc:ClinicRpc,input:unknown):Promise<ResultDetachResult>{
 const command=resultDetachCommandSchema.safeParse(input);if(!command.success)return{status:'invalid'};
 try{const r=await rpc.rpc('clinic_result_detach_command',{p_command:command.data});
  if(r.error)return r.error.code==='42501'?{status:'access'}:r.error.code==='55P03'?{status:'unavailable'}:{status:'outcome-unknown'};
  const p=resultDetachResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};}catch{return{status:'outcome-unknown'};}
}
/** Audited open: the database logs the open before it returns the location. */
export async function openClinicOriginal(rpc:ClinicRpc,fileId:string){
 if(!z.uuid().safeParse(fileId).success)return null;
 try{const r=await rpc.rpc('clinic_admin_original_open',{p_file:fileId});if(r.error)return null;
  const p=z.strictObject({fileId:z.uuid(),bucket:z.literal('clinic-originals'),objectKey:z.string().min(1).max(1024),sha256:z.string().regex(/^[a-f0-9]{64}$/),sizeBytes:z.number().int().positive()}).safeParse(r.data);
  return p.success&&p.data.fileId===fileId?p.data:null;}catch{return null;}
}
export async function readClinicResultVisits(rpc:ClinicRpc,clinicId:string){
 try{const r=await rpc.rpc('clinic_portal_result_visits',{p_clinic:clinicId});if(r.error)return{status:'unavailable' as const};
  const p=clinicResultVisitsSchema.safeParse(r.data);return p.success?{status:'loaded' as const,data:p.data}:{status:'unavailable' as const};}catch{return{status:'unavailable' as const};}
}
export async function runClinicResultAttach(rpc:ClinicRpc,clinicId:string,input:unknown):Promise<ClinicResultAttachResult>{
 const command=clinicResultAttachCommandSchema.safeParse(input);if(!command.success)return{status:'invalid'};
 try{const r=await rpc.rpc('clinic_portal_result_attach',{p_clinic:clinicId,p_command:command.data});
  if(r.error)return r.error.code==='42501'?{status:'access'}:r.error.code==='55P03'?{status:'unavailable'}:{status:'outcome-unknown'};
  const p=clinicResultAttachResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};}catch{return{status:'outcome-unknown'};}
}
