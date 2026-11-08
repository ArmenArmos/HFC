import * as requiredLabMatch from '../lib/patient-care/required-lab-match';
/** Real review component; controlled action state, no Auth/DB/provider calls. */
import assert from 'node:assert/strict';
import * as regimenModule from '../lib/patient-care/regimen';
import {isClinicLabReceipt} from '../lib/patient-care/clinical-review-schema';
import * as staffLocaleCopy from '../lib/staff/staff-locale-copy';import * as staffServerCopy from '../lib/staff/staff-server-copy';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import * as icons from 'lucide-react';
import {renderToStaticMarkup} from 'react-dom/server';
import type {ClinicalSnapshot} from '../lib/patient-care/clinical-case-repository';
import {selectFieldNativeStub} from './select-field-native-stub';
import * as realLocaleModule from '@/lib/locale';

let state={ok:false,message:'The evidence or assignment changed. Reload and review.'};
const extraModules:Record<string,unknown>={};
for(const path of ['@/lib/patient-care/consultation-proposal','./use-consultation-decision','@/lib/patient-care/action-timeout','./clinical-summary','./urgent-publication'])extraModules[path]=await import(path.startsWith('./')?'@/components/real-review/'+path.slice(2):path);
function load(path:string):Record<string,unknown>{
const exports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new vm.Script(code).runInNewContext({exports,require(name:string){if(name==='@/lib/patient-care/required-lab-match')return requiredLabMatch;if(name in extraModules)return extraModules[name];
  if(name==='react')return {...React,useActionState:()=>[state,()=>{},false]};
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/components/staff/record-refresh')return load('components/staff/record-refresh.tsx');
  if(name==='lucide-react')return icons;
  if(name==='next/navigation')return {useRouter:()=>({refresh(){}})};
  if(name.endsWith('/clinical-review-actions'))return {realClinicalCommand(){throw Error('No action execution in render check');}};
  if(name.endsWith('/reports/schema'))return {extractionSchema:{safeParse:()=>({success:false})}};
  if(name==='./publish-confirmation')return {PublishConfirmation:React.createContext({published:null,set(){}})};
  if(name==='./report-provenance')return {matchingReportRows:()=>[],hasCurrentReportApproval:()=>false,hasCurrentResultReceipt:()=>false,ReportProvenance:()=>null};
  if(name==='@/lib/staff/yerevan-time')return {yerevanStamp:(value:string)=>value,yerevanInputToInstant:()=>null,calendarDate:(value:string)=>value};
  if(name==='@/lib/patient-care/clinical-review-schema')return {isClinicLabReceipt};
  if(name==='@/lib/patient-care/required-evidence')return {hasEvidencePath:()=>false};if(name==='./required-evidence')return {RequiredEvidence:()=>null};
  if(name==='@/components/ui/select-field')return selectFieldNativeStub;if(name==='@/lib/staff/staff-locale-copy')return staffLocaleCopy;if(name==='@/lib/staff/staff-server-copy')return staffServerCopy;if(name==='@/lib/locale')return realLocaleModule;if(name==='./regimen')return {RegimenApproval:()=>null,RegimenEditor:()=>null};if(name==='@/lib/patient-care/regimen')return regimenModule;throw Error(`Unexpected import ${name}`);
}});return exports;
}
const {RealReviewControls}=load('components/real-review/review-controls.tsx') as typeof import('../components/real-review/review-controls');
const snapshot={id:'83000000-0000-4000-8000-000000000001',revision:3,evidenceToken:'a'.repeat(32),draft:{explanation:'Explanation',instructions:'Instructions'},draftStale:false,evidence:{reports:[]},review:{evidenceToken:'a'.repeat(32),engine:{tests:[]},consultation:{decision:'not-required',completedAt:null}}} as unknown as ClinicalSnapshot;
const render=()=>renderToStaticMarkup(React.createElement(RealReviewControls,{snapshot,requestId:'83000000-0000-4000-8000-000000000002',section:'treatment'}));
let html=render();
assert.equal((html.match(/Publication not confirmed/g)||[]).length,1,'Rejected publication needs one distinct, explicit recovery panel');
assert.match(html,/Refresh current case/);
assert.match(html,/The evidence or assignment changed/,'Keep the actionable server reason');
state={ok:false,message:'The response could not be received.'};
html=render();
assert.match(html,/Publication not confirmed/);
assert.doesNotMatch(html,/>Not published</,'An unknown transport outcome must not claim nothing was committed');
state={ok:true,message:'Care plan published.'};
html=render();
assert.doesNotMatch(html,/Publication not confirmed/);
assert.match(html,/Care plan published/);
console.log('Publication feedback distinguishes unconfirmed outcomes, preserves server reasons and offers current-case recovery. Controlled render state only.');

// Draft readiness gates publication only. Doctors must still receive required evidence before saving a draft.
state={ok:false,message:''};
const draftless={...snapshot,draft:null,review:{...snapshot.review!,approvals:{},receipts:{},engine:{...snapshot.review!.engine,tests:[{id:'fixture-lab',title:'Current required laboratory test',method:'lab' as const}]}}};
const evidence=renderToStaticMarkup(React.createElement(RealReviewControls,{snapshot:draftless,requestId:snapshot.id,reviewCurrent:true,draftCurrent:false}));
assert.match(evidence,/Current required laboratory test/,'A current clinical review remains available before the first draft is saved');
assert.match(evidence,/Review and save the draft against the current clinical recommendations before publishing/);
console.log('Draft readiness disables publication while preserving the current review and evidence-receipt controls.');
