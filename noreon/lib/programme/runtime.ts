import 'server-only';
import {checkinCommandSchema,confirmCommandSchema,doctorMemberSchema,doctorQueueSchema,memberTimelineSchema,
 type CheckinResult,type ConfirmResult,type DoctorMember,type DoctorQueue,type MemberTimeline} from './schema';

export type ProgrammeRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>};

async function read<T>(rpc:ProgrammeRpc,name:string,args:Record<string,unknown>|undefined,parse:(v:unknown)=>{success:boolean;data?:T}):Promise<T|null>{
 try{const r=await rpc.rpc(name,args);if(r.error)return null;const p=parse(r.data);return p.success?p.data as T:null;}catch{return null;}
}
/** The member's own programme. Null means unreadable, never "not started". */
export const readMemberTimeline=(rpc:ProgrammeRpc):Promise<MemberTimeline|null>=>read(rpc,'member_programme_timeline',undefined,v=>memberTimelineSchema.safeParse(v));
/** Assigned doctor only; the database enforces the switch and the assignment. */
export const readDoctorMember=(rpc:ProgrammeRpc,memberId:string):Promise<DoctorMember|null>=>read(rpc,'doctor_programme_member',{p_user_id:memberId},v=>doctorMemberSchema.safeParse(v));
export const readDoctorQueue=(rpc:ProgrammeRpc):Promise<DoctorQueue|null>=>read(rpc,'doctor_programme_queue',undefined,v=>doctorQueueSchema.safeParse(v));

const refused=(code?:string)=>code==='42501'?'access':code==='55P03'?'off':code==='22023'?'invalid':'outcome-unknown';
/** A resend of the same submission returns the recorded outcome, so an unknown result can be retried. */
export async function runCheckin(rpc:ProgrammeRpc,input:unknown):Promise<CheckinResult>{
 const c=checkinCommandSchema.safeParse(input);if(!c.success)return{status:'invalid'};
 try{const r=await rpc.rpc('member_programme_checkin_submit',{p_checkpoint:c.data.checkpointId,p_feeling:c.data.feeling,p_medicines:c.data.medicines,p_note:c.data.note?.trim()||null,p_submission:c.data.submissionId});
  if(r.error)return{status:refused(r.error.code)} as CheckinResult;
  const s=(r.data as {status?:string}|null)?.status;
  return s==='saved'||s==='already'||s==='closed'?{status:s}:{status:'outcome-unknown'};}catch{return{status:'outcome-unknown'};}
}
export async function runConfirm(rpc:ProgrammeRpc,input:unknown):Promise<ConfirmResult>{
 const c=confirmCommandSchema.safeParse(input);if(!c.success)return{status:'invalid'};
 try{const r=await rpc.rpc('doctor_programme_confirm',{p_user_id:c.data.memberId,p_checkpoint:c.data.checkpointId,p_note:c.data.note?.trim()||null,p_submission:c.data.submissionId});
  if(r.error)return{status:refused(r.error.code)} as ConfirmResult;
  const s=(r.data as {status?:string}|null)?.status;
  return s==='confirmed'||s==='closed'||s==='no_plan'?{status:s}:{status:'outcome-unknown'};}catch{return{status:'outcome-unknown'};}
}
