'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {revalidatePath} from 'next/cache';
import {after} from 'next/server';
import {redirect} from 'next/navigation';
import type {Route} from 'next';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {commandConversation,conversationActions} from '@/app/staff/real/conversation/actions';
import {decideInboxDraft,type DraftNotice} from '@/lib/doctor-inbox/draft-decision';
import {commandResultSchema} from '@/lib/conversation-persistence/contracts';
import {runConfiguredTelegramSweep} from '@/lib/telegram-runtime/server';
import {markZoeAnswered,type ZoeMarkNotice} from '@/lib/doctor-inbox/zoe-answered';

/** Approve or reject a reply draft from Today. Approval goes through the conversation review's own commands. */
async function decide(form:FormData,decision:'approve'|'reject'){
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='doctor')redirect('/staff/real/today?notice=access' as Route);
 let notice:DraftNotice='unavailable';
 try{
  notice=await decideInboxDraft({
   inbox:async()=>{const {data,error}=await client.rpc('doctor_ai_inbox');if(error)throw Error('Doctor inbox unavailable');return data;},
   actions:memberId=>conversationActions(memberId),
   command:input=>commandConversation(input),
   // The inbox gate (doctor_inbox_approve) then the same conversation_command; a newly queued reply is sent right
   // after the response, as commandConversation does, with the cron sweep as the fallback.
   approve:async(memberId,input)=>{
    const {data,error}=await client.rpc('doctor_inbox_approve',{p_member:memberId,p_command:input as never});
    if(error)throw Error(`Inbox approval unavailable for member ${memberId}`);
    const r=commandResultSchema.safeParse(data);
    if(r.success&&r.data.ok&&r.data.purpose==='reply.approve'&&r.data.deliveryId&&!r.data.replayed)after(async()=>{await runConfiguredTelegramSweep().catch(()=>null);});
    return data;
   },
   recordReason:async(draftId,reason,note)=>{const {data,error}=await client.rpc('conversation_draft_reject_reason',{p_draft:draftId,p_reason:reason,p_note:note??undefined});if(error)throw Error(`Reject reason not recorded for draft ${draftId}`);return data;},
   requestId:()=>crypto.randomUUID().replaceAll('-',''),
  },{decision,memberId:form.get('memberId'),draftId:form.get('draftId'),revision:form.get('revision'),contentHash:form.get('contentHash'),
   ...(decision==='reject'?{reason:form.get('reason'),note:form.get('note')??''}:{})});
 }catch{notice='unavailable';}
 revalidatePath('/staff/real/today');
 redirect(`/staff/real/today?notice=${notice}` as Route);
}

export const approveInboxDraft=loggedAction("approveInboxDraft",async function approveInboxDraft(form:FormData){await decide(form,'approve');});
export const rejectInboxDraft=loggedAction("rejectInboxDraft",async function rejectInboxDraft(form:FormData){await decide(form,'reject');});

/** Doctor inbox, part 2: mark a thread Zoe answered as reviewed, or reopen it for the doctor's reply (doctor_zoe_answered_mark). */
export const markZoeAnsweredAction=loggedAction("markZoeAnswered",async function markZoeAnsweredAction(form:FormData){
 const {client,identity}=await requireRealStaff();
 const from=form.get('from')==='replies'?'/staff/real/conversations':'/staff/real/today';
 if(identity.role!=='doctor')redirect(`${from}?notice=unavailable` as Route);
 let notice:ZoeMarkNotice='unavailable';
 try{
  notice=await markZoeAnswered({mark:async(memberId,action,version)=>{
   const {data,error}=await client.rpc('doctor_zoe_answered_mark',{p_member:memberId,p_action:action,p_version:version});
   if(error)throw Error(`Zoe-answered mark unavailable for member ${memberId}`);return data;}},
   {memberId:form.get('memberId'),action:form.get('action'),version:form.get('version')});
 }catch{notice='unavailable';}
 revalidatePath('/staff/real/today');revalidatePath('/staff/real/conversations');
 redirect(`${from}?notice=${notice}` as Route);
});
