import * as memberStaffNames from "@/lib/member-staff-name.mjs";
// Sign-up steps 5 and 6 (prototype "Join"): Meet Zoe and Meet your care team, EN and HY. The
// doctor is named only from patient_care_team; null says "assigned shortly"; a failed read
// (undefined) names nobody and claims nothing. No copy promises a review of each answer.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {tx} from '@/lib/patient/copy';
import * as common from '@/components/patient-care/common';
import * as meetZoe from '@/components/patient/meet-zoe';
import * as steps from '@/components/patient/onboarding-steps';

let state:{profile:{name:string;locale:'en'|'hy'}};
let team:{doctor:string|null}|null|undefined;
let zoe:{readsMessages:boolean;directAnswers:boolean}|null=null;
let reviewOn=true;
function load(file:string){
 const exports:Record<string,unknown>={};
 new vm.Script(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports,process,require:(name:string)=>{
  if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/member-staff-name.mjs')return memberStaffNames;
  if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
  if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
  if(name.endsWith('/repository'))return {requireRegistered:async()=>state};
  if(name.endsWith('/patient-shell'))return {PatientShell:({children}:{children:React.ReactNode})=>React.createElement('main',null,children)};
  if(name.endsWith('/ui/button'))return {buttonVariants:()=>'button'};
  if(name.endsWith('/copy'))return {tx};
  if(name.endsWith('/meet-zoe'))return meetZoe;
  if(name.endsWith('/onboarding-steps'))return steps;
  if(name.endsWith('/patient-care/common'))return common;
  if(name.endsWith('/care-team-repository'))return {readMemberCareTeam:async()=>team};
  if(name==='@/lib/zoe/member')return {readZoeConsents:async()=>zoe};
  if(name==='@/lib/patient-care/real-review-config')return {realReviewEnabled:()=>reviewOn};
  throw Error(`Unexpected boundary: ${name}`);
 }});
 return exports.default as ()=>Promise<React.ReactElement>;
}
const Ready=load('app/patient/ready/page.tsx'),Team=load('app/patient/ready/team/page.tsx');
const reviewClaim=/reviews? (each|every|all)|ամեն պատասխան/i;
for(const locale of ['en','hy'] as const){
 state={profile:{name:'Mariam Fictional',locale}};
 zoe={readsMessages:true,directAnswers:false};
 const ready=renderToStaticMarkup(await Ready());
 assert.match(ready,/data-onboarding-step="5"/,'Meet Zoe is step 5');
 assert.ok(ready.includes(locale==='en'?'Hello, Mariam. I am Zoe.':'Բարև, Mariam։'),'Zoe greets by first name');
 assert.ok(!ready.includes('tel:103')&&!ready.includes('103'),'No 103 button or link on sign-up screens (Khikar 19 Oct, Gohar Q5)');
 assert.ok(ready.includes(locale==='en'?'I am not a doctor':'Ես բժիշկ չեմ'),'Zoe is not a doctor');
 assert.ok(ready.includes('href="/patient/ready/team"'),'Next: the care team');
 assert.ok(!ready.includes(locale==='en'?'Your team, and who does what':'Ձեր թիմը, և ով ինչ է անում'),'Team block moves to step 6');
 assert.ok(!reviewClaim.test(ready));
 team={doctor:'Dr Ani Fictional'};
 let html=renderToStaticMarkup(await Team());
 assert.match(html,/data-onboarding-step="6"/,'Care team is step 6');
 assert.ok(html.includes('Dr Ani Fictional')&&html.includes('data-care-team-doctor="named"'),'Assigned doctor named');
 assert.ok(!html.includes(locale==='en'?'assigned shortly':'շուտով կնշանակվի'));
 assert.ok(!html.includes('103'),'No 103 on the care team step (Gohar Q5)');
 assert.ok(html.includes('href="/patient/questions"')&&html.includes('href="/patient/dashboard"'),'Start questions or later');
 assert.ok(!reviewClaim.test(html),'No promise that the doctor reviews each answer');
 team=null;html=renderToStaticMarkup(await Team());
 assert.ok(html.includes(locale==='en'?'Your doctor is assigned once you finish the health questions.':'երբ ավարտեք առողջության հարցերը')&&html.includes('data-care-team-doctor="after-questions"'),'No case yet: assigned once the questions are finished (F3a)');
 assert.ok(!html.includes(locale==='en'?'assigned shortly':'շուտով կնշանակվի'),'No "shortly" before enrolment');
 reviewOn=false;html=renderToStaticMarkup(await Team());
 assert.ok(!html.includes(locale==='en'?'assigned once':'կնշանակվի')&&html.includes('data-care-team-doctor="unknown"'),'Real review off: no assignment promise (Codex #277)');
 reviewOn=true;
 team={doctor:null};html=renderToStaticMarkup(await Team());
 assert.ok(html.includes(locale==='en'?'Your doctor will be assigned shortly.':'Ձեր բժիշկը շուտով կնշանակվի։')&&html.includes('data-care-team-doctor="pending"'),'Enrolled, no doctor free: assigned shortly');
 // F3b: Zoe lines follow the member's choice and direct answers.
 // Gohar D-011: after "Continue without Zoe" (no grant), with Zoe off or an unreadable choice,
 // step 5 is a neutral care-team welcome: no Zoe greeting or Zoe lines at all.
 for(const choice of [{readsMessages:false,directAnswers:false},{readsMessages:false,directAnswers:true},null]){
  zoe=choice;
  const r=renderToStaticMarkup(await Ready());
  assert.ok(r.includes('data-welcome="care-team"')&&r.includes(locale==='en'?'Welcome, Mariam.':'Բարի գալուստ, Mariam։'),'Without Zoe: neutral welcome by first name');
  assert.ok(!r.includes('Zoe'),'Without Zoe: Zoe is not mentioned on step 5');
  assert.match(r,/data-onboarding-step="5"/);
  assert.ok(!r.includes('103')&&r.includes('href="/patient/ready/team"'),'Without Zoe: next step, no 103 (Gohar Q5)');
  html=renderToStaticMarkup(await Team());
  assert.ok(!html.includes('Zoe'),'Without Zoe: care team page does not mention Zoe');
 }
 let r:string;
 zoe={readsMessages:true,directAnswers:false};
 r=renderToStaticMarkup(await Ready());
 assert.ok(r.includes(locale==='en'?'I read your messages to help your care team.':'Կարդում եմ ձեր հաղորդագրությունները')&&!r.includes(locale==='en'?'answer simple questions':'պարզ հարցերին'),'With Zoe, direct answers off: no answering claim');
 zoe={readsMessages:true,directAnswers:true};
 r=renderToStaticMarkup(await Ready());
 assert.ok(r.includes(locale==='en'?'I answer simple questions about visits and the app myself.':'պարզ հարցերին'),'Direct answers on: says so');
 html=renderToStaticMarkup(await Team());
 assert.ok(html.includes(locale==='en'?'passes your messages to the team':'փոխանցում թիմին'),'With Zoe: passes messages');
 zoe=null;
 team=undefined;html=renderToStaticMarkup(await Team());
 assert.ok(html.includes('data-care-team-doctor="unknown"')&&!html.includes(locale==='en'?'assigned shortly':'շուտով'),'Failed read: no name and no claim');
}
console.log('Onboarding steps 5-6 EN/HY: Meet Zoe (not a doctor, 103, step dots) and care team (named, after-questions, pending, unknown) Zoe lines by choice and direct answers, and no promise with review off passed.');
