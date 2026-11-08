'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {after} from 'next/server';
import {redirect} from 'next/navigation';
import {revalidatePath} from 'next/cache';
import type {Route} from 'next';
import {conversationFailureCodes,staffWorkspaceSchema} from '@/lib/conversation-persistence/contracts';
import {assignedDoctorConversation} from '@/lib/conversation-persistence/server';
import {runConfiguredTelegramSweep} from '@/lib/telegram-runtime/server';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
export const readConversation=loggedAction("readConversation",async function readConversation(memberId:string){return staffWorkspaceSchema.parse(await(await assignedDoctorConversation()).workspace(memberId));});
/** POST action issues exact draft-bound intents; loading a GET never approves. */
export const conversationActions=loggedAction("conversationActions",async function conversationActions(memberId:string){return(await assignedDoctorConversation()).actions(memberId);},{failureCode:'prepare_failed',failureCodes:conversationFailureCodes});
export const commandConversation=loggedAction("commandConversation",async function commandConversation(command:unknown,decision?:unknown){
 if(decision!==undefined){const {doctorDecisionsEnabled}=await import('@/lib/staff-zoe/workspace-config');if(!doctorDecisionsEnabled())return {ok:false as const,code:'disabled'};}
 const result=await(await assignedDoctorConversation()).command(command,decision);
 // A newly queued approved reply is sent right after the response; the cron sweep
 // is the fallback. Sending reclaims nothing: each delivery allows one attempt.
 if(result.ok&&result.purpose==='reply.approve'&&result.deliveryId&&!result.replayed)after(async()=>{await runConfiguredTelegramSweep().catch(()=>null);});
 // Doctor takeover (Astra DT-02): an approval may switch the thread to doctor mode, so the page's server-rendered
 // "You are answering this member" panel (with Hand back to Zoe) is refreshed with the action's response.
 if(result.ok&&result.purpose==='reply.approve')revalidatePath('/staff/real/conversations/[id]','page');
 return result;
},{failureCode:'approval_failed',failureCodes:conversationFailureCodes});
/** Retrying is an explicit staff action; SQL rechecks authority, route and context. */
export const retryConversationDelivery=loggedAction('retryConversationDelivery',async function retryConversationDelivery(deliveryId:string){
 const result=await(await assignedDoctorConversation()).retryDelivery(deliveryId);
 if(result.ok){after(async()=>{await runConfiguredTelegramSweep().catch(()=>null);});revalidatePath('/staff/real/conversations/[id]','page');}
 return result;
},{failureCode:'retry_failed',failureCodes:conversationFailureCodes});
export const readAwaitingReplies=loggedAction("readAwaitingReplies",async function readAwaitingReplies(){return(await assignedDoctorConversation()).awaiting();});
export const readZoeAnswered=loggedAction("readZoeAnswered",async function readZoeAnswered(){return(await assignedDoctorConversation()).zoeAnswered();});
export const composeConversationReply=loggedAction("composeConversationReply",async function composeConversationReply(input:unknown){return(await assignedDoctorConversation()).compose(input);},{failureCode:'compose_failed',failureCodes:conversationFailureCodes});
export const editConversationSummary=loggedAction("editConversationSummary",async function editConversationSummary(input:unknown){return(await assignedDoctorConversation()).editSummary(input);},{failureCode:'compose_failed',failureCodes:conversationFailureCodes});

export const recoverConversationCommand=loggedAction("recoverConversationCommand",async function recoverConversationCommand(memberId:string,input:unknown){
 const result=await(await assignedDoctorConversation()).recover(memberId,input);
 // A recovered approval may have switched the thread to doctor mode (Astra DT-02).
 revalidatePath(`/staff/real/conversations/${memberId}`);
 return result;
});

/** Zoe's recent runs for the assigned doctor's own member; null when the pipeline is off. */
export const readZoeRuns=loggedAction("readZoeRuns",async function readZoeRuns(memberId:string){
 const {zoePipelineEnabled}=await import('@/lib/zoe/server');
 if(!zoePipelineEnabled())return null;
 const {zoeRunsSchema}=await import('@/lib/zoe/contracts');
 const {client}=await requireRealStaff();
 const {data,error}=await client.rpc('zoe_runs_for_doctor',{p_member:memberId});
 if(error)throw Error('Zoe runs unavailable');
 return zoeRunsSchema.parse(data).runs;
});

/** Zoe's symptom summaries for the assigned doctor's own member; null when the pipeline is off. */
export const readSymptomIntakes=loggedAction("readSymptomIntakes",async function readSymptomIntakes(memberId:string){
 const {zoePipelineEnabled}=await import('@/lib/zoe/server');
 if(!zoePipelineEnabled())return null;
 const {symptomIntakesSchema}=await import('@/lib/zoe/symptoms/contracts');
 const {client}=await requireRealStaff();
 const {data,error}=await client.rpc('zoe_symptom_intakes_for_doctor',{p_member:memberId});
 if(error)throw Error('Zoe symptom summaries unavailable');
 return symptomIntakesSchema.parse(data).intakes;
});

/** Zoe's structured reply drafts (sources, needs doctor judgement) for the assigned doctor's own member; null when the pipeline is off. */
export const readZoeReplyDrafts=loggedAction("readZoeReplyDrafts",async function readZoeReplyDrafts(memberId:string){
 const {zoePipelineEnabled}=await import('@/lib/zoe/server');
 if(!zoePipelineEnabled())return null;
 const {zoeReplyDraftsSchema}=await import('@/lib/zoe/reply-draft-contracts');
 const {client}=await requireRealStaff();
 const {data,error}=await client.rpc('zoe_reply_drafts_for_doctor',{p_member:memberId});
 if(error)throw Error('Zoe reply drafts unavailable');
 return zoeReplyDraftsSchema.parse(data).drafts;
});

/** Doctor takeover (20261020082321): whether the assigned doctor has this member's conversation, and since when. */
export const readDoctorMode=loggedAction("readDoctorMode",async function readDoctorMode(memberId:string){
 const {doctorModeSchema}=await import('@/lib/zoe/doctor-mode');
 const {client}=await requireRealStaff();
 const {data,error}=await client.rpc('doctor_zoe_mode',{p_member:memberId});
 if(error)throw Error(`Doctor mode unavailable for member ${memberId}`);
 return doctorModeSchema.parse(data);
});

/** The member's "New question" dividers (20261021070207): the message seqs after which a new question starts. */
export const readTopicBreaks=loggedAction("readTopicBreaks",async function readTopicBreaks(memberId:string){
 const {topicBreaksSchema}=await import('@/lib/zoe/doctor-mode');
 const {client}=await requireRealStaff();
 const {data,error}=await client.rpc('doctor_conversation_topic_breaks',{p_member:memberId});
 if(error)throw Error(`Topic dividers unavailable for member ${memberId}`);
 return topicBreaksSchema.parse(data).breaks.map(b=>b.afterSeq);
});

/** Hand the conversation back to Zoe (doctor_zoe_hand_back). The member's Telegram line is sent right after, as for a reply. */
export const handBackToZoeAction=loggedAction("handBackToZoe",async function handBackToZoeAction(form:FormData){
 const {handBackToZoe}=await import('@/lib/zoe/doctor-mode');
 const memberId=form.get('memberId');
 let notice:Awaited<ReturnType<typeof handBackToZoe>>='unavailable';
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role==='doctor')notice=await handBackToZoe({handBack:async id=>{
   const {data,error}=await client.rpc('doctor_zoe_hand_back',{p_member:id});
   if(error)throw Error(`Hand back unavailable for member ${id}`);return data;}},memberId);
 }catch{notice='unavailable';}
 if(notice==='handed_back')after(async()=>{await runConfiguredTelegramSweep({withZoe:false}).catch(()=>null);});
 const id=typeof memberId==='string'&&/^[0-9a-f-]{36}$/iu.test(memberId)?memberId:null;
 if(id)revalidatePath(`/staff/real/conversations/${id}`);
 redirect((id?`/staff/real/conversations/${id}?zoe=${notice}`:'/staff/real/conversations')as Route);
});

/** The member's 103 window (doctor_zoe_urgent_window, 20261020182719): open, since when, opened by a model or a rule. */
export const readUrgentWindow=loggedAction("readUrgentWindow",async function readUrgentWindow(memberId:string){
 const {urgentWindowSchema}=await import('@/lib/zoe/doctor-mode');
 const {client}=await requireRealStaff();
 const {data,error}=await client.rpc('doctor_zoe_urgent_window',{p_member:memberId});
 if(error)throw Error(`Urgent window unavailable for member ${memberId}`);
 return urgentWindowSchema.parse(data);
});

/** Clear the member's 103 alert (doctor_zoe_clear_urgent): the assigned doctor only; audited; the member is sent nothing. */
export const clearUrgentAction=loggedAction("clearUrgent",async function clearUrgentAction(form:FormData){
 const {clearUrgentWindow}=await import('@/lib/zoe/doctor-mode');
 const memberId=form.get('memberId');
 let notice:Awaited<ReturnType<typeof clearUrgentWindow>>='urgent_unavailable';
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role==='doctor')notice=await clearUrgentWindow({clear:async id=>{
   const {data,error}=await client.rpc('doctor_zoe_clear_urgent',{p_member:id});
   if(error)throw Error(`Clear urgent unavailable for member ${id}`);return data;}},memberId);
 }catch{notice='urgent_unavailable';}
 const id=typeof memberId==='string'&&/^[0-9a-f-]{36}$/iu.test(memberId)?memberId:null;
 if(id)revalidatePath(`/staff/real/conversations/${id}`);
 redirect((id?`/staff/real/conversations/${id}?zoe=${notice}`:'/staff/real/conversations')as Route);
});
