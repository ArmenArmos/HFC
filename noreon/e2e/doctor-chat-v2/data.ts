import type {AlertItem,InboxItem} from '@/lib/doctor-inbox/contracts';
import type {ChatDayResponse} from '@/lib/staff-zoe/chat-v2-actions';
const at='2026-11-02T08:00:00Z',memberId='d1a00000-0000-4000-8000-000000000001';
export function fixtureAlert(id='urgent-one',memberName='Ani Example'):AlertItem{
 return {id,memberId,memberName,at,rank:0,lane:'P0',kind:'care_alert',confidence:'rule',ai:'none',sources:[],alert:{id:id==='new-alert'?'a1a00000-0000-4000-8000-000000000002':'a1a00000-0000-4000-8000-000000000001',memberId,memberName,source:'message',priority:'urgent',reason:'urgent_words_matched',redFlags:[],state:'open',stateSeq:1,occurrences:1,createdAt:at,lastSeenAt:at,doctorName:null,acknowledgedAt:null,acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[]}};
}
export function fixtureWho(long=false):Extract<ChatDayResponse,{kind:'who'}>{
 const items:InboxItem[]=Array.from({length:long?70:3},(_,i)=>({id:`reply-${i}`,memberId:`d1a00000-0000-4000-8000-${String(i+2).padStart(12,'0')}`,memberName:i===0?'Mariam Example':`Member Example ${i}`,at,rank:4,lane:'P1',kind:'reply_draft',confidence:'H',ai:'draft',sources:[],
  ...(i===0?{draft:{draftId:memberId,revision:1,body:'Synthetic draft',contentHash:'synthetic',author:'ai_assistant',structured:true,stale:false,planCurrent:true,openAlert:false,asked:'Can you help me understand my plan? '.repeat(5),acknowledgementId:null,needsJudgement:false,outsidePlan:false,judgementReasons:[],doctorDecides:[],approvable:true}}:{})}));
 return {kind:'who',missing:[],identityChecks:[],windows:[],alerts:[fixtureAlert()],p0Total:1,items,labs:[{id:'lab-attention',memberId:items[0].memberId,memberName:'Mariam Example',at,rank:0,lane:'P1',kind:'lab_attention',confidence:'rule',ai:'none',sources:[],fileId:fixtureFile,critical:1,flagged:1,toReview:3},{id:'lab-sheet',memberId:items[1].memberId,memberName:'Member Example 1',at,rank:0,lane:'P2',kind:'lab_sheet',confidence:'rule',ai:'none',sources:[],fileId:'e1a00000-0000-4000-8000-000000000002',toReview:3}],plans:[{id:'plan-second',memberId,memberName:'Ani Example',at,rank:9,lane:'P2',kind:'plan_draft',confidence:'M',ai:'draft',sources:[]},{id:'plan-first',memberId:items[0].memberId,memberName:'Mariam Example',at,rank:1,lane:'P2',kind:'plan_draft',confidence:'M',ai:'draft',sources:[]},{kind:'saved_plan',id:'saved-plan:'+items[1].memberId,memberId:items[1].memberId,memberName:items[1].memberName,at}],uploads:[{memberId:items[0].memberId,memberName:'Mariam Example',documentId:fixtureUploadDocument,jobId:fixtureUploadDocument,at}],uploadTotal:1,others:{rest:3},urgentIncomplete:false,incomplete:false,capped:long,asOf:at};
}

import type {ChatMemberResponse} from '@/lib/staff-zoe/chat-v2-actions';
export const fixtureMembers=[
 {id:'d1a00000-0000-4000-8000-000000000002',name:'Mariam Example'},
 {id:'d1a00000-0000-4000-8000-000000000003',name:'Member Example 1'},
 {id:memberId,name:'Ani Example'},
];
export const fixtureDraft='You can keep following your agreed care plan and send your home readings.';
export function fixtureIdentity(id:string,name=fixtureMembers.find(member=>member.id===id)?.name??'Member Example'){
 return {id,name,birthDate:id===fixtureMembers[0].id?'1986-11-06':'1992-04-15',birthYear:id===fixtureMembers[0].id?1986:1992,sex:'female' as const,clinic:'Linked identity clinic',phone:id===fixtureMembers[0].id?'+37499123456':'+37499787890',phoneLast4:id===fixtureMembers[0].id?'3456':'7890',shortId:id.slice(-8).toUpperCase()};
}
export function fixtureMember(id:string,long=false):Extract<ChatMemberResponse,{kind:'member'}>{
 const member=fixtureMembers.find(m=>m.id===id)??{id,name:'Lilit Example'};
 const card=id===fixtureMembers[0].id?{memberId:id,draftId:'d2a00000-0000-4000-8000-000000000001',revision:1,body:fixtureDraft,summary:'Synthetic reply',author:'ai_assistant' as const,contentHash:'synthetic-1',intentId:'a'.repeat(32),requestId:'b'.repeat(32),takeover:true,modeRevision:'c'.repeat(32)}:null;
 return {kind:'member',memberId:id,memberName:member.name,identity:fixtureIdentity(id,member.name),conversationId:id,version:3,modeRevision:'c'.repeat(32),uploads:id===fixtureMembers[0].id?[{documentId:fixtureUploadDocument,jobId:fixtureUploadDocument}]:[],
  thread:Array.from({length:long?100:3},(_,i)=>({key:`member:${i}`,who:i%3===1?'zoe' as const:i%3===2?'nurse' as const:'member' as const,name:i%3===1?'Zoe':i%3===2?'Nurse Example':member.name,text:long?`Earlier conversation message ${i}`:['Can you help me understand my plan?','Your doctor can review this with you.','Your readings are ready for review.'][i],at:new Date(Date.parse(at)+i*1000).toISOString()})),
  reply:{card,prepare:{memberId:id,expectedVersion:3,expectedClinicalRevision:1,expectedDraftEpoch:1,expectedSource:'synthetic-source'}},replyFailed:false,source:null,sourcesFailed:false,
  mode:{ok:true,doctorMode:false,zoeActive:true,since:null,byName:null,intakePaused:false,scope:'conversation'},unsupportedMedia:false,unsavedOverLimit:false,urgentOpen:false,urgentSince:null,zoeFailed:false,urgentFailed:false,staleDraft:false};
}

import type {LabRead} from '@/lib/lab-ai/doctor-schema';
export const fixtureFile='e1a00000-0000-4000-8000-000000000001';
export function fixtureLab():Extract<LabRead,{enabled:true}>{
 return {version:'lab-ai-read-v1',enabled:true,fileId:fixtureFile,name:'Synthetic lab sheet.pdf',clinic:'Example clinic',uploadedAt:at,openedByYou:false,
  job:{jobId:fixtureFile,fileId:fixtureFile,state:'done',outcome:null,attempts:1,pageCount:3,identityStatus:'match',identityConfirmedAt:null,identityNote:null,provider:'noreon.fake',model:null,createdAt:at,finishedAt:at,counts:{total:3,unverified:3,verified:0,autoAccepted:0,rejected:0,attention:1},calls:{count:0,costUsd:0,models:[]},summary:null,identity:{nameOnSheet:'Mariam Example',birthDateOnSheet:'1980-01-01',sampleDate:'2026-11-02',patientsSeen:1,nameMatch:'yes',birthDateMatch:'yes'}},
  values:['LDL','Sodium','ALT'].map((testName,i)=>({valueId:`e2a00000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,seq:i+1,testName,catalogueRef:null,valueText:['3.1','138','41'][i],value:[3.1,138,41][i],unit:i===2?'U/L':'mmol/L',refLow:null,refHigh:null,refText:null,labFlag:i===0?'critical':null,collectedOn:'2026-11-02',labName:null,page:i+1,snippet:null,checks:[],attention:i===0?'lab_critical':null,attentionRule:null,status:'unverified',correctedValue:null,correctedUnit:null,reviewNote:null,reviewedAt:null,reviewedByYou:null}))};
}

import type {ApprovalCards} from '@/lib/doctor-decisions/approvals';
export function fixturePlan(id=memberId):ApprovalCards{
 const context={memberId:id,revision:4,evidenceToken:'a'.repeat(32)};
 const medicine={name:'Saved medicine',dose:'Saved dose',times:['09:00'],instructions:'Saved medicine instructions'};
 return {firstNote:{context:{...context,appointmentsRevision:'c'.repeat(32)},submissionId:id,assessmentRevision:1,data:{version:'first-note-v1',enabled:true,completedAt:at,dueAt:at,urgent:false,planActive:false,note:null},draft:{text:{en:'First note must stay outside this block',hy:'Առաջին գրառում'},sources:[]}},regimen:{context,current:true,clinicalReview:{evidenceToken:context.evidenceToken,doctorId:id,preparedAt:at,engine:{version:'fixture',urgency:'green',tests:[]},approvals:{},receipts:{},consultation:{decision:'not-required'}},requestId:'d5a00000-0000-4000-8000-000000000001',
  draft:{explanation:'Exact saved explanation',instructions:'Exact saved care instructions',followUp:'Exact saved follow-up',medicationName:'',medicationDose:'',medicationTimes:[],medicationInstructions:'',medicines:[medicine]},
  review:{version:'regimen-review-v1',enabled:true,versions:[{planId:id,version:1,publishedAt:at,changeSummary:null,current:true,medicines:[{...medicine,dose:'Previous dose'}],changes:[]}],draft:{medicines:[medicine],approvalHash:'b'.repeat(32),changes:[{kind:'dose_changed',name:medicine.name,fromDose:'Previous dose',toDose:medicine.dose}]}}},
  consultation:{context,review:{evidenceToken:context.evidenceToken,doctorId:id,preparedAt:at,engine:{version:'fixture',urgency:'green',tests:[]},approvals:{},receipts:{},consultation:{decision:'undecided'}}}};
}


export const fixtureAiGeneration='d6a00000-0000-4000-8000-000000000001';
export function fixtureAiPlan(id:string){
 return {kind:'ai-plan' as const,labEvidence:{generationId:fixtureAiGeneration,values:[] as import('@/lib/ai-plan/contracts').PlanLabValue[]},snapshot:{id,revision:4,evidenceToken:'a'.repeat(32),draft:fixturePlan(id).regimen!.draft,draftSavedAt:at,draftStale:false},generation:{id:fixtureAiGeneration,summary:'Synthetic protocol summary for doctor review.',draft:{explanation:'AI explanation for review',instructions:'AI care instructions for review',followUp:'AI follow-up for review'},items:[{id:'fixture.follow_up',section:'follow_up' as const,status:'protocol' as const,text:'Review your home readings.',rationale:'A synthetic protocol item.',source:{kind:'protocol' as const,ref:'fixture',label:'Synthetic protocol'},timing:'Next review',member:{en:'Review your home readings.',hy:'Վերանայեք ձեր չափումները։'}}]},stale:false,published:false};
}

import type {ChatUploadResponse} from '@/lib/staff-zoe/chat-v2-actions';
export const fixtureUploadDocument='f1a00000-0000-4000-8000-000000000001';
export function fixtureUpload():Extract<ChatUploadResponse,{kind:'upload'}>{
 const lab=fixtureLab();
 return {kind:'upload',document:{id:fixtureUploadDocument,fileName:'Member upload.pdf',mime:'application/pdf',sizeBytes:100,resultDate:'2026-11-02',createdAt:at},
  doc:{documentId:fixtureUploadDocument,name:'Member upload.pdf',uploadedAt:at,job:{jobId:fixtureUploadDocument,state:'done',outcome:null,pageCount:3,identityStatus:'match',identity:null,summary:null,provider:'noreon.fake',model:null,createdAt:at,finishedAt:at,confirmation:{identityAnswer:'mine',valuesSaved:3,valuesCharted:1,at}},
   values:lab.values.map(v=>({valueId:v.valueId,seq:v.seq,testName:v.testName,catalogueRef:v.catalogueRef,valueText:v.valueText,value:v.value,unit:v.unit,refText:v.refText,labFlag:v.labFlag,collectedOn:v.collectedOn,page:v.page,checks:v.checks,attention:v.attention,attentionRule:v.attentionRule,memberStatus:'confirmed',memberValue:null,memberReviewedAt:at}))},
  approvals:{version:'member-upload-approvals-v1',required:true,canApprove:true,readings:[{jobId:fixtureUploadDocument,documentId:fixtureUploadDocument,ranges:lab.values.map(v=>({valueId:v.valueId,refLow:0,refHigh:5})),approval:null}]}};
}

import {resultsAssessment,type ResultsAssessmentInput} from '@/lib/clinical/rules/results-assessment';
import type {ResultsBlockState} from '@/lib/gp-report/runtime';
/** Fictional, reviewed lipids with no SCORE2 entered yet. Uses the production assessment. */
export function fixtureResults(id=fixtureMembers[0].id,entries:ResultsAssessmentInput['entries']={score2Percent:null,potassium:null,ecgLvh:null,ecgIschaemia:null,echoDone:null,ahi:null}):Extract<ResultsBlockState,{status:'ready'}>{
 const input:ResultsAssessmentInput={answers:{'q6.conditions':{fieldId:'q6.conditions',value:['none'],source:'manual',answeredAt:at}},questionnaireComplete:true,age:55,
  labs:{totalCholesterol:{value:4.8,on:'2026-11-02'},hdl:{value:1.5,on:'2026-11-02'},ldl:{value:2.7,on:'2026-11-02'},egfr:null,uacr:null,hba1c:null},latestTotalCholesterol:{value:4.8,on:'2026-11-02'},entries,awaitingReview:0};
 return {status:'ready',memberId:id,token:JSON.stringify(entries),submissionId:'f1a00000-0000-4000-8000-000000000001',priorityLevel:'green',priority:{en:'Continue routine follow-up.',hy:'Շարունակեք պլանային հսկողությունը։'},assessment:resultsAssessment(input),labsShown:input.labs,nonHdlOn:'2026-11-02',entries,
  reportBlocks:{en:[{type:'p',text:'Fictional report for clinical review.'}],hy:[{type:'p',text:'Հորինված հաշվետվություն կլինիկական վերանայման համար։'}]}};
}

/** Synthetic chart history shared by mounted/browser checks. Never connects to a record reader. */
export function fixtureGraphs(memberId=fixtureMembers[0].id):import('@/lib/staff-zoe/patient-graphs').PatientGraphs{
 const at=(day:number)=>`2026-11-${String(day).padStart(2,'0')}T08:00:00Z`;
 const bp:import('@/components/charts/types').TrendPoint[]=[
  {id:'home-1',at:at(1),values:[138,86],source:'home',slot:'morning'},
  {id:'home-2',at:at(3),values:[132,82],source:'home',slot:'evening'},
  {id:'clinic-1',at:at(4),values:[130,80],source:'clinic'},
  {id:'typed-1',at:at(5),values:[155,96],source:'member'},
 ];
 const single=(id:string,values:number[],source:import('@/components/charts/types').ChartSource='reviewed')=>({points:values.map((value,i)=>({id:`${id}-${i}`,at:at(i+1),values:[value],source,dateOnly:true}))});
 return {memberId,asOf:at(6),unavailable:[],series:{bp:{points:bp},ldl:{...single('ldl',[3.1,2.8,2.1]),target:{below:1.8}},hba1c:single('hba1c',[6.7,6.4]),egfr:single('egfr',[84,86]),pulse:single('pulse',[78,74,72],'home'),weight:single('weight',[82,81.5],'member'),streak:single('week',[2,3,4,3],'verified')}};
}
