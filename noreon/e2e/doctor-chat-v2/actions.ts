import {consultationProposal} from '@/lib/staff-zoe/plan-ready';
export async function setStaffLocale(form:FormData){
 if(!form.get('locale')||new URL(window.location.href).searchParams.get('state')==='language-failed')throw Error('Language unavailable');
}
// Sign-out is the one permitted navigation in this isolated browser harness.
// eslint-disable-next-line @next/next/no-location-assign-relative-destination
export async function realStaffSignOut(){window.location.assign('/staff/real/login');}

import {fixtureAlert,fixtureWho,fixtureIdentity} from './data';
import type {ChatApprovalsResponse,ChatDayResponse,ChatAlertsResponse} from '@/lib/staff-zoe/chat-v2-actions';
export type FixtureState={locale:'en'|'hy'|'ru';history:unknown[];state:string|null;long:boolean;dayReads:number;pollReads:number;newAlert:boolean;releaseDay?:()=>void};
const fixture=()=> (window as unknown as {fixture:FixtureState}).fixture;
export async function readDoctorChatApprovals(day:unknown,doctorId:unknown):Promise<ChatApprovalsResponse>{
 checkDoctor(doctorId);if(day!=='today'&&day!=='yesterday')return {kind:'refused'};
 const f=fixture() as FixtureState&{approvalsReads?:number};f.approvalsReads=(f.approvalsReads??0)+1;
 if(f.state==='approvals-unavailable')return {kind:'unavailable'};
 if(f.state==='refused')return {kind:'refused'};
 const row={at:day==='yesterday'?'2026-11-03T08:00:00Z':'2026-11-04T08:00:00Z',memberId:'d1a00000-0000-4000-8000-000000000002',memberName:'Mariam Example'};
 const rows:Extract<ChatApprovalsResponse,{kind:'approvals_history'}>['rows']=[
  {...row,kind:'reply',state:'accepted_by_provider',excerpt:'Your approved reply.'},
  {...row,kind:'reply',state:'held',excerpt:'Your held reply.'},
  {...row,kind:'reply',state:'definitely_failed',excerpt:'Your failed reply.'},
  {...row,kind:'reply',state:'unknown',excerpt:'Your reply with an unknown outcome.'},
  {...row,kind:'lab_review',state:'confirm'}, {...row,kind:'plan',state:'published'},
  {...row,kind:'upload',state:'approved'}, {...row,kind:'alert',state:'acknowledged'},
 ];
 return {kind:'approvals_history',day,ok:true,asOf:'2026-11-04T08:00:00Z',hasMore:f.long&&f.state!=='empty',rows:f.state==='empty'?[]:f.long?Array.from({length:100},(_,i)=>rows[i%rows.length]):rows};
}
export async function readDoctorChatDay(expectedDoctorId:unknown):Promise<ChatDayResponse>{
 if(expectedDoctorId!=='fictional-doctor')throw Error('Unexpected identity');
 const f=fixture();f.dayReads++;
 if(f.state==='loading')await new Promise<void>(resolve=>{f.releaseDay=resolve;});
 if(f.state==='unavailable'||f.state==='refused')return {kind:f.state};
 const result=fixtureWho(f.long),current=alertFixture().alert!;result.alerts=current.alert.state==='resolved'?[]:[structuredClone(current)];result.p0Total=result.alerts.length;
 if((f as FixtureState&Partial<UploadFixture>).uploadApproved){result.uploads=[];result.uploadTotal=0;}
 if(f.state==='empty')return {...result,alerts:[],p0Total:0,items:[],labs:[],plans:[],uploads:[],uploadTotal:0,others:{rest:0}};
 if(f.state==='non-urgent-incomplete')return {...result,missing:['saved_plans','uploads_waiting'],urgentIncomplete:false,incomplete:true};
 if(f.state==='incomplete')return {...result,missing:['care_alerts'],urgentIncomplete:true,incomplete:true};
 return result;
}
export async function readDoctorChatAlerts(expectedDoctorId:unknown):Promise<ChatAlertsResponse>{
 if(expectedDoctorId!=='fictional-doctor')throw Error('Unexpected identity');
 const f=fixture();f.pollReads++;
 if(f.state==='poll-failed')return {kind:'unavailable'};
 const a=alertFixture();if(f.newAlert)a.alert=a.pollAlert??=fixtureAlert('new-alert','Lilit Example');
 return {kind:'alerts',alerts:f.newAlert?[structuredClone(a.pollAlert!)]:[],windows:[],p0Total:f.newAlert?1:0,capped:false,windowsCapped:false,urgentIncomplete:false,incomplete:false,asOf:'2026-11-02T08:00:00Z'};
}

import {fixtureMember,fixtureMembers} from './data';
import type {ChatMemberResponse,ChatSearchResponse} from '@/lib/staff-zoe/chat-v2-actions';
type MemberView=Extract<ChatMemberResponse,{kind:'member'}>;
export type ConversationFixture={members:Record<string,MemberView>;openReads:number;conversationReads:number;searchReads:number;approveCalls:number;composeCalls:number;reviseCalls:number;newMessage:boolean;readActive:number;maxReadActive:number;holdRead:boolean;releaseRead?:()=>void};
const conversationFixture=()=>{
 const f=fixture() as FixtureState&Partial<ConversationFixture>;
 return Object.assign(f,{members:f.members??{},openReads:f.openReads??0,conversationReads:f.conversationReads??0,searchReads:f.searchReads??0,approveCalls:f.approveCalls??0,composeCalls:f.composeCalls??0,reviseCalls:f.reviseCalls??0,newMessage:f.newMessage??false,readActive:f.readActive??0,maxReadActive:f.maxReadActive??0,holdRead:f.holdRead??false}) as FixtureState&ConversationFixture;
};
function checkDoctor(id:unknown){if(id!=='fictional-doctor')throw Error('Unexpected identity');}
function memberView(id:unknown){const f=conversationFixture(),key=String(id);return f.members[key]??=fixtureMember(key,f.long);}
export async function openDoctorChatMember(id:unknown,doctorId:unknown):Promise<ChatMemberResponse>{
 checkDoctor(doctorId);const f=conversationFixture();f.openReads++;
 if(f.state==='member-failed')return {kind:'unavailable'};
 const view=memberView(id);if(f.state?.startsWith('identity-same-name')){view.memberName='Same Name';view.identity=fixtureIdentity(String(id),'Same Name');}if(f.state?.startsWith('hand-'))view.mode.doctorMode=true;if(f.state==='hand-disabled')view.mode.zoeActive=false;if(f.state==='stale')view.staleDraft=true;
 return structuredClone(view);
}
export async function readDoctorChatConversation(id:unknown,doctorId:unknown):Promise<ChatMemberResponse>{
 checkDoctor(doctorId);const f=conversationFixture();f.conversationReads++;f.readActive++;f.maxReadActive=Math.max(f.maxReadActive,f.readActive);
 try{
  if(f.holdRead)await new Promise<void>(resolve=>{f.releaseRead=resolve;});
  if(f.state==='conversation-failed')return {kind:'unavailable'};
  const view=memberView(id);
  if(f.newMessage&&!view.thread.some(entry=>entry.key==='member:poll'))view.thread.push({key:'member:poll',who:'member',name:view.memberName,text:'A new message while you were reading.',at:'2026-11-02T09:00:00Z'});
  return {...structuredClone(view),reply:null};
 }finally{f.readActive--;}
}
export async function searchDoctorChatMembers(query:unknown,doctorId:unknown):Promise<ChatSearchResponse>{
 checkDoctor(doctorId);const f=conversationFixture();f.searchReads++;
 if(f.state==='find-member'){
  const state=f as typeof f&{searchQueries?:unknown[]};(state.searchQueries??=[]).push(query);
  if(query==='31.02.1968'||query==='123')return {kind:'invalid'};
  const matches=query==='9929'||query==='15.03.1968'||query==='Mariam'?[fixtureMembers[0]]:query==='1234'?fixtureMembers.slice(0,2):[];
  return {kind:'members',rows:matches.map(row=>fixtureIdentity(row.id,row.name)),hasMore:false};
 }
 if(f.state==='search-failed')return {kind:'unavailable'};
 const q=String(query).toLowerCase();
 if(f.state?.startsWith('identity-same-name'))return {kind:'members',rows:fixtureMembers.slice(0,2).map(member=>fixtureIdentity(member.id,'Same Name')),hasMore:false};
 const matches=q===''||q==='example'?fixtureMembers:q==='0104'?[fixtureMembers[2]]:q.includes('mariam')?[fixtureMembers[0]]:q.includes('ani')?[fixtureMembers[2]]:[];
 return {kind:'members',rows:matches.map(member=>({id:member.id,name:member.name})),hasMore:false};
}
const result=(purpose:'reply.edit'|'reply.approve',draftId:string,revision:number)=>({ok:true as const,purpose,draftId,revision,replayed:false});
export async function approveDoctorChatReply(command:unknown,_decision:unknown,doctorId:unknown){
 checkDoctor(doctorId);const f=conversationFixture();f.approveCalls++;
 if(f.state==='approve-stale')return {ok:false as const,code:'stale_context'};
 if(f.state==='approve-unknown')throw Error('Synthetic outcome unavailable');
 if(f.state==='approve-failed')return {ok:false as const,code:'unavailable'};
 const input=command as {intentId:string};const view=Object.values(f.members).find(m=>m.reply?.card?.intentId===input.intentId);
 if(!view?.reply?.card)return {ok:false as const,code:'stale_context'};
 const card=view.reply.card;
 view.thread.push({key:'doctor:d4a00000-0000-4000-8000-000000000001',who:'doctor',name:'Aram Example',text:card.body,at:'2026-11-02T09:00:00Z',delivery:{state:f.state==='delivery-unknown'?'unknown':f.state==='delivery-failed'?'definitely_failed':'queued',reason:null}});
 view.reply.card=null;view.mode.doctorMode=true;
 return {...result('reply.approve',card.draftId,card.revision),approvalId:'d3a00000-0000-4000-8000-000000000001',deliveryId:'d4a00000-0000-4000-8000-000000000001'};
}
export async function composeDoctorChatReply(input:unknown,doctorId:unknown){
 checkDoctor(doctorId);const f=conversationFixture();f.composeCalls++;
 if(f.state==='save-stale')return {ok:false as const,code:'stale_context'};
 if(f.state==='save-unknown')throw Error('Synthetic outcome unavailable');
 if(f.state==='save-failed')return {ok:false as const,code:'unavailable'};
 const value=input as {memberId:string;body:string};const view=memberView(value.memberId),draft=fixtureMember(fixtureMembers[0].id).reply!.card!;
 view.reply!.card={...draft,memberId:view.memberId,body:value.body,author:'staff',revision:2,contentHash:'synthetic-2'};
 return {ok:true as const,draftId:draft.draftId,revision:2,replayed:false};
}
export async function reviseDoctorChatReply(id:unknown,command:unknown,doctorId:unknown){
 checkDoctor(doctorId);const f=conversationFixture();f.reviseCalls++;
 const value=command as {body:string};
 if(f.state==='save-stale')return {ok:false as const,code:'stale_context'};
 if(f.state==='save-unknown')throw Error('Synthetic outcome unavailable');
 if(f.state==='save-failed')return {ok:false as const,code:'unavailable'};
 const card=memberView(id).reply!.card!;card.body=value.body;card.author='staff';card.revision++;card.contentHash=`synthetic-${card.revision}`;
 return result('reply.edit',card.draftId,card.revision);
}


import {fixtureLab} from './data';
import type {ChatLabResponse} from '@/lib/staff-zoe/chat-v2-actions';
import {autoAcceptBlock} from '@/lib/lab-ai/auto-accept';
import type {ConfirmPassingResult,ReviewCommand,ReviewResult,IdentityResult,RequestResult} from '@/lib/lab-ai/doctor-schema';
export type LabFixture={lab:ReturnType<typeof fixtureLab>;labCommands:ReviewCommand[];bulkCommands:{memberId:string;attachmentId:string;submissionId:string}[];pdfOpened:boolean};
function labFixture(){
 const f=fixture() as FixtureState&Partial<LabFixture>;
 if(!f.lab&&f.state==='lab-bulk'){
  f.lab=fixtureLab();f.lab.values[2].status='auto_accepted';
  f.lab.values.push({...f.lab.values[1],valueId:'e2a00000-0000-4000-8000-000000000004'}, {...f.lab.values[1],valueId:'e2a00000-0000-4000-8000-000000000005',checks:['unit_missing']});
 }
 return Object.assign(f,{lab:f.lab??fixtureLab(),labCommands:f.labCommands??[],bulkCommands:f.bulkCommands??[],pdfOpened:f.pdfOpened??false}) as FixtureState&LabFixture;
}
export async function readDoctorChatLab(_memberId:string,fileId:string,doctorId:string):Promise<ChatLabResponse>{
 checkDoctor(doctorId);const f=labFixture();
 if(f.state==='lab-disabled')return {kind:'off'};
 if(f.state==='lab-access')return {kind:'refused'};
 if(f.state==='lab-unavailable')return {kind:'unavailable'};
 f.lab.openedByYou=f.pdfOpened;
 if(f.state==='lab-all-auto')for(const value of f.lab.values)value.status='auto_accepted';
 if(f.state==='lab-two-eyes')f.lab.values[2].status='auto_accepted';
 const ruleBlocks=Object.fromEntries(f.lab.values.map(v=>[v.valueId,f.state==='lab-bulk'?(v.checks.length?'checks':null):autoAcceptBlock({...v,canonical:null},f.lab.job!.identityStatus!,f.lab.uploadedAt.slice(0,10),'2026-11-07')]));
 return {kind:'lab',data:{...structuredClone(f.lab),fileId},ruleBlocks};
}
export async function reviewDoctorChatLabValue(_memberId:string,_fileId:string,input:unknown,doctorId:string):Promise<ReviewResult>{
 checkDoctor(doctorId);const f=labFixture(),command=input as ReviewCommand;f.labCommands.push(command);
 if(f.state?.startsWith('lab-review-'))return {status:f.state.slice(11) as ReviewResult['status']};
 if(!f.pdfOpened)return {status:'open-first'};
 const value=f.lab.values.find(v=>v.valueId===command.valueId)!;
 value.status=command.action==='confirm'?'verified':command.action==='reject'?'rejected':'corrected';
 value.correctedValue=command.value??null;value.correctedUnit=command.unit??null;
 return {status:'saved',valueStatus:value.status};
}
export async function confirmDoctorChatPassingLabValues(memberId:string,fileId:string,input:{memberId:string;attachmentId:string;submissionId:string},doctorId:string):Promise<ConfirmPassingResult>{
 checkDoctor(doctorId);const f=labFixture();f.bulkCommands.push(input);
 if(input.memberId!==memberId||input.attachmentId!==fileId)return {status:'invalid'};
 if(!f.pdfOpened)return {status:'open-first'};
 for(const value of f.lab.values)if(value.status==='unverified'&&!value.attention&&!value.labFlag&&!value.checks.length)value.status='verified';
 return f.bulkCommands.length===1?{status:'outcome-unknown'}:{status:'saved',replayed:true,confirmed:2,remaining:2};
}
export async function confirmDoctorChatLabIdentity(_memberId:string,_fileId:string,_input:unknown,doctorId:string):Promise<IdentityResult>{checkDoctor(doctorId);return {status:'confirmed'};}
export async function requestDoctorChatLabReading(_memberId:string,_fileId:string,doctorId:string):Promise<RequestResult>{checkDoctor(doctorId);return {status:'queued'};}

import {fixturePlan} from './data';
import type {ChatPlanResponse} from '@/lib/staff-zoe/chat-v2-actions';
import type {ClinicalCardCommand} from '@/lib/doctor-decisions/approvals';
export type PlanFixture={planReads:number;planCommands:ClinicalCardCommand[];aiPlanSavedDraft?:NonNullable<ReturnType<typeof fixturePlan>['regimen']>['draft']};
function planFixture(){const f=fixture() as FixtureState&Partial<PlanFixture>;return Object.assign(f,{planReads:f.planReads??0,planCommands:f.planCommands??[]}) as FixtureState&PlanFixture;}
export type PlanReadyFixture={readyRevision?:number;readySavedAtRevision?:number;readyConsultationAtRevision?:number;readyResults?:boolean;readyReceiptCalls?:Record<string,string>[]};
function readyFixture(){const f=planFixture() as ReturnType<typeof planFixture>&PlanReadyFixture;f.readyRevision??=4;return f;}
const readyTest={id:'tsh',title:'Thyroid function',method:'lab' as const};
const readySource={attachmentId:'d6a00000-0000-4000-8000-000000000003',fileId:'d6a00000-0000-4000-8000-000000000004',fileName:'Thyroid.pdf',clinic:'Synthetic clinic',attachedAt:'2026-11-07T08:00:00Z',values:[{id:'d6a00000-0000-4000-8000-000000000005',seq:1,reviewedAt:'2026-11-07T08:00:00Z',name:'TSH',valueText:'2',value:2,unit:null,reference:null,collectedOn:'2026-11-07',laboratory:null}]};
function readyApprovals(memberId:string){
 const f=readyFixture(),approvals=fixturePlan(memberId);
 const decision=f.planCommands.findLast(command=>command.kind==='consultation-decision');
 const review=approvals.consultation!.review;
 review.engine.tests=f.state==='plan-ready-no-consultation'?[]:[readyTest];
 if(f.readyResults)review.receipts[readyTest.id]={source:'clinic-lab',attachmentId:readySource.attachmentId,values:readySource.values,note:'Recorded from Thyroid.pdf, 2026-11-07',actorId:review.doctorId,at:'2026-11-07T08:00:00Z'};
 review.consultation=decision?.kind==='consultation-decision'?{decision:decision.decision,note:decision.note}:{decision:'undecided'};
 approvals.consultation!.context.revision=f.readyRevision!;
 const card=approvals.regimen!;
 card.clinicalReview=review;card.context.revision=f.readyRevision!;
 card.review.versions=[];card.review.draft!.medicines=[];card.draft={...card.draft,medicines:[]};
 if(f.aiPlanSavedDraft)card.draft=f.aiPlanSavedDraft;
 card.current=!!f.aiPlanSavedDraft&&!(f.readyConsultationAtRevision&&f.readyConsultationAtRevision>(f.readySavedAtRevision??0));
 if(!f.aiPlanSavedDraft)approvals.regimen=null;
 return approvals;
}
export async function recordDoctorChatPlanResults(form:FormData,doctorId:string):Promise<ClinicalFormState>{
 checkDoctor(doctorId);const f=readyFixture();
 if(f.state==='plan-ready-missing')return {ok:false,message:'The selected values do not cover this required test'};
 (f.readyReceiptCalls??=[]).push(Object.fromEntries([...form.entries()].map(([key,value])=>[key,String(value)])));
 f.readyResults=true;f.readyRevision!++;
 return {ok:true,message:'Review saved. Reload the case before the next step.'};
}
export async function readDoctorChatPlan(memberId:string,doctorId:string):Promise<ChatPlanResponse>{
 checkDoctor(doctorId);const f=planFixture();f.planReads++;
 if(f.state?.startsWith('plan-ready'))return {kind:'plan',approvals:readyApprovals(memberId)};
 if(f.state==='plan-off')return {kind:'off'};
 if(f.state==='plan-unavailable')return {kind:'unavailable'};
 if(f.state==='plan-access')return {kind:'refused'};
 const approvals=fixturePlan(memberId);
 if((f.state?.startsWith('plan-ai-')||['plan-no-ai','plan-no-regimen'].includes(f.state??''))&&!f.aiPlanSavedDraft)approvals.regimen=null;
 if(f.aiPlanSavedDraft&&approvals.regimen){approvals.regimen.draft=f.aiPlanSavedDraft;approvals.regimen.context.revision=5;}
 if(f.state==='plan-consultation-stale'){
  const changed=f.planCommands.some(c=>c.kind==='consultation-decision');
  approvals.regimen!.clinicalReview!.consultation.decision=changed?'not-required':'undecided';
  approvals.regimen!.current=!changed||!!f.aiPlanSavedDraft;
  approvals.regimen!.staleReason=changed&&!f.aiPlanSavedDraft?'consultation':undefined;
  approvals.regimen!.context.revision=f.aiPlanSavedDraft?7:changed?5:4;
 }
 if(f.planCommands.some(c=>c.kind==='consultation-decision')&&approvals.consultation)approvals.consultation.review.consultation={decision:'not-required',note:'Saved decision'};
 return {kind:'plan',approvals};
}
export async function pressDoctorChatPlan(command:ClinicalCardCommand,doctorId:string){
 checkDoctor(doctorId);const f=planFixture();f.planCommands.push(command);
 if(f.state?.startsWith('plan-ready')){const r=readyFixture();r.readyRevision!++;if(command.kind==='consultation-decision')r.readyConsultationAtRevision=r.readyRevision;}
 if(f.state==='plan-refused')return {ok:false,message:'Not published: a required laboratory result has not been received yet.'};
 if(f.state==='plan-unknown')throw Error('Synthetic uncertain press');
 return {ok:true,message:command.kind==='regimen'?'Care plan published. Any notice depends on your member’s saved messaging consent.':'Review saved. Reload the case before the next step.'};
}
// Unused standalone actions must never be reached by the chat cards.
export function pressClinicalCard(){throw Error('Chat bypassed its guarded press');}
export function approveFirstNote(){throw Error('First-note approval is outside this block');}


import {fixtureAiPlan} from './data';
import {parseRegimenInput} from '@/lib/service-workflow/draft-input';
import type {ClinicalFormState} from '@/lib/patient-care/clinical-actions';
export type AiPlanFixture={aiPlanReads:number;aiPlanSaves:Record<string,string>[];aiPlanAdoptions:{id:string;fields:string[]}[];aiPlanPrepares:number;aiPlanPrepared:boolean;holdPrepare:boolean;releasePrepare?:()=>void;refreshedGeneration?:ReturnType<typeof fixtureAiPlan>['generation']};
function aiPlanFixture(){
 const f=planFixture() as FixtureState&PlanFixture&Partial<AiPlanFixture>;
 return Object.assign(f,{aiPlanReads:f.aiPlanReads??0,aiPlanSaves:f.aiPlanSaves??[],aiPlanAdoptions:f.aiPlanAdoptions??[],aiPlanPrepares:f.aiPlanPrepares??0,aiPlanPrepared:f.aiPlanPrepared??false,holdPrepare:f.holdPrepare??false}) as FixtureState&PlanFixture&AiPlanFixture;
}
export async function readDoctorChatAiPlan(memberId:string,doctorId:string){
 checkDoctor(doctorId);const f=aiPlanFixture();f.aiPlanReads++;
 if(f.state==='plan-off')return {kind:'off' as const};
 if(f.state==='plan-unavailable')return {kind:'unavailable' as const};
 if(f.state==='plan-access')return {kind:'refused' as const};
 if(f.state?.startsWith('plan-ready')){
  const r=readyFixture(),data=fixtureAiPlan(memberId),approvals=readyApprovals(memberId);
  const labFiles=f.state==='plan-ready-missing'?[]:[{fileId:readySource.fileId,fileName:readySource.fileName,needsReview:f.state==='plan-ready-lab-links'},...(f.state==='plan-ready-lab-links'?[{fileId:'d6a00000-0000-4000-8000-000000000006',fileName:'Second lab file.pdf',needsReview:true}]:[])];
  return {...data,generation:f.aiPlanAdoptions.length?null:data.generation,snapshot:{...data.snapshot,draft:f.aiPlanSavedDraft??null,revision:r.readyRevision!,draftStale:!!f.aiPlanSavedDraft&&!approvals.regimen?.current},savedDraftCurrent:!!approvals.regimen?.current,ready:{labFiles,results:f.state==='plan-ready-no-consultation'?[]:[{...readyTest,recorded:!!r.readyResults,source:f.state==='plan-ready-missing'?null:readySource,reason:f.state==='plan-ready-missing'?'missing' as const:null}],sourcesAvailable:true,reviewCurrent:!!f.aiPlanSavedDraft,urgency:'green' as const,proposal:consultationProposal('green',f.state==='plan-ready-no-consultation'?null:f.state==='plan-ready-proposal'?'No consultation is needed.':'Routine review within 12 months')}};
 }
 const data:Omit<ReturnType<typeof fixtureAiPlan>,'snapshot'|'generation'>&{snapshot:Omit<ReturnType<typeof fixtureAiPlan>['snapshot'],'draft'>&{draft:ReturnType<typeof fixtureAiPlan>['snapshot']['draft']|null};generation:ReturnType<typeof fixtureAiPlan>['generation']|null}=fixtureAiPlan(memberId);
 if(f.state?.startsWith('plan-ai-')||f.state==='plan-no-ai')data.snapshot.draft=null;
 if(f.state==='plan-no-regimen')data.snapshot.draft={...data.snapshot.draft!,medicines:undefined,medicationName:'Saved single medicine',medicationDose:'Saved single dose',medicationTimes:['09:00']};
 if(!f.state?.startsWith('plan-ai-')&&!f.aiPlanPrepared)data.generation=null;
 if(f.state==='plan-ai-stale'&&!f.aiPlanPrepared||f.state==='plan-ai-save-refused'&&f.aiPlanSaves.length>0){data.stale=true;data.snapshot.draftStale=true;}
 if(f.aiPlanSavedDraft){data.snapshot.draft=f.aiPlanSavedDraft;data.snapshot.revision=5;}
 if(f.aiPlanPrepared&&f.state==='plan-ai-prepare-missing')data.generation=null;
 if(f.aiPlanPrepared&&f.state==='plan-ai-prepare-off')return {kind:'off' as const};
 if(f.state==='plan-consultation-stale'){
  const changed=f.planCommands.some(c=>c.kind==='consultation-decision');
  data.snapshot.revision=f.aiPlanSavedDraft?7:changed?5:4;data.snapshot.draftStale=changed&&!f.aiPlanSavedDraft;
 }
 if(f.refreshedGeneration)data.generation=f.refreshedGeneration;
 return structuredClone({...data,trends:data.generation&&!data.stale?{bp:fixtureGraphs(memberId).series.bp,ldl:fixtureGraphs(memberId).series.ldl}:null});
}
export async function saveDoctorChatAiPlan(_previous:ClinicalFormState,form:FormData,doctorId:string):Promise<ClinicalFormState>{
 checkDoctor(doctorId);const f=aiPlanFixture();
 f.aiPlanSaves.push(Object.fromEntries([...form.entries()].map(([key,value])=>[key,String(value)])));
 if(f.state==='plan-ai-save-refused')return {ok:false,message:'Source evidence changed. Your edits are retained. Review the current evidence before saving again.'};
 f.aiPlanSavedDraft={explanation:String(form.get('explanation')),instructions:String(form.get('instructions')),followUp:String(form.get('followUp')),medicationName:String(form.get('medicationName')??''),medicationDose:String(form.get('medicationDose')??''),medicationTimes:String(form.get('medicationTimes')??'').split(',').filter(Boolean),medicationInstructions:String(form.get('medicationInstructions')??''),...(form.get('medicines')?{medicines:parseRegimenInput(String(form.get('medicines'))) as NonNullable<PlanFixture['aiPlanSavedDraft']>['medicines']}:{})};
 if(f.state?.startsWith('plan-ready')){const r=readyFixture();r.readyRevision!++;r.readySavedAtRevision=r.readyRevision;return {ok:true,message:'Draft saved. Nothing has been published.',revision:r.readyRevision};}
 return {ok:true,message:'Draft saved. Nothing has been published.',revision:f.state==='plan-consultation-stale'?7:5};
}
export async function recordDoctorChatAiPlanAdoption(id:string,fields:string[],doctorId:string){checkDoctor(doctorId);aiPlanFixture().aiPlanAdoptions.push({id,fields});return true;}
export async function prepareDoctorChatAiPlan(_memberId:string,doctorId:string){
 checkDoctor(doctorId);const f=aiPlanFixture();f.aiPlanPrepares++;
 if(f.holdPrepare)await new Promise<void>(resolve=>{f.releasePrepare=resolve;});
 f.aiPlanPrepared=true;
 return {ok:true,generationId:fixtureAiPlan(_memberId).generation.id,message:'Draft prepared. Check each marked field before saving.'};
}
export function saveRealDraft(){throw Error('Chat bypassed its guarded draft save');}
export function enrollRealMember(){throw Error('Enrollment is outside this block');}
export function recordAiPlanAdoption(){throw Error('Chat bypassed its guarded adoption');}
export function checkRealClinicalCaseAvailability(){throw Error('Chat bypassed its guarded evidence read');}
import {fixtureUpload,fixtureUploadDocument} from './data';
import type {ChatUploadResponse} from '@/lib/staff-zoe/chat-v2-actions';
import type {ApproveCommand,ApproveResult as UploadApproveResult} from '@/lib/lab-ai/member-approval';
export type UploadFixture={uploadCommands:ApproveCommand[];uploadApproved:boolean};
function uploadFixture(){const f=fixture() as FixtureState&Partial<UploadFixture>;return Object.assign(f,{uploadCommands:f.uploadCommands??[],uploadApproved:f.uploadApproved??false}) as FixtureState&UploadFixture;}
export async function readDoctorChatUpload(_memberId:string,_documentId:string,doctorId:string):Promise<ChatUploadResponse>{
 checkDoctor(doctorId);const f=uploadFixture();
 if(f.state==='upload-off')return {kind:'off'};
 if(f.state==='upload-access')return {kind:'refused'};
 if(f.state==='upload-unavailable')return {kind:'unavailable'};
 const data=fixtureUpload();
 if(f.state==='upload-photo'){data.document.mime='image/png';data.document.fileName='Member upload.png';data.doc.job!.pageCount=1;}
 if(f.state==='upload-identity')data.doc.job!.confirmation=null;
 return data;
}
export async function approveDoctorChatUpload(input:ApproveCommand,doctorId:string):Promise<UploadApproveResult>{
 checkDoctor(doctorId);const f=uploadFixture();f.uploadCommands.push(input);
 if(f.state?.startsWith('upload-approve-'))return {status:f.state.slice(15) as UploadApproveResult['status']};
 f.uploadApproved=true;
 const view=memberView(input.memberId);view.uploads=view.uploads?.filter(u=>u.documentId!==fixtureUploadDocument);
 return {status:'approved'};
}
import type {EverydayResult} from '@/lib/staff-zoe/everyday-runtime';
import type {AlertItem} from '@/lib/doctor-inbox/contracts';
export type AlertFixture={alert?:AlertItem;alertCommands?:{press:string;alertId:string;seq:number;resolution?:string;note?:string}[];alertReads?:number;handBackCalls?:number;pollAlert?:AlertItem};
function alertFixture(){const f=conversationFixture() as FixtureState&ConversationFixture&AlertFixture;f.alert??=fixtureAlert();f.alertCommands??=[];return f;}
export async function readDoctorChatAlert(id:unknown,doctorId:unknown){
 checkDoctor(doctorId);const f=alertFixture();f.alertReads=(f.alertReads??0)+1;
 return id===f.alert!.alert.id?{kind:'alert' as const,alert:structuredClone(f.alert!.alert)}:{kind:'unavailable' as const};
}
async function alertCommand(raw:unknown,doctorId:unknown,press:string):Promise<EverydayResult>{
 checkDoctor(doctorId);const f=alertFixture(),input=raw as {alertId:string;seq:number;resolution?:string;note?:string};
 f.alertCommands!.push({press,...input});
 if(f.state==='alert-changed'){f.alert!.alert.stateSeq++;return {kind:'changed'};}
 if(f.state==='alert-unknown')throw Error('Synthetic unknown outcome');
 if(f.state==='alert-resolved')return {kind:'already_resolved',resolvedBy:'Doctor Earlier',resolvedAt:'2026-11-02T09:00:00Z'};
 f.alert!.alert.state=press==='acknowledge'?'acknowledged':'resolved';f.alert!.alert.stateSeq++;
 return {kind:'saved',notice:press==='acknowledge'?'acknowledged':'resolved'};
}
export async function acknowledgeDoctorChatAlert(raw:unknown,doctorId:unknown){return alertCommand(raw,doctorId,'acknowledge');}
export async function resolveDoctorChatAlert(raw:unknown,doctorId:unknown){return alertCommand(raw,doctorId,'resolve');}
export async function handBackDoctorChat(raw:unknown,doctorId:unknown):Promise<EverydayResult>{
 checkDoctor(doctorId);const f=alertFixture();f.handBackCalls=(f.handBackCalls??0)+1;
 if(f.state==='hand-unknown')throw Error('Synthetic unknown outcome');
 if(f.state==='hand-changed')return {kind:'changed'};
 if(f.state==='hand-inactive')return {kind:'zoe_inactive'};
 const input=raw as {memberId:string;version:number;modeRevision:string},view=Object.values(f.members).find(m=>m.memberId===input.memberId);
 if(!view||view.version!==input.version||view.modeRevision!==input.modeRevision)return {kind:'changed'};
 view.mode.doctorMode=false;return {kind:'saved',notice:'handed_back'};
}


import {zoeFixture,zoeConversation,zoeAnswer,bpChartCard} from './zoe';
import type {ChatQuestionMemberResponse,ChatZoeHistoryResponse} from '@/lib/staff-zoe/chat-v2-actions';
export async function openDoctorChatZoe(memberId:unknown,doctorId:unknown){
 checkDoctor(doctorId);const f=zoeFixture();f.zoeOpenCalls.push(String(memberId));
 return f.state==='zoe-open-failed'?{ok:false as const}:{ok:true as const,conversationId:memberId===fixtureMembers[0].id?zoeConversation:`f1a00000-0000-4000-8000-${String(fixtureMembers.findIndex(m=>m.id===memberId)+1).padStart(12,'0')}`};
}
export async function readDoctorChatBp(memberId:unknown,doctorId:unknown){
 checkDoctor(doctorId);if(!fixtureMembers.some(m=>m.id===memberId))return {kind:'refused' as const};
 return {kind:'bp' as const,card:bpChartCard};
}
export async function findDoctorChatQuestionMember(question:unknown,doctorId:unknown,currentMember?:{memberId:string;memberName:string}):Promise<ChatQuestionMemberResponse>{
 checkDoctor(doctorId);const current=currentMember?.memberId,f=zoeFixture(),text=String(question).normalize('NFKC').toLowerCase();f.zoeQuestionCalls.push(String(question));f.zoeQuestionTargets.push(current??null);
 if(f.state==='zoe-question-failed')return {kind:'unavailable'};
 if(f.state==='zoe-question-invalid')return {kind:'invalid'};
 if(f.state==='zoe-question-ambiguous')return {kind:'ambiguous'};
 const words:string[]=text.match(/[\p{L}\p{M}]+/gu)??[],whole=` ${words.join(' ')} `;
 const matches=fixtureMembers.filter(m=>m.name.toLowerCase().split(' ').some(word=>word!=='example'&&words.includes(word)));
 const verified=matches.filter(m=>whole.includes(` ${m.name.toLowerCase()} `));
 if(verified.length===1)return verified[0].id===current?{kind:'keep'}:{kind:'member',memberId:verified[0].id,memberName:verified[0].name};
 if(!matches.length)return {kind:current?'keep':'none'};
 if(current&&matches.every(m=>m.id===current))return {kind:'keep'};
 return {kind:'choose',rows:matches};
}
export async function readDoctorChatZoeHistory(doctorId:unknown):Promise<ChatZoeHistoryResponse>{
 checkDoctor(doctorId);const f=zoeFixture();f.zoeHistoryReads++;
 if(f.state==='zoe-history-failed')return {kind:'unavailable'};
 if(f.state!=='zoe-history')return {kind:'history',turns:[],conversations:[],target:null};
 const conversations=Array.from({length:3},(_,i)=>({conversationId:`f1a00000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,memberId:fixtureMembers[i===2?1:i===1?2:0].id,memberName:fixtureMembers[i===2?1:i===1?2:0].name,savedAt:new Date(Date.parse('2026-11-02T06:00:00Z')+(17+i)*60_000).toISOString()}));
 const turns=Array.from({length:20},(_,i)=>({...conversations[Math.min(2,Math.floor(i/7))],key:`saved-${i}`,seq:i+1,role:i%2?'zoe' as const:'staff' as const,text:i%2?'':`Saved question ${i}`,content:i%2?zoeAnswer():null,savedAt:new Date(Date.parse('2026-11-02T06:00:00Z')+i*60_000).toISOString()}));
 return {kind:'history',turns,conversations,target:conversations.at(-1)!};
}

// The fixture never connects Telegram: the menu is hidden when the page passes no `telegram` state.
export async function connectDoctorTelegram(_form:FormData){return {ok:false as const,code:'unavailable' as const};}
export async function verifyDoctorTelegram(_form:FormData){return {ok:false as const,code:'unavailable' as const};}
export async function disconnectDoctorTelegram(){return {ok:false as const,code:'unavailable' as const};}
export async function doctorTelegramMenuState(){return null;}

import {fixtureResults} from './data';
import type {ResultEntryField} from '@/lib/gp-report/result-entry';
import type {ResultsBlockState,ApproveResult} from '@/lib/gp-report/runtime';
export type ResultsFixture={results:ReturnType<typeof fixtureResults>;resultsReads:number;resultSaves:number;reportApprovals:number};
function resultsFixture(){
 const f=fixture() as FixtureState&Partial<ResultsFixture>;
 return Object.assign(f,{results:f.results??fixtureResults(),resultsReads:f.resultsReads??0,resultSaves:f.resultSaves??0,reportApprovals:f.reportApprovals??0}) as FixtureState&ResultsFixture;
}
export async function readDoctorChatResults(doctorId:unknown,memberId:string):Promise<ResultsBlockState>{
 checkDoctor(doctorId);const f=resultsFixture();f.resultsReads++;
 return f.state==='results'&&memberId===fixtureMembers[0].id?structuredClone(f.results):{status:'none'};
}
export async function saveResultEntry(memberId:string,field:ResultEntryField,value:number|'yes'|'no'|null,on:string,_submissionId:string){
 if(memberId!==fixtureMembers[0].id||!_submissionId)throw Error('Unexpected fictional member');
 const f=resultsFixture();f.resultSaves++;
 const keys={score2_percent:'score2Percent',potassium:'potassium',ecg_lvh:'ecgLvh',ecg_ischaemia:'ecgIschaemia',echo_done:'echoDone',ahi:'ahi'} as const;
 Object.assign(f.results.entries,{[keys[field]]:value===null?null:{value,on}});
 f.results=fixtureResults(memberId,f.results.entries);
 return {status:'saved' as const};
}
export async function approveMemberGpReport(memberId:string,token:string,_submissionId:string,shownResultsAssessment=false):Promise<ApproveResult>{
 const f=resultsFixture();
 if(memberId!==fixtureMembers[0].id||!shownResultsAssessment||!_submissionId)throw Error('Unexpected fictional approval');
 if(token!==f.results.token)return {status:'stale'};
 f.reportApprovals++;
 return {status:'approved',approval:{version:1,approvedAt:'2026-11-02T10:00:00Z',approvedByName:'Aram Example'}};
}

/** The doctor's home reads that the typed plain-word commands use: only the missing blood pressure list has a fixture. */
export async function readDoctorHome(input:{kind:string},doctorId:unknown){
 checkDoctor(doctorId);
 if(input.kind!=='missing_bp')return {kind:'unavailable' as const};
 const rows=fixtureMembers.map(member=>({id:member.id,name:member.name}));
 return {kind:'missing_bp' as const,page:{rows,hasMore:false,nextCursor:null},missingIds:[rows[2]!.id],query:'',from:'2026-10-28',to:'2026-11-03',unknown:0,asOf:'2026-11-03T08:00:00Z'};
}

// Doctor-to-nurse handover stays entirely inside the synthetic browser fixture.
import type {DoctorHandover} from '@/lib/staff-zoe/handover';
type HandoverFixture={handovers?:DoctorHandover[];handoverState?:'sent'|'working'|'done';handoverFail?:boolean};
export async function prepareDoctorChatHandover(memberId:string,doctorId:string){
 checkDoctor(doctorId);
 if(fixture().state==='no-nurse')return {kind:'refused' as const};
 return {kind:'handover' as const,target:{memberId,memberName:memberView(memberId).memberName,nurseId:'00000000-0000-4000-8000-000000000002',nurseName:'Nurse Example',conversationId:memberView(memberId).conversationId!}};
}
export async function sendDoctorChatHandover(command:DoctorHandover,doctorId:string){
 checkDoctor(doctorId);const f=fixture()as FixtureState&HandoverFixture;
 (f.handovers??=[]).push(structuredClone(command));
 return {kind:f.handoverFail?'unavailable' as const:'sent' as const};
}
export async function readDoctorChatHandover(_taskId:string,_memberId:string,_nurseId:string,doctorId:string){
 checkDoctor(doctorId);return {kind:'state' as const,state:(fixture()as FixtureState&HandoverFixture).handoverState??'sent'};
}

export async function readStaffChatMemberIdentities(ids:unknown){
 if(!Array.isArray(ids))return null;
 const f=fixture();
 if(f.state==='identity-unavailable')return null;
 return ids.map(id=>{
  const identity=fixtureIdentity(String(id),f.state?.startsWith('identity-same-name')?'Same Name':undefined);
  if(f.state==='identity-masked'){const {phone:_,...masked}=identity;return masked;}
  return identity;
 });
}

/** Synthetic portfolio fixture. No record, authentication or provider IO. */
export async function readDoctorChatPanel(doctorId:unknown,mode:'summary'|'full'='full'):Promise<import('@/lib/staff-zoe/panel').PanelResponse>{
 checkDoctor(doctorId);const f=fixture();
 if(f.state==='panel-unavailable')return {kind:'unavailable'};
 const day=await readDoctorChatDay(doctorId);if(day.kind!=='who')return {kind:'unavailable'};
 const queue={...day,urgentIncomplete:day.urgentIncomplete||f.state==='poll-failed',incomplete:day.incomplete||f.state==='poll-failed'};
 const rows:import('@/lib/staff-zoe/panel').PanelMember[]=f.state==='empty'?[]:fixtureMembers.slice(0,3).map((member,i)=>({identity:fixtureIdentity(member.id,member.name),risk:i===0?'very_high':i===1?'low':null,attention:i===0?'urgent':i===1?'needs_me':'none',unavailable:false,bp:i===2?null:{systolic:120+i*10,diastolic:78,at:'2026-11-06T08:00:00Z',unverified:i===1},ldl:i===2?null:{value:1.2+i,on:'2026-11-05',counted:i===0}}));
 const ids=rows.map(r=>r.identity.id),bar=(key:string,count:number,memberIds:string[])=>({key,count,memberIds});
 return {kind:'panel',rows,who:queue,asOf:'2026-11-06T08:00:00Z',graphs:mode==='summary'?[]:[
  {kind:'risk',total:rows.length,bars:[bar('very_high',rows.length?1:0,ids.slice(0,1)),bar('low',rows.length?1:0,ids.slice(1,2)),bar('unknown',rows.length?1:0,ids.slice(2))]},
  {kind:'ldl',total:rows.length,bars:[bar('at_goal',rows.length?1:0,ids.slice(0,1)),bar('unknown',Math.max(0,rows.length-1),ids.slice(1))]},
  {kind:'readings',total:rows.length,bars:[bar('2026-10-26',rows.length?5:0,ids.slice(0,1)),bar('2026-11-02',rows.length?7:0,ids.slice(1,2))]},
  {kind:'alerts',total:rows.length,bars:[bar('2026-11-05',rows.length?1:0,ids.slice(0,1)),bar('2026-11-06',0,[])]},
 ]};
}
import {fixtureGraphs} from './data';
export async function readDoctorPatientGraphs(memberId:unknown,doctorId:unknown){
 checkDoctor(doctorId);if(!fixtureMembers.some(m=>m.id===memberId))return {kind:'refused' as const};
 if(fixture().state==='graphs-unavailable')return {kind:'unavailable' as const};
 const data=fixtureGraphs(String(memberId));
 if(fixture().state==='graphs-empty')for(const id of Object.keys(data.series) as (keyof typeof data.series)[])data.series[id].points=[];
 if(fixture().state==='graphs-one')for(const id of Object.keys(data.series) as (keyof typeof data.series)[])data.series[id].points=data.series[id].points.slice(0,1);
 return {kind:'graphs' as const,data};
}
export async function readDoctorPatientChatHistory(memberId:unknown,doctorId:unknown){checkDoctor(doctorId);return {kind:'history' as const,conversations:[],turns:[]};}
export async function readDoctorPatientChatAlerts(memberId:unknown,doctorId:unknown){checkDoctor(doctorId);return {kind:'alerts' as const,alerts:fixture().state==='notice-focus'?[structuredClone(alertFixture().alert!),fixtureAlert('new-alert')]:[]};}

// Resolve prefill reads the same synthetic alert; no real server action can enter the fixture.
export async function readCareAlertResolutionRecord(id:string){
 const f=alertFixture() as ReturnType<typeof alertFixture>&{resolutionMode?:'none'|'unavailable';resolutionReads?:number};
 f.resolutionReads=(f.resolutionReads??0)+1;
 if(f.resolutionMode==='unavailable')return null;
 const item=[f.alert,f.pollAlert].find(item=>item?.alert.id===id);if(!item)return null;
 return {alert:structuredClone(item.alert),cycleStartedAt:item.alert.createdAt,closer:'Aram Example',contacts:f.resolutionMode==='none'?[]:[{id:'synthetic-reply',memberId:item.memberId,at:'2026-11-07T09:00:00Z',by:'Nurse Example',kind:'reply' as const,state:'in_app'}]};
}
