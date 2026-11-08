import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as labProvenance from '@/lib/lab-ai/provenance';
import {fixtureLab,fixtureResults,fixtureUpload} from '../e2e/doctor-chat-v2/data';
import type {StaffLabResults} from '@/lib/lab-ai/staff-results';
const projectionPath='lib/staff-zoe/patient-labs.ts';
assert.ok(existsSync(projectionPath),'Patient labs need a shared file/status projection');
assert.ok(existsSync('lib/ai-plan/lab-evidence.ts'),'Plan evidence must include the member-reported HbA1c from the same questionnaire snapshot');
const {planLabEvidence}=await import('@/lib/ai-plan/lab-evidence');
const reported=planLabEvidence([],{'q6.hba1c':{value:7.2,answeredAt:'2026-11-05T21:00:00Z'}});
assert.equal(reported[0]?.status,'member-reported');assert.equal(reported[0]?.value,7.2);assert.equal(reported[0]?.unit,'%');
assert.equal(reported[0]?.collectedOn,null,'An answer timestamp must never become a lab collection date');
assert.deepEqual(planLabEvidence([],{'q6.hba1c':{value:'UNKNOWN'}}),[]);
const projection=await import('@/lib/staff-zoe/patient-labs');
const member='d1a00000-0000-4000-8000-000000000002',doctor='d1a00000-0000-4000-8000-000000000009';
const id=(n:number)=>`e1a00000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const lab=fixtureLab();
const file=(n:number,at:string,status='verified',identity='match')=>({...lab,fileId:id(n),name:`Long file ${n} ${'name'.repeat(30)}.pdf`,uploadedAt:at,job:{...lab.job!,identityStatus:identity as 'match',identityConfirmedAt:null},values:lab.values.map(v=>({...v,valueId:id(n*10+v.seq),status:status as 'verified',collectedOn:at.slice(0,10)}))});
const raw:StaffLabResults={version:'staff-lab-ai-v1',enabled:true,viewer:'doctor',clinic:[file(2,'2026-11-01T08:00:00Z','unverified'),file(1,'2026-11-06T08:00:00Z'),file(3,'2026-10-01T08:00:00Z','verified','mismatch'),{...file(4,'2026-11-05T08:00:00Z'),values:[]}],memberUploads:[]};
const projected=projection.patientLabs(raw,[]);
assert.deepEqual(projected.files.map(f=>f.id),[id(3),id(2),id(4),id(1)]);
assert.deepEqual(projected.files.map(f=>f.state),['mismatch','to-check','empty','checked']);
assert.equal(projected.values[0].fileId,id(1),'Result history is ordered by collection date, newest first');
assert.ok(!projected.values.some(v=>v.fileId===id(3)),'An unconfirmed sheet exposes no lab values');
// Astra: an empty extraction says "0 values" even when identity is not yet confirmed; mismatch still wins.
{const emptyUnknown=projection.patientLabs({...raw,clinic:[{...file(5,'2026-11-04T08:00:00Z','verified','unknown'),values:[]},{...file(6,'2026-11-03T08:00:00Z','verified','mismatch'),values:[]}],memberUploads:[]},[]);
 assert.equal(emptyUnknown.files.find(f=>f.id===id(5))!.state,'empty');assert.equal(emptyUnknown.files.find(f=>f.id===id(5))!.needsReview,true);
 assert.equal(emptyUnknown.files.find(f=>f.id===id(6))!.state,'mismatch');}
const upload=fixtureUpload();
const uploadsOnly={...raw,clinic:[],memberUploads:[upload.doc]};
assert.equal(projection.patientLabs(uploadsOnly,[],upload.approvals).files[0].state,'to-check','Member confirmation is not doctor review');
assert.equal(projection.patientLabs(uploadsOnly,[],upload.approvals).files[0].needsReview,true);
const pendingUpload={...upload.doc,values:upload.doc.values.map(v=>({...v,memberStatus:'pending' as const}))};
const pendingProjection=projection.patientLabs({...uploadsOnly,memberUploads:[pendingUpload]},[],upload.approvals);
assert.equal(pendingProjection.values[0].mark,'not-reviewed','An AI value the member has not confirmed is not member-reported');
const approvedUpload=structuredClone(upload.approvals);
approvedUpload.readings[0].approval={version:1,approvedAt:'2026-11-06T08:00:00Z',byYou:true,doctorName:'Example Doctor',interpretationHy:'Ստուգված',interpretationEn:'Checked',interpretationEdited:false,changes:null,values:upload.doc.values.map((v,i)=>({valueId:v.valueId,action:i===0?'corrected':i===1?'removed':'kept',value:i===0?4.2:v.value}))};
const approvedProjection=projection.patientLabs(uploadsOnly,[],approvedUpload);
assert.equal(approvedProjection.files[0].state,'checked');
assert.equal(approvedProjection.values[0].value,'4.2','Show the physician-approved correction rather than the old member number');
assert.equal(approvedProjection.values[0].mark,'reviewed');
assert.ok(!approvedProjection.values.some(v=>v.id===upload.doc.values[1].valueId),'A doctor-removed value stays removed');
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const doc=new EventTarget();
const modules:Record<string,unknown>={'./patient-graphs':{PlanSparklines:()=>null},'@/lib/lab-ai/provenance':labProvenance,'@/lib/lab-ai/review-copy':await import('@/lib/lab-ai/review-copy'),react:React,'react/jsx-runtime':jsx,'@/lib/staff/staff-locale-copy':copy,
 '@/components/staff/chat-member-identity':{ChatMemberIdentity:(p:{name:string})=>React.createElement('span',null,p.name)},
 '@/lib/staff/yerevan-time':await import('@/lib/staff/yerevan-time'),
 './results-block':{ResultsBlock:()=>React.createElement('div',{'data-report':true}),LabResultsHistory:(p:{values:unknown})=>React.createElement('div',{'data-history':true},JSON.stringify(p.values))},
 '@/lib/staff-zoe/chat-v2-actions':{readDoctorPatientLabs:async(m:string,d:string)=>{assert.equal(m,member);assert.equal(d,doctor);return {kind:'labs',...projected};},readDoctorChatResults:async()=>fixtureResults(member)},
};
modules['@/lib/ai-plan/language']=await import('@/lib/ai-plan/language');
modules['@/lib/patient-care/consultation-proposal']=await import('@/lib/patient-care/consultation-proposal');
modules['@/components/real-review/use-consultation-decision']=await import('@/components/real-review/use-consultation-decision');
function load(path:string){const exports:Record<string,unknown>={};vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(name:string)=>{assert.ok(name in modules,`Unmocked ${name}`);return modules[name];},document:doc,crypto,Event});return exports;}
const {PatientLabs}=load('components/doctor-chat-v2/patient-labs.tsx') as typeof import('@/components/doctor-chat-v2/patient-labs');
const text=(node:import('react-test-renderer').ReactTestInstance):string=>node.children.map(c=>typeof c==='string'?c:text(c)).join(' ');
let screen:ReactTestRenderer;const opened:string[]=[];
for(const locale of ['en','hy','ru'] as const){
 await act(async()=>{screen=create(React.createElement(PatientLabs,{memberId:member,name:'Example A',doctorId:doctor,locale,resultsReport:true,onLab:(id:string)=>opened.push(id),onUpload:()=>{}}));});
 const rows=screen!.root.findAll(node=>node.type==='li'&&!!node.props['data-lab-file-row']);
 assert.deepEqual(rows.map(r=>r.props['data-lab-file-row']),projected.files.map(f=>f.id));
 assert.match(text(rows[0]),/Example A/);
 const review=screen!.root.findAllByType('button').find(b=>text(b)===copy.st(locale,'Review these values','Վերանայել այս արժեքները','Проверить эти значения'));
 assert.equal(screen!.root.findAllByType('button').filter(b=>text(b)===copy.st(locale,'Review these values','Վերանայել այս արժեքները','Проверить эти значения')).length,projected.files.filter(f=>f.needsReview).length,'One review action per file, irrespective of value count');
 assert.ok(rows.every(row=>row.findAllByType('button').filter(b=>text(b)===copy.st(locale,'Review these values','Վերանայել այս արժեքները','Проверить эти значения')).length===Number(projected.files.find(f=>f.id===row.props['data-lab-file-row'])!.needsReview)));
 assert.ok(review);await act(async()=>review.props.onClick());assert.equal(opened.at(-1),id(3));
 assert.equal(screen!.root.findAllByProps({'data-report':true}).length,1);
 if(locale==='en'){
  const Result=(modules['./results-block'] as {ResultsBlock:React.ComponentType}).ResultsBlock;
  const approved=screen!.root.findByType(Result).props.onApproved;
  const action=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>;
  const oldRead=action.readDoctorChatResults;
  let resolve!:(block:ReturnType<typeof fixtureResults>)=>void;
  action.readDoctorChatResults=()=>new Promise(done=>{resolve=done;});
  await act(async()=>screen!.root.findAllByType('button').find(b=>text(b)==='Refresh labs')!.props.onClick());
  await act(async()=>approved(3));
  await act(async()=>resolve(fixtureResults(member)));
  assert.equal(screen!.root.findAllByProps({'data-report':true}).length,0,'A pending pre-approval refresh cannot restore report approval controls');
  action.readDoctorChatResults=oldRead;
 }
 await act(async()=>screen!.unmount());
}
console.log('Patient labs: file states, mismatch-first order, identity-safe values and review-first action in en/hy/ru passed (mounted, controlled IO).');
// D12: a 25-value file has one file-level action, and the second file has its own exact target.
{
 const io=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>,savedRead=io.readDoctorPatientLabs;
 for(const locale of ['en','hy','ru'] as const)for(const count of [1,2]){
  const files=[{...projected.files.find(f=>f.id===id(2))!,source:'clinic' as const},{...pendingProjection.files[0],source:'member' as const}].slice(0,count);
  io.readDoctorPatientLabs=async()=>({kind:'labs',files,values:Array.from({length:25},(_,i)=>({...projected.values[0],id:id(100+i),fileId:files[0].id,mark:'not-reviewed'}))});
  await act(async()=>{screen=create(React.createElement(PatientLabs,{memberId:member,name:'Example A',doctorId:doctor,locale,resultsReport:false,onLab:(file:string)=>opened.push(`clinic:${file}`),onUpload:(file:string)=>opened.push(`member:${file}`)}));});
  const reviews=screen!.root.findAllByType('button').filter(b=>text(b)===copy.st(locale,'Review these values','Վերանայել այս արժեքները','Проверить эти значения'));
  assert.equal(reviews.length,count,`${locale}: ${count} file(s) give ${count} review actions`);
  for(const [index,button] of reviews.entries()){
   await act(async()=>button.props.onClick());assert.equal(opened.at(-1),`${files[index].source}:${files[index].id}`);
  }
  await act(async()=>screen!.unmount());
 }
 io.readDoctorPatientLabs=savedRead;
}


// The full result history uses the production result renderer, including provenance and units.
for(const imported of ts.preProcessFile(readFileSync('components/doctor-chat-v2/results-block.tsx','utf8')).importedFiles)if(!(imported.fileName in modules))modules[imported.fileName]={};
modules['@/lib/lab-ai/analyte-names']=await import('@/lib/lab-ai/analyte-names');
const {LabResultsHistory}=load('components/doctor-chat-v2/results-block.tsx') as typeof import('@/components/doctor-chat-v2/results-block');
for(const locale of ['en','hy','ru'] as const){
 const values=projection.patientLabs(uploadsOnly,[],upload.approvals).values;
 await act(async()=>{screen=create(React.createElement(LabResultsHistory,{values:[...projected.values,...values.slice(0,1),...pendingProjection.values.slice(1)],locale}));});
 assert.match(text(screen!.root),/mmol\/L/);assert.match(text(screen!.root),/U\/L/);
 assert.ok(text(screen!.root).includes(copy.st(locale,'Member-reported','Անդամի հաղորդած','Со слов участника')));
 assert.ok(text(screen!.root).includes(copy.st(locale,'Not reviewed','Չվերանայված','Не проверено')));
 assert.equal(screen!.root.findAllByType('button').length,0,'Individual values show state only; file rows own the review action');
 await act(async()=>screen!.unmount());
}

// Mount the existing classic form through the chat wrapper, with real value and identity controls.
Object.assign(modules,{
 '@/lib/lab-ai/empty-read-copy':await import('@/lib/lab-ai/empty-read-copy'),
 '@/lib/staff-zoe/outcome-copy':await import('@/lib/staff-zoe/outcome-copy'),
 '@/lib/locale':await import('@/lib/locale'),
 '@/lib/lab-ai/analyte-names':await import('@/lib/lab-ai/analyte-names'),
 '@/lib/clinical/seed/tests':await import('@/lib/clinical/seed/tests'),
 '@/lib/lab-ai/doctor-schema':await import('@/lib/lab-ai/doctor-schema'),
 '@/components/staff/upload-identity-check':{UploadIdentityChecks:()=>null},
 'lucide-react':Object.fromEntries(['AlertTriangle','Bot','CheckCircle2','FileText'].map(key=>[key,()=>null])),
 './shell':{buttonClass:'button'},'./lab-review-action':{LabCheckLink:()=>null},
});
const Refresh=React.createContext<()=>void>(()=>{});
modules['@/components/staff/record-refresh']={RecordRefreshProvider:({value,children}:{value:()=>void;children:React.ReactNode})=>React.createElement(Refresh.Provider,{value},children),useRecordRefresh:()=>React.useContext(Refresh)};
modules['@/components/staff/lab-ai-check']=load('components/staff/lab-ai-check.tsx');
let read=fixtureLab(),refused=false;read.openedByYou=true;
const commands:{member:string;file:string;input:{action:string;value?:number}}[]=[];
Object.assign(modules['@/lib/staff-zoe/chat-v2-actions'] as object,{
 readDoctorChatLab:async(m:string,f:string)=>{assert.equal(m,member);assert.equal(f,read.fileId);return refused?{kind:'refused'}:{kind:'lab',data:structuredClone(read)};},
 reviewDoctorChatLabValue:async(m:string,f:string,input:{action:string;valueId:string;value?:number})=>{commands.push({member:m,file:f,input});const v=read.values.find(v=>v.valueId===input.valueId)!;v.status=input.action==='confirm'?'verified':input.action==='correct'?'corrected':'rejected';v.correctedValue=input.value??null;return {status:'saved',valueStatus:v.status};},
 confirmDoctorChatLabIdentity:async()=>({status:'confirmed'}),requestDoctorChatLabReading:async()=>({status:'queued'}),
});
const {DoctorChatLab}=load('components/doctor-chat-v2/lab.tsx') as typeof import('@/components/doctor-chat-v2/lab');
for(const locale of ['en','hy','ru'] as const){
 read=fixtureLab();read.openedByYou=true;
 await act(async()=>{screen=create(React.createElement(DoctorChatLab,{memberId:member,fileId:read.fileId,doctorId:doctor,locale,inline:true,onReviewed:()=>{}}));});
 const full=screen!.root.findAllByType('a').find(a=>a.props.href.endsWith('/check'));
 assert.ok(full,'The inline check keeps an Open full page deep link');
 assert.equal(full.props.href,`/staff/real/members/${member}/documents/${read.fileId}/check`);
 assert.equal(screen!.root.findAllByType('iframe')[0]?.props.src,`/staff/real/members/${member}/documents/${read.fileId}#page=1`);
 const press=async(en:string,hy:string,ru:string)=>{const b=screen!.root.findAllByType('button').find(b=>text(b)===copy.st(locale,en,hy,ru));assert.ok(b,`${locale}: ${en}`);await act(async()=>b.props.onClick());};
 await press('Confirm','Հաստատել','Подтвердить');
 await press('Correct','Ուղղել','Исправить');
 const number=screen!.root.findAllByType('input').find(i=>i.props.inputMode==='decimal');assert.ok(number);
 await act(async()=>number.props.onChange({target:{value:'139'}}));
 await press('Save correction','Պահպանել ուղղումը','Сохранить исправление');
 await press('Reject (does not apply)','Մերժել (կիրառելի չէ)','Отклонить (не относится)');
 assert.deepEqual(commands.slice(-3).map(c=>c.input.action),['confirm','correct','reject']);
 assert.ok(commands.slice(-3).every(c=>c.member===member&&c.file===read.fileId));
 await act(async()=>screen!.unmount());
}
console.log('Patient labs: inline PDF/full-page link and shared confirm, correct and reject controls passed in en/hy/ru (mounted, controlled actions).');

// From an opened home row: matching sheets need no identity click and auto-confirmed rows need no review click.
for(const needsEyes of [0,2]){
 read=fixtureLab();read.openedByYou=true;
 read.values.forEach((v,i)=>{v.status=i<needsEyes?'unverified':'auto_accepted';});
 const before=commands.length;
 await act(async()=>{screen=create(React.createElement(DoctorChatLab,{memberId:member,fileId:read.fileId,doctorId:doctor,locale:'en',inline:true,onReviewed:()=>{}}));});
 assert.equal(screen!.root.findAllByType('button').some(b=>text(b)==='This PDF belongs to this member'),false);
 const completed=()=>text(screen!.root).includes('All values on this sheet are reviewed.');
 let clicks=1;
 for(let i=0;i<needsEyes;i++){
  assert.equal(completed(),false);
  const confirm=screen!.root.findAllByType('button').find(b=>text(b)==='Confirm');
  assert.ok(confirm);await act(async()=>confirm.props.onClick());clicks++;
 }
 assert.equal(completed(),true);
 assert.equal(clicks,needsEyes===0?1:3);
 assert.equal(commands.length-before,needsEyes);
 await act(async()=>screen!.unmount());
}
// An all-auto-confirmed sheet still cannot skip an unresolved identity check.
for(const identity of ['unknown','mismatch','multiple_patients'] as const){
 read=fixtureLab();read.values.forEach(v=>{v.status='auto_accepted';});read.job!.identityStatus=identity;
 await act(async()=>{screen=create(React.createElement(DoctorChatLab,{memberId:member,fileId:read.fileId,doctorId:doctor,locale:'en',inline:true,onReviewed:()=>{}}));});
 assert.equal(text(screen!.root).includes('All values on this sheet are reviewed.'),false);
 assert.equal(screen!.root.findAllByType('summary').some(n=>text(n).includes('Already confirmed by the rules')),false);
 await act(async()=>screen!.unmount());
}
console.log('Lab click counts: home row plus 0/2 individual confirmations = 1/3; unresolved identities cannot count as reviewed (mounted production controls, synthetic reads).');

const {fixturePlan,fixtureAiPlan}=await import('../e2e/doctor-chat-v2/data');
const evidence=lab.values.map((v,i)=>({valueId:v.valueId,catalogueRef:v.catalogueRef,testName:v.testName,value:v.value,unit:v.unit,labFlag:v.labFlag,collectedOn:`2026-11-0${i+1}`,attention:v.attention,status:i===0?'unverified':'verified'}));
const planEvidence=[...evidence,...reported];
let draft:Omit<ReturnType<typeof fixtureAiPlan>,'labEvidence'>&{labEvidence:{generationId:string;values:typeof planEvidence}|null}={...fixtureAiPlan(member),labEvidence:{generationId:fixtureAiPlan(member).generation.id,values:planEvidence}};
const planActions=modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>;
Object.assign(planActions,{readDoctorChatPlan:async()=>({kind:'plan',approvals:fixturePlan(member)}),readDoctorChatAiPlan:async()=>structuredClone(draft)});
Object.assign(modules,{
 '@/components/staff/doctor-workspace/approval-cards':{DoctorApprovalCards:({data,chat}:{data:{regimen?:{current:boolean}};chat:{publicationBlocked?:boolean}})=>React.createElement('button',{disabled:!data.regimen?.current||chat.publicationBlocked,'data-publish':true},'Publish')},
 '@/components/real-review/forms':{DraftForm:()=>null},
 '@/lib/ai-plan/contracts':await import('@/lib/ai-plan/contracts'),
 '@/lib/ai-plan/display':await import('@/lib/ai-plan/display'),
 '@/lib/staff/staff-server-copy':await import('@/lib/staff/staff-server-copy'),
 '@/lib/staff/alert-label':await import('@/lib/staff/alert-label'),
 '@/lib/patient-care/action-timeout':await import('@/lib/patient-care/action-timeout'),
 '@/components/real-review/urgent-publication':{UrgentPublicationBlock:()=>null},
 './messages':{time:()=>''},
});
modules['./plan-ready-card']=await import('@/components/doctor-chat-v2/plan-ready-card');modules['@/lib/patient-care/required-lab-match']=await import('@/lib/patient-care/required-lab-match');
const {DoctorChatPlan}=load('components/doctor-chat-v2/plan.tsx') as typeof import('@/components/doctor-chat-v2/plan');
for(const locale of ['en','hy','ru'] as const){
 draft={...fixtureAiPlan(member),labEvidence:{generationId:fixtureAiPlan(member).generation.id,values:planEvidence}};
 let reviews=0;
 await act(async()=>{screen=create(React.createElement(DoctorChatPlan,{memberId:member,name:'Example A',doctorId:doctor,locale,aiDraft:true,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){},onReviewLabs(){reviews++;}}));});
 assert.match(text(screen!.root),/LDL.*3.1.*mmol\/L/,'Plan shows the token-bound values, not just plan prose');
 assert.match(text(screen!.root),/2026/);
 assert.ok(text(screen!.root).includes(copy.st(locale,'Member-reported','Անդամի հաղորդած','Со слов участника')));
 assert.equal(screen!.root.findByProps({'data-publish':true}).props.disabled,true,'Unreviewed evidence keeps publishing disabled');
 const review=screen!.root.findAllByType('button').find(b=>text(b)===copy.st(locale,'Review these values','Վերանայել այս արժեքները','Проверить эти значения'));assert.ok(review);
 await act(async()=>review.props.onClick());assert.equal(reviews,1);
 draft={...draft,labEvidence:{generationId:fixtureAiPlan(member).generation.id,values:planEvidence.map(value=>({...value,status:value.status==='member-reported'?'member-reported':'verified'}))}};
 await act(async()=>{doc.dispatchEvent(new Event('noreon:clinical-evidence-changed'));});
 assert.equal(screen!.root.findByProps({'data-publish':true}).props.disabled,false,'Completed review refreshes the same mounted plan');
 draft={...draft,stale:true,labEvidence:null};
 await act(async()=>{doc.dispatchEvent(new Event('noreon:clinical-evidence-changed'));});
 assert.equal(screen!.root.findByProps({'data-publish':true}).props.disabled,true);
 assert.doesNotMatch(text(screen!.root),/3\.1.*mmol/,'A stale plan never substitutes new current numbers for its old evidence');
 assert.ok(text(screen!.root).includes(copy.st(locale,'Prepare again','Պատրաստել կրկին','Подготовить снова')));
 await act(async()=>screen!.unmount());
}
console.log('Patient plan: evidence values with dates/units and review-first publication gating passed in en/hy/ru (mounted, controlled reads).');

// Use the actual publication control too: satisfying its other confirmations cannot bypass lab review.
for(const path of ['@/lib/doctor-decisions/publication-gate','@/components/patient-care/common','@/lib/first-note/compose','@/lib/service-workflow/publication','@/components/patient-care/regimen-changes','@/components/real-review/clinical-summary'])modules[path]=await import(path);
Object.assign(modules,{'next/navigation':{useRouter:()=>({refresh(){}})},'next/link':{default:(props:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',props)},'@/lib/first-note/actions':{},'@/lib/doctor-decisions/approval-actions':{},'@/lib/patient-care/clinical-review-actions':{}});
modules['@/components/staff/doctor-workspace/approval-cards']=load('components/staff/doctor-workspace/approval-cards.tsx');
modules['./plan-ready-card']=await import('@/components/doctor-chat-v2/plan-ready-card');modules['@/lib/patient-care/required-lab-match']=await import('@/lib/patient-care/required-lab-match');
const RealPlan=load('components/doctor-chat-v2/plan.tsx').DoctorChatPlan as typeof DoctorChatPlan;
for(const locale of ['en','hy','ru'] as const){
 draft={...fixtureAiPlan(member),labEvidence:{generationId:fixtureAiPlan(member).generation.id,values:planEvidence}};
 await act(async()=>{screen=create(React.createElement(RealPlan,{memberId:member,name:'Example A',doctorId:doctor,locale,aiDraft:true,onOpen(){},onSaved(){},onCheckAgain(){},onAction(){},onReviewLabs(){}}));});
 const regimen=()=>screen!.root.findByProps({'data-decision':'regimen'});
 const approve=()=>regimen().findAllByType('button').find(b=>text(b)===copy.st(locale,'Approve and publish this plan','Հաստատել և հրապարակել այս պլանը','Утвердить и опубликовать этот план'))!;
 const confirm=async()=>{await act(async()=>regimen().findByType('input').props.onChange({target:{checked:true}}));await act(async()=>regimen().findByType('textarea').props.onChange({target:{value:'Reviewed treatment change'}}));};
 await confirm();assert.equal(approve().props.disabled,true,'Actual Publish stays disabled after medicine/dose confirmation when labs need review');
 draft={...draft,labEvidence:{generationId:fixtureAiPlan(member).generation.id,values:planEvidence.map(value=>({...value,status:value.status==='member-reported'?'member-reported':'verified'}))}};
 await act(async()=>{doc.dispatchEvent(new Event('noreon:clinical-evidence-changed'));});
 await confirm();assert.equal(!!approve().props.disabled,false,'Actual Publish still respects its normal confirmations after lab review');
 await act(async()=>screen!.unmount());
}
console.log('Patient plan: real publication controls enforce lab review alongside medicine/dose/replacement confirmations in en/hy/ru.');

// The shared identity gate keeps the AI summary and value actions behind the PDF verdict.
for(const locale of ['en','hy','ru'] as const){
 read=fixtureLab();read.openedByYou=true;read.job!.identityStatus='mismatch';read.job!.outcome='identity_mismatch';
 read.job!.summary={version:'lab-ai-summary-v1',label:'Prepared by AI | Not reviewed by a doctor',preparedBy:'ai',reviewedByDoctor:false,valuesVerified:false,priority:[],changed:[],outOfRange:[],missingForPlan:[],dataGaps:[],narrative:{en:'Synthetic lab summary',hy:'Լաբորատոր ամփոփում'},sources:{pages:3,method:'ai_document_reading',model:null,identityStatus:'mismatch'}};
 (modules['@/lib/staff-zoe/chat-v2-actions'] as Record<string,unknown>).confirmDoctorChatLabIdentity=async(m:string,f:string,input:{note:string})=>{assert.equal(m,member);assert.equal(f,read.fileId);assert.equal(input.note,'Checked against the original sheet');read.job!.identityConfirmedAt='2026-11-06T08:00:00Z';read.job!.identityNote=input.note;return {status:'confirmed'};};
 await act(async()=>{screen=create(React.createElement(DoctorChatLab,{memberId:member,fileId:read.fileId,doctorId:doctor,locale,inline:true,onReviewed(){}}));});
 assert.ok(text(screen!.root).includes(copy.st(locale,'This PDF belongs to this member','Այս PDF-ը պատկանում է այս անդամին','Этот PDF принадлежит этому участнику')));
 assert.equal(screen!.root.findAllByType('button').filter(b=>text(b)===copy.st(locale,'Confirm','Հաստատել','Подтвердить')).length,0);
 assert.doesNotMatch(text(screen!.root),/Synthetic lab summary|Լաբորատոր ամփոփում/);
 const reason=screen!.root.findByType('textarea');assert.equal(reason.props.required,true);
 await act(async()=>reason.props.onChange({target:{value:'Checked against the original sheet'}}));
 await act(async()=>screen!.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.ok(text(screen!.root).includes(copy.st(locale,'Summary for the doctor','Ամփոփում բժշկի համար','Сводка для врача')));
 assert.ok(text(screen!.root).includes('Checked against the original sheet'));
 await act(async()=>screen!.unmount());
}
console.log('Patient labs: mismatch reason, belongs-to-member verdict and gated AI summary reuse passed in en/hy/ru.');

// Refusal never renders a PDF, values or an alternate document link, including after a successful read.
read=fixtureLab();read.openedByYou=true;refused=false;
await act(async()=>{screen=create(React.createElement(DoctorChatLab,{memberId:member,fileId:read.fileId,doctorId:doctor,locale:'en',inline:true,onReviewed(){}}));});
refused=true;
await act(async()=>screen!.root.findAllByType('button').find(b=>text(b)==='Reload')!.props.onClick());
assert.equal(screen!.root.findAllByType('iframe').length,0);
assert.equal(screen!.root.findAllByType('a').length,0);
assert.doesNotMatch(text(screen!.root),/3\.1|Sodium|ALT/);
await act(async()=>screen!.unmount());refused=false;
for(const locale of ['en','hy','ru'] as const){
 read={...fixtureLab(),values:[]};
 await act(async()=>{screen=create(React.createElement(DoctorChatLab,{memberId:member,fileId:read.fileId,doctorId:doctor,locale,inline:true,onReviewed(){}}));});
 assert.ok(text(screen!.root).includes((modules['@/lib/lab-ai/empty-read-copy'] as typeof import('@/lib/lab-ai/empty-read-copy')).labEmptyReadMessage(locale)));
 assert.equal(screen!.root.findAllByType('iframe').length,1,'An empty extraction still lets the doctor read the PDF');
 await act(async()=>screen!.unmount());
}

// Execute the production server actions and Lab RPC reader with assignment-scoped synthetic IO.
const actionSource=readFileSync('lib/staff-zoe/chat-v2-actions.ts','utf8');
for(const imported of ts.preProcessFile(actionSource).importedFiles)if(!(imported.fileName in modules))modules[imported.fileName]={};
const {z}=await import('zod');
let actorRole='doctor',labOn=true,labToken='lab-current',caseToken='case-current';
const saved=fixtureAiPlan(member);
const generation={...saved.generation,evidenceToken:'case-current',labToken:'lab-current',caseRevision:4,adoptedAt:null};
const rpcCalls:{name:string;args?:Record<string,unknown>}[]=[];
Object.assign(modules,{
 zod:{z},'./plan-ready':await import('@/lib/staff-zoe/plan-ready'),'@/lib/patient-care/clinic-lab-sources':{readClinicLabSources:async()=>[]},'@/components/real-review/report-provenance':await import('@/components/real-review/report-provenance'),'@/lib/patient-care/clinical-review-current':{currentClinicalReview:()=>true},'./patient-graphs':await import('@/lib/staff-zoe/patient-graphs'),'./patient-graphs-read':{readPatientGraphs:async()=>null},'./patient-labs':projection,'@/lib/ai-plan/lab-evidence':{planLabEvidence},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,action:unknown)=>action},
 '@/lib/staff/real-staff-access':{chatDoctorEnabled:()=>true,chatDoctorIdentity:(identity:{role:string;id:string},expected:unknown)=>identity.role==='doctor'&&identity.id===expected},
 '@/lib/lab-ai/config':{labAiEnabled:()=>labOn},
 './workspace-config':{doctorDecisionsEnabled:()=>true},'@/lib/patient-care/regimen-config':{multiMedicineEnabled:()=>true},
 '@/lib/ai-plan/current':await import('@/lib/ai-plan/current'),
 '@/lib/staff/doctor-upload-overrides':{readDoctorUploadOverrides:async()=>[]},
 '@/lib/lab-ai/member-approval-server':{readMemberUploadApprovals:async()=>upload.approvals},
 '@/lib/lab-ai/staff-results-server':{readStaffLabResults:async(_client:unknown,m:string)=>m===member?raw:null},
 '@/lib/lab-ai/doctor-runtime':await import('@/lib/lab-ai/doctor-runtime'),
 '@/lib/doctor-decisions/read':{retryOnLock:(client:unknown)=>client},
 '@/lib/patient-care/clinical-case-repository':{snapshotSchema:z.object({id:z.string(),revision:z.number(),evidenceToken:z.string(),draft:z.unknown(),draftStale:z.boolean(),evidence:z.object({measurements:z.array(z.unknown()).default([]),assessment:z.unknown().nullable()})}),requireRealStaff:async()=>({identity:{role:actorRole,id:doctor},client:{rpc:async(name:string,args?:Record<string,unknown>)=>{rpcCalls.push({name,args});
  if(name==='doctor_lab_ai_read')return args?.p_user_id===member&&args?.p_file===lab.fileId?{data:lab,error:null}:{data:null,error:{code:'42501'}};
  if(name==='patient_clinical_case_snapshot')return {data:{...saved.snapshot,evidenceToken:caseToken,evidence:{assessment:{urgent_rule:null,answers:{'q6.hba1c':{value:7.2,answeredAt:'2026-11-05T21:00:00Z'}}}}},error:null};
  throw Error(`Unexpected ${name}`);
 }}})},
 '@/lib/ai-plan/server':{readDoctorAiPlan:async()=>({enabled:true,published:false,labToken,labValues:evidence,latest:generation})},
});
const actions=load('lib/staff-zoe/chat-v2-actions.ts') as typeof import('@/lib/staff-zoe/chat-v2-actions');
assert.equal((await actions.readDoctorChatLab(member,id(99),doctor)).kind,'refused','A document outside the route member is refused by the existing scoped RPC');
assert.equal((await actions.readDoctorChatLab(id(99),lab.fileId,doctor)).kind,'refused');
assert.equal((await actions.readDoctorChatLab(member,lab.fileId,doctor)).kind,'lab');
actorRole='nurse';const before=rpcCalls.length;
assert.equal((await actions.readDoctorChatLab(member,lab.fileId,doctor)).kind,'refused');assert.equal(rpcCalls.length,before);actorRole='doctor';
assert.equal((await actions.readDoctorPatientLabs(member,doctor)).kind,'labs');
assert.equal((await actions.readDoctorPatientLabs(member,id(99))).kind,'refused');
labOn=false;assert.equal((await actions.readDoctorPatientLabs(member,doctor)).kind,'off');labOn=true;
let plan=await actions.readDoctorChatAiPlan(member,doctor);assert.equal(plan.kind,'ai-plan');
if(plan.kind==='ai-plan')assert.deepEqual(JSON.parse(JSON.stringify(plan.labEvidence)),{generationId:generation.id,values:planEvidence});
labToken='changed-lab';plan=await actions.readDoctorChatAiPlan(member,doctor);
if(plan.kind!=='ai-plan')throw Error('Expected stale plan');assert.equal(plan.stale,true);assert.equal(plan.labEvidence,null,'New values can never be labelled as the old draft basis');
labToken='lab-current';caseToken='changed-case';plan=await actions.readDoctorChatAiPlan(member,doctor);
if(plan.kind!=='ai-plan')throw Error('Expected stale plan');assert.equal(plan.labEvidence,null);
// Audit D14: in the single-column chat the inline PDF must not be sticky; a pinned 70vh iframe covered the Confirm/Correct/Reject buttons.
{const source=readFileSync('components/staff/lab-ai-check.tsx','utf8');
 const section=source.match(/<section aria-label="PDF" className=\{([^}]*)\}>/);
 assert.ok(section,'The PDF section keeps a conditional class');
 assert.match(section![1],/chat\?"space-y-2":"space-y-2 lg:sticky lg:top-4 lg:self-start"/,'Only the classic two-column page pins the PDF; the chat does not');
 assert.match(source,/chat\?"h-\[45vh\] min-h-64 w-full/,'The inline chat PDF leaves room for the value buttons on a short screen');}
console.log('Patient labs: wrong-member document/refreshed-access refusals, zero-values recovery and evidence-token matching passed (mounted/production readers with synthetic RPCs; no DB).');
