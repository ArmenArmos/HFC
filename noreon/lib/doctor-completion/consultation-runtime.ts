import 'server-only';
import {arrangeCommandSchema,arrangeResultSchema,consultationQueueSchema,type ArrangeResult,type ConsultationQueue} from './consultation-schema';
import type {DocumentRpc} from './document-runtime';

/** Admin only; the database enforces the administrator session and the switch. Null means unreadable. */
export async function readConsultationQueue(rpc:DocumentRpc):Promise<ConsultationQueue|null>{
 try{const r=await rpc.rpc('admin_consultations_to_arrange');if(r.error)return null;
  const p=consultationQueueSchema.safeParse(r.data);return p.success?p.data:null;}catch{return null;}
}
/** Resending the same submission returns its recorded outcome, so an unknown result can be checked by retrying. */
export async function runArrangeCommand(rpc:DocumentRpc,input:unknown):Promise<ArrangeResult>{
 const command=arrangeCommandSchema.safeParse(input);if(!command.success)return{status:'invalid'};
 try{const r=await rpc.rpc('admin_consultation_arrange_command',{p_command:command.data});
  if(r.error)return r.error.code==='42501'?{status:'access'}:r.error.code==='55P03'?{status:'unavailable'}:{status:'outcome-unknown'};
  const p=arrangeResultSchema.safeParse(r.data);return p.success?p.data:{status:'outcome-unknown'};}catch{return{status:'outcome-unknown'};}
}
