import 'server-only';
import {confirmPassingCommandSchema,confirmPassingResultSchema,type ConfirmPassingResult} from './doctor-schema';
import {z} from 'zod';
import {autoAcceptBlock,type AutoAcceptReason} from './auto-accept';
import {identityCommandSchema,identityResultSchema,labReadSchema,overviewSchema,requestResultSchema,reviewCommandSchema,reviewResultSchema,type IdentityResult,type LabOverview,type LabRead,type RequestResult,type ReviewResult} from './doctor-schema';
export type LabRpcClient={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};

/** Null means unreadable, never "nothing read". The database enforces assignment and both switches. */
export async function readLabOverview(c:LabRpcClient,memberId:string):Promise<LabOverview|null>{
 if(!z.uuid().safeParse(memberId).success)return null;
 try{const r=await c.rpc('doctor_lab_ai_overview',{p_user_id:memberId});if(r.error)return null;const p=overviewSchema.safeParse(r.data);return p.success?p.data:null;}catch{return null;}
}
export async function readLab(c:LabRpcClient,memberId:string,fileId:string):Promise<LabRead|'access'|null>{
 if(!z.uuid().safeParse(memberId).success||!z.uuid().safeParse(fileId).success)return 'access';
 try{const r=await c.rpc('doctor_lab_ai_read',{p_user_id:memberId,p_file:fileId});if(r.error)return r.error.code==='42501'?'access':null;
  const p=labReadSchema.safeParse(r.data);return p.success?p.data:null;}catch{return null;}
}
const failure=(code?:string)=>code==='42501'?'access':code==='55P03'?'unavailable':'outcome-unknown';
/** Resending the same submission returns its recorded outcome, so an unknown result is checked by retrying. */
export async function runLabReview(c:LabRpcClient,memberId:string,input:unknown):Promise<ReviewResult>{
 const cmd=reviewCommandSchema.safeParse(input);if(!cmd.success||cmd.data.memberId!==memberId)return {status:'invalid'};
 try{const r=await c.rpc('doctor_lab_ai_value_review',{p_command:cmd.data});if(r.error)return {status:failure(r.error.code)};
  const p=reviewResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};}catch{return {status:'outcome-unknown'};}
}
export async function runLabIdentity(c:LabRpcClient,memberId:string,input:unknown):Promise<IdentityResult>{
 const cmd=identityCommandSchema.safeParse(input);if(!cmd.success||cmd.data.memberId!==memberId)return {status:'invalid'};
 try{const r=await c.rpc('doctor_lab_ai_identity_confirm',{p_command:cmd.data});if(r.error)return {status:failure(r.error.code)};
  const p=identityResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};}catch{return {status:'outcome-unknown'};}
}
export async function runLabRequest(c:LabRpcClient,memberId:string,fileId:string):Promise<RequestResult>{
 if(!z.uuid().safeParse(memberId).success||!z.uuid().safeParse(fileId).success)return {status:'invalid'};
 try{const r=await c.rpc('doctor_lab_ai_request',{p_user_id:memberId,p_file:fileId});if(r.error)return {status:r.error.code==='42501'?'access':'unavailable'};
  const p=requestResultSchema.safeParse(r.data);return p.success?p.data:{status:'unavailable'};}catch{return {status:'unavailable'};}
}

/** Compute on the server from the audited read, using the worker's exact safeguards. */
export function labRuleBlocks(data:Extract<LabRead,{enabled:true}>,today=new Date().toISOString().slice(0,10)):Record<string,AutoAcceptReason|null>{
 return Object.fromEntries(data.values.map(v=>[v.valueId,autoAcceptBlock({...v,canonical:null},data.job?.identityStatus??'unknown',data.uploadedAt.slice(0,10),today)]));
}

/** Confirm only values the database rules accept under lock; retries return the recorded counts. */
export async function runConfirmPassingLabValues(c:LabRpcClient,input:unknown):Promise<ConfirmPassingResult>{
 const cmd=confirmPassingCommandSchema.safeParse(input);if(!cmd.success)return {status:'invalid'};
 try{const r=await c.rpc('doctor_lab_ai_confirm_passing',{p_command:cmd.data});if(r.error)return {status:failure(r.error.code)};
  const p=confirmPassingResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};}catch{return {status:'outcome-unknown'};}
}
