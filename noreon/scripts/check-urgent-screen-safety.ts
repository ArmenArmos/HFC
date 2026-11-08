/** Actual urgent route rendering; isolate authenticated request IO and the demo reset widget. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as memberScreens from '@/components/patient-care/member-screens';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {ruleById} from '@/lib/clinical/rules/rules';
import {tx} from '@/lib/patient/copy';
import {PatientDocumentLanguage} from '@/components/patient/document-language';
import type {PatientLocale} from '@/lib/patient/copy';
import {evaluate,exerciseRemindersAllowed} from '@/lib/clinical/rules/engine';
import {CORE_QUESTIONS,visibleFields} from '@/lib/clinical/seed/questions';
import {validProfile} from '@/lib/patient/validation';
import type {Answers,FieldValue} from '@/lib/clinical/types';
import * as realClinicalTypes from '@/lib/clinical/types';
let prototypeEnabled = false;
let locale:PatientLocale='en', urgentRule:string|null='RF-01';
const assessment={revision:4,get urgentRule(){return urgentRule;},answers:{},completedAt:null};
const exports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync('app/patient/urgent/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new vm.Script(code).runInNewContext({exports,require(name:string):unknown {
 if(name==='@/components/patient-care/member-screens')return memberScreens;
  if(name==='@/lib/patient/member-screens-config')return {memberScreensPrototypeEnabled:()=>prototypeEnabled};
  if(name==='react/jsx-runtime')return jsx;
 if(name==='next/navigation')return {redirect:(path:string)=>{throw Error(`redirect:${path}`);}};
 if(name.endsWith('/repository'))return {requireRegistered:async()=>({profile:{locale},assessment})};
 if(name.endsWith('/rules/rules'))return {ruleById};
 if(name.endsWith('/copy'))return {tx};
 if(name.endsWith('/document-language'))return {PatientDocumentLanguage};
 if(name.endsWith('/patient-shell'))return {PatientShell:({children}:{children:React.ReactNode})=>React.createElement('main',null,children)};
 if(name.endsWith('/common'))return {CareLink:({children,href}:{children:React.ReactNode;href:string})=>React.createElement('a',{href},children)};
 if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
 if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
 if(name==='@/lib/care-alerts/member')return {careAlertMemberStatus:async()=>({ok:true,alertsEnabled:false,alerted:false,alertedAt:null})};
 if(name==='@/lib/care-alerts/urgent-review')return {reviewableAnswer:()=>null,urgentAnswerReviewEnabled:()=>false};
 if(name==='@/lib/clinical/types')return realClinicalTypes;throw Error(`Unexpected boundary: ${name}`);
}});
const Urgent=exports.default as ()=>Promise<React.ReactElement>;
for(prototypeEnabled of [false,true]) {
 for(locale of ['en','hy'] as const) for(urgentRule of ['RF-01','RF-02','RF-03','RF-04','RF-05']) {
  const html=renderToStaticMarkup(await Urgent());
  assert.ok(html.includes(locale==='en'?'Sit down. Do not stay alone. Do not drive.':'Նստեք, մի մնացեք մենակ, մի վարեք մեքենա։'),'Source emergency instructions must reach every red-rule screen in the selected language');
  const links=[...html.matchAll(/<a\b[^>]*href="([^"]+)"/g)].map(match=>match[1]);
  // Lead decision 17 Oct (QA M-01): the call action first, then one Get help exit; no routine navigation.
  assert.deepEqual(links,['tel:103','/patient/help'],'Emergency guidance has the call action first and only the help exit');
  assert.ok(html.includes(locale==='en'?'Call 103 now':'Զանգահարել 103 հիմա'));
  assert.match(html,/<main\b[^>]*lang="(?:en|hy)"[^>]*class="[^"]*min-h-dvh[^\"]*bg-\[var\(--marker-out-fg\)\]/,'Urgent guidance owns the full viewport with the existing critical colour token');
  assert.ok(html.includes(locale==='en'?'has not been notified':'չեն ծանուցվել'),'The call must not imply automatic emergency notification');
  assert.ok(!/RF-\d+|Back to Home|Guidance reference/.test(html));
  assert.ok(html.indexOf('tel:103')<html.indexOf('/patient/help'),'Call 103 stays ahead of Get help');
  assert.equal(assessment.urgentRule,urgentRule,'Rendering never clears the urgent assessment');
 }
 for(urgentRule of [null,'missing-rule','RF-06','RF-08','NRN-RULE-CP-002']) await assert.rejects(Urgent,/redirect:\/patient\/questions/,'Only a genuine red registry rule opens emergency guidance');
}
// The prototype stylesheet must not override the full-viewport critical ground.
assert.doesNotMatch(readFileSync('components/patient-care/member-screens.css','utf8'), /\.member-journey\.ms-urgent\s*\{[^}]*background\s*:/);
console.log('Actual urgent route EN/HY, prototype off/on: all red rules show source instructions, call 103 first and only the Get help exit; full-viewport critical treatment, truthful notice, preserved urgency and non-red route guards pass. Request IO/demo widget isolated; browser visual verification remains separate.');

// Card 53 bounded domain coverage. No exercise scheduler exists to test end to end.
const answers=(values:Record<string,FieldValue>):Answers=>Object.fromEntries(Object.entries(values).map(([fieldId,value])=>[fieldId,{fieldId,value,source:'manual',answeredAt:'2026-10-15T00:00:00Z'}]));
const palp=answers({'q10.symptoms':'palpitations_only','q10.syncope':'never','q10.rhythm':'fast_regular','q10.episode_duration':'seconds'});
const palpFields=visibleFields(CORE_QUESTIONS.find(question=>question.id==='q10')!,palp).map(field=>field.id);
assert.deepEqual(palpFields,['q10.symptoms','q10.breathless','q10.syncope','q10.rhythm','q10.episode_duration'],'Palpitations without dizziness opens history clarifiers and skips the combined acute-symptom gate');
assert.ok(evaluate({answers:palp,observations:[]}).findings.some(finding=>finding.ruleId==='NRN-RULE-PAL-002'));
for(const [syncope,allowed,flag] of [['exertion',false,'RF-08'],['rest',false,'RF-09'],['never',true,null],['vasovagal',true,null]] as const) {
 const input=answers({'q10.syncope':syncope});
 assert.equal(exerciseRemindersAllowed(input),allowed,`Exercise eligibility for ${syncope}`);
 if(flag)assert.ok(evaluate({answers:input,observations:[]}).findings.some(finding=>finding.ruleId===flag));
}
for(const [birthDate,valid] of [['1916-10-15',true],['1915-10-16',true],['1915-10-15',false]] as const) assert.equal(validProfile({name:'Synthetic age boundary',birthDate,biologicalSex:'male',locale:'en'},'2026-10-15'),valid,'Age 110 remains eligible through the day before the 111th birthday');
console.log('Card 53 domain checks: palpitations-only clarifiers/finding, RF08/09 exercise eligibility helper, and exact upper-age birthday boundaries pass. Relief question and operational exercise scheduling remain unavailable.');
