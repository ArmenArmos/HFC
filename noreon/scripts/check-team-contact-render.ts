import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as memberScreens from '@/components/patient-care/member-screens';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import * as common from '@/components/patient-care/common';
import * as contactLine from '@/components/patient-care/member-contact';
import * as teamContent from '@/components/patient-care/member-team-content';
import * as helpContent from '@/components/patient-care/member-help-content';
import type {MemberContact} from '@/lib/patient-care/member-contact';
import * as icons from 'lucide-react';
import type {CareData} from '@/lib/patient-care/types';
import * as realLocaleModule from '@/lib/locale';
let locale='en',signedIn=true;
let contact:MemberContact={mode:'chat',href:'/patient/zoe'};
const care={plan:null} as CareData;
const load=(path:string)=>{
const exports: {default?: (props: {searchParams: Promise<Record<string,string>>}) => Promise<React.ReactNode>}={};
const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports,process,require:(name:string)=>{
  if(name==='@/components/patient-care/member-screens')return memberScreens;
  if(name==='@/lib/patient/member-screens-config')return {memberScreensPrototypeEnabled:()=>false};
  if(name==='react/jsx-runtime') return jsx;
  if(name==='lucide-react') return icons;
  if(name.endsWith('/patient-shell')) return {PatientShell:({children}:{children:React.ReactNode})=>React.createElement('main',null,children)};
  if(name.endsWith('/common')) return common;
  if(name==='@/components/patient-care/member-contact') return contactLine;
  if(name==='@/components/patient-care/member-team-content') return teamContent;
  if(name==='@/components/patient-care/member-help-content') return helpContent;
  if(name==='@/lib/patient-care/member-contact') return {memberContact:async()=>contact};
  if(name==='@/lib/zoe/member-screen') return {ZOE_FAQ:[]};
  if(name.endsWith('/repository')) return {carePageData:async()=>({profile:{locale},care}),requireRegistered:async()=>({profile:{locale}}),getPatientState:async()=>({profile:{locale},consentAccepted:true,assessment:{}})};
  if(name.endsWith('/patient/auth')) return {patientIdentity:async()=>signedIn?{userId:'member',phone:'+37400000000'}:null};
  if(name==='next/headers') return {cookies:async()=>({get:()=>undefined})};
  if(name.endsWith('/real-review-config')) return {realReviewEnabled:()=>false};
  if(name==='@/lib/locale')return realLocaleModule;throw new Error(`Unexpected boundary ${name}`);
}});
return exports.default!;
};
const page=load('app/patient/team/page.tsx');
const help=load('app/patient/help/page.tsx');
for(locale of ['en','hy']) {
 {
  const contact=renderToStaticMarkup(await page({searchParams:Promise.resolve({section:'contact'})}));
  assert.match(contact,locale==='en' ? /<h1[^>]*>Contact Noreon<\/h1>/ : /<h1[^>]*>Կապվել Նորեոն Հելթի հետ<\/h1>/);
  assert.match(contact,/href="\/patient\/zoe"/);
  assert.doesNotMatch(contact,/mailto:/,'QA N-09: Telegram-only, no email contact');
  assert.doesNotMatch(contact,/href="\/patient\/team"/,'Contact must not direct members to unavailable Zoe chat');
  const informationTitle=locale==='en'?'Care team information':'Խնամքի թիմի մասին';
  assert.ok(contact.indexOf(informationTitle)>=0 && contact.indexOf('href="/patient/zoe"') < contact.indexOf(informationTitle),'Available contact precedes team information');
  assert.doesNotMatch(contact,/href="tel:103"/,'Header pill is the one 103 button (Khikar, 18 Oct 22:57)');
  assert.match(contact,locale==='en'?/call 103/:/զանգահարեք 103/);
  assert.doesNotMatch(contact,/<input/,'Contact destination must not show an unavailable chat composer');
  assert.match(contact,locale==='en' ? /Message your care team/ : /Գրել խնամքի թիմին/);
 }
 const realDefault=renderToStaticMarkup(await page({searchParams:Promise.resolve({})}));
 assert.match(realDefault,locale==='en' ? /<h1[^>]*>Contact Noreon<\/h1>/ : /<h1[^>]*>Կապվել Նորեոն Հելթի հետ<\/h1>/,'Real Contact team opens direct contact by default');
 assert.match(realDefault,/href="\/patient\/zoe"/);
 assert.doesNotMatch(realDefault,/mailto:/);
 assert.doesNotMatch(realDefault,/href="tel:103"/);
 const informationTitle=locale==='en'?'Care team information':'Խնամքի թիմի մասին';
 assert.ok(realDefault.indexOf(informationTitle)>=0 && realDefault.indexOf('href="/patient/zoe"') < realDefault.indexOf(informationTitle),'Real default prioritizes available contact over team information');
 assert.doesNotMatch(realDefault,/<h1[^>]*>Zoe<\/h1>|<input|<form|disabled=""/,'Real members must not land on fictional or unavailable chat controls');
  const helpHtml=renderToStaticMarkup(await help({searchParams:Promise.resolve({})}));
  assert.doesNotMatch(helpHtml,/disabled=""|<input|<form/,'Help offers available contact routes only');
  assert.doesNotMatch(helpHtml,/href="tel:103"/,'Signed in: the header pill is the one 103 button');
  assert.match(helpHtml,/id="about-zoe"/,'Help carries About Zoe');
  assert.match(helpHtml,/href="\/patient\/zoe"/);
  assert.doesNotMatch(helpHtml,/mailto:/);
  assert.match(helpHtml,/href="\/patient\/team\?section=contact"/);
  assert.match(helpHtml,locale==='en'?/Write to your care team in the Zoe chat/:/Գրեք ձեր խնամքի թիմին Զոյայի զրույցում/);
  assert.match(helpHtml,locale==='en'?/does not notify a doctor or emergency service/:/չի ծանուցում բժշկին կամ շտապ օգնությանը/);
  signedIn=false;
  const signedOutHelp=renderToStaticMarkup(await help({searchParams:Promise.resolve({locale})}));
  signedIn=true;
  assert.match(signedOutHelp,/href="tel:103"/,'Signed-out help keeps the emergency route');
  assert.doesNotMatch(signedOutHelp,/mailto:|href="\/patient\/zoe"/,'Signed-out help offers no email and no member-only chat');
  assert.match(signedOutHelp,new RegExp(`href="/patient\\?locale=${locale}"`),'Signed-out help returns to sign-in in the same language');
  assert.doesNotMatch(signedOutHelp,/section=contact/,'Signed-out help does not link to member-only pages');
}
// Review F3: the chat promise only appears while the chat is on; otherwise Telegram or a plain statement.
for(locale of ['en','hy']){
 contact={mode:'none'};
 for(const html of [renderToStaticMarkup(await page({searchParams:Promise.resolve({section:'contact'})})),renderToStaticMarkup(await help({searchParams:Promise.resolve({})}))]){
  assert.doesNotMatch(html,/Zoe chat|Զոյայի զրույցում|href="\/patient\/zoe"|mailto:/,'No chat promise or email when no route is on');
  assert.match(html,locale==='en'?/is not switched on yet/:/դեռ միացված չէ/);
  assert.match(html,locale==='en'?/call 103/i:/զանգահարեք 103/);
 }
 contact={mode:'telegram',href:'https://t.me/noreon_test_bot'};
 const tg=renderToStaticMarkup(await page({searchParams:Promise.resolve({section:'contact'})}));
 assert.match(tg,/href="https:\/\/t.me\/noreon_test_bot"/);assert.match(tg,locale==='en'?/on Telegram/:/Telegram-ով/);assert.doesNotMatch(tg,/Zoe chat|Զոյայի զրույցում/);
 contact={mode:'connect',href:'/patient/account/telegram'};
 assert.match(renderToStaticMarkup(await help({searchParams:Promise.resolve({})})),/href="\/patient\/account\/telegram"/);
 contact={mode:'chat',href:'/patient/zoe'};
}
for(const file of ['app/patient/account/page.tsx','components/patient-care/member-help-content.tsx']) assert.match(readFileSync(file,'utf8'),/\/patient\/team\?section=contact/);
console.log('Actual team EN/HY: default and explicit contact routes prioritize the care-team chat and 103. Help contacts preserved, signed in and signed out. Authenticated data/shell are mocked.');
