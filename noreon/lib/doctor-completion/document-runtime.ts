import 'server-only';
import {z} from 'zod';
import {documentCommandSchema,documentOpenSchema,documentResultSchema,doctorDocumentsReadSchema,memberDocumentsReadSchema,type DocumentResult,type DoctorDocumentsRead,type MemberDocument} from './document-schema';
import {planVersionsReadSchema,type PlanVersion} from './version-schema';
export type DocumentRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};

/** Assigned doctor only; the database enforces assignment and the switch. */
export async function readDoctorDocuments(rpc:DocumentRpc,memberId:string):Promise<DoctorDocumentsRead|null>{
 if(!z.uuid().safeParse(memberId).success)return null;
 try{const r=await rpc.rpc('doctor_member_documents',{p_user_id:memberId});if(r.error)return null;
  const p=doctorDocumentsReadSchema.safeParse(r.data);return p.success?p.data:null;}catch{return null;}
}
/** Resending the same submission returns its recorded outcome, so an unknown result can be checked by retrying. */
export async function runDocumentCommand(rpc:DocumentRpc,memberId:string,input:unknown):Promise<DocumentResult>{
 const command=documentCommandSchema.safeParse(input);if(!command.success||command.data.memberId!==memberId)return{status:'invalid'};
 try{const r=await rpc.rpc('doctor_member_document_command',{p_command:command.data});
  if(r.error)return r.error.code==='42501'?{status:'access'}:r.error.code==='55P03'?{status:'unavailable'}:{status:'outcome-unknown'};
  const p=documentResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};}catch{return{status:'outcome-unknown'};}
}
/** Audited open: the database logs the open before it returns the location. */
export async function openDoctorDocument(rpc:DocumentRpc,memberId:string,fileId:string){
 if(!z.uuid().safeParse(memberId).success||!z.uuid().safeParse(fileId).success)return null;
 try{const r=await rpc.rpc('doctor_member_document_open',{p_user_id:memberId,p_file:fileId});if(r.error)return null;
  const p=documentOpenSchema.safeParse(r.data);return p.success&&p.data.fileId===fileId?p.data:null;}catch{return null;}
}
/** Null means unreadable, never "no documents". */
export async function readMemberDocuments(rpc:DocumentRpc):Promise<MemberDocument[]|null>{
 try{const r=await rpc.rpc('patient_released_documents');if(r.error)return null;
  const p=memberDocumentsReadSchema.safeParse(r.data);return p.success?p.data.documents:null;}catch{return null;}
}
export async function openMemberDocument(rpc:DocumentRpc,fileId:string){
 if(!z.uuid().safeParse(fileId).success)return null;
 try{const r=await rpc.rpc('patient_released_document_open',{p_file:fileId});if(r.error)return null;
  const p=documentOpenSchema.safeParse(r.data);return p.success&&p.data.fileId===fileId?p.data:null;}catch{return null;}
}
/** Member's own plan versions, newest first. Null means unreadable. */
export async function readMemberPlanVersions(rpc:DocumentRpc):Promise<PlanVersion[]|null>{
 try{const r=await rpc.rpc('patient_care_plan_versions');if(r.error)return null;
  const p=planVersionsReadSchema.safeParse(r.data);return p.success?p.data.versions:null;}catch{return null;}
}
export async function readDoctorPlanVersions(rpc:DocumentRpc,memberId:string):Promise<PlanVersion[]|null>{
 if(!z.uuid().safeParse(memberId).success)return null;
 try{const r=await rpc.rpc('doctor_member_plan_versions',{p_user_id:memberId});if(r.error)return null;
  const p=planVersionsReadSchema.safeParse(r.data);return p.success?p.data.versions:null;}catch{return null;}
}
