// The one-time Zoe card (OK grants, Not now records nothing) and the Me "My consents" switches
// (no Telegram row), EN and HY. Real components; server actions are stubs that record calls.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestInstance,type ReactTestRenderer} from 'react-test-renderer';
import {tx as localeText} from '@/lib/patient/copy';
// These checks render Armenian and English only; Russian is covered by the type checker and check:ru.
const tx=(l:'en'|'hy',hy:string,en:string)=>localeText(l,hy,en,'');
import {ZOE_STATEMENT,ZOE_DIRECT_ANSWERS,zoeStatement} from '@/lib/zoe/consent-copy';
import * as realLocaleModule from '@/lib/locale';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const calls:string[]=[];
let acceptOk=true;
const host=(tag:string)=>function Fixture({children,...props}:{children?:React.ReactNode}){return React.createElement(tag,props,children);};
function load(file:string){
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,require:(name:string)=>{
  if(name==='react')return React;
  if(name==='react/jsx-runtime')return jsx;
  if(name==='lucide-react')return {Bot:host('i'),CalendarClock:host('i'),MessageCircle:host('i')};
  if(name==='@/components/ui/button')return {Button:host('button')};
  if(name==='@/components/patient-care/common')return {IconTile:host('i')};
  if(name==='@/lib/patient/copy')return {tx};
  if(name==='@/lib/zoe/consent-copy')return {ZOE_STATEMENT,ZOE_DIRECT_ANSWERS,zoeStatement};
  if(name==='@/app/patient/account/telegram/zoe-actions')return {
   acceptZoePrompt:async()=>{calls.push('accept');return {ok:acceptOk};},
   postponeZoePrompt:async()=>{calls.push('later');return {ok:true};},
   changeZoeConsent:async(kind:string,granted:boolean)=>{calls.push(`${kind}:${granted}`);return {ok:true,view:{readsMessages:granted,scheduledQuestions:false}};},
  };
  if(name==='@/lib/locale')return realLocaleModule;throw Error(`Unexpected dependency ${name}`);
 }});
 return exports;
}
const {ZoeConsentPrompt}=load('components/patient/zoe-consent-prompt.tsx') as {ZoeConsentPrompt:React.ComponentType<{locale:'en'|'hy';directAnswers?:boolean}>};
const {ZoeConsents}=load('components/patient/zoe-consents.tsx') as {ZoeConsents:React.ComponentType<Record<string,unknown>>};
const text=(n:ReactTestInstance|string):string=>typeof n==='string'?n:n.children.map(text).join('');
const buttons=(root:ReactTestInstance)=>root.findAll(n=>n.type==='button');
async function mount(element:React.ReactElement){let t!:ReactTestRenderer;await act(async()=>{t=create(element);});return t;}
for(const locale of ['en','hy'] as const){
 // OK records the grant once.
 calls.length=0;acceptOk=true;
 let tree=await mount(React.createElement(ZoeConsentPrompt,{locale}));
 assert.ok(text(tree.root).includes(ZOE_STATEMENT[locale]),'Card shows the same statement as enrolment');
 assert.ok(!text(tree.root).includes(ZOE_DIRECT_ANSWERS[locale]),'No direct-answers claim while they are off (F3)');
 assert.deepEqual(buttons(tree.root).map(text),locale==='en'?['OK','Not now']:['Լավ','Ոչ հիմա']);
 await act(async()=>{buttons(tree.root)[0]!.props.onClick();});
 assert.deepEqual(calls,['accept']);
 assert.equal(tree.root.findAll(n=>n.props.role==='status').length,1,'OK confirms');
 assert.ok(text(tree.root).includes(locale==='en'?'Your choice is saved.':'Ձեր ընտրությունը պահպանված է։'),'Confirmation claims no more than the saved choice (F3)');
 await act(async()=>{tree.unmount();});
 // With direct answers on, the card says so.
 tree=await mount(React.createElement(ZoeConsentPrompt,{locale,directAnswers:true}));
 assert.ok(text(tree.root).includes(ZOE_DIRECT_ANSWERS[locale]),'Direct answers named while on (F3)');
 await act(async()=>{tree.unmount();});
 // Not now records no consent and hides the card.
 calls.length=0;
 tree=await mount(React.createElement(ZoeConsentPrompt,{locale}));
 await act(async()=>{buttons(tree.root)[1]!.props.onClick();});
 assert.deepEqual(calls,['later'],'Not now records nothing');
 assert.equal(tree.toJSON(),null,'Card hidden after Not now');
 await act(async()=>{tree.unmount();});
 // A failed save keeps the card with an alert.
 calls.length=0;acceptOk=false;
 tree=await mount(React.createElement(ZoeConsentPrompt,{locale}));
 await act(async()=>{buttons(tree.root)[0]!.props.onClick();});
 assert.equal(tree.root.findAll(n=>n.props.role==='alert').length,1,'Failure is shown');
 await act(async()=>{tree.unmount();});
 // Me, My consents: the switches without the Telegram row; turning Zoe off calls the action.
 calls.length=0;
 tree=await mount(React.createElement(ZoeConsents,{locale,initial:{readsMessages:true,scheduledQuestions:false},canGrant:true,headingId:'my-consents-title',title:tx(locale,'Իմ համաձայնությունները','My consents')}));
 assert.ok(text(tree.root).includes(locale==='en'?'My consents':'Իմ համաձայնությունները'));
 assert.ok(!text(tree.root).includes('Telegram'),'No Telegram row under Me');
 assert.ok(!text(tree.root).includes(ZOE_DIRECT_ANSWERS[locale]),'Settings line omits direct answers while off (F3)');
 const reads=tree.root.find(n=>n.type==='input'&&n.props.id==='zoe-reads');
 assert.equal(reads.props.checked,true);
 await act(async()=>{reads.props.onChange({target:{checked:false}});});
 assert.deepEqual(calls,['zoe_reads_messages:false'],'Switching off withdraws');
 await act(async()=>{tree.unmount();});
 {const t=await mount(React.createElement(ZoeConsents,{locale,initial:{readsMessages:true,scheduledQuestions:false},directAnswers:true}));
  assert.ok(text(t.root).includes(ZOE_DIRECT_ANSWERS[locale]),'Settings line names direct answers while on (F3)');await act(async()=>{t.unmount();});}
 // The Telegram page keeps its Telegram row.
 tree=await mount(React.createElement(ZoeConsents,{locale,initial:{readsMessages:false,scheduledQuestions:false},telegramConnected:false}));
 assert.ok(text(tree.root).includes('Telegram'),'Telegram page keeps its row');
 await act(async()=>{tree.unmount();});
}
console.log('Zoe consent card and My consents EN/HY: statement, OK grants, Not now records nothing, failure alert, switch off withdraws, no Telegram row under Me.');
