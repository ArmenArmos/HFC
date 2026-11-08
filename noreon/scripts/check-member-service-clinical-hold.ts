import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as memberScreens from '@/components/patient-care/member-screens';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as legacyMode from '@/lib/real-booking/legacy-mode';
import * as formError from '@/lib/real-booking/form-error';
import * as rules from '@/lib/clinical/rules/rules';
import * as questionnaire from '@/lib/patient/questionnaire';
import type {MemberBookingData} from '@/lib/real-booking/schema';
import type {PilotBookingData} from '@/lib/real-booking/appointment-schema';
import * as realPatientCopy from '@/lib/patient/copy';
// CP14-F3: actual member service route with the actual hold merge. A pilot source outage must not
// replace a clinical hold that the member's own booking read detected. Child rendering and IO isolated.
const program=[{id:'synthetic',title:'Synthetic test',method:'lab' as const,preparation:''}];
let data:MemberBookingData;let pilot:PilotBookingData;
let assessment:{answers:Record<string,unknown>;urgentRule:null;completedAt?:string}={answers:{},urgentRule:null};
const exports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync('app/patient/service/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{exports,crypto:globalThis.crypto,require:(name:string)=>{
 if(name==='@/components/patient-care/member-screens')return memberScreens;
  if(name==='@/lib/patient/member-screens-config')return {memberScreensPrototypeEnabled:()=>false};
  if(name==='react/jsx-runtime')return jsx;if(name==='@/lib/patient-care/lab-stage-repository')return {getMemberLabStages:async()=>null};if(name==='@/lib/patient-care/repository')return {getCareData:async()=>({plan:null})};if(name==='@/lib/staff/lab-stage-schema')return {memberLabSummary:()=>null};if(name==='@/lib/patient-care/journey-strip')return {journeyStripIndex:()=>1,journeyStripInput:(f:unknown)=>f};if(name==='@/lib/patient-care/journey-reads')return {readJourneyExtras:async()=>({nurseVisit:undefined,released:null})};if(name==='@/lib/real-booking/visit-gate')return {completedRequestTestIds:()=>[]};
 if(name==='next/navigation')return {redirect:()=>{throw Error('Unexpected urgent redirect');},unstable_rethrow:()=>{}};
 if(name==='@/lib/clinical/rules/engine')return {evaluate:()=>({urgency:'green'})};
 if(name==='@/lib/patient/repository')return {requireRegistered:async()=>({profile:{locale:'en'},assessment})};
 if(name==='@/lib/patient/demo')return {demoEnabled:()=>false};
 if(name==='@/lib/real-booking/repository')return {getMemberBookingData:async()=>data};
 if(name==='@/lib/real-booking/appointment-repository')return {getMemberAppointmentData:async()=>pilot,getMemberAppointmentSummary:async()=>({appointments:[],clinics:{}})};
 if(name==='@/lib/observability/logger')return {log:{error:()=>{}},errorFields:()=>({})};
 if(name==='@/lib/real-booking/legacy-mode')return legacyMode;
 if(name==='@/lib/real-booking/form-error')return formError;
 if(name==='@/lib/real-booking/appointment-actions')return {selectMemberAppointment:()=>{},changeMemberAppointment:()=>{}};
 if(name==='@/components/real-booking/pilot-member')return {PilotMemberBooking:({data}:{data:PilotBookingData})=>React.createElement('div',null,`PILOT:${data.unavailableReason}:${data.available}:${data.offers.length}`)};
 if(name==='@/components/real-booking/member')return {RealMemberBooking:()=>React.createElement('div',null,'LEGACY'),HomeVisitRequest:()=>null};
 if(name==='@/components/patient/patient-shell')return {PatientShell:({children}:{children:React.ReactNode})=>children};
 if(['@/lib/service-workflow/server','@/components/service-workflow/legacy-booking-history','@/lib/demo-booking/repository','@/lib/demo-booking/actions','@/lib/staff/cases','@/components/service-workflow/client','@/lib/service-workflow/client-projection'].includes(name))return {};
 if(name==='@/components/patient-care/common')return {CareLink:({href,children}:{href:string;children:React.ReactNode})=>React.createElement('a',{href},children)};
 if(name==='@/lib/pilot-commerce/member')return {getMemberPricing:async()=>undefined};
 if(name==='@/components/patient-care/consultation-window-notice')return {ConsultationWindowNotice:()=>null};
 if(name==='@/lib/clinical/rules/rules')return rules;
 if(name==='@/lib/patient/questionnaire')return questionnaire;
 if(name==='@/lib/patient/copy')return realPatientCopy;throw Error(`Unexpected route boundary ${name}`);
}});
const page=exports.default as ()=>Promise<React.ReactElement>;
const base={available:false,requirements:[],homeTasks:[],requests:[]};
for(const reason of ['unavailable','source-unavailable'] as const){
 pilot={available:false,unavailableReason:reason,program,offers:[],appointments:[]};
 data={...base,pilot:undefined,clinicalHold:true,message:'Routine test requests are on hold. Review your health guidance and contact Noreon before continuing.'};
 assert.match(renderToStaticMarkup(await page()),/PILOT:clinical-hold:false:0/,`Member hold survives a pilot ${reason}`);
 data={...base,pilot:undefined,message:'Test requests are unavailable. Please try again.'};
 assert.match(renderToStaticMarkup(await page()),new RegExp(`PILOT:${reason}:false:0`),'A non-clinical failure claims no hold');
}
pilot={available:false,unavailableReason:'configuration-unavailable',program,offers:[],appointments:[]};
data={...base,available:true,pilot,legacyCreationAvailable:true};
assert.match(renderToStaticMarkup(await page()),/LEGACY/,'Switched-off pilot without a hold keeps the legacy flow');
// QA N-03: a saved questionnaire with an unanswered question (a crisis-range reading whose symptom
// question is unanswered) holds booking with approved wording, the Call 103 pattern and the way back.
const fixture=JSON.parse(readFileSync('scripts/fixtures/patient-answers.json','utf8'));
const crisis={...fixture,'q5.last_reading.systolic':{...fixture['q5.last_reading.systolic'],value:190},'q5.last_reading.diastolic':{...fixture['q5.last_reading.diastolic'],value:125}};
pilot={available:true,unavailableReason:null,program,offers:[],appointments:[]};
data={...base,available:true,pilot};
assessment={answers:crisis,urgentRule:null,completedAt:'2026-10-16T08:00:00.000Z'};
{const html=renderToStaticMarkup(await page());
 assert.doesNotMatch(html,/PILOT|could not be loaded/,'No booking panel or load error while the questionnaire is incomplete');
 assert.match(html,/href="tel:103"[^>]*>Call 103</,'Crisis-range reading: the big Call 103 button');
 assert.match(html,/For urgent medical help, call 103\./);assert.match(html,/href="\/patient\/questions"[^>]*>Continue questionnaire</);}
assessment={answers:Object.fromEntries(Object.entries(fixture).filter(([k])=>k!=='q9.present')),urgentRule:null,completedAt:'2026-10-16T08:00:00.000Z'};
{const html=renderToStaticMarkup(await page());
 assert.match(html,/Continue questionnaire/,'Any unanswered question holds booking');assert.doesNotMatch(html,/tel:103/,'No 103 button without a crisis-range reading');}
assessment={answers:{...crisis,'q5.crisis_symptoms':{fieldId:'q5.crisis_symptoms',value:['none'],source:'manual',answeredAt:'2026-10-16T08:00:00.000Z'}},urgentRule:null,completedAt:'2026-10-16T08:00:00.000Z'};
assert.match(renderToStaticMarkup(await page()),/PILOT:null:true/,'Answered "none of these" (orange) still books');
console.log('Actual member service route: a member-detected clinical hold replaces a non-clinical pilot outage; no hold is invented. Child/IO boundaries isolated.');
