'use server';
import {readDoctorPanel} from './panel-read';
import type {PanelResponse} from './panel';
import {readDoctorUploadOverrides,type DoctorUploadOverride} from '@/lib/staff/doctor-upload-overrides';
import {z} from 'zod';
import {patientLabs,type PatientLabData} from './patient-labs';
import {planLabEvidence,type PlanLabEvidenceValue} from '@/lib/ai-plan/lab-evidence';
import {readChatMemberIdentities,questionMemberIdentities} from '@/lib/staff/chat-member-identity-read';
import type {ChatMemberIdentity} from '@/lib/staff/chat-member-identity-schema';
import {coordinationCommand,refreshCoordinationTask} from '@/lib/staff/real-coordination/actions';
import {memberPageSchema} from '@/lib/staff/real-coordination/schema';
import {doctorHandoverSchema,doctorHandoverCopy,type HandoverTarget} from './handover';
import {approvalsDaySchema,approvalsDayWindow,approvalsHistorySchema,type ChatApprovalsResponse} from './approvals-history';
export type {ChatApprovalsResponse} from './approvals-history';
import {openStaffZoe,type OpenResult} from './actions';
import {readPatientChatZoeHistory,searchChatMemberNames,questionMemberTokens,resolveQuestionMember,type ChatQuestionMemberResponse,type ChatZoeHistoryResponse} from './chat-v2-zoe-read';
export type {ChatZoeHistoryResponse,ChatZoeHistoryTurn,ChatZoeConversation} from './chat-v2-zoe-read';
import {hasEvidencePath,readRequiredEvidenceSources} from '@/lib/patient-care/required-evidence';
import {readClinicLabSources} from '@/lib/patient-care/clinic-lab-sources';
import {realClinicalCommand} from '@/lib/patient-care/clinical-review-actions';
import {hasCurrentResultReceipt} from '@/components/real-review/report-provenance';
import {currentClinicalReview} from '@/lib/patient-care/clinical-review-current';
import {matchedPlanResults,consultationProposal,planLabFiles,type PlanReadyEvidence} from './plan-ready';
import {readApprovalCards} from '@/lib/doctor-decisions/approval-read';
import {pressClinicalCard} from '@/lib/doctor-decisions/approval-actions';
import {multiMedicineEnabled} from '@/lib/patient-care/regimen-config';
import type {ApprovalCards} from '@/lib/doctor-decisions/approvals';
import {saveRealDraft} from '@/lib/patient-care/clinical-actions';
import {readDoctorAiPlan} from '@/lib/ai-plan/server';
import {currentAiDraft} from '@/lib/ai-plan/current';
import {prepareAiCarePlan,recordAiPlanAdoption,type PlanActionState} from '@/lib/ai-plan/actions';
import {DRAFT_FIELDS,type DraftField,type PlanGeneration,type PlanItem} from '@/lib/ai-plan/contracts';
import type {DraftSnapshot} from '@/components/real-review/forms';
import type {ClinicalFormState} from '@/lib/patient-care/clinical-actions';
import {labAiEnabled} from '@/lib/lab-ai/config';
import {readLab,labRuleBlocks,type LabRpcClient} from '@/lib/lab-ai/doctor-runtime';
import {approveMemberUpload,reviewLabValue,confirmLabIdentity,requestLabReading} from '@/lib/lab-ai/actions';
import {readMemberHistoryForStaff} from '@/lib/member-history/server';
import {readStaffLabResults} from '@/lib/lab-ai/staff-results-server';
import {readMemberUploadApprovals} from '@/lib/lab-ai/member-approval-server';
import {approveCommandSchema,type ApproveResult,type MemberUploadApprovals} from '@/lib/lab-ai/member-approval';
import type {StaffMemberUpload} from '@/lib/lab-ai/staff-results';
import type {ReportedDocument} from '@/lib/member-history/measures';
import {confirmPassingInputSchema,type ConfirmPassingResult} from '@/lib/lab-ai/doctor-schema';
import {confirmPassingLabValues} from '@/lib/staff-zoe/lab-review-actions';
import type {LabRead,ReviewResult,IdentityResult,RequestResult} from '@/lib/lab-ai/doctor-schema';
import {readEverydayConversation} from './everyday-read';
import {readReplyCard} from '@/lib/doctor-decisions/replies';
import type {ReplyCard,ReplyPreparation} from '@/lib/doctor-decisions/replies';
import {zoePipelineEnabled} from '@/lib/zoe/policy';
import {zoeRunsSchema,type ZoeRunView} from '@/lib/zoe/contracts';
import {urgentWindowSchema,type DoctorModeView} from '@/lib/zoe/doctor-mode';
import type {ZoeReplyDraftView} from '@/lib/zoe/reply-draft-contracts';
import {uploadWaitingSchema,memberThread,memberReplyWaiting,whoNeedsMe,missingDaySources,DAY_SOURCE_RPC,savedPlansSchema,type SavedPlans,type ChatThreadEntry,type ChatWho,type ChatAlert,type ChatMemberSummary} from './chat-v2-read';
import {log} from '@/lib/observability/logger';
import {conversationFailureCodes,actionsResultSchema} from '@/lib/conversation-persistence/contracts';
import {retryConversationDelivery,commandConversation,composeConversationReply,conversationActions} from '@/app/staff/real/conversation/actions';
import {loggedAction} from '@/lib/observability/with-logging';
import {resultsReportEnabled} from '@/lib/gp-report/config';
import {readResultsBlock,type ResultsBlockState,type GpRpc} from '@/lib/gp-report/runtime';
import {requireRealStaff,snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import {staffLocale} from '@/lib/staff/staff-locale';
import {runDoctorHome} from './home-read';
import {memberSearchInputSchema,type MemberSearchInput} from '@/lib/staff/member-search-schema';
import {doctorDecisionsEnabled,doctorChatV2Enabled} from './workspace-config';
import {chatDoctorEnabled,chatDoctorIdentity} from '@/lib/staff/real-staff-access';
import {orderAlerts} from '@/lib/doctor-inbox/contracts';
import {retryOnLock} from '@/lib/doctor-decisions/read';
import {runEverydayAcknowledge,runEverydayResolve,runEverydayHandBackForMember,type EverydayResult,type EverydayContext} from './everyday-runtime';
import {afterHandBack} from './hand-back-sweep';
import {runDoctorCard} from './card-read';
import type {CareAlert} from '@/lib/care-alerts/contracts';
import type {UrgentWindow} from '@/lib/doctor-inbox/urgent-windows';
import {doctorDayCounts} from '@/lib/doctor-inbox/day-counts';
import {staffRecordReader} from './server';
import {readPatientGraphs} from './patient-graphs-read';
import {planGraphEvidence} from './patient-graphs';
import type {PatientGraphs} from './patient-graphs';
import type {TrendData} from '@/components/charts/types';
import type {ToolResult} from './contracts';

async function chatDoctor(expectedDoctorId:unknown){
 if(!chatDoctorEnabled())return null;
 const actor=await requireRealStaff();
 return chatDoctorIdentity(actor.identity,expectedDoctorId)?actor:null;
}

/** Read-only confirmation target. Rechecked on Send; SQL locks and checks it again. */
async function handoverTarget(actor:NonNullable<Awaited<ReturnType<typeof chatDoctor>>>,memberId:string):Promise<{kind:'handover';target:HandoverTarget}|{kind:'no_nurse'|'no_conversation'|'refused'|'unavailable'}>{
 const r=await actor.client.rpc('patient_coordination_members',{p_search:memberId,p_limit:50});
 const page=memberPageSchema.safeParse(r.data);
 if(r.error)return {kind:r.error.code==='42501'?'refused':'unavailable'};
 if(!page.success)return {kind:'unavailable'};
 const member=page.data.members.find(m=>m.id===memberId);
 if(!member)return {kind:'refused'};
 const nurse=member.owners.find(o=>o.role==='nurse');
 if(!nurse)return {kind:'no_nurse'};
 const conversation=await readEverydayConversation(actor.client as unknown as Parameters<typeof readEverydayConversation>[0],memberId);
 if(conversation.kind!=='ready')return {kind:conversation.kind};
 if(!('conversationId'in conversation.initial)||!conversation.initial.conversationId)return {kind:'no_conversation'};
 return {kind:'handover',target:{memberId,memberName:member.name??'',nurseId:nurse.id,nurseName:nurse.name,conversationId:conversation.initial.conversationId}};
}
export const prepareDoctorChatHandover=loggedAction('prepareDoctorChatHandover',async function prepareDoctorChatHandover(memberId:unknown,expectedDoctorId:unknown){
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused' as const};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {kind:'refused' as const};
 try{return await handoverTarget(actor,id.data);}catch{return {kind:'unavailable' as const};}
});
export const sendDoctorChatHandover=loggedAction('sendDoctorChatHandover',async function sendDoctorChatHandover(raw:unknown,expectedDoctorId:unknown){
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused' as const};
 const parsed=doctorHandoverSchema.safeParse(raw);if(!parsed.success)return {kind:'refused' as const};
 const c=parsed.data;
 try{
  const prepared=await handoverTarget(actor,c.memberId);
  if(prepared.kind!=='handover'||prepared.target.nurseId!==c.nurseId||prepared.target.conversationId!==c.conversationId)return {kind:'refused' as const};
  const copy=doctorHandoverCopy(c.locale);
  const result=await coordinationCommand({caseId:c.memberId,taskId:c.taskId,requestId:c.requestId,revision:0,operation:'create',input:{kind:'contact-followup',ownerId:c.nurseId,title:copy.title,instructions:c.note??copy.noNote,dueAt:null,sourceConversationId:c.conversationId}});
  return result.ok?{kind:'sent' as const}:{kind:'unavailable' as const};
 }catch{return {kind:'unavailable' as const};}
});
export const readDoctorChatHandover=loggedAction('readDoctorChatHandover',async function readDoctorChatHandover(taskId:unknown,memberId:unknown,nurseId:unknown,expectedDoctorId:unknown){
 if(!await chatDoctor(expectedDoctorId))return {kind:'refused' as const};
 if(!z.uuid().safeParse(taskId).success||!z.uuid().safeParse(memberId).success||!z.uuid().safeParse(nurseId).success)return {kind:'refused' as const};
 try{
  const result=await refreshCoordinationTask(taskId);
  if(!result.ok||result.task.caseId!==memberId)return {kind:'unavailable' as const};
  const task=result.task;
  return {kind:'state' as const,state:task.status==='completed'?'done' as const:task.status==='cancelled'?'closed' as const:task.needsReassignment||task.ownerId!==nurseId?'reassign' as const:task.events.some(e=>e.actor_id===nurseId&&['contact','await-member','reopen'].includes(e.operation))?'working' as const:'sent' as const};
 }catch{return {kind:'unavailable' as const};}
});

type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
type Failure={kind:'refused';reason?:'conversation_access'|'zoe_context_access'}|{kind:'unavailable'};
export type ChatDayResponse=({kind:'who'} & ChatWho)|Failure;
export type ChatAlertsResponse={kind:'alerts';alerts:ChatAlert[];windows:UrgentWindow[];p0Total:number;capped:boolean;windowsCapped:boolean;urgentIncomplete:boolean;incomplete:boolean;missing?:string[];asOf:string}|Failure;

export const readDoctorChatApprovals=loggedAction('readDoctorChatApprovals',async function readDoctorChatApprovals(day:unknown,expectedDoctorId:unknown):Promise<ChatApprovalsResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 if(!doctorDecisionsEnabled())return {kind:'refused'};
 const parsedDay=approvalsDaySchema.safeParse(day);if(!parsedDay.success)return {kind:'refused'};
 try{
  const result=await actor.client.rpc('doctor_approvals_history',approvalsDayWindow(parsedDay.data));
  if(result.error)return {kind:result.error.code==='42501'?'refused':'unavailable'};
  if(z.object({ok:z.literal(false),code:z.literal('refused')}).safeParse(result.data).success)return {kind:'refused'};
  const parsed=approvalsHistorySchema.safeParse(result.data);
  return parsed.success?{kind:'approvals_history',day:parsedDay.data,...parsed.data}:{kind:'unavailable'};
 }catch{return {kind:'unavailable'};}
});

export const readDoctorChatDay=loggedAction('readDoctorChatDay',async function readDoctorChatDay(expectedDoctorId:unknown):Promise<ChatDayResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 const {client,identity}=actor;
 try{
  const result=await runDoctorHome({client:client as unknown as Parameters<typeof runDoctorHome>[0]['client'],role:identity.role,locale:await staffLocale(identity.role)},{kind:'day'});
  if(result.kind!=='day')return {kind:result.kind==='refused'?'refused':'unavailable'};
  // The day finishes first. These reads can lock the same case rows and must take turns.
  let saved:SavedPlans|null=null;
  try{const read=await retryOnLock(client as unknown as Rpc).rpc('doctor_saved_plans');if(!read.error){const parsed=savedPlansSchema.safeParse(read.data);if(parsed.success)saved=parsed.data;}}catch{/* Partial queue, never a silent empty success. */}
  let uploads:Parameters<typeof whoNeedsMe>[2]={rows:[],total:0};
  if(labAiEnabled())try{const r=await client.rpc('doctor_member_uploads_waiting');uploads=r.error?null:uploadWaitingSchema.parse(r.data);}catch{uploads=null;}
  const overrides=await readDoctorUploadOverrides(client);
  const missing=missingDaySources(result.day,saved,uploads,overrides);
  // One line per unreadable source: the event id and `rpc` are allow-listed log fields; free text and arrays are dropped by the redactor.
  for(const source of missing)log.warn('doctor_day_source_missing',{rpc:DAY_SOURCE_RPC[source]??'doctor_ai_inbox'});
  return {kind:'who',...whoNeedsMe(result.day,saved,uploads,overrides)};
 }catch{return {kind:'unavailable'};}
});
export const readDoctorChatAlerts=loggedAction('readDoctorChatAlerts',async function readDoctorChatAlerts(expectedDoctorId:unknown):Promise<ChatAlertsResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 const {client,identity}=actor;
 try{
  const result=await runDoctorHome({client:client as unknown as Parameters<typeof runDoctorHome>[0]['client'],role:identity.role,locale:await staffLocale(identity.role)},{kind:'poll'});
  if(result.kind!=='poll')return {kind:result.kind==='refused'?'refused':'unavailable'};
  const missing=result.day.inbox.unavailable.filter(source=>source==='urgent_windows'||source==='care_alerts');
  const incomplete=missing.length>0;
  return {kind:'alerts',alerts:orderAlerts(result.day.inbox.p0),windows:result.day.windows,p0Total:doctorDayCounts(result.day).alerts,urgentIncomplete:incomplete,incomplete,missing,capped:result.day.urgentCapped,windowsCapped:result.day.urgentWindowsTotal>result.day.windows.length,asOf:result.day.inbox.asOf};
 }catch{return {kind:'unavailable'};}
});


/** Portfolio only. The reader removes unassigned queue rows before returning any payload. */
export const readDoctorChatPanel=loggedAction('readDoctorChatPanel',async function readDoctorChatPanel(expectedDoctorId:unknown,mode:unknown='full'):Promise<PanelResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 try{
  if(mode!=='summary'&&mode!=='full')return {kind:'refused'};
  const day=await readDoctorChatDay(expectedDoctorId);
  if(day.kind!=='who')return {kind:day.kind==='refused'?'refused':'unavailable'};
  // Include escalated/list-only alerts as well as the day inbox, using the existing bounded union.
  const alerts=await readDoctorChatAlerts(expectedDoctorId);
  const missing=[...new Set([...(day.missing??[]),...(alerts.kind==='alerts'?alerts.missing??[]:['care_alerts'])])];
  const queue=alerts.kind==='alerts'?{...day,missing,alerts:alerts.alerts,windows:alerts.windows,urgentIncomplete:day.urgentIncomplete||alerts.incomplete,incomplete:day.incomplete||alerts.incomplete,capped:day.capped||alerts.capped||alerts.windowsCapped}:{...day,missing,urgentIncomplete:true,incomplete:true};
  return await readDoctorPanel(actor.client as unknown as Rpc,actor.identity.id,queue,new Date(),mode==='full');
 }catch{return {kind:'unavailable'};}
});

export const readDoctorChatAlert=loggedAction('readDoctorChatAlert',async function readDoctorChatAlert(alertId:unknown,expectedDoctorId:unknown):Promise<{kind:'alert';alert:CareAlert}|Failure|{kind:'off'|'invalid'}>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 const id=z.uuid().safeParse(alertId);if(!id.success)return {kind:'invalid'};
 try{
  for(const view of ['live','resolved'] as const){
   const result=await runDoctorCard(actor.client as unknown as EverydayContext['client'],{card:'alerts',view});
   if(result.kind!=='ready'||result.card!=='alerts')return {kind:result.kind==='refused'?'refused':result.kind==='off'?'off':'unavailable'};
   const alert=result.inbox.alerts.find(alert=>alert.id===id.data);if(alert)return {kind:'alert',alert};
  }
 }catch{/* A bounded read that cannot find the alert cannot confirm its state. */}
 return {kind:'unavailable'};
});
export const acknowledgeDoctorChatAlert=loggedAction('acknowledgeDoctorChatAlert',async function acknowledgeDoctorChatAlert(raw:unknown,expectedDoctorId:unknown):Promise<EverydayResult>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 try{return await runEverydayAcknowledge({client:actor.client as unknown as EverydayContext['client'],role:actor.identity.role,doctorId:actor.identity.id,expectedDoctorId},raw);}catch{return {kind:'unavailable'};}
});
export const resolveDoctorChatAlert=loggedAction('resolveDoctorChatAlert',async function resolveDoctorChatAlert(raw:unknown,expectedDoctorId:unknown):Promise<EverydayResult>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 try{return await runEverydayResolve({client:actor.client as unknown as EverydayContext['client'],role:actor.identity.role,doctorId:actor.identity.id,expectedDoctorId},raw);}catch{return {kind:'unavailable'};}
});
export const handBackDoctorChat=loggedAction('handBackDoctorChat',async function handBackDoctorChat(raw:unknown,expectedDoctorId:unknown):Promise<EverydayResult>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 try{const result=await runEverydayHandBackForMember({client:actor.client as unknown as EverydayContext['client'],role:actor.identity.role,doctorId:actor.identity.id,expectedDoctorId},raw);afterHandBack(result);return result;}catch{return {kind:'unavailable'};}
});

export type ChatMemberResponse={kind:'member';memberId:string;memberName:string;identity:ChatMemberIdentity;conversationId:string|null;version:number|null;modeRevision:string;thread:ChatThreadEntry[];reply:{card:ReplyCard|null;prepare:ReplyPreparation|null}|null;replyFailed:boolean;source:ZoeReplyDraftView|null;sourcesFailed:boolean;mode:DoctorModeView;unsupportedMedia:boolean;unsavedOverLimit:boolean;urgentOpen:boolean|null;urgentSince?:string|null;summary?:ChatMemberSummary;zoeFailed:boolean;urgentFailed:boolean;staleDraft:boolean;uploads?:{documentId:string;jobId:string}[];uploadsFailed?:boolean;identityChecks?:DoctorUploadOverride[];identityChecksFailed?:boolean}|Failure|{kind:'off'}|{kind:'invalid'};

/** The shared conversation read. `reply` is read only for an open, because it issues intents; the poll never does. */
async function memberRead(client:Rpc,memberId:string,withReply:boolean):Promise<ChatMemberResponse>{
 const conversation=await readEverydayConversation(client as unknown as Parameters<typeof readEverydayConversation>[0],memberId);
 if(conversation.kind!=='ready')return conversation;
 const identity=(await readChatMemberIdentities(client,[memberId]))?.find(row=>row.id===memberId);
 if(!identity)return {kind:'unavailable'};
 let reply:{card:ReplyCard|null;prepare:ReplyPreparation|null}|null=null,replyFailed=false;
 if(withReply)try{reply=await readReplyCard(client as unknown as Parameters<typeof readReplyCard>[0],memberId);}catch{replyFailed=true;}
 let runs:ZoeRunView[]=[],zoeFailed=false,urgentFailed=false,urgentOpen:boolean|null=null,urgentSince:string|null=null;
 if(zoePipelineEnabled()){
  try{const r=await client.rpc('zoe_runs_for_doctor',{p_member:memberId});if(r.error)throw Error('Zoe runs unavailable');runs=zoeRunsSchema.parse(r.data).runs;}catch{zoeFailed=true;}
  try{const r=await client.rpc('doctor_zoe_urgent_window',{p_member:memberId});if(r.error)throw Error('Urgent window unavailable');const window=urgentWindowSchema.parse(r.data);urgentOpen=window.open;urgentSince=window.since;}catch{urgentFailed=true;}
 }
 let uploads:{documentId:string;jobId:string}[]=[],uploadsFailed=false;
 const summary:ChatMemberSummary={replyWaiting:memberReplyWaiting(conversation.initial,conversation.zoeReview!==null)};
 if(withReply&&labAiEnabled()){
  const results=await readStaffLabResults(client,memberId);
  const approvals=await readMemberUploadApprovals(client,memberId);
  uploadsFailed=!results||!approvals;
  if(results?.enabled&&approvals?.required&&approvals.canApprove)uploads=results.memberUploads.filter(doc=>{
   const j=doc.job,reading=approvals.readings.find(r=>r.jobId===j?.jobId&&r.documentId===doc.documentId);
   return j?.state==='done'&&j.confirmation&&j.confirmation.identityAnswer!=='not_mine'&&reading&&!reading.approval&&doc.values.some(v=>v.memberStatus!=='rejected');
  }).map(doc=>({documentId:doc.documentId,jobId:doc.job!.jobId}));
  if(results?.enabled){
   const dates=[...results.clinic,...results.memberUploads].map(doc=>doc.uploadedAt).sort((a,b)=>Date.parse(b)-Date.parse(a));
   if(dates[0])summary.latestFileAt=dates[0];
   const clinicWaiting=results.clinic.some(doc=>doc.values.some(v=>v.status==='unverified'));
   if(clinicWaiting||uploads.length)summary.resultsWaiting=true;
  }
 }
 const identityChecks=await readDoctorUploadOverrides(client,memberId);
 const workspace=conversation.initial;
 const pending='drafts'in workspace?workspace.drafts.find(d=>d.state==='pending'):undefined;
 const staleDraft=!!pending&&'version'in workspace&&(pending.context_version!==workspace.version||pending.clinical_revision!==workspace.clinicalRevision||pending.source_token!==workspace.sourceToken);
 const sourceId=reply?.card?.draftId??pending?.id;
 const source=sourceId?conversation.replyDrafts?.find(d=>d.draftId===sourceId)??null:null;
 return {kind:'member',identityChecks:identityChecks??[],identityChecksFailed:identityChecks===null,memberId,identity,uploads,uploadsFailed,urgentSince,summary,memberName:identity.name??('memberName'in workspace?workspace.memberName:''),conversationId:'conversationId'in workspace?workspace.conversationId:null,version:'version'in workspace?workspace.version:null,modeRevision:conversation.modeRevision,thread:memberThread(workspace,runs).map(entry=>({...entry,memberId})),reply,replyFailed,
  source,sourcesFailed:zoePipelineEnabled()&&(conversation.replyDrafts===null||!!reply?.card&&reply.card.author==='ai_assistant'&&!source),
  mode:conversation.mode,unsupportedMedia:'unsupportedMedia'in workspace&&workspace.unsupportedMedia,unsavedOverLimit:'unsavedOverLimit'in workspace&&workspace.unsavedOverLimit,urgentOpen,zoeFailed,urgentFailed,staleDraft};
}
async function member(memberId:unknown,expectedDoctorId:unknown,withReply:boolean):Promise<ChatMemberResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {kind:'invalid'};
 if(!doctorDecisionsEnabled())return {kind:'off'};
 // Another tab can hold the case row for a moment: a read tries once more, and the reads below still run in order.
 try{return await memberRead(retryOnLock(actor.client as unknown as Rpc),id.data,withReply);}catch{return {kind:'unavailable'};}
}
export const openDoctorChatMember=loggedAction('openDoctorChatMember',async function openDoctorChatMember(memberId:unknown,expectedDoctorId:unknown):Promise<ChatMemberResponse>{
 return member(memberId,expectedDoctorId,true);
});
export const readDoctorChatConversation=loggedAction('readDoctorChatConversation',async function readDoctorChatConversation(memberId:unknown,expectedDoctorId:unknown):Promise<ChatMemberResponse>{
 return member(memberId,expectedDoctorId,false);
});

export const searchDoctorChatMembers=loggedAction('searchDoctorChatMembers',async function searchDoctorChatMembers(query:unknown,expectedDoctorId:unknown){
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused' as const};
 try{
  const locale=await staffLocale(actor.identity.role);
  const search=(query:string,cursor:MemberSearchInput['cursor']=null)=>runDoctorHome({client:actor.client as unknown as Parameters<typeof runDoctorHome>[0]['client'],role:actor.identity.role,locale},{kind:'members',query,cursor});
  // Let the existing request schema reject unknown or malformed input before any name reads.
  const input=memberSearchInputSchema.safeParse({query,cursor:null});
  if(!input.success)return {kind:'invalid' as const};
  const result=await searchChatMemberNames(input.data.query,search);
  if(result.kind!=='members')return {kind:result.kind==='refused'?'refused' as const:result.kind==='invalid'?'invalid' as const:'unavailable' as const};
  const identities=await readChatMemberIdentities(actor.client as unknown as Rpc,result.page.rows.map(row=>row.id));
  if(!identities||result.page.rows.some(row=>!identities.some(identity=>identity.id===row.id)))return {kind:'unavailable' as const};
  return {kind:'members' as const,rows:identities,hasMore:result.page.hasMore,...('requiresChoice' in result&&result.requiresChoice?{requiresChoice:true as const}:{})};
 }catch{return {kind:'unavailable' as const};}
});
export type {ChatQuestionMemberResponse} from './chat-v2-zoe-read';
export const findDoctorChatQuestionMember=loggedAction('findDoctorChatQuestionMember',async function findDoctorChatQuestionMember(question:unknown,expectedDoctorId:unknown,current?:{memberId:string;memberName:string}):Promise<ChatQuestionMemberResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 const tokens=questionMemberTokens(question,current?Infinity:4);if(!tokens)return {kind:'invalid'};
 if(current&&!z.strictObject({memberId:z.uuid(),memberName:z.string().min(1)}).safeParse(current).success)return {kind:'invalid'};
 if(!tokens.length&&!current)return {kind:'none'};
 try{
  const locale=await staffLocale(actor.identity.role);
  const search=(query:string,cursor:MemberSearchInput['cursor']=null)=>runDoctorHome({client:actor.client as unknown as Parameters<typeof runDoctorHome>[0]['client'],role:actor.identity.role,locale},{kind:'members',query,cursor});
  return await questionMemberIdentities(actor.client as unknown as Rpc,await resolveQuestionMember(question,current,search));
 }catch{return {kind:'unavailable'};}
});
export const openDoctorChatZoe=loggedAction('openDoctorChatZoe',async function openDoctorChatZoe(memberId:unknown,expectedDoctorId:unknown):Promise<OpenResult>{
 if(!await chatDoctor(expectedDoctorId))return {ok:false};
 try{return await openStaffZoe(memberId);}catch{return {ok:false};}
});
/** A chart is an audited record read, without a model turn. The existing BP RPCs enforce member assignment. */
export const readDoctorChatBp=loggedAction('readDoctorChatBp',async function readDoctorChatBp(memberId:unknown,expectedDoctorId:unknown):Promise<{kind:'bp';card:ToolResult}|Failure>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {kind:'refused'};
 try{
  const status=await actor.client.rpc('staff_zoe_status');
  if(status.error||status.data!==true)return {kind:'refused'};
  const read=staffRecordReader(actor.client as unknown as Rpc,await staffLocale(actor.identity.role),new Date());
  return {kind:'bp',card:await read('bp',id.data,'doctor')};
 }catch{return {kind:'unavailable'};}
});
export const readDoctorPatientGraphs=loggedAction('readDoctorPatientGraphs',async function readDoctorPatientGraphs(memberId:unknown,expectedDoctorId:unknown):Promise<{kind:'graphs';data:PatientGraphs}|Failure>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {kind:'refused'};
 try{const data=await readPatientGraphs(actor.client as unknown as Rpc,id.data,new Date());return data?.memberId===id.data?{kind:'graphs',data}:{kind:'unavailable'};}catch{return {kind:'unavailable'};}
});
export const readDoctorPatientChatHistory=loggedAction('readDoctorPatientChatHistory',async function readDoctorPatientChatHistory(memberId:unknown,expectedDoctorId:unknown):Promise<ChatZoeHistoryResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {kind:'refused'};
 try{
  const result=await actor.client.rpc('staff_zoe_member_conversation',{p_member:id.data});
  if(result.error)return {kind:result.error.code==='42501'?'refused':'unavailable'};
  const existing=z.uuid().nullable().safeParse(result.data);if(!existing.success)return {kind:'unavailable'};
  let conversationId=existing.data;
  if(conversationId===null){
   const opened=await openStaffZoe(id.data);if(!opened.ok)return {kind:'refused'};
   conversationId=opened.conversationId;
  }
  return readPatientChatZoeHistory(actor.client as unknown as Rpc,conversationId,id.data);
 }catch{return {kind:'unavailable'};}
});
/** Return only the open member's alerts to the patient screen, including non-P0 alerts. */
export const readDoctorPatientChatAlerts=loggedAction('readDoctorPatientChatAlerts',async function readDoctorPatientChatAlerts(memberId:unknown,expectedDoctorId:unknown):Promise<{kind:'alerts';alerts:import('@/lib/doctor-inbox/contracts').AlertItem[]}|Failure>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {kind:'refused'};
 try{
  const status=await actor.client.rpc('staff_zoe_status');if(status.error||status.data!==true)return {kind:'refused'};
  const member=(await readChatMemberIdentities(actor.client as unknown as Rpc,[id.data]))?.find(row=>row.id===id.data);
  if(!member)return {kind:'refused'};
  const result=await runDoctorCard(actor.client as unknown as EverydayContext['client'],{card:'alerts',view:'live'});
  if(result.kind!=='ready'||result.card!=='alerts'||result.incomplete||result.capped)return {kind:'unavailable'};
  return {kind:'alerts',alerts:result.inbox.alerts.filter(alert=>alert.memberId===id.data).map(alert=>({kind:'care_alert' as const,lane:'P0' as const,rank:0,confidence:'rule' as const,ai:'none' as const,sources:[],id:alert.id,memberId:alert.memberId,memberName:alert.memberName??'',at:alert.createdAt,alert}))};
 }catch{return {kind:'unavailable'};}
});
export const approveDoctorChatReply=loggedAction('approveDoctorChatReply',async function approveDoctorChatReply(command:unknown,decision:unknown,expectedDoctorId:unknown){
 if(!await chatDoctor(expectedDoctorId))return {ok:false as const,code:'refused'};
 if(!doctorDecisionsEnabled())return {ok:false as const,code:'disabled'};
 if(!z.object({purpose:z.literal('reply.approve')}).safeParse(command).success||!z.strictObject({memberId:z.uuid(),modeRevision:z.string().regex(/^[a-f0-9]{32}$/)}).safeParse(decision).success)return {ok:false as const,code:'invalid'};
 return commandConversation(command,decision);
},{failureCode:'approval_failed',failureCodes:conversationFailureCodes});
export const retryDoctorChatDelivery=loggedAction('retryDoctorChatDelivery',async function retryDoctorChatDelivery(deliveryId:unknown,expectedDoctorId:unknown){
 if(!await chatDoctor(expectedDoctorId))return {ok:false as const,code:'refused'};
 const parsed=z.uuid().safeParse(deliveryId);if(!parsed.success)return {ok:false as const,code:'invalid'};
 return retryConversationDelivery(parsed.data);
},{failureCode:'retry_failed',failureCodes:conversationFailureCodes});
export const composeDoctorChatReply=loggedAction('composeDoctorChatReply',async function composeDoctorChatReply(input:unknown,expectedDoctorId:unknown){
 if(!await chatDoctor(expectedDoctorId))return {ok:false as const,code:'refused'};
 if(!doctorDecisionsEnabled())return {ok:false as const,code:'disabled'};
 return composeConversationReply(input);
},{failureCode:'compose_failed',failureCodes:conversationFailureCodes});
export const reviseDoctorChatReply=loggedAction('reviseDoctorChatReply',async function reviseDoctorChatReply(memberId:unknown,command:unknown,expectedDoctorId:unknown){
 if(!await chatDoctor(expectedDoctorId))return {ok:false as const,code:'refused'};
 if(!doctorDecisionsEnabled())return {ok:false as const,code:'disabled'};
 const id=z.uuid().safeParse(memberId),p=z.strictObject({expectedVersion:z.number().int().nonnegative(),expectedRevision:z.number().int().positive(),expectedContentHash:z.string().min(1),body:z.string().min(1).max(8000)}).safeParse(command);
 if(!id.success||!p.success)return {ok:false as const,code:'invalid'};
 const issued=actionsResultSchema.parse(await conversationActions(id.data));
 if(!issued.ok||issued.view.conversationVersion!==p.data.expectedVersion||issued.view.draft.revision!==p.data.expectedRevision||issued.view.draft.contentHash!==p.data.expectedContentHash)return {ok:false as const,code:'stale_context'};
 const intent=issued.view.actions.find(a=>a.purpose==='reply.edit');
 if(!intent)return {ok:false as const,code:'stale_context'};
 return commandConversation({schema:1,purpose:'reply.edit',intentId:intent.intentId,requestId:crypto.randomUUID().replaceAll('-',''),body:p.data.body});
},{failureCode:'prepare_failed',failureCodes:conversationFailureCodes});
export type ChatSearchResponse={kind:'members';rows:({id:string;name:string|null}&Partial<ChatMemberIdentity>)[];hasMore:boolean;requiresChoice?:true}|Failure|{kind:'invalid'};

export type PatientLabsResponse=({kind:'labs'}&PatientLabData)|Failure|{kind:'off'};
export const readDoctorPatientLabs=loggedAction('readDoctorPatientLabs',async function readDoctorPatientLabs(memberId:unknown,expectedDoctorId:unknown):Promise<PatientLabsResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 if(!labAiEnabled())return {kind:'off'};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {kind:'refused'};
 try{
  const [results,checks,approvals]=await Promise.all([readStaffLabResults(actor.client,id.data),readDoctorUploadOverrides(actor.client,id.data),readMemberUploadApprovals(actor.client,id.data)]);
  if(!results||checks===null||!approvals)return {kind:'unavailable'};
  if(!results.enabled)return {kind:'off'};
  return {kind:'labs',...patientLabs(results,checks,approvals)};
 }catch{return {kind:'unavailable'};}
});

export type ChatLabResponse={kind:'lab';data:Extract<LabRead,{enabled:true}>;identityCheck?:DoctorUploadOverride;ruleBlocks?:ReturnType<typeof labRuleBlocks>}|Failure|{kind:'off'};
export const readDoctorChatLab=loggedAction('readDoctorChatLab',async function readDoctorChatLab(memberId:unknown,fileId:unknown,expectedDoctorId:unknown):Promise<ChatLabResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 if(!labAiEnabled())return {kind:'off'};
 const ids=z.object({memberId:z.uuid(),fileId:z.uuid()}).safeParse({memberId,fileId});if(!ids.success)return {kind:'refused'};
 const data=await readLab(actor.client as unknown as LabRpcClient,ids.data.memberId,ids.data.fileId);
 if(data==='access')return {kind:'refused'};
 if(!data)return {kind:'unavailable'};
 const checks=await readDoctorUploadOverrides(actor.client,ids.data.memberId);if(checks===null)return {kind:'unavailable'};
 if(data.enabled&&data.fileId!==ids.data.fileId)return {kind:'refused'};
 return data.enabled?{kind:'lab',data,ruleBlocks:labRuleBlocks(data),identityCheck:checks.find(row=>row.fileId===ids.data.fileId)}:{kind:'off'};
});
export const reviewDoctorChatLabValue=loggedAction('reviewDoctorChatLabValue',async function reviewDoctorChatLabValue(memberId:string,fileId:string,input:unknown,expectedDoctorId:unknown):Promise<ReviewResult>{
 if(!await chatDoctor(expectedDoctorId))return {status:'access'};
 if(!labAiEnabled())return {status:'disabled'};
 return reviewLabValue(memberId,fileId,input);
});
export const confirmDoctorChatPassingLabValues=loggedAction('confirmDoctorChatPassingLabValues',async function confirmDoctorChatPassingLabValues(memberId:string,fileId:string,input:unknown,expectedDoctorId:unknown):Promise<ConfirmPassingResult>{
 if(!await chatDoctor(expectedDoctorId))return {status:'access'};
 if(!labAiEnabled())return {status:'disabled'};
 const parsed=confirmPassingInputSchema.safeParse(input);
 if(!parsed.success||parsed.data.memberId!==memberId||parsed.data.fileId!==fileId)return {status:'invalid'};
 return confirmPassingLabValues(parsed.data);
});
export const confirmDoctorChatLabIdentity=loggedAction('confirmDoctorChatLabIdentity',async function confirmDoctorChatLabIdentity(memberId:string,fileId:string,input:unknown,expectedDoctorId:unknown):Promise<IdentityResult>{
 if(!await chatDoctor(expectedDoctorId))return {status:'access'};
 if(!labAiEnabled())return {status:'disabled'};
 return confirmLabIdentity(memberId,fileId,input);
});
export const requestDoctorChatLabReading=loggedAction('requestDoctorChatLabReading',async function requestDoctorChatLabReading(memberId:string,fileId:string,expectedDoctorId:unknown):Promise<RequestResult>{
 if(!await chatDoctor(expectedDoctorId))return {status:'access'};
 if(!labAiEnabled())return {status:'disabled'};
 return requestLabReading(memberId,fileId);
});

export type ChatPlanResponse={kind:'plan';approvals:ApprovalCards}|Failure|{kind:'off'};
export const readDoctorChatPlan=loggedAction('readDoctorChatPlan',async function readDoctorChatPlan(memberId:unknown,expectedDoctorId:unknown):Promise<ChatPlanResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 if(!doctorDecisionsEnabled()||!multiMedicineEnabled())return {kind:'off'};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {kind:'refused'};
 const approvals=await readApprovalCards(actor.client as unknown as Parameters<typeof readApprovalCards>[0],id.data,actor.identity.id);
 return approvals?{kind:'plan',approvals}:{kind:'unavailable'};
});
export const pressDoctorChatPlan=loggedAction('pressDoctorChatPlan',async function pressDoctorChatPlan(command:unknown,expectedDoctorId:unknown):Promise<ClinicalFormState>{
 if(!await chatDoctor(expectedDoctorId))return {ok:false,message:'Assigned doctor access is required.'};
 return pressClinicalCard(command);
});

/** Same receipt operation as the Evidence tab, behind the chat's doctor and feature gates. */
export const recordDoctorChatPlanResults=loggedAction('recordDoctorChatPlanResults',async function recordDoctorChatPlanResults(form:FormData,expectedDoctorId:unknown):Promise<ClinicalFormState>{
 if(!await chatDoctor(expectedDoctorId))return {ok:false,message:'Assigned doctor access is required.'};
 if(!doctorDecisionsEnabled()||!multiMedicineEnabled())return {ok:false,message:'This action is switched off.'};
 if(form.get('operation')!=='receive-all-clinic-results')return {ok:false,message:'Check the form details.'};
 return realClinicalCommand({ok:false,message:''},form);
});

export type ChatAiPlanResponse={kind:'ai-plan';snapshot:DraftSnapshot;generation:Pick<PlanGeneration,'id'|'summary'> & {guard?:string[];items:Omit<PlanItem,'member'>[];draft:Record<DraftField,string>}|null;stale:boolean;published:boolean;urgent?:boolean;savedDraftCurrent?:boolean;labEvidence?:{generationId:string;values:PlanLabEvidenceValue[]}|null;trends?:{bp:TrendData;ldl:TrendData}|null;ready?:PlanReadyEvidence}|Failure|{kind:'off'};
export const readDoctorChatAiPlan=loggedAction('readDoctorChatAiPlan',async function readDoctorChatAiPlan(memberId:unknown,expectedDoctorId:unknown):Promise<ChatAiPlanResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 if(!doctorDecisionsEnabled()||!multiMedicineEnabled())return {kind:'off'};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {kind:'refused'};
 try{
  const plan=await readDoctorAiPlan(actor.client,id.data);if(!plan)return {kind:'unavailable'};if(!plan.enabled)return {kind:'off'};
  const read=await retryOnLock(actor.client as unknown as Rpc).rpc('patient_clinical_case_snapshot',{p_user_id:id.data});
  if(read.error)return {kind:read.error.code==='42501'?'refused':'unavailable'};
  const parsed=snapshotSchema.safeParse(read.data);if(!parsed.success||parsed.data.id!==id.data)return {kind:'unavailable'};
  const snap=parsed.data,g=plan.latest;
  // Reviewed receipt sources omit unreviewed files. This existing reader validates
  // file UUIDs and enforces the assigned doctor's member access in the database.
  const [sources,labs]=await Promise.all([
   readClinicLabSources(actor.client as unknown as Parameters<typeof readClinicLabSources>[0],id.data),
   readStaffLabResults(actor.client,id.data),
  ]);
  const investigations=snap.review?.engine.tests.some(test=>test.method!=='lab')?await readRequiredEvidenceSources(actor.client as unknown as Parameters<typeof readRequiredEvidenceSources>[0],id.data):null;
  const results=matchedPlanResults(snap.review?.engine.tests??[],sources??[],snap.evidence.assessment?.completed_at).map(test=>({...test,recorded:test.method==='lab'?hasCurrentResultReceipt(snap,test.id,sources??[]):hasEvidencePath(test.id)&&!!investigations?.[test.id].some(source=>source.id===snap.review?.evidenceReceipts?.[test.id]?.sourceId)}));
  const reviewCurrent=currentClinicalReview(snap,actor.identity.id);
  const current=!!g&&g.labToken===plan.labToken&&g.evidenceToken===snap.evidenceToken;
  const sentence=current?g.items.find(item=>item.source?.kind==='rule'&&item.source.ref==='consultation-window')?.timing:null;
  return {kind:'ai-plan',ready:{results,labFiles:planLabFiles(labs),sourcesAvailable:sources!==null,reviewCurrent,urgency:snap.review?.engine.urgency??null,proposal:reviewCurrent?consultationProposal(snap.review?.engine.urgency,sentence):null},snapshot:{id:snap.id,revision:snap.revision,evidenceToken:snap.evidenceToken,draft:snap.draft,draftStale:snap.draftStale},
   generation:g&&!plan.published&&(!g.adoptedAt||g.evidenceToken!==snap.evidenceToken||g.labToken!==plan.labToken)?{id:g.id,summary:g.summary,guard:g.guard,items:g.items.filter(item=>!item.member||item.status==='needs_doctor_judgement').map(({id,section,status,text,rationale,source,timing})=>({id,section,status,text,rationale,source,timing})),draft:{explanation:g.draft.explanation,instructions:g.draft.instructions,followUp:g.draft.followUp}}:null,
   stale:!plan.published&&!!g&&(g.evidenceToken!==snap.evidenceToken||g.labToken!==plan.labToken||g.caseRevision>snap.revision),published:plan.published,urgent:!!snap.evidence.assessment?.urgent_rule,
   savedDraftCurrent:currentAiDraft(snap,plan),
   trends:g&&!plan.published&&g.labToken===plan.labToken&&g.evidenceToken===snap.evidenceToken?planGraphEvidence(snap,planLabEvidence(plan.labValues,snap.evidence.assessment?.answers)):null,
   // These are exactly the lab inputs read by generation while both tokens match.
   // Historical values are not stored; never substitute today's labs for a stale draft.
   labEvidence:g&&!plan.published&&g.labToken===plan.labToken&&g.evidenceToken===snap.evidenceToken?{generationId:g.id,values:planLabEvidence(plan.labValues,snap.evidence.assessment?.answers)}:null};
 }catch{return {kind:'unavailable'};}
});
export const prepareDoctorChatAiPlan=loggedAction('prepareDoctorChatAiPlan',async function prepareDoctorChatAiPlan(memberId:unknown,expectedDoctorId:unknown):Promise<PlanActionState>{
 if(!await chatDoctor(expectedDoctorId))return {ok:false,message:'Assigned doctor access is required.'};
 if(!doctorDecisionsEnabled()||!multiMedicineEnabled())return {ok:false,message:'AI plan drafts are switched off.'};
 const id=z.uuid().safeParse(memberId);if(!id.success)return {ok:false,message:'The plan draft could not be prepared. Try again.'};
 try{return await prepareAiCarePlan(id.data);}catch{return {ok:false,message:'The plan draft could not be prepared. Try again.'};}
});
export const saveDoctorChatAiPlan=loggedAction('saveDoctorChatAiPlan',async function saveDoctorChatAiPlan(previous:ClinicalFormState,form:FormData,expectedDoctorId:unknown):Promise<ClinicalFormState>{
 if(!await chatDoctor(expectedDoctorId))return {ok:false,message:'Assigned doctor access is required.'};
 if(!doctorDecisionsEnabled()||!multiMedicineEnabled())return {ok:false,message:'AI plan drafts are switched off.'};
 if(!z.object({id:z.uuid(),generation:z.uuid().optional()}).safeParse({id:form.get('id'),generation:form.get('aiGeneration')??undefined}).success)return {ok:false,message:'The case details are out of date. Reload the case and save again.'};
 try{return await saveRealDraft(previous,form);}catch{return {ok:false,uncertain:true,message:'The draft save could not be confirmed. Refresh the current case before trying again.'};}
});
export const recordDoctorChatAiPlanAdoption=loggedAction('recordDoctorChatAiPlanAdoption',async function recordDoctorChatAiPlanAdoption(generationId:unknown,fields:unknown,expectedDoctorId:unknown):Promise<boolean>{
 if(!await chatDoctor(expectedDoctorId))return false;
 if(!doctorDecisionsEnabled()||!multiMedicineEnabled())return false;
 const parsed=z.object({id:z.uuid(),fields:z.array(z.enum(DRAFT_FIELDS)).max(3)}).safeParse({id:generationId,fields});if(!parsed.success)return false;
 try{return await recordAiPlanAdoption(parsed.data.id,parsed.data.fields);}catch{return false;}
});

export type ChatUploadResponse={kind:'upload';document:ReportedDocument;doc:StaffMemberUpload;approvals:MemberUploadApprovals}|Failure|{kind:'off'};
export const readDoctorChatUpload=loggedAction('readDoctorChatUpload',async function readDoctorChatUpload(memberId:unknown,documentId:unknown,expectedDoctorId:unknown):Promise<ChatUploadResponse>{
 const actor=await chatDoctor(expectedDoctorId);if(!actor)return {kind:'refused'};
 if(!labAiEnabled())return {kind:'off'};
 const ids=z.strictObject({memberId:z.uuid(),documentId:z.uuid()}).safeParse({memberId,documentId});if(!ids.success)return {kind:'refused'};
 try{
  const history=await readMemberHistoryForStaff(actor.client,ids.data.memberId);
  if(!history)return {kind:'unavailable'};
  const document=history.documents.find(d=>d.id===ids.data.documentId);if(!document)return {kind:'refused'};
  const results=await readStaffLabResults(actor.client,ids.data.memberId);
  if(!results)return {kind:'unavailable'};if(!results.enabled)return {kind:'off'};
  const approvals=await readMemberUploadApprovals(actor.client,ids.data.memberId);if(!approvals)return {kind:'unavailable'};
  const doc=results.memberUploads.find(d=>d.documentId===document.id);if(!doc)return {kind:'unavailable'};
  const readings=approvals.readings.filter(r=>r.documentId===document.id&&r.jobId===doc.job?.jobId);if(!readings.length)return {kind:'unavailable'};
  return {kind:'upload',document,doc,approvals:{...approvals,readings}};
 }catch{return {kind:'unavailable'};}
});
export const approveDoctorChatUpload=loggedAction('approveDoctorChatUpload',async function approveDoctorChatUpload(input:unknown,expectedDoctorId:unknown):Promise<ApproveResult>{
 if(!await chatDoctor(expectedDoctorId))return {status:'access'};
 if(!labAiEnabled())return {status:'disabled'};
 const command=approveCommandSchema.safeParse(input);if(!command.success)return {status:'invalid'};
 try{return await approveMemberUpload(command.data);}catch{return {status:'outcome-unknown'};}
});

/** Results stay inside this conversation. Every read rechecks the expected doctor. */
export const readDoctorChatResults=loggedAction('readDoctorChatResults',async function readDoctorChatResults(expectedDoctorId:unknown,memberId:string):Promise<ResultsBlockState|{status:'identity-checks';rows:DoctorUploadOverride[]}>{
 if(!doctorChatV2Enabled()||!resultsReportEnabled())return {status:'off'};
 try{
  const {client,identity}=await requireRealStaff();
  if(identity.role!=='doctor'||identity.id!==expectedDoctorId)return {status:'unavailable'};
  const block=await readResultsBlock(client as unknown as GpRpc,memberId);
  const checks=await readDoctorUploadOverrides(client,memberId);
  if(checks===null)return {status:'unavailable'};
  if(checks.length)return {status:'identity-checks',rows:checks};
  return block;
 }catch{return {status:'unavailable'};}
});
