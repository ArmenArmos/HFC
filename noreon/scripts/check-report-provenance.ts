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
const extraModules:Record<string,unknown>={};
for(const path of ['@/lib/patient-care/consultation-proposal','./use-consultation-decision','@/lib/patient-care/action-timeout','./clinical-summary','./urgent-publication'])extraModules[path]=await import(path.startsWith('./')?'@/components/real-review/'+path.slice(2):path);
function load(path:string):Record<string,unknown>{
 const exports={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new vm.Script(code).runInNewContext({exports,require(name:string){if(name==='@/lib/patient-care/required-lab-match')return requiredLabMatch;if(name in extraModules)return extraModules[name];
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/components/staff/record-refresh')return load('components/staff/record-refresh.tsx');
  if(name==='lucide-react')return require(name);
  if(name==='next/navigation')return {unstable_rethrow:require('next/navigation').unstable_rethrow,useRouter:()=>({refresh(){}})};
  if(name==='@/lib/patient-care/clinical-review-actions')return {checkRealClinicalCaseAvailability:async()=>({ok:true,message:''}),realClinicalCommand:async()=>({ok:false,message:'Deferred action boundary'})};
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
const reportId='b4f53448-927f-46c5-b936-9baec2e0e00c',actorId='d118a1a4-54d3-47c1-a4ab-887ebca84881';
const snapshot:ClinicalSnapshot={id:'78e98173-e740-40b2-bbfe-2c8edc6dfa07',revision:7,evidenceToken:'current',draft:null,draftSavedAt:null,draftStale:false,
 evidence:{visits:[],profile:{name:'Fictional member',birthDate:null,biologicalSex:null},consent:null,assessment:{revision:1,answers:{},urgent_rule:null,completed_at:'2026-10-14T08:00:00Z'},measurements:[],reports:[{id:reportId,revision:2,state:'confirmed',confirmedAt:'2026-10-14T09:00:00Z',reviewed:{personName:null,laboratory:'Fictional laboratory',reportDate:'2026-10-14',summary:'',warnings:[],rows:[{name:'HbA1c',literal:'1',unit:null,reference:null,page:1,snippet:'',uncertain:false}]}}]},
 review:{evidenceToken:'current',doctorId:actorId,preparedAt:'2026-10-14T09:30:00Z',engine:{version:'test',urgency:'green',tests:[{id:'hba1c',title:'Example required test',method:'lab'}]},approvals:{[reportId]:{revision:2,actorId,at:'2026-10-14T10:00:00Z'}},receipts:{'hba1c':{reportId,reportRevision:2,rows:[0],actorId,at:'2026-10-14T11:00:00Z',note:'Checked example row.'}},consultation:{decision:'undecided'}}};
async function render(s:ClinicalSnapshot,clinicLab:Parameters<typeof RealReviewControls>[0]['clinicLab']=null){let tree!:ReturnType<typeof create>;await act(async()=>{tree=create(React.createElement(RealReviewControls,{snapshot:s,requestId:'request',section:undefined,clinicLab}));});return tree;}
function text(tree:ReturnType<typeof create>){
 const flatten=(node:unknown):string=>typeof node==='string'?node:Array.isArray(node)?node.map(flatten).join(''):node&&typeof node==='object'&&'children' in node?flatten(node.children):'';
 return flatten(tree.toJSON());
}
let tree=await render(snapshot);
assert.match(text(tree),/Member confirmed/,'The source confirmation time is visible');
assert.match(text(tree),/Current approval/);
assert.match(text(tree),new RegExp(actorId));
assert.match(text(tree),/2026-10-14T09:00:00Z/);
assert.match(text(tree),/2026-10-14T10:00:00Z/);
assert.match(text(tree),/2026-10-14T11:00:00Z/);
assert.match(text(tree),/Source rows: 1/,'Stored zero-based rows are displayed as one-based rows');
assert.equal(tree.root.findAllByType('a')[0].props.href,`/staff/real/members/${snapshot.id}/reports/${reportId}`);
assert.ok(tree.root.findAllByType('input').some(input=>input.props.name==='operation'&&input.props.value==='prepare'));
assert.ok(tree.root.findAllByType('input').some(input=>input.props.name==='operation'&&input.props.value==='publish'),'Current review retains publication command');
await act(async()=>tree.unmount());
for(const changed of [
 {...snapshot,evidenceToken:'changed'},
 {...snapshot,review:{...snapshot.review!,doctorId:'fa6f9bfd-970c-4541-81ed-4c4b81a427e1'}},
 {...snapshot,evidence:{...snapshot.evidence,reports:[{...snapshot.evidence.reports[0],reviewed:null}]}},
 {...snapshot,evidence:{...snapshot.evidence,reports:[{...snapshot.evidence.reports[0],revision:3}]}},
 {...snapshot,evidence:{...snapshot.evidence,reports:[{...snapshot.evidence.reports[0],state:'review'}]}},
 {...snapshot,evidence:{...snapshot.evidence,reports:[{...snapshot.evidence.reports[0],confirmedAt:null}]}},
]){
 tree=await render(changed);
 assert.match(text(tree),/Historical approval/);
 assert.doesNotMatch(text(tree),/Current approval/);
 assert.match(text(tree),/Historical receipt/);
 assert.match(text(tree),new RegExp(actorId),'Historical actors remain visible');
 assert.match(text(tree),/Checked example row/);
 if(changed.evidenceToken!=='current')assert.equal(tree.root.findAllByType('input').filter(input=>input.props.name==='operation'&&input.props.value!=='prepare').length,0,'Stale review never exposes mutation actions');
 await act(async()=>tree.unmount());
}
tree=await render({...snapshot,review:{...snapshot.review!,receipts:{'hba1c':{...snapshot.review!.receipts['hba1c'],reportRevision:1}}}});
assert.match(text(tree),/Current approval/,'Current approval does not make a receipt for another revision current');
assert.match(text(tree),/Historical receipt/);
assert.doesNotMatch(text(tree),/Current receipt/);
await act(async()=>tree.unmount());
const withoutApproval={...snapshot,review:{...snapshot.review!,approvals:{},receipts:{}}};
tree=await render(withoutApproval);
assert.ok(tree.root.findAllByType('input').some(input=>input.props.name==='operation'&&input.props.value==='approve-report'),'Missing approval retains approval action');
assert.match(text(tree),/Approve a confirmed source report before recording this result/);
await act(async()=>tree.unmount());
tree=await render({...snapshot,review:{...snapshot.review!,receipts:{}}});
assert.ok(tree.root.findAllByType('input').some(input=>input.props.name==='operation'&&input.props.value==='receive-result'),'Approved source retains result receipt action');
assert.equal(tree.root.findAllByType('select').find(select=>select.props.name==='reportId')?.props.value,reportId);
assert.equal(tree.root.findAllByType('input').find(input=>input.props.name==='reportRevision')?.props.value,2);
await act(async()=>tree.unmount());
tree=await render({...snapshot,review:null});
assert.match(text(tree),/No approval recorded/);
assert.doesNotMatch(text(tree),new RegExp(actorId),'Absent actors are never fabricated');
await act(async()=>tree.unmount());
// QA 174: with no member report, a doctor-confirmed clinic lab result is offered as the source, and its receipt shows.
const attachmentId='0c1ab000-0000-4000-8000-000000000031',valueId='0c1ab000-0000-4000-8000-000000000051';
const value={id:valueId,seq:1,reviewedAt:'2026-10-29T20:00:00+00:00',name:'HbA1c',valueText:'2.9',value:2.9,unit:'mmol/L',reference:'< 3.0',collectedOn:'2026-10-29',laboratory:'Fictional clinic lab'};
const clinicLab=[{attachmentId,fileId:'0c1ab000-0000-4000-8000-000000000021',fileName:'fictional-lipids.pdf',clinic:'Fictional clinic',attachedAt:'2026-10-29T19:00:00+00:00',values:[value]}];
const noReports={...snapshot,evidence:{...snapshot.evidence,assessment:{revision:1,answers:{},urgent_rule:null,completed_at:'2026-10-28T10:00:00Z'},reports:[]},review:{...snapshot.review!,engine:{...snapshot.review!.engine,tests:[{id:'hba1c',title:'HbA1c',method:'lab' as const}]},approvals:{},receipts:{}}};
tree=await render(noReports,[]);
assert.match(text(tree),/No reports imported by the member. Lab results from a clinic are not listed here/);
assert.match(text(tree),/No source for this result yet/);
await act(async()=>tree.unmount());
tree=await render(noReports,null);
assert.match(text(tree),/Clinic lab results could not be read/);
await act(async()=>tree.unmount());
tree=await render(noReports,clinicLab);
assert.ok(tree.root.findAllByType('input').some(input=>input.props.name==='operation'&&input.props.value==='receive-all-clinic-results'),'Clinic lab receipt form offered');
assert.ok(tree.root.findAllByType('input').some(input=>input.props.name==='valueIds'&&input.props.value===valueId),'Confirmed value selectable');
assert.match(text(tree),/HbA1c: 2.9 mmol\/L/);
await act(async()=>tree.unmount());
const clinicReceipt={source:'clinic-lab' as const,attachmentId,values:[value],note:'Checked the clinic sheet.',actorId,at:'2026-10-29T20:05:00+00:00'};
tree=await render({...noReports,review:{...noReports.review,receipts:{'hba1c':clinicReceipt}}},clinicLab);
assert.match(text(tree),/Current receipt from a clinic lab result/);
assert.ok(!tree.root.findAllByType('input').some(input=>input.props.name==='operation'&&input.props.value==='receive-all-clinic-results'),'A current receipt is not offered again');
await act(async()=>tree.unmount());
tree=await render({...noReports,review:{...noReports.review,receipts:{'hba1c':clinicReceipt}}},[{...clinicLab[0],values:[{...value,valueText:'3.1',value:3.1,reviewedAt:'2026-10-29T21:00:00+00:00'}]}]);
assert.match(text(tree),/Historical receipt. A received clinic value changed/);
assert.ok(tree.root.findAllByType('input').some(input=>input.props.name==='operation'&&input.props.value==='receive-all-clinic-results'),'A stale clinic receipt can be recorded again');
await act(async()=>tree.unmount());
console.log('Report provenance shows source, actors, linked receipts and historical status without enabling stale actions.');
