import assert from 'node:assert/strict';
import type {ContextType} from 'react';
import {labsResult} from '@/lib/staff-zoe/facts';
import {FICTIONAL_RECORDS,MEMBER_A,EVAL_NOW} from '@/lib/staff-zoe/eval/fixtures';
const labs=FICTIONAL_RECORDS[MEMBER_A]!.labs!;
const file=labs.clinic[0]!;
const override={fileId:file.fileId,fileName:file.name,at:file.uploadedAt,clinicName:file.clinic,mismatch:'name' as const,reason:null,
 sheet:{name:'Different sheet name',birthDate:'1970-01-01'},member:{name:'Ani Example',birthDate:'1971-01-01'},current:true as const,
 memberId:MEMBER_A,memberName:'Ani Example',jobState:null};
for(const locale of ['en','hy','ru'] as const){
 const result=labsResult(labs,{memberId:MEMBER_A,role:'doctor',locale,now:EVAL_NOW},[override]);
 assert.equal(result.facts.length,0,'An open override must hide even reviewed values from plain lab answers');
 assert.equal(result.identityChecks?.[0]?.fileId,file.fileId,'The identity check survives a no-AI-read file');
}
console.log('Doctor mismatched uploads: identity gate passed');

const {readDoctorUploadOverrides}=await import('@/lib/staff/doctor-upload-overrides');
const calls:{name:string;args:unknown}[]=[];
const io={rpc:async(name:string,args?:Record<string,unknown>)=>{calls.push({name,args});return {data:[override],error:null};}};
assert.deepEqual(await readDoctorUploadOverrides(io,MEMBER_A),[override]);
assert.deepEqual(calls,[{name:'doctor_mismatched_uploads',args:{p_member:MEMBER_A}}]);
for(const data of [null,{},[{...override,memberId:'invalid'}]])assert.equal(await readDoctorUploadOverrides({rpc:async()=>({data,error:null})}),null);
assert.equal(await readDoctorUploadOverrides({rpc:async()=>({data:[],error:{code:'42501'}})}),null);
assert.equal(await readDoctorUploadOverrides({rpc:async()=>{throw Error('Unavailable');}}),null);

const React=await import('react');
const {renderToStaticMarkup}=await import('react-dom/server');
const {UploadIdentityChecks}=await import('@/components/staff/upload-identity-check');
const {DoctorReply}=await import('@/components/doctor-chat-v2/messages');
const {fixtureWho}=await import('../e2e/doctor-chat-v2/data');
for(const locale of ['en','hy','ru'] as const){
 const check=labsResult(labs,{memberId:MEMBER_A,role:'doctor',locale,now:EVAL_NOW},[override]);
 const html=renderToStaticMarkup(React.createElement(DoctorReply,{reply:{kind:'zoe-answer',member:{memberId:MEMBER_A,memberName:override.memberName},cards:[check]},locale,onOpen(){},onLab(){},onAct(){}}));
 assert.ok(html.includes('Different sheet name')&&html.includes('1970')&&html.includes('1971'));
 assert.doesNotMatch(html,/Creatinine|82 µmol|LDL-C|2.6 mmol/);
 assert.ok(html.indexOf('data-upload-identity')<html.indexOf('zoe-card-labs'),'Identity check precedes the lab answer');
 assert.match(html,locale==='en'?/Lab values not read yet/:locale==='hy'?/դեռ չեն կարդացվել/:/ещё не прочитаны/);
 const who=renderToStaticMarkup(React.createElement(DoctorReply,{reply:{...fixtureWho(),items:[],labs:[],plans:[],uploads:[],alerts:[],windows:[],p0Total:0,others:{rest:0},identityChecks:[override]},locale,onOpen(){},onLab(){},onAct(){}}));
 assert.ok(who.includes('data-upload-identity'));
 assert.doesNotMatch(who,/Nobody is waiting/);
 const readOnly=renderToStaticMarkup(React.createElement(UploadIdentityChecks,{rows:[override],locale}));
 assert.doesNotMatch(readOnly,/<button/,'Read-only notice never adds authority');
 assert.ok(readOnly.includes(`data-member-identity="${MEMBER_A}"`),'Mismatch comparisons use the shared chat identity line');
 const after=labsResult(labs,{memberId:MEMBER_A,role:'doctor',locale,now:EVAL_NOW},[]);
 assert.ok(after.facts.some(f=>f.label==='Creatinine'),'Resolved checks allow the ordinary reviewed facts');
}
console.log('Doctor mismatched uploads: mocked audited read, fail-closed IO, queue and first notice in EN/HY/RU passed');

// Actual Zoe entry point with IO replaced, including no-AI and role refusal.
const {staffRecordReader}=await import('@/lib/staff-zoe/server');
const testEnv={NOREON_LAB_AI_ENABLED:'true',NOREON_DOCTOR_COMPLETION_ENABLED:'true',NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NOREON_SHARED_DEMO:'false',NEXT_PUBLIC_SUPABASE_URL:'https://fixture.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fictional',NOREON_WORKSPACE_SUPABASE_URL:'https://fixture.invalid'};
const previousEnv=Object.fromEntries(Object.keys(testEnv).map(key=>[key,process.env[key]]));
Object.assign(process.env,testEnv);
try{
 for(const locale of ['en','hy','ru']as const){
  const visited:string[]=[];
  const reader=staffRecordReader({rpc:async(name:string)=>{visited.push(name);return {data:name==='doctor_mismatched_uploads'?[override]:labs,error:null};}},locale,EVAL_NOW);
  const result=await reader('labs',MEMBER_A,'doctor');
  assert.equal(result.identityChecks?.[0]?.fileId,file.fileId);
  assert.equal(result.facts.length,0);
  assert.deepEqual(visited,['staff_lab_ai_results','doctor_mismatched_uploads'],'Check identity after the values read, including files attached during it');
  visited.length=0;assert.equal((await reader('labs',MEMBER_A,'nurse')).state,'not_permitted');assert.deepEqual(visited,[],'Nurses gain no lab read');
  const denied=staffRecordReader({rpc:async()=>({data:null,error:{code:'42501'}})},locale,EVAL_NOW);
  assert.equal((await denied('labs',MEMBER_A,'doctor')).state,'unavailable','Another doctor never receives a lab answer after RPC refusal');
 }
}finally{for(const [key,value]of Object.entries(previousEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;}

// A completed empty AI read needs actionable guidance both behind and after the identity gate.
const {AppRouterContext}=await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
const {LabAiCheck}=await import('@/components/staff/lab-ai-check');
const {fixtureLab,fixtureMember}=await import('../e2e/doctor-chat-v2/data');
const {MemberConversation}=await import('@/components/doctor-chat-v2/conversation');
const {whoNeedsMe}=await import('@/lib/staff-zoe/chat-v2-read');
const emptyDay:import('@/lib/doctor-inbox/day').DoctorDay={windows:[],urgentWindowsTotal:0,urgentCapped:false,inbox:{version:'doctor-inbox-v1',ok:true,asOf:EVAL_NOW.toISOString(),p0:[],p0Total:0,laneCap:50,unavailable:[],items:[],zoeAnswered:[],zoeAnsweredTotal:0,nurseActivity:[]},medicines:[],ldl:[],firstNotes:{version:'first-note-queue-v1',enabled:false,items:[],closed:[]},tasks:{items:[],hasMore:false}};
for(const locale of ['en','hy','ru'] as const){
 const emptyText={en:'No values could be read from this file. Open the PDF and enter them, or ask the clinic for a clearer copy.',hy:'Այս ֆայլից ոչ մի արժեք հնարավոր չեղավ կարդալ։ Բացեք PDF-ը և մուտքագրեք դրանք, կամ խնդրեք կլինիկային ավելի հստակ պատճեն տրամադրել։',ru:'Не удалось прочитать показатели из этого файла. Откройте PDF и внесите их вручную или попросите клинику предоставить более чёткую копию.'}[locale];
 const data=fixtureLab();data.values=[];data.job!.counts.total=0;
 for(const identityRequired of [true,false]){
  const html=renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:{refresh(){}} as ContextType<typeof AppRouterContext>},React.createElement(LabAiCheck,{data,memberId:MEMBER_A,locale,identityRequired,submissionIds:{},ports:{review:async()=>({status:'unavailable' as const}),confirmIdentity:async()=>({status:'unavailable' as const}),readAgain:async()=>({status:'queued'})},chat:{onOpenPdf(){},onReviewed(){}}})));
  assert.ok(html.includes(emptyText),`Completed empty read explains the next step in ${locale}, identityRequired=${identityRequired}`);
  assert.match(html,/<button[^>]*>[^<]*PDF/,'PDF action stays available');
 }
 const notice=renderToStaticMarkup(React.createElement(UploadIdentityChecks,{rows:[{...override,jobState:'done',noValuesRead:true}],locale}));
 assert.ok(notice.includes(emptyText),`The identity check itself explains an empty read in ${locale}`);
 const checks=await readDoctorUploadOverrides({rpc:async()=>({data:[{...override,jobState:'done',noValuesRead:true}],error:null})});
 assert.equal(checks?.[0]?.noValuesRead,true,'Empty-read metadata survives the audited RPC parser');
 const queue=whoNeedsMe(emptyDay,undefined,undefined,checks);
 const queueHtml=renderToStaticMarkup(React.createElement(DoctorReply,{reply:{kind:'who',...queue},locale,onOpen(){},onLab(){},onAct(){}}));
 assert.ok(queueHtml.includes('data-upload-identity'),'Who needs me discovers the override without any document queue item');
 assert.ok(queueHtml.includes({en:'1 member is waiting for you.',hy:'1 անդամ սպասում է ձեզ։',ru:'Вас ожидают: 1 участник.'}[locale]),'The override is counted without document rows');
 const memberHtml=renderToStaticMarkup(React.createElement(MemberConversation,{data:{...fixtureMember(MEMBER_A),uploads:[],thread:[],reply:null,identityChecks:checks!},locale,active:true,busy:false,onApprove(){},onChange(){},onIdentityCheck(){}}));
 assert.ok(memberHtml.includes('data-upload-identity')&&memberHtml.includes(emptyText),'Member chat shows the empty override without any member document');
 // Production had no member Documents row: no clinic document or values may be needed for discovery.
 const noDocuments={...labs,clinic:[],memberUploads:[]};
 const reader=staffRecordReader({rpc:async(name:string)=>({data:name==='doctor_mismatched_uploads'?[{...override,jobState:'done',noValuesRead:true}]:noDocuments,error:null})},locale,EVAL_NOW);
 Object.assign(process.env,testEnv);
 try{
  const answer=await reader('labs',MEMBER_A,'doctor');
  assert.equal(answer.identityChecks?.[0]?.fileId,file.fileId,'Override survives an empty document list through the actual Zoe read');
  const html=renderToStaticMarkup(React.createElement(DoctorReply,{reply:{kind:'zoe-answer',member:{memberId:MEMBER_A,memberName:override.memberName},cards:[answer]},locale,onOpen(){},onLab(){},onAct(){}}));
  assert.ok(html.includes('data-upload-identity'),'Member chat shows the file despite no member document');
  assert.ok(html.includes(emptyText),'The doctor RPC alone supplies empty-read guidance, without clinic JSON');
 }finally{for(const [key,value]of Object.entries(previousEnv))if(value===undefined)delete process.env[key];else process.env[key]=value;}
}

console.log('Doctor empty reads EN/HY/RU: guidance before/after identity check, PDF action, no-document queue count, member chat and Zoe entry point passed (mocked IO).');

// Classic page and workspace card both omit identityRequired and chat.
// The audited doctor_lab_ai_read RPC reports an unconfirmed override as mismatch,
// even when the AI's identity payload says nameMatch/birthDateMatch=yes.
for(const locale of ['en','hy','ru'] as const){
 for(const scenario of [
  {name:'mismatch override unconfirmed',status:'mismatch',confirmed:false,show:false,aiMatch:false},
  {name:'mismatch override confirmed',status:'mismatch',confirmed:true,show:true,aiMatch:false},
  {name:'AI match without override',status:'match',confirmed:false,show:true,aiMatch:true},
  {name:'AI match with override unconfirmed',status:'mismatch',confirmed:false,show:false,aiMatch:true},
  {name:'AI match with override confirmed',status:'match',confirmed:true,show:true,aiMatch:true},
  {name:'unknown identity',status:'unknown',confirmed:false,show:false,aiMatch:false},
  {name:'missing identity status',status:null,confirmed:false,show:false,aiMatch:false},
 ] as const){
  const data=fixtureLab(),job=data.job!;
  job.identityStatus=scenario.status;
  job.identityConfirmedAt=scenario.confirmed?'2026-11-05T08:00:00Z':null;
  job.identity!.nameMatch=scenario.aiMatch?'yes':'no';
  job.identity!.birthDateMatch=scenario.aiMatch?'yes':'unknown';
  job.summary={version:'lab-ai-summary-v1',label:'Prepared by AI | Not reviewed by a doctor',preparedBy:'ai',reviewedByDoctor:false,valuesVerified:false,
   priority:[],changed:[],outOfRange:[],missingForPlan:[],dataGaps:[],narrative:{en:'Synthetic gated narrative',hy:'Synthetic gated narrative'},
   sources:{pages:3,method:'ai_document_reading',model:null,identityStatus:scenario.status??'unknown'}};
  const html=renderToStaticMarkup(React.createElement(AppRouterContext.Provider,{value:{refresh(){}} as ContextType<typeof AppRouterContext>},React.createElement(LabAiCheck,{
   data,memberId:MEMBER_A,locale,submissionIds:{},ports:{review:async()=>({status:'unavailable' as const}),confirmIdentity:async()=>({status:'unavailable' as const}),readAgain:async()=>({status:'queued'})},
  })));
  const label=`${scenario.name}, ${locale}, no identityRequired prop`;
  assert.equal(html.includes('id="lab-values"'),scenario.show,`Value list: ${label}`);
  assert.equal(html.includes('Synthetic gated narrative'),scenario.show,`Summary: ${label}`);
  assert.ok(html.includes('id="lab-identity"'),`Identity check stays reachable: ${label}`);
  assert.match(html,/<iframe[^>]+src="[^"]+\/documents\//,`PDF stays reachable: ${label}`);
  assert.equal(html.includes('<form'),!scenario.show,`Confirmation stays reachable: ${label}`);
  if(!scenario.show){
   assert.doesNotMatch(html,/138|Sodium|Synthetic gated narrative/,`No value content leaks: ${label}`);
   assert.ok(html.includes({en:'This PDF belongs to this member',hy:'Այս PDF-ը պատկանում է այս անդամին',ru:'Этот PDF принадлежит этому участнику'}[locale]),`Localized confirmation: ${label}`);
  }else assert.ok(html.includes('138 mmol/L'),`Confirmed/matched values are rendered: ${label}`);
  if(scenario.status==='mismatch'&&!scenario.confirmed)assert.match(html,/<textarea[^>]*required/,`Override still needs a reason: ${label}`);
 }
}
console.log('Classic/workspace LabAiCheck EN/HY/RU: default identity gate, summary/value visibility, PDF, confirmation and override reason passed (RPC-shaped fixtures).');
