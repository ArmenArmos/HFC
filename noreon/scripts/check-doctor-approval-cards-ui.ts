import * as outcomeCopy from '@/lib/staff-zoe/outcome-copy';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TestRenderer,{act} from 'react-test-renderer';
import type {ApprovalCards} from '@/lib/doctor-decisions/approvals';
import {clinicalReviewSchema} from '@/lib/patient-care/clinical-review-schema';
import {RegimenChanges,RegimenList} from '@/components/patient-care/regimen-changes';
import {regimenNameKey} from '@/lib/service-workflow/publication';
import {stamp} from '@/components/patient-care/common';
import {st} from '@/lib/staff/staff-locale-copy';
import {staffServerText} from '@/lib/staff/staff-server-copy';
import {FIRST_NOTE_BUILDER,FIRST_NOTE_VERSION} from '@/lib/first-note/compose';
const extraModules:Record<string,unknown>={};
for(const path of ['@/lib/patient-care/consultation-proposal','@/components/real-review/use-consultation-decision','@/lib/doctor-decisions/publication-gate','@/lib/patient-care/action-timeout','@/components/real-review/clinical-summary','@/components/real-review/urgent-publication'])extraModules[path]=await import(path);
const require=createRequire(import.meta.url),exports:Record<string,unknown>={};
const id='11111111-1111-4111-8111-111111111111',at='2026-10-31T12:00:00Z';
const context={memberId:id,revision:4,evidenceToken:'a'.repeat(32)};
const noteCalls:unknown[][]=[],clinicalCalls:unknown[]=[];
let noteStatus='approved',clinicalResult={ok:true,message:'Care plan published.'};
const code=ts.transpileModule(readFileSync('components/staff/doctor-workspace/approval-cards.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new vm.Script(code).runInNewContext({exports,crypto,FormData,require(name:string){
 if(name==='@/lib/patient-care/clinical-review-actions')return {checkRealClinicalCaseAvailability:async()=>({ok:true,message:''})};
 if(name in extraModules)return extraModules[name];
 if(name==='@/components/patient-care/common')return {stamp};
 if(name==='next/navigation')return {useRouter:()=>({refresh(){}})};
 if(name==='next/link')return {default:(p:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',p)};
 if(name==='@/lib/first-note/actions')return {approveFirstNote:async(...args:unknown[])=>{noteCalls.push(args);return {status:noteStatus};}};
 if(name==='@/lib/doctor-decisions/approval-actions')return {pressClinicalCard:async(input:unknown)=>{clinicalCalls.push(input);return clinicalResult;}};
 if(name==='@/lib/staff/staff-locale-copy')return {st};
 if(name==='@/lib/staff/staff-server-copy')return {staffServerText};
 if(name==='@/lib/first-note/compose')return {FIRST_NOTE_BUILDER,FIRST_NOTE_VERSION};
 if(name==='@/lib/service-workflow/publication')return {regimenNameKey};
 if(name==='@/components/patient-care/regimen-changes')return {RegimenChanges,RegimenList};
 if(name==='@/lib/staff-zoe/outcome-copy')return outcomeCopy;
 return require(name);
}});
const Cards=exports.DoctorApprovalCards as typeof import('@/components/staff/doctor-workspace/approval-cards').DoctorApprovalCards;
const med=(name:string,dose:string)=>({name,dose,times:['09:00'],instructions:`Instructions for ${name}`});
const medicines=[med('New medicine','New dose'),med('Changed medicine','New dose'),med('Same medicine','Same dose')];
const data:ApprovalCards={firstNote:{context:{...context,appointmentsRevision:'b'.repeat(32)},submissionId:id,assessmentRevision:3,
 data:{version:'first-note-v1',enabled:true,completedAt:at,dueAt:at,urgent:false,planActive:false,note:null},draft:{text:{en:'Exact <note>',hy:'Հայերեն գրառում'},sources:['HTN-002']}},
 regimen:{context,current:true,clinicalReview:{evidenceToken:context.evidenceToken,doctorId:id,preparedAt:at,engine:{version:'fixture',urgency:'green',tests:[]},approvals:{},receipts:{},consultation:{decision:'not-required'}},requestId:id,draft:{explanation:'Saved explanation',instructions:'Saved care instructions',followUp:'Saved follow-up',medicationName:'',medicationDose:'',medicationTimes:[],medicationInstructions:'',medicines},
 review:{version:'regimen-review-v1',enabled:true,versions:[{planId:id,version:2,publishedAt:at,changeSummary:null,current:true,medicines:[med('Changed medicine','Old dose'),med('Same medicine','Same dose'),med('Stopped medicine','Stopped dose')],changes:[]}],draft:{medicines,approvalHash:'c'.repeat(32),changes:[{kind:'started',...medicines[0]},{kind:'dose_changed',name:'Changed medicine',fromDose:'Old dose',toDose:'New dose'},{kind:'stopped',name:'Stopped medicine',dose:'Stopped dose',times:['09:00']}]}}},consultation:null};
for(const locale of ['en','hy','ru']as const){
 const html=renderToStaticMarkup(React.createElement(Cards,{data,locale}));
 assert.doesNotMatch(html.replace(/(?:href|dateTime)="[^"]*"/g,''),/\d{4}-\d{2}-\d{2}T|Case revision|Դեպքի տարբերակ|Версия случая|>11111111-/);
 for(const text of ['Exact &lt;note&gt;','Հայերեն գրառում','Saved explanation','Saved care instructions','Saved follow-up','Stopped medicine','Stopped dose','Old dose'])assert.ok(html.includes(text),text);
 for(const group of ['new','changed','unchanged','stopped'])assert.ok(html.includes(`data-regimen="${group}"`),group);
}
assert.equal(noteCalls.length+clinicalCalls.length,0,'Rendering never approves');
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let tree:TestRenderer.ReactTestRenderer;
const press=(text:string)=>tree!.root.findAllByType('button').find(b=>b.props.children===text)!;
await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data,locale:'en'}));});
const noteForm=tree!.root.findAllByType('form').find(f=>f.props['data-decision']==='first-note')!;
await act(async()=>tree!.root.findAllByType('textarea').find(t=>t.props.lang==='en')!.props.onChange({target:{value:'Doctor edited exact text'}}));
await act(async()=>{noteForm.props.onSubmit({preventDefault(){}});noteForm.props.onSubmit({preventDefault(){}});});
assert.equal(noteCalls.length,1,'Rapid first-note double press sends one command');
assert.equal((noteCalls[0][0]as {textEn:string}).textEn,'Doctor edited exact text');
assert.deepEqual(JSON.parse(JSON.stringify(noteCalls[0][1])),data.firstNote!.context);
await act(async()=>tree!.root.findAllByType('input').find(i=>i.props.type==='checkbox')!.props.onChange({target:{checked:true}}));
assert.equal(press('Approve and publish this plan').props.disabled,true,'A replacement needs its exact member-facing change note');
await act(async()=>tree!.root.findAllByType('textarea').find(t=>t.props.maxLength===1000)!.props.onChange({target:{value:'Exact replacement note'}}));
assert.equal(press('Approve and publish this plan').props.disabled,false);
await act(async()=>{press('Approve and publish this plan').props.onClick();press('Approve and publish this plan').props.onClick();});
assert.equal(clinicalCalls.length,1,'Regimen double press sends one command');
assert.deepEqual(JSON.parse(JSON.stringify(clinicalCalls[0])),{kind:'regimen',context,requestId:id,regimenHash:'c'.repeat(32),approved:true,changeSummary:'Exact replacement note'});
await act(async()=>tree!.unmount());
// A stale or missing clinical review must block publication even after every other prerequisite is met.
const readerExports:Record<string,unknown>={};
const readerModules:Record<string,unknown>={};
for(const path of ['@/lib/patient-care/clinical-review-engine','@/lib/patient-care/clinical-case-repository','@/lib/first-note/schema','@/lib/first-note/compose','@/lib/patient-care/regimen','@/lib/real-booking/appointment-schema','@/lib/patient-care/clinical-review-current','@/lib/doctor-decisions/publication-gate','@/lib/service-workflow/publication'])readerModules[path]=await import(path);
vm.runInNewContext(ts.transpileModule(readFileSync('lib/doctor-decisions/approval-read.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:readerExports,crypto,require(name:string){
 if(name==='server-only')return {};
 if(name==='@/lib/patient-care/regimen-config')return {multiMedicineEnabled:()=>true};
 if(name in readerModules)return readerModules[name];
 return require(name);
}});
const readCards=readerExports.readApprovalCards as typeof import('@/lib/doctor-decisions/approval-read').readApprovalCards;
for(const review of ['stale','missing'] as const){
 const clinicalReview=review==='missing'?null:{...data.regimen!.clinicalReview!,evidenceToken:'d'.repeat(32)};
 const bundle={snapshot:{id,revision:4,evidenceToken:context.evidenceToken,draft:data.regimen!.draft,draftSavedAt:at,draftStale:false,review:clinicalReview,
  evidence:{profile:{name:null,birthDate:null,biologicalSex:null},consent:{},assessment:null,measurements:[],reports:[]}},
  firstNote:{version:'first-note-v1',enabled:false},regimen:data.regimen!.review,appointments:[],appointmentsRevision:'b'.repeat(32),replacementId:id};
 const blocked=await readCards({async rpc(){return {data:bundle,error:null};}},id,id);
 assert.ok(blocked?.regimen,'A reviewable saved plan remains visible');
 assert.equal(blocked.regimen.current,false,`${review} clinical review cannot create a current card`);
 const before:number=clinicalCalls.length;
 await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:blocked,locale:'en'}));});
 const card=tree!.root.findByProps({'data-decision':'regimen'});
 await act(async()=>{card.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});card.findByType('textarea').props.onChange({target:{value:'Reviewed replacement after changed labs'}});});
 assert.equal(card.findByProps({type:'checkbox'}).props.checked,true);
 assert.equal(card.findByType('textarea').props.value,'Reviewed replacement after changed labs');
 assert.equal(press('Approve and publish this plan').props.disabled,true,`${review} review blocks an otherwise ready publication`);
 // Exercise the guard itself as well as the disabled control.
 await act(async()=>press('Approve and publish this plan').props.onClick());
 assert.equal(clinicalCalls.length,before,`${review} review never reaches publication`);
 await act(async()=>tree!.unmount());
}
console.log('Publication freshness: stale and null reviews refuse publication with approval tick and change summary satisfied.');
for(const outcome of ['stale','access','outcome-unknown']){
 noteStatus=outcome;clinicalResult={ok:false,message:'The evidence or assignment changed. Reload and review.'};
 await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data,locale:'en'}));});
 await act(async()=>tree!.root.findAllByType('form')[0].props.onSubmit({preventDefault(){}}));
 assert.equal(press('Approve and show this note').props.disabled,true,'Every failure requires review/refresh before another approval');
 assert.ok(tree!.root.findAllByProps({role:'alert'}).length);
 await act(async()=>tree!.unmount());
}
const missing=renderToStaticMarkup(React.createElement(Cards,{data:null,locale:'en'}));
assert.match(missing,/could not be read/);assert.doesNotMatch(missing,/<button/);
const urgent=structuredClone(data);urgent.firstNote!.data.urgent=true;urgent.firstNote!.draft=null;urgent.regimen=null;
assert.doesNotMatch(renderToStaticMarkup(React.createElement(Cards,{data:urgent,locale:'en'})),/Approve and show this note/);
const consultation:ApprovalCards={firstNote:null,regimen:null,consultation:{context,review:{evidenceToken:context.evidenceToken,doctorId:id,preparedAt:at,engine:{version:'fixture',urgency:'green',tests:[]},approvals:{},receipts:{},consultation:{decision:'required',note:'Saved private reason'}}}};
for(const operation of ['decision','completion']){
 await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:consultation,locale:'en'}));});
 const forms=tree!.root.findAllByType('form');
 await act(async()=>forms[0].findByType('textarea').props.onChange({target:{value:'Distinct private rationale'}}));
 assert.equal(forms[1].findByType('textarea').props.value,'','Decision rationale never fills completion notes');
 await act(async()=>forms[1].findByType('textarea').props.onChange({target:{value:'Distinct completion narrative'}}));
 assert.equal(forms[0].findByType('textarea').props.value,'Distinct private rationale','Completion notes never overwrite decision reason');
 await act(async()=>forms[0].findByType('select').props.onChange({target:{value:'not-required'}}));
 await act(async()=>forms[0].findByType('textarea').props.onChange({target:{value:'Distinct private rationale'}}));
 await act(async()=>forms[1].findByType('input').props.onChange({target:{value:'2026-10-31T12:00'}}));
 const before:number=clinicalCalls.length;
 await act(async()=>{const form=forms[operation==='decision'?0:1];form.props.onSubmit({preventDefault(){}});form.props.onSubmit({preventDefault(){}});});
 assert.equal(clinicalCalls.length,before+1,'Consultation double press submits once');
 const submitted=clinicalCalls.at(-1)as {kind:string;note:string};
 assert.equal(submitted.kind,operation==='decision'?'consultation-decision':'complete-consultation');
 assert.equal(submitted.note,operation==='decision'?'Distinct private rationale':'Distinct completion narrative');
 await act(async()=>tree!.unmount());
}
for(const locale of ['en','hy','ru'] as const){
 const fixture=structuredClone(consultation);
 fixture.consultation!.review.consultation={decision:'undecided'};
 Object.assign(fixture.consultation!,{proposal:{decision:'not-required',note:'No consultation is needed.'}});
 const before:number=clinicalCalls.length;
 await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:fixture,locale}));});
 const form=()=>tree!.root.findByType('form');
 const attribution=st(locale,"Zoe's proposal",'Զոյայի առաջարկը','Предложение Zoe');
 assert.equal(form().findByType('select').props.value,'not-required');
 assert.equal(form().findByType('textarea').props.value,'No consultation is needed.');
 assert.equal(clinicalCalls.length,before);
 assert.ok(JSON.stringify(tree!.toJSON()).includes(attribution));
 await act(async()=>form().props.onSubmit({preventDefault(){}}));
 assert.deepEqual(JSON.parse(JSON.stringify(clinicalCalls.at(-1))),{kind:'consultation-decision',context,decision:'not-required',note:'No consultation is needed.'});
 await act(async()=>{tree!.unmount();tree=TestRenderer.create(React.createElement(Cards,{data:fixture,locale}));});
 await act(async()=>form().findByType('select').props.onChange({target:{value:'required'}}));
 assert.ok(!JSON.stringify(tree!.toJSON()).includes(attribution));
 await act(async()=>form().findByType('textarea').props.onChange({target:{value:'Doctor override reason'}}));
 await act(async()=>form().props.onSubmit({preventDefault(){}}));
 assert.equal((clinicalCalls.at(-1) as {note:string}).note,'Doctor override reason');
 for(const withdrawal of ['missing','abnormal'] as const)for(const edit of ['untouched','reason','decision','both'] as const){
  await act(async()=>{tree!.unmount();tree=TestRenderer.create(React.createElement(Cards,{data:fixture,locale}));});
  const decisionEdited=edit==='decision'||edit==='both',reasonEdited=edit==='reason'||edit==='both';
  if(decisionEdited)await act(async()=>form().findByType('select').props.onChange({target:{value:edit==='both'?'required':'not-required'}}));
  if(reasonEdited)await act(async()=>form().findByType('textarea').props.onChange({target:{value:'Doctor-entered reason'}}));
  const withdrawn=structuredClone(fixture);
  if(withdrawal==='missing')delete withdrawn.consultation!.proposal;
  else{
   withdrawn.consultation!.review.engine.tests=[{id:'ecg-12-lead',title:'ECG',method:'clinic'}];
   withdrawn.consultation!.review.evidenceReceipts={'ecg-12-lead':{source:'investigation',sourceId:id,actorId:id,at,snapshot:{result:'abnormal'}}};
  }
  await act(async()=>tree!.update(React.createElement(Cards,{data:withdrawn,locale})));
  assert.equal(form().findByType('select').props.value,decisionEdited?(edit==='both'?'required':'not-required'):'',`${withdrawal}/${edit}: only a doctor-chosen decision survives withdrawal`);
  assert.equal(form().findByType('textarea').props.value,reasonEdited?'Doctor-entered reason':'',`${withdrawal}/${edit}: only an edited reason survives withdrawal`);
  assert.equal(form().findByType('button').props.disabled,!(decisionEdited&&reasonEdited),'Incomplete decisions disable Save');
  const beforeWithdrawalSubmit:number=clinicalCalls.length;
  await act(async()=>form().props.onSubmit({preventDefault(){}}));
  assert.equal(clinicalCalls.length,beforeWithdrawalSubmit+(decisionEdited&&reasonEdited?1:0),'Withdrawal cannot submit an untouched automatic decision');
  if(decisionEdited&&reasonEdited)assert.equal((clinicalCalls.at(-1) as {decision:string}).decision,'required');
 }
 for(const urgency of ['yellow','orange'] as const){
  const blocked=structuredClone(fixture);blocked.consultation!.review.engine.urgency=urgency;
  await act(async()=>{tree!.unmount();tree=TestRenderer.create(React.createElement(Cards,{data:blocked,locale}));});
  assert.equal(form().findByType('select').props.value,'');
  assert.equal(form().findByType('textarea').props.value,'');
 }
 await act(async()=>tree!.unmount());
}
console.log('Approval card rendering and interaction checks passed (controlled IO, no browser or database).');

// An unconfirmed standalone publication can retry after a verified unchanged reread.
{
 clinicalResult={ok:false,message:'Taking longer than expected. The outcome is not confirmed. Reload to check what was saved or sent, then try again.'};
 const onlyPlan={...data,firstNote:null,consultation:null};
 await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:onlyPlan,locale:'en'}));});
 const approve=()=>press('Approve and publish this plan');
 await act(async()=>{tree!.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});tree!.root.findByType('textarea').props.onChange({target:{value:'Reviewed replacement'}});});
 await act(async()=>approve().props.onClick());assert.equal(approve().props.disabled,true);
 await act(async()=>press('Refresh').props.onClick());
 await act(async()=>{tree!.root.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});tree!.root.findByType('textarea').props.onChange({target:{value:'Reviewed replacement'}});});
 assert.equal(approve().props.disabled,false,'Same revision/token/hash must not permanently freeze a failed publication');
 await act(async()=>tree!.unmount());
 console.log('Standalone approval: verified unchanged reread clears the failed-card lock and requires a new explicit approval tick.');
}

// Fresh-eyes regression: the first unmet gate is actionable, localized and cannot publish.
const textOf=(node:TestRenderer.ReactTestInstance):string=>node.children.map(child=>typeof child==='string'?child:textOf(child)).join(' ');
for(const locale of ['en','hy','ru'] as const){
 const labels={
  lab:st(locale,'Needs Lipids result: review lab file','Lipids հետազոտության արդյունքն անհրաժեշտ է․ վերանայեք լաբորատոր ֆայլը','Нужен результат Lipids: проверьте файл анализов'),
  consultation:st(locale,'Record whether a consultation is needed','Գրանցեք՝ արդյոք խորհրդատվություն անհրաժեշտ է','Укажите, нужна ли консультация'),
  completion:st(locale,'Record the completed consultation','Գրանցեք կայացած խորհրդատվությունը','Запишите состоявшуюся консультацию'),
  evidence:st(locale,'Confirm Home readings on the Evidence tab','Հաստատեք Home readings հետազոտությունը «Տվյալներ» ներդիրում','Подтвердите Home readings на вкладке «Данные»'),
  source:st(locale,'Review and approve the lab file','Վերանայեք և հաստատեք լաբորատոր ֆայլը','Проверьте и утвердите файл анализов'),
  medicines:st(locale,'Review the medicines and doses, then tick the confirmation','Վերանայեք դեղերն ու դեղաչափերը, ապա նշեք հաստատման վանդակը','Проверьте лекарства и дозы, затем отметьте подтверждение'),
 };
 for(const kind of ['lab','consultation','completion','evidence','source','medicines','stale'] as const){
  const fixture=structuredClone(data);fixture.firstNote=null;
  const card=fixture.regimen!,review=card.clinicalReview!;
  if(kind==='lab'){review.engine.tests=[{id:'lipids',title:'Lipids',method:'lab'}];review.consultation.decision='undecided';}
  if(kind==='consultation')review.consultation.decision='undecided';
  if(kind==='completion')review.consultation.decision='required';
  if(kind==='evidence')review.engine.tests=[{id:'bp-home-log',title:'Home readings',method:'home-log'}];
  if(kind==='source')card.publicationGate={kind:'source',reportId:id};
  if(kind==='stale'){card.current=false;card.staleReason='consultation';}
  fixture.consultation={context,review};
  await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:fixture,locale}));});
  const section=tree!.root.findByProps({'data-decision':'regimen'});
  const publishLabel=st(locale,'Approve and publish this plan','Հաստատել և հրապարակել այս պլանը','Утвердить и опубликовать этот план');
  if(kind!=='medicines')await act(async()=>section.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}}));
  await act(async()=>section.findByType('textarea').props.onChange({target:{value:'Reviewed changes'}}));
  assert.equal(press(publishLabel).props.disabled,true,`${locale}/${kind}: publish stays disabled`);
  const before:number=clinicalCalls.length;
  await act(async()=>press(publishLabel).props.onClick());
  assert.equal(clinicalCalls.length,before,`${locale}/${kind}: disabled press guard`);
  if(kind==='stale'){
   assert.ok(textOf(section).includes(st(locale,'The draft is out of date because the consultation decision changed.','Սևագիրը հնացել է, քանի որ խորհրդատվության որոշումը փոխվել է։','Черновик устарел, потому что решение о консультации изменилось.')));
   assert.ok(section.findAllByType('a').some(a=>a.props.href===`/staff/real/members/${id}#treatment`));
  }else{
   const action=section.findAll(n=>['button','a'].includes(String(n.type))&&textOf(n)===labels[kind]);
   assert.equal(action.length,1,`${locale}/${kind}: one plain actionable gate`);
   if(['lab','evidence'].includes(kind))assert.equal(action[0].props.href,`/staff/real/members/${id}#uploaded-reports`);
   if(kind==='source')assert.equal(action[0].props.href,`/staff/real/members/${id}/reports/${id}`);
   if(kind==='lab')assert.ok(!textOf(section).includes(labels.consultation),'Only the first unmet gate is shown');
  }
  assert.doesNotMatch(textOf(tree!.root),/\d{4}-\d{2}-\d{2}T|revision|11111111-/i,'No raw timestamps, revisions or ids in visible card text');
  assert.ok(textOf(tree!.root).includes('16:00'),'Consultation prepared time uses Yerevan time and 24-hour clock');
  await act(async()=>tree!.unmount());
 }
}
console.log('Fresh-eyes cards: every gate has localized action and blocks publish; visible dates are Yerevan 24-hour with no ids or revisions.');

// A report gate must not invent an association with an already received test.
{
 const {firstPublicationGate}=await import('@/lib/doctor-decisions/publication-gate');
 const review=structuredClone(data.regimen!.clinicalReview!);
 review.engine.tests=[{id:'lipids',title:'Lipids',method:'lab'}];
 review.receipts.lipids={reportId:id,reportRevision:2,rows:[0],note:'Checked',actorId:id,at};
 review.approvals[id]={revision:2,actorId:id,at};
 const other='22222222-2222-4222-8222-222222222222';
 const reports=[{id,state:'confirmed',reviewed:{rows:[]},revision:2},{id:other,state:'uploaded',reviewed:null,revision:1}] as unknown as import('@/lib/patient-care/clinical-case-repository').ClinicalSnapshot['evidence']['reports'];
 assert.deepEqual(firstPublicationGate(review,true,reports),{kind:'source',reportId:other},'An unrelated report cannot be described as the received Lipids result');
}

// A known urgent refusal already has its explanation and action; chat must not append a generic failure.
for(const locale of ['en','hy','ru'] as const){
 const fixture={...data,firstNote:null,consultation:null};
 await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:fixture,locale,chat:{press:async()=>({ok:false,message:"Can't publish while urgent alerts are open. Resolve them first."}),onSuccess(){},onCheckAgain(){}}}));});
 const section=tree!.root.findByProps({'data-decision':'regimen'});
 await act(async()=>{section.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});section.findByType('textarea').props.onChange({target:{value:'Reviewed changes'}});});
 const publish=st(locale,'Approve and publish this plan','Հաստատել և հրապարակել այս պլանը','Утвердить и опубликовать этот план');
 await act(async()=>press(publish).props.onClick());
 assert.ok(section.findAllByType('a').some(a=>a.props.href===`/staff/real/members/${id}#member-alerts`));
 assert.doesNotMatch(textOf(section),/Not done|Չի կատարվել|Не выполнено/);
 assert.equal(press(publish).props.disabled,true);
 await act(async()=>tree!.unmount());
}

// Every locally observable publication requirement blocks the mounted card, even
// after the doctor ticks approval and supplies the replacement note.
for(const scenario of ['abnormal-not-required','abnormal-wrong-token','completion-wrong-token','completion-future','unsupported-path','unknown-report','lab-and-completion'] as const){
 const fixture=structuredClone(data);fixture.firstNote=null;
 const card=fixture.regimen!,review=card.clinicalReview!;
 review.consultation={decision:'required',completedAt:at,evidenceToken:context.evidenceToken};
 let label='Record the completed consultation';
 if(scenario.startsWith('abnormal')||scenario==='unsupported-path'){
  review.engine.tests=[{id:scenario==='unsupported-path'?'unsupported-test':'ecg-12-lead',title:'ECG',method:'clinic'}];
  review.evidenceReceipts={'ecg-12-lead':{source:'investigation',sourceId:id,snapshot:{result:'abnormal'},actorId:id,at}};
  if(scenario==='unsupported-path'){
   label='ECG cannot be confirmed in Noreon yet. Review the evidence pathway';
   review.evidenceReceipts['unsupported-test']=review.evidenceReceipts['ecg-12-lead'];
  }
  else{
   label='An abnormal investigation needs a completed consultation first';
   if(scenario==='abnormal-not-required')review.consultation={decision:'not-required'};
   else review.consultation.evidenceToken='d'.repeat(32);
  }
 }
 if(scenario==='completion-wrong-token')review.consultation.evidenceToken='d'.repeat(32);
 if(scenario==='completion-future')review.consultation.completedAt='2999-01-01T00:00:00Z';
 if(scenario==='unknown-report'){
  review.engine.tests=[{id:'lipids',title:'Lipids',method:'lab'}];
  review.receipts.lipids={reportId:id,reportRevision:2,rows:[0],note:'Checked',actorId:id,at};
  label='Needs Lipids result: review lab file';
 }
 if(scenario==='lab-and-completion'){
  review.engine.tests=[{id:'lipids',title:'Lipids',method:'lab'}];
  review.receipts.lipids={reportId:id,reportRevision:2,rows:[0],note:'Checked',actorId:id,at};
  review.consultation.evidenceToken='d'.repeat(32);
  card.publicationGate={kind:'completion'}; // The frozen server read has the approved report.
 }
 fixture.consultation={context,review};
 const before:number=clinicalCalls.length;
 let focused=false,scrolled=false;
 await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:fixture,locale:'en',chat:{press:async command=>{clinicalCalls.push(command);return {ok:true,message:'Published'};},onSuccess(){},onCheckAgain(){}}}),{createNodeMock(element){
  const props=element.props as {'data-decision'?:unknown};
  if(props['data-decision']==='consultation')return {scrollIntoView(){scrolled=true;},querySelector(){return {focus(){focused=true;}};}};
  return null;
 }});});
 const section=tree!.root.findByProps({'data-decision':'regimen'});
 await act(async()=>{section.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});section.findByType('textarea').props.onChange({target:{value:'Reviewed replacement'}});});
 assert.equal(press('Approve and publish this plan').props.disabled,true,`${scenario}: approval tick cannot bypass the gate`);
 const action=section.findAll(n=>['button','a'].includes(String(n.type))&&textOf(n)===label);
 assert.equal(action.length,1,`${scenario}: explanation and action are present`);
 if(scenario.startsWith('abnormal')||scenario.startsWith('completion')||scenario==='lab-and-completion'){
  assert.equal(action[0].type,'button',`${scenario}: consultation control is mounted in chat`);
  await act(async()=>action[0].props.onClick());
  assert.ok(focused&&scrolled,`${scenario}: opens and focuses the consultation control`);
  const consultation=tree!.root.findByProps({'data-decision':'consultation'});
  assert.equal(consultation.findAllByType('form').length,scenario==='abnormal-not-required'?1:2,`${scenario}: the required correction form is available`);
 }else assert.equal(action[0].props.href,`/staff/real/members/${id}#uploaded-reports`);
 await act(async()=>press('Approve and publish this plan').props.onClick());
 assert.equal(clinicalCalls.length,before,`${scenario}: guarded handler never publishes`);
 if(scenario!=='unsupported-path'&&scenario!=='unknown-report'){
  const forms=tree!.root.findByProps({'data-decision':'consultation'}).findAllByType('form');
  const form=forms.at(-1)!;
  await act(async()=>{
   form.findByType('textarea').props.onChange({target:{value:'Doctor corrected the consultation record'}});
   if(scenario==='abnormal-not-required')form.findByType('select').props.onChange({target:{value:'required'}});
   else form.findByType('input').props.onChange({target:{value:'2026-11-05T12:00'}});
  });
  await act(async()=>form.props.onSubmit({preventDefault(){}}));
  assert.equal((clinicalCalls.at(-1) as {kind:string}).kind,scenario==='abnormal-not-required'?'consultation-decision':'complete-consultation',`${scenario}: correction can be submitted`);
 }
 await act(async()=>tree!.unmount());
}

// A shape-valid saved draft can still fail the SQL validity rule. Use the real
// clinical engine so this cannot pass merely because the review was already stale.
{
 const {clinicalReviewEngine}=await import('@/lib/patient-care/clinical-review-engine');
 const answers=JSON.parse(readFileSync('scripts/fixtures/patient-answers.json','utf8'));
 const snapshot:import('@/lib/patient-care/clinical-case-repository').ClinicalSnapshot={id,revision:4,evidenceToken:context.evidenceToken,draft:{...data.regimen!.draft,instructions:'Add the approved care instructions.'},draftSavedAt:at,draftStale:false,
  evidence:{visits:[],profile:{name:null,birthDate:'1974-01-01',biologicalSex:answers['q1.sex'].value},consent:{version:'patient-pilot-v1'},assessment:{revision:1,assessment_date:'2026-10-12',answers,completed_at:'2026-10-12T00:00:00Z',urgent_rule:null},measurements:[],reports:[]}};
 snapshot.review={...data.regimen!.clinicalReview!,engine:clinicalReviewSchema.shape.engine.parse(clinicalReviewEngine(snapshot))};
 const bundle={snapshot,firstNote:{version:'first-note-v1',enabled:false},regimen:data.regimen!.review,appointments:[],appointmentsRevision:'b'.repeat(32),replacementId:id};
 const blocked=await readCards({async rpc(){return {data:bundle,error:null};}},id,id);
 assert.ok(blocked?.regimen);
 assert.equal(blocked.regimen.current,false,'A draft with placeholder care instructions cannot be declared current');
 await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:blocked,locale:'en'}));});
 const card=tree!.root.findByProps({'data-decision':'regimen'});
 await act(async()=>{card.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});card.findByType('textarea').props.onChange({target:{value:'Reviewed changes'}});});
 assert.equal(press('Approve and publish this plan').props.disabled,true);
 assert.ok(card.findAllByType('a').some(a=>textOf(a)==='Refresh draft'));
 await act(async()=>tree!.unmount());
}

// Do not replace the trusted null from a complete report read with a fallback
// that has no reports. Valid consultation evidence must also release its gate.
for(const kind of ['lab','abnormal'] as const){
 const fixture=structuredClone(data);fixture.firstNote=null;
 const card=fixture.regimen!,review=card.clinicalReview!;
 review.consultation={decision:'required',completedAt:at,evidenceToken:context.evidenceToken};
 const {firstPublicationGate}=await import('@/lib/doctor-decisions/publication-gate');
 if(kind==='lab'){
  review.engine.tests=[{id:'lipids',title:'Lipids',method:'lab'}];
  review.receipts.lipids={reportId:id,reportRevision:2,rows:[0],note:'Checked',actorId:id,at};
  review.approvals[id]={revision:2,actorId:id,at};
  card.publicationGate=firstPublicationGate(review,true,[{id,revision:2,state:'confirmed',reviewed:{rows:[]},confirmedAt:at}]);
 }else{
  review.engine.tests=[{id:'ecg-12-lead',title:'ECG',method:'clinic'}];
  review.evidenceReceipts={'ecg-12-lead':{source:'investigation',sourceId:id,snapshot:{result:'abnormal'},actorId:id,at}};
  card.publicationGate=firstPublicationGate(review,true,[]);
 }
 assert.equal(card.publicationGate,null);
 await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:fixture,locale:'en'}));});
 const section=tree!.root.findByProps({'data-decision':'regimen'});
 await act(async()=>{section.findByProps({type:'checkbox'}).props.onChange({target:{checked:true}});section.findByType('textarea').props.onChange({target:{value:'Reviewed replacement'}});});
 assert.equal(press('Approve and publish this plan').props.disabled,false,`${kind}: established local gates allow a publication attempt`);
 await act(async()=>tree!.unmount());
}
console.log('Publication gates: abnormal investigations, unsupported paths, current completed consultations, known report state and valid saved drafts pass mounted regressions (controlled IO).');
