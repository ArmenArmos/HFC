import {visitSummary} from '@/lib/real-booking/visit-summary';
import * as suggestionFilter from '@/lib/patient-care/suggestion-filter';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as icons from 'lucide-react';
import * as realClinicalTypes from '@/lib/clinical/types';
import * as realLocaleModule from '@/lib/locale';

// Render the actual route and recommendation component. Only data/IO and
// unrelated presentation boundaries are fixtures; no clinical rules are changed.
const copy=(locale:string,en:string,hy:string)=>locale==='hy'?hy:en;
const box=({children,title}:{children?:React.ReactNode;title?:string})=>React.createElement('section',null,title&&React.createElement('h2',null,title),children);
function load(path:string,modules:Record<string,unknown>){
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:(name:string)=>{
  if(name==='react/jsx-runtime')return jsx;
  if(name.endsWith('/member-screens-config'))return {memberScreensPrototypeEnabled:()=>false};
  if(name.endsWith('/member-screens'))return {MemberScreen:box};
  if(name==='lucide-react')return icons;
  if(name in modules)return modules[name];
  if(name==='@/lib/patient-care/suggestion-filter')return suggestionFilter;if(name==='@/lib/clinical/types')return realClinicalTypes;if(name==='@/lib/locale')return realLocaleModule;throw Error(`Unexpected rendering boundary: ${name}`);
 }});return exports;
}
const common={copy,CareSection:box,CareLink:box,IconTile:()=>null,RowLink:box};
const RecommendedTests=load('components/patient-care/recommended-tests.tsx',{'./common':common}).RecommendedTests;
for(const locale of ['en','hy'] as const){
 for(const published of [false,true]){
  for(const urgent of [false,true]){
   const tests=['lipid-panel','new-check'].map(id=>({id,name:{en:id,hy:id},category:'laboratory',method:'blood_draw',sourceRuleIds:[id],whatItTells:{en:'Fixture purpose',hy:'Fixture purpose'}}));
   const detail=copy(locale,'Reported value: 6.4','Նշված արժեք՝ 6.4');
   const decision={urgency:urgent?'red':'yellow',algorithmVersion:'fixture',findings:tests.map(t=>({ruleId:t.id,reason:{en:'Lipid analysis results are missing.',hy:'Լիպիդային անալիզի արդյունքները բացակայում են։'},detail:{en:'Reported value: 6.4',hy:'Նշված արժեք՝ 6.4'}}))};
   const publication=published?{planId:'fictional',sourceRows:[{}]}:null;
   const modules:Record<string,unknown>={
    'next/link':{default:box},
    '@/components/patient-care/common':common,
    '@/components/patient/patient-shell':{PatientShell:box},
    '@/components/patient-care/member-page-frame':{MemberPageFrame:box},
    '@/lib/patient-care/repository':{carePageData:async()=>({profile:{locale},assessment:{completedAt:'fixture',answers:{}},care:{tests:[],results:[]},demo:false,stage:'complete'})},
    '@/lib/service-workflow/server':{getServiceWorkflowForRender:async()=>null},
    '@/lib/patient-care/current-published-review':{currentPatientPublishedReview:async()=>publication},
    '@/lib/patient-care/published-review':{currentPublishedSourceRows:()=>published?[{}]:[]},
    '@/lib/real-booking/visit-summary':{visitSummary},
    '@/lib/real-booking/repository':{getMemberBookingData:async()=>null},
    '@/lib/clinical/rules/engine':{evaluate:()=>decision,buildPlan:()=>tests},
    '@/components/patient-care/recommended-tests':{RecommendedTests},
    '@/components/patient-care/consultation-window-notice':{ConsultationWindowNotice:()=>null},
    '@/components/patient-care/published-source-results':{PublishedSourceResults:()=>React.createElement('p',null,'Approved LDL 3.2 mmol/L')},
    '@/components/patient-care/controls':{CareRefresh:()=>null},
    // B5 ships dark: no released-document read while switched off.
    '@/lib/doctor-completion/config':{doctorCompletionEnabled:()=>false},
    '@/lib/supabase/server':{createClient:async()=>{throw Error('Unexpected member client while B5 is off');}},
    '@/lib/doctor-completion/document-runtime':{readMemberDocuments:async()=>{throw Error('Unexpected document read while B5 is off');}},
    '@/components/patient-care/released-documents':{ReleasedDocuments:()=>null},
   };
   for(const [file,name] of [['test-summary','TestSummary'],['progress-navigation','ProgressNavigation'],['result-history','ResultHistory'],['test-orders','TestOrders']])modules[`@/components/patient-care/${file}`]={[name]:()=>null};
   const Page=load('components/patient-care/member-results-content.tsx',modules).default as ()=>Promise<React.ReactNode>;
   const html=renderToStaticMarkup(await Page());
   const label=copy(locale,'Questionnaire suggestions','Հարցաշարի առաջարկներ');
   if(urgent){assert.ok(!html.includes('lipid-panel'));continue;}
   assert.ok(html.includes(label),'Screening suggestions must identify their questionnaire-only basis');
   assert.ok(html.includes(copy(locale,'Uses questionnaire answers only, not approved report values.','Այս առաջարկները հիմնված են միայն հարցաշարի պատասխանների վրա, ոչ թե հաստատված արդյունքների։')));
   assert.ok(html.includes('lipid-panel')&&html.includes('new-check'),'An existing publication must not erase recommendations from changed answers');
   if(published)assert.ok(html.indexOf('Approved LDL 3.2 mmol/L')<html.indexOf(label),'Approved evidence must precede questionnaire-only suggestions');
   const reason=copy(locale,'Lipid analysis results are missing.','Լիպիդային անալիզի արդյունքները բացակայում են։');
   const disclosures=[...html.matchAll(/<details\b([^>]*)>([\s\S]*?)<\/details>/g)].filter(match=>match[2].includes(reason));
   assert.ok(!html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'').includes(reason),'No raw missing-result reason may leak outside a contextual disclosure');
   assert.equal(disclosures.length,2,'Each screening reason must be contained in contextual disclosure');
   assert.ok(!html.replace(/<details\b[^>]*>[\s\S]*?<\/details>/g,'').includes(detail),'Reported details must remain contextualized');
   for(const match of disclosures){assert.ok(!/\bopen(?:=|\s|$)/.test(match[1]));assert.ok(match[2].includes(copy(locale,'Questionnaire screening reasons','Հարցաշարային սքրինինգի պատճառները')));assert.ok(match[2].includes(detail),'Each screening disclosure must retain its reported detail');}
  }
 }
}
console.log('Results renders approved evidence first, retains changed-answer suggestions, scopes missing-result reasons to closed questionnaire disclosures, and preserves urgent suppression in EN/HY.');
