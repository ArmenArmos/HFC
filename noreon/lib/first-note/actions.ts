'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {runFirstNoteApprove,runFirstNoteBacklogClose,runFirstNoteBacklogReopen,type FirstNoteRpc} from './runtime';
import {backlogCloseSchema,backlogReopenSchema,type ApproveResult,type BacklogResult} from './schema';
import {doctorDecisionsEnabled} from '@/lib/staff-zoe/workspace-config';
import {firstNoteContextSchema,runFirstNoteCard} from '@/lib/doctor-decisions/approvals';

/** The assigned doctor approves the first note (the database checks the assignment, the switch and the state). */
export const approveFirstNote=loggedAction('approveFirstNote',async function approveFirstNote(input:unknown,cardContext?:unknown):Promise<ApproveResult>{
 if(cardContext!==undefined){
  if(!doctorDecisionsEnabled())return {status:'disabled'};
  if(!firstNoteContextSchema.safeParse(cardContext).success)return {status:'invalid'};
 }
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')return {status:'access'};
 const result=cardContext===undefined?await runFirstNoteApprove(client as unknown as FirstNoteRpc,input):await runFirstNoteCard(client as unknown as FirstNoteRpc,{context:cardContext,note:input});
 if(result.status==='approved'){
  const id=(input as {memberId?:string}).memberId;
  if(id)revalidatePath(`/staff/real/members/${id}`);
  revalidatePath('/staff/real/members');
  if(cardContext!==undefined)revalidatePath('/staff/real/doctor-workspace');
 }
 return result;
});

function refreshFirstNotes(memberId:string){
 revalidatePath(`/staff/real/members/${memberId}`);
 revalidatePath('/staff/real/members');
 revalidatePath('/staff/real/today');
 revalidatePath('/staff/real/doctor-workspace');
}

export const closeFirstNoteBacklog=loggedAction('closeFirstNoteBacklog',async function closeFirstNoteBacklog(input:unknown):Promise<BacklogResult>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor'&&identity.role!=='admin')return {status:'access'};
 const cmd=backlogCloseSchema.safeParse(input);if(!cmd.success)return {status:'invalid'};
 const result=await runFirstNoteBacklogClose(client as unknown as FirstNoteRpc,cmd.data);
 if(result.status==='closed')refreshFirstNotes(cmd.data.memberId);
 return result;
});

export const reopenFirstNoteBacklog=loggedAction('reopenFirstNoteBacklog',async function reopenFirstNoteBacklog(input:unknown):Promise<BacklogResult>{
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor'&&identity.role!=='admin')return {status:'access'};
 const cmd=backlogReopenSchema.safeParse(input);if(!cmd.success)return {status:'invalid'};
 const result=await runFirstNoteBacklogReopen(client as unknown as FirstNoteRpc,cmd.data);
 if(result.status==='reopened')refreshFirstNotes(cmd.data.memberId);
 return result;
});
