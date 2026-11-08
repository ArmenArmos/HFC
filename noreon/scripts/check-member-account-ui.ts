// Actual language settings interaction with server/Next IO supplied. No database writes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {tx} from '@/lib/patient/copy';
import type {PatientLocale} from '@/lib/patient/copy';
import type {SaveResult} from '@/lib/patient/types';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
let result:SaveResult={ok:true,revision:2},refreshes=0;
const code=ts.transpileModule(readFileSync('components/patient/language-preference.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
const exports:Record<string,unknown>={};
const modules:Record<string,unknown>={
 react:React,'react/jsx-runtime':jsx,
 'lucide-react':{Check:()=>null,Languages:()=>null},
 '@/components/patient-care/common':{IconTile:()=>null},
 'next/navigation':{useRouter:()=>({refresh:()=>refreshes++})},
 '@/app/patient/account/locale-actions':{saveLanguagePreference:async()=>result},
 '@/lib/patient/transport':{safeRequest:(action:()=>Promise<SaveResult>)=>action()},
 '@/lib/patient/copy':{tx},'./sign-in-ended':{SignInEnded:()=>React.createElement('p',{'data-signed-out':true})},
};
new vm.Script(code).runInNewContext({exports,require:(id:string)=>{assert.ok(id in modules,`Unexpected module ${id}`);return modules[id];}});
const LanguagePreference=exports.LanguagePreference as React.ComponentType<{locale:PatientLocale;revision:number}>;
for(const locale of ['en','hy','ru'] as const){
 const next=locale==='en'?'hy':'en';
 let tree!:ReactTestRenderer;
 result={ok:true,revision:2};refreshes=0;
 await act(async()=>{tree=create(React.createElement(LanguagePreference,{locale,revision:1}));});
 await act(async()=>{tree.root.findAllByType('button').find(n=>n.props.children.includes(next==='hy'?'Հայերեն':'English'))!.props.onClick();});
 assert.equal(refreshes,1,'Successful save refreshes translated page');
 assert.equal(tree!.root.findAllByType('button').find(n=>n.props['aria-pressed'])!.props.children.includes(next==='hy'?'Հայերեն':'English'),true,'Saved language is visibly selected');
 assert.equal(tree!.root.findAll(n=>n.props.role==='status').length,1,'Successful save is announced');
 await act(async()=>tree!.unmount());
 result={ok:false,reason:'unavailable'};refreshes=0;
 await act(async()=>{tree=create(React.createElement(LanguagePreference,{locale,revision:1}));});
 await act(async()=>{tree.root.findAllByType('button').find(n=>n.props.children.includes(next==='hy'?'Հայերեն':'English'))!.props.onClick();});
 assert.equal(refreshes,0,'Failed save does not refresh');
 assert.equal(tree!.root.findAll(n=>n.props.role==='alert').length,1,'Failed save is announced');
 assert.equal(tree!.root.findAll(n=>n.props.role==='status').length,0,'Failed save claims no success');
 await act(async()=>tree!.unmount());
}
console.log('Language preference EN/HY/RU: saved selection and live confirmation; failed save has an alert and no success claim (mocked IO).');

// Mount the actual account card, supplying only IO and the independently tested child forms.
const accountExports:Record<string,unknown>={};
const refreshSections:string[]=[];
let consentView:{readsMessages:boolean;scheduledQuestions:boolean;canGrant:boolean;directAnswers:boolean}|null={readsMessages:true,scheduledQuestions:false,canGrant:false,directAnswers:true};
const accountModules:Record<string,unknown>={
 ...modules,
 './sign-out-button':{SignOutButton:()=>React.createElement('button',{'data-signout':true},'Sign out')},
 './profile-form':{ProfileForm:()=>React.createElement('div',{'data-profile':true})},
 './language-preference':{LanguagePreference:()=>React.createElement('div',{'data-language':true})},
 './text-size-preference':{TextSizePreference:({value,onSaved}:{value:string;onSaved:unknown})=>React.createElement('div',{'data-text-size':value,onSaved})},
 './zoe-consents':{ZoeConsents:(props:Record<string,unknown>)=>React.createElement('div',{'data-consents':true,'data-can-grant':props.canGrant,'data-direct':props.directAnswers,'data-reads':(props.initial as {readsMessages:boolean}).readsMessages,onSaved:props.onSaved})},
 '@/components/patient-care/reminder-settings':{ReminderSettings:()=>React.createElement('div',{'data-reminders':true})},
 '@/components/messaging/message-settings':{MessagePreferences:()=>React.createElement('div',{'data-messages':true})},
 '@/components/patient-care/common':{copy:(l:PatientLocale,en:string,hy:string,ru:string)=>tx(l,hy,en,ru)},
 '@/components/ui/button':{Button:({children,...props}:React.PropsWithChildren<Record<string,unknown>>)=>React.createElement('button',props,children)},
 '@/lib/zoe-chat-actions/account-actions':{readAccountSettingsFromCard:async()=>({status:'ok',data:{profile:{locale:'en'},assessment:{revision:1},textSize:'large',zoe:consentView}}),saveAccountFromCard:async()=>({status:'unavailable'})},
};
const accountCode=ts.transpileModule(readFileSync('components/patient/zoe-account.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new vm.Script(accountCode).runInNewContext({exports:accountExports,CustomEvent:globalThis.CustomEvent,window:{dispatchEvent:(event:CustomEvent<{section:string}>)=>{refreshSections.push(event.detail.section);return false;}},require:(id:string)=>{assert.ok(id in accountModules,`Unexpected account module ${id}`);return accountModules[id];}});
const ZoeAccount=accountExports.ZoeAccount as React.ComponentType<Record<string,unknown>>;
for(const locale of ['en','hy','ru'] as const){
 let tree!:ReactTestRenderer;
 const props={card:{id:'synthetic',state:'open',outcome:{}},locale,onCard:()=>{}};
 await act(async()=>{tree=create(React.createElement(ZoeAccount,{...props,initialSection:'text-size'}));});
 assert.equal(tree.root.findAll(n=>n.props['data-text-size']==='large').length,1,'Text-size section embeds the existing form with saved value');
 assert.equal(tree.root.findAllByType('a').length,0,'Account controls stay in the chat');
 assert.equal(tree.root.findAll(n=>n.props['data-signout']).length,1,'Sign out remains accessible');
 await act(async()=>tree.root.find(n=>n.props['data-text-size']).props.onSaved('xlarge'));
 assert.equal(tree.root.find(n=>n.props['data-text-size']).props['data-text-size'],'xlarge','Text-size value updates before refresh');
 assert.equal(refreshSections.at(-1),'text-size','Text-size save requests current account with same section');
 assert.equal(tree.root.findByType('fieldset').props.disabled,true,'Old token controls stay disabled if refresh fails');
 await act(async()=>tree.unmount());
 await act(async()=>{tree=create(React.createElement(ZoeAccount,{...props,initialSection:'privacy'}));});
 await act(async()=>{tree.update(React.createElement(ZoeAccount,{...props,initialSection:'privacy'}));});
 const consents=tree.root.find(n=>n.props['data-consents']);
 assert.equal(consents.props['data-can-grant'],false,'Current consent gate reaches embedded form');
 assert.equal(consents.props['data-direct'],true,'Direct-answer disclosure reaches embedded form');
 await act(async()=>consents.props.onSaved({readsMessages:false,scheduledQuestions:false}));
 assert.equal(tree.root.find(n=>n.props['data-consents']).props['data-reads'],false,'Consent values update before refresh');
 assert.equal(refreshSections.at(-1),'privacy','Consent save requests current privacy section');
 assert.equal(tree.root.findByType('fieldset').props.disabled,true,'Old consent token controls remain disabled until refresh');
 await act(async()=>tree.unmount());
 consentView=null;
 await act(async()=>{tree=create(React.createElement(ZoeAccount,{...props,initialSection:'privacy'}));});
 assert.equal(tree.root.findAll(n=>n.props.role==='status').length,1,'Unavailable consents have clear status');
 await act(async()=>tree.unmount());
 consentView={readsMessages:true,scheduledQuestions:false,canGrant:false,directAnswers:true};
}
console.log('Account sections EN/HY/RU: embedded text size and privacy, prop-based section changes, consent gates, unavailable status and accessible sign out (mocked IO/child boundaries).');
