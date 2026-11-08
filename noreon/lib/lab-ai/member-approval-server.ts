import 'server-only';
import {z} from 'zod';
import {labAiEnabled} from './config';
import {approvalsSchema,approveCommandSchema,approveStatuses,type ApproveResult,type MemberUploadApprovals} from './member-approval';

type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
/** Assigned active doctor or active admin; the database refuses anyone else and records the read.
 * Undefined while the app switch is off; null means unreadable. */
export async function readMemberUploadApprovals(client:unknown,memberId:string):Promise<MemberUploadApprovals|null|undefined>{
 if(!labAiEnabled())return undefined;
 if(!z.uuid().safeParse(memberId).success)return null;
 try{
  const r=await (client as Rpc).rpc('staff_member_upload_approvals',{p_user_id:memberId});
  if(r.error)return null;
  const p=approvalsSchema.safeParse(r.data);
  return p.success?p.data:null;
 }catch{return null;}
}
/** A resend of the same submission returns its recorded outcome, so an unknown result can be retried. */
export async function runMemberUploadApprove(client:unknown,input:unknown):Promise<ApproveResult>{
 const cmd=approveCommandSchema.safeParse(input);if(!cmd.success)return {status:'invalid'};
 try{
  const r=await (client as Rpc).rpc('doctor_member_upload_approve',{p_command:cmd.data});
  if(r.error)return {status:r.error.code==='42501'?'access':r.error.code==='55P03'?'unavailable':'outcome-unknown'};
  const s=(r.data as {status?:string}|null)?.status;
  return (approveStatuses as readonly string[]).includes(s??'')?{status:s as ApproveResult['status']}:{status:'outcome-unknown'};
 }catch{return {status:'outcome-unknown'};}
}
