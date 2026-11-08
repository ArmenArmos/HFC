import 'server-only';
import {approveCommandSchema,approveStatuses,doctorFirstNoteSchema,firstNoteQueueSchema,firstNoteQueueCountSchema,memberFirstNoteSchema,type ApproveResult,type DoctorFirstNote,type FirstNoteQueue,type MemberFirstNote} from './schema';
import {backlogCloseSchema,backlogReopenSchema,backlogStatuses,type BacklogResult} from './schema';

export type FirstNoteRpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
async function read<T>(c:FirstNoteRpc,name:string,args:Record<string,unknown>|undefined,parse:(v:unknown)=>{success:boolean;data?:T}):Promise<T|null>{
 try{const r=await c.rpc(name,args);if(r.error)return null;const p=parse(r.data);return p.success?p.data as T:null;}catch{return null;}
}
/** Assigned doctor only. Null when unreadable: the panel stays hidden. */
export const readDoctorFirstNote=(c:FirstNoteRpc,memberId:string):Promise<DoctorFirstNote|null>=>read(c,'doctor_first_note_read',{p_user_id:memberId},v=>doctorFirstNoteSchema.safeParse(v));
export const readFirstNoteQueue=(c:FirstNoteRpc):Promise<FirstNoteQueue|null>=>read(c,'doctor_first_note_queue',undefined,v=>firstNoteQueueSchema.safeParse(v));
export const readFirstNoteQueueCount=(c:FirstNoteRpc)=>read(c,'doctor_first_note_queue_count',undefined,v=>firstNoteQueueCountSchema.safeParse(v));
/** The member's own approved note while no plan is active. Undefined when unreadable, null when there is none. */
export async function readMemberFirstNote(c:FirstNoteRpc):Promise<MemberFirstNote|undefined>{
 try{const r=await c.rpc('patient_first_note');if(r.error)return undefined;const p=memberFirstNoteSchema.safeParse(r.data);return p.success?p.data:undefined;}catch{return undefined;}
}
/** A resend of the same submission returns its recorded outcome, so an unknown result can be retried. */
export async function runFirstNoteApprove(c:FirstNoteRpc,input:unknown):Promise<ApproveResult>{
 const cmd=approveCommandSchema.safeParse(input);if(!cmd.success)return {status:'invalid'};
 try{const r=await c.rpc('doctor_first_note_approve',{p_command:cmd.data});
  if(r.error)return {status:r.error.code==='42501'?'access':r.error.code==='55P03'?'unavailable':'outcome-unknown'};
  const s=(r.data as {status?:string}|null)?.status;
  return (approveStatuses as readonly string[]).includes(s??'')?{status:s as ApproveResult['status']}:{status:'outcome-unknown'};}catch{return {status:'outcome-unknown'};}
}

async function runBacklog(c:FirstNoteRpc,name:string,args:Record<string,unknown>):Promise<BacklogResult>{
 try{
  const r=await c.rpc(name,args);
  if(r.error)return {status:r.error.code==='42501'?'access':r.error.code==='55P03'?'unavailable':'outcome-unknown'};
  const status=(r.data as {status?:string}|null)?.status;
  return (backlogStatuses as readonly string[]).includes(status??'')?{status:status as BacklogResult['status']}:{status:'outcome-unknown'};
 }catch{return {status:'outcome-unknown'};}
}
export async function runFirstNoteBacklogClose(c:FirstNoteRpc,input:unknown):Promise<BacklogResult>{
 const cmd=backlogCloseSchema.safeParse(input);if(!cmd.success)return {status:'invalid'};
 return runBacklog(c,'doctor_first_note_backlog_close',{p_member:cmd.data.memberId,p_reason:cmd.data.reason});
}
export async function runFirstNoteBacklogReopen(c:FirstNoteRpc,input:unknown):Promise<BacklogResult>{
 const cmd=backlogReopenSchema.safeParse(input);if(!cmd.success)return {status:'invalid'};
 return runBacklog(c,'doctor_first_note_backlog_reopen',{p_member:cmd.data.memberId});
}
