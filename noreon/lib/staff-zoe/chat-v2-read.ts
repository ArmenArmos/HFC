import 'server-only';
import type {DoctorUploadOverride} from '@/lib/staff/doctor-upload-overrides';
import {z} from 'zod';
import type {StaffConversationWorkspace} from '@/lib/conversation-persistence/contracts';
import type {ZoeRunView} from '@/lib/zoe/contracts';
import {orderInbox,orderAlerts} from '@/lib/doctor-inbox/contracts';
import type {DoctorDay} from '@/lib/doctor-inbox/day';
import {doctorDayCounts} from '@/lib/doctor-inbox/day-counts';

export const uploadWaitingSchema=z.object({rows:z.array(z.object({memberId:z.uuid(),memberName:z.string(),documentId:z.uuid(),jobId:z.uuid(),at:z.iso.datetime({offset:true})})).max(60),total:z.number().int().nonnegative()});
export type ChatUploadsWaiting=z.infer<typeof uploadWaitingSchema>;

/** The bounded queues needed by this reply, without the rest of the doctor's day. */
export const savedPlansSchema=z.object({items:z.array(z.object({memberId:z.uuid(),memberName:z.string(),savedAt:z.string().datetime({offset:true})})),total:z.number().int().nonnegative()});
export type SavedPlans=z.infer<typeof savedPlansSchema>;
export type SavedPlanRow={kind:'saved_plan';id:string;memberId:string;memberName:string;at:string};
/** The read behind each day source: the only identifier the log allow-list lets through for a source. */
export const DAY_SOURCE_RPC:Readonly<Record<string,string>>={identity_checks:'doctor_mismatched_uploads',saved_plans:'doctor_saved_plans',uploads_waiting:'doctor_member_uploads_waiting',
 first_notes:'doctor_first_note_queue',ldl_responses:'doctor_ldl_responses',medicine_concerns:'doctor_medicine_concerns',tasks:'patient_coordination_queue',handoffs:'conversation_nurse_handoffs',
 care_alerts:'care_alert_inbox',urgent_windows:'doctor_urgent_windows',bp_repeat_notes:'doctor_bp_repeat_notes'};
/** Names only, never values: which day sources were unreadable. The same test as `incomplete`, so the log explains the banner. */
export function missingDaySources(day:DoctorDay,saved:SavedPlans|null,uploads:ChatUploadsWaiting|null,identityChecks:DoctorUploadOverride[]|null):string[]{
 return [...(identityChecks===null?['identity_checks']:[]),...(saved===null?['saved_plans']:[]),...(uploads===null?['uploads_waiting']:[]),...day.inbox.unavailable,
  ...(!day.firstNotes?['first_notes']:[]),...(!day.ldl?['ldl_responses']:[]),...(!day.medicines?['medicine_concerns']:[]),...(day.tasks===null?['tasks']:[]),...(day.handoffs===null?['handoffs']:[])];
}
export function whoNeedsMe(day:DoctorDay,saved:SavedPlans|null={items:[],total:0},uploads:ChatUploadsWaiting|null={rows:[],total:0},identityChecks:DoctorUploadOverride[]|null=[]){
 const {inbox}=day;
 const items=orderInbox(inbox.items.filter(i=>['reply_overdue','reply_draft','reply_not_delivered','intake','bp_repeat_pending'].includes(i.kind)));
 const labs=inbox.items.filter(i=>i.kind==='lab_attention'||i.kind==='lab_sheet');
 const aiPlans=inbox.items.filter(i=>i.kind==='plan_draft');
 const savedRows:SavedPlanRow[]=(saved?.items??[]).filter(i=>!aiPlans.some(ai=>ai.memberId===i.memberId)).map(i=>({kind:'saved_plan',id:`saved-plan:${i.memberId}`,memberId:i.memberId,memberName:i.memberName,at:i.savedAt}));
 const plans=[...aiPlans,...savedRows];
 const counts=doctorDayCounts(day);
 const missing=missingDaySources(day,saved,uploads,identityChecks);
 return {identityChecks:identityChecks??[],alerts:orderAlerts(inbox.p0),windows:day.windows,p0Total:counts.alerts,items,labs,plans,uploads:uploads?.rows??[],uploadTotal:uploads?.total??0,
  others:{rest:counts.total-counts.alerts-items.length-labs.length-aiPlans.length},
  urgentIncomplete:inbox.unavailable.some(source=>source==='care_alerts'||source==='urgent_windows'),
  // Same missing-source test as dayStatus, including the optional tasks/handoffs distinction.
  missing,incomplete:missing.length>0,
  capped:day.urgentCapped||!!saved&&saved.total>saved.items.length||!!uploads&&uploads.total>uploads.rows.length||inbox.p0Total>inbox.p0.length||inbox.items.some(i=>inbox.items.filter(x=>x.lane===i.lane).length>=inbox.laneCap)||!!day.tasks?.hasMore||!!day.handoffs?.hasMore,
  asOf:inbox.asOf};
}
export type ChatWho=ReturnType<typeof whoNeedsMe>;
export type ChatAlert=ChatWho['alerts'][number];


export type ChatThreadEntry={key:string;memberId?:string;who:'member'|'doctor'|'nurse'|'zoe';name:string;text:string;at:string;delivery?:{state:Extract<StaffConversationWorkspace,{deliveries:unknown}>['deliveries'][number]['state'];reason:string|null;id?:string;can_retry?:boolean;retry_of?:string|null};deliveryHistory?:{state:Extract<StaffConversationWorkspace,{deliveries:unknown}>['deliveries'][number]['state'];id:string;reason:string|null;at:string}[]};

/** Use recorded decisions and the exact-snapshot Zoe answer cursor, not thread timestamps or message text. */
export function memberReplyWaiting(workspace:StaffConversationWorkspace,zoeAnswered:boolean):'draft'|'message'|null{
 if(!('drafts'in workspace))return null;
 if(workspace.drafts.some(d=>d.state==='pending'))return 'draft';
 if(zoeAnswered)return null;
 const decided=Math.max(0,...workspace.drafts.filter(d=>d.state==='approved'||d.state==='rejected').map(d=>d.context_version));
 return workspace.messages.some(m=>m.seq>decided)||workspace.version>decided&&(workspace.unsupportedMedia||workspace.unsavedOverLimit)?'message':null;
}

export type ChatMemberSummary={replyWaiting:ReturnType<typeof memberReplyWaiting>;latestFileAt?:string;resultsWaiting?:boolean};

/** Use frozen approval text, including unsent replies, and stable keys when timestamps tie. */
export function memberThread(workspace:StaffConversationWorkspace,runs:readonly ZoeRunView[]):ChatThreadEntry[]{
 const entries:ChatThreadEntry[]=[];
 if('messages'in workspace){
  for(const message of workspace.messages)entries.push({key:`member:${message.seq}`,who:'member',name:workspace.memberName,text:message.text,at:message.at});
  for(const delivery of workspace.deliveries.filter(d=>!workspace.deliveries.some(child=>child.retry_of===d.id)))entries.push({key:`doctor:${delivery.id}`,who:'doctor',name:delivery.approval.doctor_name,text:delivery.approval.body,at:delivery.approval.created_at,delivery:{id:delivery.id,state:delivery.state,reason:delivery.reason,can_retry:delivery.can_retry,retry_of:delivery.retry_of},deliveryHistory:deliveryHistory(workspace.deliveries,delivery)});
  for(const reply of workspace.nurseReplies??[])entries.push({key:`nurse:${reply.id}`,who:'nurse',name:reply.senderName,text:reply.text,at:reply.at});
 }
 for(const run of runs)if(run.answer)entries.push({key:`zoe:${run.id}`,who:'zoe',name:'Zoe',text:run.answer,at:run.finishedAt});
 return entries.sort((a,b)=>{const time=Date.parse(a.at)-Date.parse(b.at);return (Number.isFinite(time)?time:0)||a.key.localeCompare(b.key);});
}

function deliveryHistory(deliveries:Extract<StaffConversationWorkspace,{deliveries:unknown}>['deliveries'],latest:{retry_of?:string|null}){
 const history:{state:typeof deliveries[number]['state'];id:string;reason:string|null;at:string}[]=[];let parent=latest.retry_of;
 while(parent){const old=deliveries.find(d=>d.id===parent);if(!old||history.length>=deliveries.length)break;history.push({id:old.id,state:old.state,reason:old.reason,at:old.created_at});parent=old.retry_of;}
 return history;
}
