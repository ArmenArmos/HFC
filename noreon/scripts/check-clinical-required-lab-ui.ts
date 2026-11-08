import * as requiredLabMatch from '../lib/patient-care/required-lab-match';
/** Exercises the real review controls and React hooks; only router/actions are replaced. */
import assert from 'node:assert/strict';
import * as regimenModule from '../lib/patient-care/regimen';
import {isClinicLabReceipt} from '../lib/patient-care/clinical-review-schema';
import * as staffLocaleCopy from '../lib/staff/staff-locale-copy';import * as staffServerCopy from '../lib/staff/staff-server-copy';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {extractionSchema} from '../lib/reports/schema';
import type {ClinicalSnapshot} from '../lib/patient-care/clinical-case-repository';
import {selectFieldNativeStub} from './select-field-native-stub';
import * as realLocaleModule from '@/lib/locale';
const require=createRequire(import.meta.url);
const {create,act}=require('react-test-renderer') as typeof import('react-test-renderer');
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const calls:FormData[]=[];
type CommandResult={ok:boolean;message:string;uncertain?:boolean};
let commandWait:Promise<CommandResult>|null=null;
let routeRefreshes=0;
const router={refresh(){routeRefreshes++;}};
const hashListeners=new Set<()=>void>();
const fakeWindow={location:{hash:''},addEventListener(_name:string,fn:()=>void){hashListeners.add(fn);},removeEventListener(_name:string,fn:()=>void){hashListeners.delete(fn);}};
const extraModules:Record<string,unknown>={};
for(const path of ['@/lib/patient-care/consultation-proposal','./use-consultation-decision','@/lib/patient-care/action-timeout','./clinical-summary','./urgent-publication'])extraModules[path]=await import(path.startsWith('./')?'@/components/real-review/'+path.slice(2):path);
function load(path:string):Record<string,unknown>{
 const exports={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new vm.Script(code).runInNewContext({exports,window:fakeWindow,FormData:class{constructor(data:FormData){return data;}},require(name:string){if(name==='@/lib/patient-care/required-lab-match')return requiredLabMatch;if(name in extraModules)return extraModules[name];
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/components/staff/record-refresh')return load('components/staff/record-refresh.tsx');
  if(name==='lucide-react')return require(name);
  if(name==='next/navigation')return {unstable_rethrow:require('next/navigation').unstable_rethrow,useRouter:()=>router};
  if(name==='@/lib/patient-care/clinical-review-actions')return {checkRealClinicalCaseAvailability:async()=>({ok:true,message:''}),realClinicalCommand:async(_previous:unknown,form:FormData)=>{calls.push(form);return commandWait??{ok:true,message:'Review saved.'};}};
  if(name==='@/lib/reports/schema')return {extractionSchema};
  if(name==='./publish-confirmation')return {PublishConfirmation:React.createContext({published:null,set(){}})};
  if(name==='./report-provenance')return load('components/real-review/report-provenance.tsx');
  if(name==='@/lib/staff/yerevan-time')return load('lib/staff/yerevan-time.ts');
  if(name==='@/lib/patient-care/clinical-review-schema')return {isClinicLabReceipt};
  if(name==='@/lib/patient-care/required-evidence')return {hasEvidencePath:()=>false};if(name==='./required-evidence')return {RequiredEvidence:()=>null};
  if(name==='@/components/ui/select-field')return selectFieldNativeStub;if(name==='@/lib/staff/staff-locale-copy')return staffLocaleCopy;if(name==='@/lib/staff/staff-server-copy')return staffServerCopy;if(name==='@/lib/locale')return realLocaleModule;if(name==='./regimen')return {RegimenApproval:()=>null,RegimenEditor:()=>null};if(name==='@/lib/patient-care/regimen')return regimenModule;throw Error(`Unexpected import ${name}`);
 }});return exports;
}
const {RealReviewControls}=load('components/real-review/review-controls.tsx') as typeof import('../components/real-review/review-controls');

const id=(n:number)=>`c1ad0000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const names=['Total cholesterol','HDL-C','LDL-C','Triglycerides','Glucose','Magnesium'];
const today=new Date().toISOString().slice(0,10),questionnaire=new Date(Date.now()-86400000).toISOString();
const values=names.map((name,i)=>({id:id(50+i),seq:i+1,name,reviewedAt:today+'T00:00:00Z',valueText:'1.2',value:1.2,unit:'mmol/L',reference:null,collectedOn:today,laboratory:'Synthetic clinic'}));
const source={attachmentId:id(30),fileId:id(20),fileName:'lipids-glucose-magnesium.pdf',clinic:'Synthetic clinic',attachedAt:today+'T00:00:00Z',values};
const tests=['lipid-panel','tsh','apob','lpa','urine-acr','urinalysis','potassium','sodium','cbc-hb','hba1c-glucose'].map(id=>({id,title:id,method:'lab' as const}));
const snapshot:ClinicalSnapshot={id:id(1),revision:1,evidenceToken:'a'.repeat(32),draft:null,draftSavedAt:null,draftStale:false,evidence:{visits:[],profile:{name:'Synthetic',birthDate:null,biologicalSex:null},consent:null,assessment:{revision:1,completed_at:questionnaire,urgent_rule:null,answers:{}},measurements:[],reports:[]},review:{evidenceToken:'a'.repeat(32),doctorId:id(4),preparedAt:questionnaire,engine:{version:'NRN-CLIN-ALG-001-v1.1',urgency:'yellow',tests},approvals:{},receipts:{},consultation:{decision:'undecided'}}};
const flatten=(node:unknown):string=>typeof node==='string'?node:Array.isArray(node)?node.map(flatten).join(''):node&&typeof node==='object'&&'children'in node?flatten(node.children):'';
const text=(tree:ReturnType<typeof create>)=>flatten(tree.toJSON());
async function mount(locale:'en'|'hy'|'ru'='en',clinicLab=[source],data=snapshot){let tree!:ReturnType<typeof create>;await act(async()=>{tree=create(React.createElement(RealReviewControls,{snapshot:data,requestId:id(90),section:'evidence',locale,clinicLab}));});return tree;}
const forms=(tree:ReturnType<typeof create>,operation:string)=>tree.root.findAllByType('form').filter(form=>form.findAllByType('input').some(input=>input.props.name==='operation'&&input.props.value===operation));
function formPayload(form:ReturnType<typeof create>['root']){
 const payload=new FormData();
 for(const input of form.findAllByType('input'))if(input.props.name&&(input.props.type==='hidden'||input.props.checked))payload.append(input.props.name,String(input.props.value));
 for(const input of form.findAllByType('textarea'))if(input.props.name)payload.set(input.props.name,input.props.defaultValue??'');
 return payload;
}
const edit=(tree:ReturnType<typeof create>,locale:'en'|'hy'|'ru'='en')=>tree.root.findAllByType('details').find(node=>node.findAllByType('summary').some(summary=>flatten(summary.children).includes(({en:'Edit selection',hy:'Խմբագրել ընտրությունը',ru:'Изменить выбор'})[locale])))!;
for(const locale of ['en','hy','ru']as const){
 calls.length=0;
 const tree=await mount(locale);
 const bulk=forms(tree,'receive-all-clinic-results');
 assert.equal(bulk.length,1,'One action per eligible file');
 assert.equal(forms(tree,'receive-clinic-result').length,0,'No duplicate per-test recording');
 const selected=bulk[0].findAllByType('input').filter(input=>input.props.name==='valueIds');
 assert.deepEqual(selected.map(input=>input.props.value),values.slice(0,4).map(value=>value.id),'All and only complete matching values are submitted');
 assert.ok(selected.every(input=>input.props.type==='hidden'),'No per-value ticking on the quick path');
 assert.equal(bulk[0].findAllByType('input').find(input=>input.props.name==='sourceChecked')!.props.value,'on');
 assert.equal(bulk[0].findAllByType('textarea').filter(input=>input.props.name).length,0,'No separate note entry on the quick path');
 assert.equal(flatten(bulk[0].findByType('button').children),({en:'Record',hy:'Գրանցել',ru:'Записать'})[locale]);
 const body=text(tree);
 assert.ok(body.includes(({en:'Recorded from confirmed lab values',hy:'Գրանցված է հաստատված լաբորատոր արժեքներից',ru:'Записано из подтверждённых лабораторных значений'})[locale]));
 assert.ok(body.includes(source.fileName));
 for(const value of values.slice(0,4))assert.ok(body.includes(`${value.name}: ${value.valueText}`),'Preview shows the actual values');
 assert.doesNotMatch(body,/c1ad0000|NRN-CLIN-ALG|yellow|Generate the required tests/);
 assert.ok(body.includes(({en:'Done 0 of 10',hy:'Պատրաստ է 0-ը 10-ից',ru:'Готово 0 из 10'})[locale]));
 assert.equal(body.split(({en:'Not in this file — still needed',hy:'Այս ֆայլում չկա․ դեռ անհրաժեշտ է',ru:'В этом файле нет, ещё требуется'})[locale]).length-1,8);
 assert.ok(body.includes(({en:'Missing: hba1c',hy:'Բացակայում է՝ hba1c',ru:'Не хватает: hba1c'})[locale]));
 assert.equal(calls.length,0,'Mounting never auto-records');
 await act(async()=>bulk[0].props.onSubmit({preventDefault(){},currentTarget:formPayload(bulk[0])}));
 assert.equal(calls.length,1,'One press sends one command');
 assert.equal(calls[0].get('operation'),'receive-all-clinic-results');
 assert.equal(calls[0].get('attachmentId'),source.attachmentId);
 assert.deepEqual(calls[0].getAll('valueIds'),values.slice(0,4).map(v=>v.id));
 assert.equal(calls[0].get('sourceChecked'),'on','The action boundary converts on to true');
 assert.equal(calls[0].get('note'),({en:`Recorded from doctor-confirmed lab values of ${source.fileName}`,hy:`Գրանցված է ${source.fileName} ֆայլի՝ բժշկի հաստատած լաբորատոր արժեքներից`,ru:`Записано из подтверждённых врачом лабораторных значений файла ${source.fileName}`})[locale]);
 assert.equal(calls[0].get('testId'),null,'The server determines covered tests');
 await act(async()=>tree.unmount());
 const manualTree=await mount(locale);
 await act(async()=>edit(manualTree,locale).props.onToggle({currentTarget:{open:true}}));
 const manualForm=forms(manualTree,'receive-all-clinic-results')[0];
 const checkbox=manualForm.findAllByType('input').find(input=>input.props.name==='valueIds')!;
 await act(async()=>checkbox.props.onChange({target:{checked:false}}));
 assert.ok(manualForm.findByType('button').props.disabled,'Manual path still blocks an incomplete selected panel');
 await act(async()=>checkbox.props.onChange({target:{checked:true}}));
 const manualPayload=formPayload(manualForm);manualPayload.set('sourceChecked','on');manualPayload.set('note','Checked manually');
 await act(async()=>manualForm.props.onSubmit({preventDefault(){},currentTarget:manualPayload}));
 assert.equal(calls.length,2,'Manual recording works in every locale');
 assert.equal(calls[1].get('note'),'Checked manually');
 assert.deepEqual(calls[1].getAll('valueIds'),values.slice(0,4).map(v=>v.id));
 await act(async()=>manualTree.unmount());
}
calls.length=0;
for(const collectedOn of ['2023-11-08','','2099-01-01']){
 const dated=await mount('en',[{...source,values:values.map(value=>({...value,collectedOn}))}]);
 assert.equal(forms(dated,'receive-all-clinic-results').length,0,'Old, undated and future values cannot be recorded');
 await act(async()=>dated.unmount());
}
const tsh={...source,attachmentId:id(31),fileId:id(21),fileName:'thyroid.pdf',values:[{...values[0],id:id(80),name:'TSH'}]};
const tree=await mount('en',[source,tsh]);
assert.equal(forms(tree,'receive-all-clinic-results').length,2,'Each file has its own Record action');
for(const form of forms(tree,'receive-all-clinic-results')){
 const attachment=form.findAllByType('input').find(i=>i.props.name==='attachmentId')!.props.value;
 assert.deepEqual(form.findAllByType('input').filter(i=>i.props.name==='valueIds').map(i=>i.props.value),attachment===source.attachmentId?values.slice(0,4).map(v=>v.id):[id(80)],'No values cross attachment boundaries');
}
await act(async()=>edit(tree).props.onToggle({currentTarget:{open:true}}));
const manual=forms(tree,'receive-all-clinic-results')[0];
assert.equal(manual.findAllByType('input').filter(i=>i.props.name==='valueIds'&&i.props.type==='checkbox').length,4);
const confirmation=manual.findAllByType('input').find(i=>i.props.name==='sourceChecked')!;
assert.ok(confirmation.props.required&&!confirmation.props.checked&&!confirmation.props.defaultChecked,'Manual source check is still explicit');
assert.equal(manual.findAllByType('textarea').filter(i=>i.props.name==='note'&&i.props.required).length,1);
const payload=formPayload(manual);payload.set('note','Checked synthetic clinic document');payload.set('sourceChecked','on');
await act(async()=>manual.props.onSubmit({preventDefault(){},currentTarget:payload}));
assert.equal(calls.length,1,'Manual action remains available');
assert.equal(calls[0].get('note'),'Checked synthetic clinic document');
assert.equal(calls[0].get('id'),id(1));
assert.equal(calls[0].get('revision'),'1');
assert.equal(calls[0].get('token'),'a'.repeat(32));
await act(async()=>tree.unmount());
console.log('Mounted en/hy/ru Required results: one press per file, complete matching IDs, checked source, automatic note, uncovered tests and manual selection. Action boundary mocked.');

// An approved member-imported file obeys the same eligibility and row filtering.
const reportId=id(95),report={id:reportId,revision:1,state:'confirmed',confirmedAt:today+'T00:00:00Z',reviewed:{personName:null,laboratory:'Synthetic lab',reportDate:today,summary:'',warnings:[],rows:values.slice(0,4).map(value=>({name:value.name,literal:value.valueText,unit:value.unit,reference:null,page:1,snippet:'Synthetic',uncertain:false}))}};
const imported={...snapshot,evidence:{...snapshot.evidence,reports:[report]},review:{...snapshot.review!,approvals:{[reportId]:{revision:1,actorId:id(4),at:today+'T00:00:00Z'}}}};
const reportTree=await mount('en',[],imported);
assert.equal(forms(reportTree,'receive-result').length,1,'Approved lipid report is offered only for the lipid test');
assert.deepEqual(forms(reportTree,'receive-result')[0].findAllByType('input').filter(input=>input.props.name==='rows').map(input=>input.props.value),[1,2,3,4]);
assert.ok(forms(reportTree,'receive-result')[0].findAllByType('input').filter(input=>input.props.name==='rows').every(input=>input.props.checked));
assert.doesNotMatch(text(reportTree),new RegExp(reportId),'File references are not exposed as names');
await act(async()=>reportTree.unmount());
const oldReport=await mount('en',[],{...imported,evidence:{...imported.evidence,reports:[{...report,reviewed:{...report.reviewed,reportDate:'2023-11-08'}}]}});
assert.match(text(oldReport),/Dated before the questionnaire/);
assert.equal(forms(oldReport,'receive-result').length,0);
await act(async()=>oldReport.unmount());
// If bulk replaces a current HbA1c receipt from another file, its confirmation
// lists HbA1c too, alongside the missing paired test. No undisclosed replacements.
const hba={...values[0],id:id(81),name:'HbA1c'};
const pairSource={...source,values:[...values,hba]};
const previous={...source,attachmentId:id(32),values:[{...hba,id:id(82)}]};
const paired={...snapshot,review:{...snapshot.review!,engine:{...snapshot.review!.engine,tests:[{id:'hba1c',title:'HbA1c',method:'lab' as const},{id:'hba1c-glucose',title:'HbA1c and fasting glucose',method:'lab' as const}]},receipts:{hba1c:{source:'clinic-lab' as const,attachmentId:previous.attachmentId,values:previous.values,note:'Previous checked receipt',actorId:id(4),at:today+'T00:00:00Z'}}}};
const replacing=await mount('en',[pairSource,previous],paired);
assert.match(text(replacing),/Done 1 of 2/);
assert.match(text(replacing),/Matched tests: HbA1c, HbA1c and fasting glucose/);
assert.match(text(replacing),/Any previous receipt for them will be replaced/);
await act(async()=>replacing.unmount());
console.log('Imported reports also filter by identity/date; bulk explicitly lists every replacement.');

// A legacy wrong receipt must not trap the doctor: show a valid replacement source.
const thyroidReport={...report,id:id(96),reviewed:{...report.reviewed,rows:[{...report.reviewed.rows[0],name:'TSH'}]}};
const staleImported={...imported,evidence:{...imported.evidence,reports:[report,thyroidReport]},review:{...imported.review!,approvals:{...imported.review!.approvals,[thyroidReport.id]:{revision:1,actorId:id(4),at:today+'T00:00:00Z'}},receipts:{tsh:{reportId,reportRevision:1,rows:[0,1,2,3],actorId:id(4),at:today+'T00:00:00Z',note:'Legacy mismatched receipt'}}}};
const recovery=await mount('en',[],staleImported);
assert.match(text(recovery),/Historical receipt/);
const thyroidForm=forms(recovery,'receive-result').find(form=>form.findAllByType('input').some(input=>input.props.name==='testId'&&input.props.value==='tsh'));
assert.ok(thyroidForm,'A stale report receipt exposes a replacement form');
assert.deepEqual(thyroidForm.findAllByType('option').map(option=>option.props.value),[thyroidReport.id]);
assert.deepEqual(thyroidForm.findAllByType('input').filter(input=>input.props.name==='rows').map(input=>input.props.value),[1]);
await act(async()=>recovery.unmount());
// The server permits an additional source row alongside a complete panel.
const extraReport={...report,reviewed:{...report.reviewed,rows:[...report.reviewed.rows,{...report.reviewed.rows[0],name:'Appearance',literal:'Clear',unit:null}]}};
const withExtra={...imported,evidence:{...imported.evidence,reports:[extraReport]},review:{...imported.review!,receipts:{'lipid-panel':{reportId,reportRevision:1,rows:[0,1,2,3,4],actorId:id(4),at:today+'T00:00:00Z',note:'Checked complete panel and extra source row'}}}};
const fullReceipt=await mount('en',[],withExtra);
assert.match(text(fullReceipt),/Done 1 of 10/,'An extra unrelated row does not invalidate a complete matched panel');
assert.match(text(fullReceipt),/Current receipt\./);
await act(async()=>fullReceipt.unmount());
console.log('Legacy report receipts allow replacement; complete panels with extra source rows stay current.');

// A file can belong to the test's row without being a complete investigation.
for(const [test,names,missing]of [
 ['cbc-hb',['WBC'],'hemoglobin'],['cbc-hb',['Platelets'],'hemoglobin'],
 ['creatinine-egfr',['Creatinine'],'egfr'],['insulin-homa',['Insulin'],'homa ir'],
]as const){
 const partialSource={...source,values:names.map((name,index)=>({...values[index],name}))};
 const onlyTest={...snapshot,review:{...snapshot.review!,engine:{...snapshot.review!.engine,tests:[{id:test,title:test,method:'lab' as const}]}}};
 const partial=await mount('en',[partialSource],onlyTest);
 assert.match(text(partial),new RegExp(`Missing: ${missing}`),`${test} explains its missing component`);
 assert.equal(forms(partial,'receive-clinic-result').length+forms(partial,'receive-all-clinic-results').length,0,'Incomplete files offer no record action');
 const legacy={...onlyTest,review:{...onlyTest.review,receipts:{[test]:{source:'clinic-lab' as const,attachmentId:source.attachmentId,values:partialSource.values,note:'Legacy partial',actorId:id(4),at:today+'T00:00:00Z'}}}};
 await act(async()=>partial.unmount());
 const historical=await mount('en',[partialSource],legacy);
 assert.match(text(historical),/Done 0 of 1/);
 assert.match(text(historical),/Historical receipt/);
 await act(async()=>historical.unmount());
}
for(const test of ['cbc-hb','urinalysis']){
 const unavailable=await mount('en',[{...source,values:[{...values[0],name:test==='cbc-hb'?'Hemoglobin':'Urinalysis'}]}],{...snapshot,review:{...snapshot.review!,engine:{...snapshot.review!.engine,tests:[{id:test,title:test,method:'lab' as const}]}}});
 assert.match(text(unavailable),/Panel completeness is not defined in the catalogue/);
 assert.equal(forms(unavailable,'receive-all-clinic-results').length+forms(unavailable,'receive-clinic-result').length,0);
 await act(async()=>unavailable.unmount());
}
console.log('Partial panels show missing components, offer no record action and legacy partial receipts stay historical. Undefined completeness fails closed.');

// Changing the selected set must immediately withdraw an incomplete panel.
for(const [test,names,missing]of [
 ['creatinine-egfr',['Creatinine','eGFR'],'egfr'],['insulin-homa',['Insulin','HOMA-IR'],'homa ir'],
]as const){
 const completeSource={...source,values:names.map((name,index)=>({...values[index],name}))};
 const onlyTest={...snapshot,review:{...snapshot.review!,engine:{...snapshot.review!.engine,tests:[{id:test,title:test,method:'lab' as const}]}}};
 const complete=await mount('en',[completeSource],onlyTest);
 await act(async()=>edit(complete).props.onToggle({currentTarget:{open:true}}));
 const component=complete.root.findAllByType('input').filter(input=>input.props.name==='valueIds')[1];
 assert.equal(typeof component.props.onChange,'function','Checkbox selection must update the panel preview');
 await act(async()=>component.props.onChange({target:{checked:false}}));
 assert.match(text(complete),new RegExp(`Missing: ${missing}`));
 assert.ok(forms(complete,'receive-all-clinic-results')[0].findByType('button').props.disabled,'No complete selected test can be recorded');
 assert.doesNotMatch(text(complete),new RegExp(`Matched tests: ${test}`));
 await act(async()=>component.props.onChange({target:{checked:true}}));
 assert.equal(forms(complete,'receive-all-clinic-results')[0].findByType('button').props.disabled,false,'Reselecting the missing component restores recording');
 await act(async()=>complete.unmount());
 const importedPair={...onlyTest,evidence:{...onlyTest.evidence,reports:[{...report,reviewed:{...report.reviewed,rows:completeSource.values.map(v=>({...report.reviewed.rows[0],name:v.name}))}}]},review:{...onlyTest.review,approvals:imported.review!.approvals}};
 const pair=await mount('en',[],importedPair);
 const row=forms(pair,'receive-result')[0].findAllByType('input').filter(input=>input.props.name==='rows')[1];
 assert.equal(typeof row.props.onChange,'function');
 await act(async()=>row.props.onChange({target:{checked:false}}));
 assert.match(text(pair),new RegExp(`Missing: ${missing}`));
 assert.ok(forms(pair,'receive-result')[0].findByType('button').props.disabled,'A deselected report component blocks recording');
 await act(async()=>pair.unmount());
}

// A per-test form from a second clinic file follows the same selected-set gate.
const kidneySource={...source,attachmentId:id(35),values:['Creatinine','eGFR'].map((name,index)=>({...values[index],name}))};
const kidneyOnly={...snapshot,review:{...snapshot.review!,engine:{...snapshot.review!.engine,tests:[{id:'creatinine-egfr',title:'Kidney test',method:'lab' as const}]}}};
const single=await mount('en',[tsh,kidneySource],kidneyOnly);
await act(async()=>edit(single).props.onToggle({currentTarget:{open:true}}));
const singleForm=forms(single,'receive-all-clinic-results')[0];
const egfr=singleForm.findAllByType('input').filter(input=>input.props.name==='valueIds')[1];
await act(async()=>egfr.props.onChange({target:{checked:false}}));
assert.match(text(single),/Missing: egfr/);
assert.ok(forms(single,'receive-all-clinic-results')[0].findByType('button').props.disabled);
await act(async()=>single.unmount());
console.log('Selected component changes recalculate bulk matches and block incomplete single clinic/report recording.');

// Consultation defaults use the real mounted controls and their explicit submit handler.
for(const locale of ['en','hy','ru'] as const){
 const data=structuredClone(snapshot);data.review!.engine={...data.review!.engine,urgency:'green',tests:[]};
 const proposal={decision:'not-required' as const,note:'No consultation is needed.'};
 const props={snapshot:data,requestId:id(90),section:'treatment' as const,locale,consultationProposal:proposal};
 let tree!:ReturnType<typeof create>;
 await act(async()=>{tree=create(React.createElement(RealReviewControls,props));});
 const form=()=>forms(tree,'consultation-decision')[0];
 const attribution=staffLocaleCopy.st(locale,"Zoe's proposal",'Զոյայի առաջարկը','Предложение Zoe');
 assert.equal(form().findByType('select').props.value,'not-required');
 assert.equal(form().findByType('textarea').props.value,'No consultation is needed.');
 assert.ok(text(tree).includes(attribution));
 const before:number=calls.length;
 const submit=async()=>{
  const values=new FormData();
  for(const node of form().findAll(node=>['input','select','textarea'].includes(String(node.type))&&!!node.props.name))values.set(node.props.name,String(node.props.value??''));
  await act(async()=>form().props.onSubmit({preventDefault(){},currentTarget:values}));
 };
 assert.equal(calls.length,before,'Rendering never saves a doctor decision');
 await submit();
 assert.equal(calls.length,before+1,'One press sends one command');
 assert.equal(calls.at(-1)!.get('decision'),'not-required');
 assert.equal(calls.at(-1)!.get('note'),'No consultation is needed.');
 await act(async()=>{tree.unmount();tree=create(React.createElement(RealReviewControls,props));});
 await act(async()=>form().findByType('select').props.onChange({target:{value:'required'}}));
 assert.ok(!text(tree).includes(attribution),'An override clears the proposal label');
 await act(async()=>form().findByType('textarea').props.onChange({target:{value:'Doctor override reason'}}));
 await submit();
 assert.equal(calls.at(-1)!.get('decision'),'required');
 assert.equal(calls.at(-1)!.get('note'),'Doctor override reason');
 await act(async()=>tree.unmount());
 // Reason edits must not protect an untouched automatic decision on the same evidence token.
 for(const withdrawal of ['missing','abnormal'] as const)for(const edit of ['reason','untouched','decision','both'] as const){
  await act(async()=>{tree=create(React.createElement(RealReviewControls,props));});
  const decisionEdited=edit==='decision'||edit==='both',reasonEdited=edit==='reason'||edit==='both';
  if(decisionEdited)await act(async()=>form().findByType('select').props.onChange({target:{value:edit==='both'?'required':'not-required'}}));
  if(reasonEdited)await act(async()=>form().findByType('textarea').props.onChange({target:{value:'Doctor-entered reason'}}));
  const withdrawn=structuredClone(data);
  if(withdrawal==='abnormal'){
   withdrawn.review!.engine.tests=[{id:'ecg-12-lead',title:'ECG',method:'clinic'}];
   withdrawn.review!.evidenceReceipts={'ecg-12-lead':{source:'investigation',sourceId:id(8),actorId:id(4),at:today,snapshot:{result:'abnormal'}}};
  }
  await act(async()=>tree.update(React.createElement(RealReviewControls,{...props,snapshot:withdrawn,consultationProposal:withdrawal==='missing'?null:proposal})));
  assert.equal(form().findByType('select').props.value,decisionEdited?(edit==='both'?'required':'not-required'):'',`${withdrawal}/${edit}: only a doctor-chosen decision survives withdrawal`);
  assert.equal(form().findByType('textarea').props.value,reasonEdited?'Doctor-entered reason':'',`${withdrawal}/${edit}: only an edited reason survives withdrawal`);
  assert.equal(form().findByType('button').props.disabled,!(decisionEdited&&reasonEdited),'Incomplete decisions disable Save');
  const beforeWithdrawalSubmit:number=calls.length;
  await submit();
  assert.equal(calls.length,beforeWithdrawalSubmit+(decisionEdited&&reasonEdited?1:0),'Withdrawal cannot submit an untouched automatic decision');
  if(decisionEdited&&reasonEdited)assert.equal(calls.at(-1)!.get('decision'),'required');
  await act(async()=>tree.unmount());
 }
 for(const state of ['missing','yellow','orange','urgent','abnormal','saved'] as const){
  const blocked=structuredClone(data);
  if(state==='yellow'||state==='orange')blocked.review!.engine.urgency=state;
  if(state==='saved')blocked.review!.consultation={decision:'not-required',note:'Doctor saved reason'};
  if(state==='abnormal'){
   blocked.review!.engine.tests=[{id:'ecg-12-lead',title:'ECG',method:'clinic'}];
   blocked.review!.evidenceReceipts={'ecg-12-lead':{source:'investigation',sourceId:id(8),actorId:id(4),at:today,snapshot:{result:'abnormal'}}};
  }
  await act(async()=>{tree=create(React.createElement(RealReviewControls,{...props,snapshot:blocked,urgent:state==='urgent',consultationProposal:state==='missing'?null:proposal}));});
  assert.equal(form().findByType('select').props.value,'',state+' has no proposed decision');
  assert.equal(form().findByType('textarea').props.value,'',state+' has no proposed reason');
  await act(async()=>tree.unmount());
 }
}
console.log('Mounted consultation controls: one explicit save with exact proposal, override and unsafe/unknown defaults in en/hy/ru (controlled IO).');
// Edit selection must not remount the command or its uncontrolled manual inputs.
const retained=await mount();
const retainedForm=forms(retained,'receive-all-clinic-results')[0];
await act(async()=>edit(retained).props.onToggle({currentTarget:{open:true}}));
const retainedNote=retainedForm.findByType('textarea');
const retainedCheck=retainedForm.findAllByType('input').find(input=>input.props.name==='valueIds')!;
await act(async()=>retainedCheck.props.onChange({target:{checked:false}}));
await act(async()=>edit(retained).props.onToggle({currentTarget:{open:false}}));
assert.equal(forms(retained,'receive-all-clinic-results')[0],retainedForm,'Toggling retains submission state');
assert.equal(retainedForm.findByType('textarea'),retainedNote,'Closing retains the same uncontrolled note input and its text');
await act(async()=>edit(retained).props.onToggle({currentTarget:{open:true}}));
assert.equal(retainedForm.findByType('textarea'),retainedNote,'Reopening keeps the edited note input');
assert.equal(retainedCheck.props.checked,false,'Manual selection survives close and reopen');
await act(async()=>retained.unmount());

calls.length=0;
let finishCommand!:(result:CommandResult)=>void;
commandWait=new Promise(resolve=>{finishCommand=resolve;});
const saving=await mount();
const savingForm=forms(saving,'receive-all-clinic-results')[0];
await act(async()=>savingForm.props.onSubmit({preventDefault(){},currentTarget:formPayload(savingForm)}));
assert.equal(calls.length,1);
assert.ok(savingForm.findAllByType('button')[0].props.disabled,'A pending save is disabled');
await act(async()=>edit(saving).props.onToggle({currentTarget:{open:true}}));
assert.equal(forms(saving,'receive-all-clinic-results')[0],savingForm,'The pending command stays mounted');
assert.ok(savingForm.findAllByType('button')[0].props.disabled,'Manual mode cannot bypass a pending save');
await act(async()=>savingForm.props.onSubmit({preventDefault(){},currentTarget:formPayload(savingForm)}));
assert.equal(calls.length,1,'Toggling never starts a second pending write');
await act(async()=>finishCommand({ok:false,uncertain:true,message:'The result could not be confirmed.'}));
commandWait=null;
assert.ok(savingForm.findAllByProps({role:'alert'}).length,'Uncertain-outcome guidance is visible');
await act(async()=>edit(saving).props.onToggle({currentTarget:{open:false}}));
assert.ok(savingForm.findAllByType('button')[0].props.disabled,'Quick mode cannot bypass the required refresh');
assert.ok(savingForm.findAllByProps({role:'alert'}).length,'Toggling keeps uncertain-outcome guidance');
await act(async()=>savingForm.props.onSubmit({preventDefault(){},currentTarget:formPayload(savingForm)}));
assert.equal(calls.length,1,'An uncertain outcome still requires refresh after toggling');
await act(async()=>saving.unmount());
console.log('Disclosure toggles retain manual inputs, pending save state and uncertain-outcome guards.');

// Never combine incomplete panels across files or show quick actions with stale requirements.
const split=await mount('en',[{...source,values:values.slice(0,2)},{...tsh,values:values.slice(2,4)}]);
assert.equal(forms(split,'receive-all-clinic-results').length,0,'A panel split over files is not a complete source');
await act(async()=>split.unmount());
const stale=await mount('en',[source],{...snapshot,evidenceToken:'changed'});
assert.equal(forms(stale,'receive-all-clinic-results').length,0,'Stale clinical requirements must be prepared explicitly');
await act(async()=>stale.unmount());
const oversized=await mount('en',[{...tsh,values:Array.from({length:101},(_,n)=>({...tsh.values[0],id:id(100+n),seq:n+1}))}]);
assert.ok(forms(oversized,'receive-all-clinic-results')[0].findByType('button').props.disabled,'The quick path respects the server maximum of 100 values');
assert.match(text(oversized),/no more than 100/);
await act(async()=>oversized.unmount());

// Opening Evidence rereads the route; it must never prepare or write a review.
const {CaseSections,CaseTabs}=load('components/staff/case-sections.tsx') as typeof import('../components/staff/case-sections');
let tabs!:ReturnType<typeof create>;
await act(async()=>{tabs=create(React.createElement(CaseSections,null,React.createElement(CaseTabs)));});
const tab=(label:string)=>tabs.root.findAllByType('button').find(button=>flatten(button.children)===label)!;
routeRefreshes=0;
await act(async()=>tab('Evidence').props.onClick());
assert.equal(routeRefreshes,1,'Opening Evidence re-reads current lab sources');
assert.equal(tab('Evidence').props['aria-pressed'],true);
await act(async()=>tab('Evidence').props.onClick());
assert.equal(routeRefreshes,1,'Staying on Evidence does not create a refresh loop');
await act(async()=>tab('Overview').props.onClick());
await act(async()=>tab('Evidence').props.onClick());
assert.equal(routeRefreshes,2,'Reopening Evidence re-reads values confirmed elsewhere');
await act(async()=>tabs.unmount());
console.log('Evidence tab re-reads on open without polling or preparing a review.');
