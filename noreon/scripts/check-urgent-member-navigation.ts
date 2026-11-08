/** Render actual member routes with only request data and unrelated client widgets isolated. */
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
import type {PatientLocale} from '@/lib/patient/copy';
import * as realClinicalTypes from '@/lib/clinical/types';
let prototypeEnabled = false;
const createRequestState = (locale: PatientLocale, urgentRule: string | null = 'RF-03') => ({profile:{name:'Fictional navigation QA',locale},assessment:{revision:4,urgentRule,answers:{},completedAt:null}});
let requestState = createRequestState('en');
const shell = ({children}: {children:React.ReactNode}) => React.createElement('main',null,children);
function load(path: string): Record<string, unknown> {
 const exports: Record<string, unknown> = {};
 const code = ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 new vm.Script(code).runInNewContext({exports,require(name:string): unknown {
  if(name==='@/components/patient-care/member-screens')return memberScreens;
  if(name==='@/lib/patient/member-screens-config')return {memberScreensPrototypeEnabled:()=>prototypeEnabled};
  if(name==='react/jsx-runtime')return jsx;
  if(name==='next/navigation')return {redirect:(path:string)=>{throw Error(`redirect:${path}`);}};
  if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
  if(name.endsWith('/repository'))return {requireRegistered:async()=>requestState};
  if(name.endsWith('/render-data'))return {requireRegisteredForRender:async()=>requestState};
  if(name.endsWith('/rules/rules'))return {ruleById};
  if(name.endsWith('/copy'))return {tx};
  if(name.endsWith('/demo'))return {demoEnabled:()=>true};
  if(name.endsWith('/patient-shell'))return {PatientShell:shell};
  if(name.endsWith('/document-language'))return {PatientDocumentLanguage:()=>null};
  if(name.endsWith('/common'))return load('components/patient-care/common.tsx');
  if(name.endsWith('/date-format'))return {formatMemberDate:()=>''};
  if(name==='lucide-react')return new Proxy({}, {get:()=>()=>null});
  if(name.endsWith('/language-preference'))return {LanguagePreference:()=>null};
  if(name.endsWith('/sign-out-button'))return {SignOutButton:()=>null};
  if(name.endsWith('/pwa-install'))return {PwaInstall:()=>null};
  if(name.endsWith('/text-size-preference'))return {TextSizePreference:({value}:{value:string})=>React.createElement('p',null,`text-size:${value}`)};
  if(name.endsWith('/when-we-reply'))return {WhenWeReply:()=>React.createElement('p',null,'when-we-reply')};
  if(name==='@/lib/patient/member-preferences')return {readMemberTextSize:async()=>'large'};
  if(name==='@/lib/telegram-runtime/config')return {telegramEnabled:()=>false};
  if(name==='@/lib/care-alerts/member')return {careAlertMemberStatus:async()=>({ok:true,alertsEnabled:false,alerted:false,alertedAt:null})};
  if(name==='@/lib/care-alerts/urgent-review')return {reviewableAnswer:()=>null,urgentAnswerReviewEnabled:()=>false};
  if(name==='@/components/patient/zoe-consents')return {ZoeConsents:()=>React.createElement('p',null,'zoe-consents')};
  if(name==='@/lib/zoe/member')return {readZoeConsents:async()=>null};
  if(name==='@/lib/clinical/types')return realClinicalTypes;throw Error(`Unexpected boundary: ${name}`);
 }});
 return exports;
}
const Urgent = load('app/patient/urgent/page.tsx').default as ()=>Promise<React.ReactElement>;
const Account = load('app/patient/account/page.tsx').default as ()=>Promise<React.ReactElement>;
for(prototypeEnabled of [false,true]) {
 for(const locale of ['en','hy'] as const) {
  requestState=createRequestState(locale);
  const assessment=requestState.assessment;
  const page = await Urgent();
  const html = renderToStaticMarkup(page);
  const links = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  // Lead decision 17 Oct (QA M-01): 103 first, plus one Get help exit; no routine navigation.
  assert.deepEqual(links.map(link=>link[1]),['tel:103','/patient/help'],'Urgent guidance keeps 103 first and only the help exit');
  assert.equal(links.filter(link=>link[1]==='tel:103').length,1,'One prominent emergency telephone action remains');
  const notice = locale==='en'?'has not been notified':'չեն ծանուցվել';
  assert.ok(html.includes(notice),'Returning cannot imply notification or acknowledgement');
  assert.ok(html.indexOf('tel:103')<html.indexOf(notice),'The emergency action precedes truthful notification status');
  assert.ok(!/RF-\d+|Guidance reference|Ցուցման հղումը/.test(html),'Internal clinical identifiers must not appear on member guidance');
  assert.equal(requestState.assessment,assessment,'Rendering retains the request assessment');
  assert.equal(assessment.urgentRule,'RF-03','Actual urgent rendering does not clear request urgency');
  const account=renderToStaticMarkup(await Account());
  const summary=account.match(/<summary\b[^>]*>([\s\S]*?)<\/summary>/)?.[1] ?? '';
  assert.ok(summary,'Unavailable settings retain an expandable explanation');
  assert.ok(!/·\s*5/.test(summary),'Disclosure does not expose an arbitrary internal item count');
  assert.match(summary,locale==='en'?/Settings not available yet/:/Դեռ անհասանելի կարգավորումներ/);
  // Prototype D6/D8/D10 (17 Oct): text size and callbacks are real settings now, not unavailable rows.
  assert.ok(!account.includes(locale==='en'?'Use browser zoom':'մեծացրեք դիտարկիչում'),'Text size is no longer listed as unavailable');
  assert.ok(account.includes('text-size:large')&&account.includes('href="/patient/account/contact"')&&account.includes('when-we-reply'),'Me shows text size, contact and callback, and when we reply');
 }
 requestState=createRequestState('en',null);
 await assert.rejects(Urgent,/redirect:\/patient\/questions/,'A missing urgent rule retains the original route guard');
}
console.log('Actual urgent/Me pages EN/HY, prototype off/on: emergency action/status with only the Get help exit, member-only wording, preserved urgency and missing-rule route guard passed. Request/client widgets isolated; browser journey remains separate.');
