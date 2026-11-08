import * as textLanguage from '@/lib/text-language';
import * as testCatalogue from '@/lib/clinical/seed/tests';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as locale from '@/lib/locale';
import * as display from '@/lib/real-booking/display-time';
import * as gate from '@/lib/real-booking/visit-gate';
import * as catalogue from '@/lib/patient/catalogue-label';
import * as prices from '@/components/pilot-commerce/member-pricing';
import {amd} from '@/lib/pilot-commerce/format';
import * as ldlRetest from '@/lib/ldl/retest';
import {memberGreeting} from '@/lib/patient/greeting';
import {evaluate} from '@/lib/clinical/rules/engine';
import * as engine from '@/lib/clinical/rules/engine';
import * as clinicalTypes from '@/lib/clinical/types';
import * as patientCopy from '@/lib/patient/copy';
import {cardSchema} from '@/lib/zoe-chat-actions/registry';
import * as visitRequest from '@/lib/zoe-chat-actions/visit-request-contract';
import * as labVisitCopy from '@/lib/zoe-chat-actions/lab-visit-copy';
import type {VisitBooking} from '@/lib/zoe-chat-actions/booking-read';
import type {PilotActionState} from '@/lib/real-booking/appointment-schema';

// Actual components and handlers, with only auth/server actions, router and pricing IO replaced.
globalThis.fetch=(()=>{throw Error('Network forbidden in this check');}) as typeof fetch;
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const program=[{id:'blood',title:'Synthetic blood test',method:'lab' as const,preparation:''}];
const offer={id:id(11),version:'v1',clinicId:id(10),clinicName:'Synthetic clinic',mode:'clinic' as const,source:'clinic-hours',startsAt:'2030-01-07T05:00:00Z',endsAt:'2030-01-07T05:30:00Z',timezone:'Asia/Yerevan' as const,clinicAddress:'Synthetic address',preparation:'Synthetic preparation',preparationVersion:'p1',coveredTestIds:['blood'],followUps:[]};
const base:VisitBooking={requestEnabled:false,requestDays:null,requestLocale:'en',token:'a'.repeat(64),hold:null,crisis:false,booking:{data:{available:true,contextToken:'context',requirements:[{id:'blood',title:'Synthetic blood test',method:'lab'}],homeTasks:[],requests:[],homeRequestAvailable:true},pilot:{available:true,canChange:true,canCancel:true,unavailableReason:null,program,offers:[offer],appointments:[]},pricing:undefined,decision:evaluate({answers:{},observations:[]}),homeAvailable:true,doneTestIds:[]}};
let read:VisitBooking=base;
let readStatus='ok',release:((r:unknown)=>void)|null=null,rejectBooking:((error:Error)=>void)|null=null;
const calls:Record<string,unknown>[]=[];
const cache=new Map<string,Record<string,unknown>>(),native=createRequire(import.meta.url);
function load(file:string):Record<string,unknown>{
 file=resolve(file);if(cache.has(file))return cache.get(file)!;
 const exports:Record<string,unknown>={};cache.set(file,exports);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,FormData,fetch:globalThis.fetch,crypto:globalThis.crypto,Date,Intl,require(name:string):unknown{if(name==='@/lib/text-language')return textLanguage;
  if(name==='@/lib/zoe-chat-actions/visit-request-contract')return visitRequest;
  if(name==='@/lib/zoe-chat-actions/lab-visit-copy')return labVisitCopy;
  if(name==='@/components/chat-v2/visit-request-form')return {VisitRequestForm:()=>React.createElement('form',{'data-visit-preference':true})};
  if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
  if(name==='lucide-react')return native(name);
  if(name==='next/link')return {default:({children,...p}:{children:React.ReactNode})=>React.createElement('a',p,children)};
  if(name==='next/navigation')return {useRouter:()=>({refresh:()=>{throw Error('A card must refresh in chat');}})};
  if(name==='@/components/ui/button')return {Button:({children,...p}:{children:React.ReactNode})=>React.createElement('button',p,children)};
  if(name==='@/components/patient-care/common')return {copy:(l:locale.Locale,en:string,hy:string,ru:string)=>locale.pick(l,{en,hy,ru}),CareLink:({children,...p}:{children:React.ReactNode})=>React.createElement('a',p,children)};
  if(name==='./common'&&dirname(file).endsWith('/patient-care'))return {copy:(l:locale.Locale,en:string,hy:string,ru:string)=>locale.pick(l,{en,hy,ru})};
  if(name==='@/lib/zoe-chat-actions/booking-actions')return {readVisitBookingFromCard:async()=>({status:readStatus,data:read}),bookVisitFromCard:async(v:Record<string,unknown>)=>{calls.push(v);return new Promise((r,reject)=>{release=r;rejectBooking=reject;});}};
  if(name==='@/lib/zoe-chat-actions/actions')return {openZoeCard:async()=>({status:'unavailable'})};
  if(name==='@/lib/real-booking/actions')return {memberBookingCommand:()=>{throw Error('A form bypassed its card');}};
  if(name==='@/lib/real-booking/display-time')return display;
  if(name==='@/lib/real-booking/visit-gate')return gate;
  if(name==='@/lib/ldl/retest')return ldlRetest;
  if(name==='@/lib/patient/catalogue-label')return catalogue;
  if(name==='@/lib/clinical/seed/tests')return testCatalogue;
  if(name==='@/lib/locale')return locale;
  if(name==='@/lib/clinical/rules/engine')return engine;
  if(name==='@/lib/clinical/types')return clinicalTypes;
  if(name==='@/lib/patient/copy')return patientCopy;
  if(name==='@/components/pilot-commerce/member-pricing')return prices;
  if(name.startsWith('@/components/'))return load(name.slice(2)+'.tsx');
  if(name.startsWith('./'))return load(resolve(dirname(file),name+'.tsx'));
  throw Error(`Unexpected UI boundary ${name}`);
 }});return exports;
}
const {ZoeBooking}=load('components/patient/zoe-booking.tsx') as typeof import('../components/patient/zoe-booking');
const card=cardSchema.parse({id:id(1),requestId:id(2),kind:'visit',source:'chip',sourceSeq:null,state:'open',outcome:{},at:'2026-11-01T10:00:00Z',snapshot:{v:1,available:true,next:null,proposal:null,attention:false,bookingToken:base.token}});
assert.ok(card.valid&&card.kind==='visit');
const callbacks:unknown[]=[];
const actions:Array<[string,boolean]>=[];
const mount=async(l:locale.Locale='en',track=false,allowRequest=false)=>{let tree!:ReactTestRenderer;await act(async()=>{tree=create(React.createElement(ZoeBooking,{card,locale:l,allowRequest,onCard:(saved:unknown)=>callbacks.push(saved),...(track?{onAct:(id:string,on:boolean)=>actions.push([id,on])}:{})}));});return tree;};
const text=(tree:ReactTestRenderer)=>JSON.stringify(tree.toJSON());
const radio=async(tree:ReactTestRenderer,name:string,value:string)=>act(async()=>tree.root.findAll(n=>n.type==='input'&&(name==='visitChoice'?n.props['data-visit-choice']===true:n.props.name===name)&&n.props.value===value)[0].props.onChange());
for(const l of ['en','hy','ru'] as const){
 const tree=await mount(l);assert.equal(tree.root.findAll(n=>n.type==='input'&&n.props['data-visit-choice']===true).length,2);
 await act(async()=>tree.unmount());
}
const tree=await mount('en',true);
await radio(tree,'visitChoice','clinic');
await act(async()=>tree.root.findByProps({name:'visitDate'}).props.onChange({target:{value:'2030-01-07'}}));
await radio(tree,'offerId',offer.id);
const form=tree.root.findAll(n=>n.type==='form')[0];
let pending!:Promise<void>;
await act(async()=>{pending=form.props.onSubmit({preventDefault(){}});void form.props.onSubmit({preventDefault(){}});});
assert.deepEqual(actions,[[card.id,true]],'V3 marks the local booking action before the server replies');
assert.equal(calls.length,1,'Double submit reaches the card action once');
assert.equal(calls[0].kind,'select');
assert.equal((calls[0].fields as Record<string,string>).homeAddress,'');
const savedCard={...card,state:'done' as const,outcome:{booking:{ok:true,code:'saved'}}};
await act(async()=>{release!({status:'ok',result:{ok:true,code:'saved',commandRecorded:true} satisfies PilotActionState,card:savedCard});await pending;});
assert.equal(callbacks.at(-1),savedCard,'Confirmed booking carries the recorded outcome card to parent refresh');
assert.match(text(tree),/Your request is recorded/);
assert.equal(tree.root.findAll(n=>n.type==='form').length,0,'A saved booking closes every form on the card');
assert.ok(!tree.root.findAll(n=>n.type==='a').some(n=>n.props.href==='/patient/service'),'Recovery stays in chat');
await act(async()=>tree.unmount());
const unknownBooking=await mount();
await radio(unknownBooking,'visitChoice','clinic');
await act(async()=>unknownBooking.root.findByProps({name:'visitDate'}).props.onChange({target:{value:'2030-01-07'}}));
await radio(unknownBooking,'offerId',offer.id);
const unknownForm=unknownBooking.root.findAll(n=>n.type==='form')[0];
const callbackCount=callbacks.length;
await act(async()=>{pending=unknownForm.props.onSubmit({preventDefault(){}});});
await act(async()=>{release!({status:'ok',result:{ok:false,code:'unknown',outcomeUnknown:true},card:{...card,state:'done',outcome:{booking:{ok:false,code:'unknown'}}}});await pending;});
assert.equal(callbacks.length,callbackCount,'Unknown booking result never triggers success refresh');
assert.equal(unknownBooking.root.findByProps({'data-zoe-booking':true}).props.disabled,true,'Unknown booking keeps all controls sealed');
const callsBeforeRetry=calls.length;
await act(async()=>{await unknownForm.props.onSubmit({preventDefault(){}});});
assert.equal(calls.length,callsBeforeRetry,'Unknown booking does not allow a second command');
await act(async()=>unknownBooking.unmount());
const lostBooking=await mount('en',true);
await radio(lostBooking,'visitChoice','clinic');
await act(async()=>lostBooking.root.findByProps({name:'visitDate'}).props.onChange({target:{value:'2030-01-07'}}));
await radio(lostBooking,'offerId',offer.id);
const lostForm=lostBooking.root.findAll(n=>n.type==='form')[0];
const actionCount=actions.length;
await act(async()=>{pending=lostForm.props.onSubmit({preventDefault(){}});});
await act(async()=>{rejectBooking!(Error('Synthetic lost booking response'));await pending;});
assert.deepEqual(actions.slice(actionCount),[[card.id,true]],'A lost booking reply keeps the local action marker until polling recovers its receipt');
assert.equal(lostBooking.root.findByProps({'data-zoe-booking':true}).props.disabled,true,'Lost replies keep the booking form sealed');
await act(async()=>lostBooking.unmount());

let pair!:ReactTestRenderer;
await act(async()=>{pair=create(React.createElement(React.Fragment,null,
 React.createElement(ZoeBooking,{card,locale:'en',onCard:()=>{}}),
 React.createElement(ZoeBooking,{card:{...card,id:id(60)},locale:'en',onCard:()=>{}})));
});
const choiceNames=pair.root.findAll(n=>n.type==='input'&&n.props.value==='clinic').map(n=>n.props.name);
assert.equal(new Set(choiceNames).size,2,'Clinic/home radio groups are isolated between chat cards');
const headingIds=pair.root.findAll(n=>typeof n.type==='string'&&typeof n.props.id==='string').map(n=>n.props.id);
assert.equal(new Set(headingIds).size,headingIds.length,'Repeated chat cards have unique heading ids');
await act(async()=>pair.unmount());

readStatus='stale';const stale=await mount();assert.match(text(stale),/booking details changed/);assert.equal(stale.root.findAll(n=>n.type==='form').length,0);await act(async()=>stale.unmount());
readStatus='ok';read={token:base.token,hold:'questionnaire',crisis:true,booking:null,requestDays:null,requestEnabled:false,requestLocale:'en'};const held=await mount();assert.match(text(held),/tel:103/);assert.match(text(held),/Continue questionnaire/);assert.equal(held.root.findAll(n=>n.type==='form').length,0);await act(async()=>held.unmount());
read=base;const home=await mount();await radio(home,'visitChoice','home');assert.match(text(home),/Send my preferred time/);assert.equal(home.root.findAll(n=>n.props.name==='visitDate').length,0);await act(async()=>home.unmount());
read={...base,booking:{...base.booking!,decision:{...base.booking!.decision,urgency:'orange'}}};
const orange=await mount();assert.match(text(orange),/A medical consultation comes first/);assert.match(text(orange),/They do not replace the consultation/);assert.equal(orange.root.findAll(n=>n.type==='input'&&n.props['data-visit-choice']===true).length,2,'Orange keeps booking available');await act(async()=>orange.unmount());
for(const [hour,en]of [[0,'Hello'],[4,'Hello'],[5,'Good morning'],[12,'Good afternoon'],[18,'Good evening'],[23,'Good evening']] as const){
 const now=new Date(`2026-11-01T${String(hour).padStart(2,'0')}:00:00+04:00`);
 assert.equal(memberGreeting('en',now,'Test'),`${en}, Test`);
 if(hour<5){assert.match(memberGreeting('hy',now,'Test'),/^Բարև,/);assert.match(memberGreeting('ru',now,'Test'),/^Здравствуйте,/);}
}
// The menu visit and the next-step visit both use this shared wrapper. Verify its
// preferred-time path keeps the fixed suggested tests and their full price above the form.
for(const l of ['hy','ru','en']as const){
 const requirements=[{id:'blood',title:'Synthetic blood test',method:'lab' as const},{id:'synthetic-second',title:'Second suggested test',method:'lab' as const}];
 read={...base,requestEnabled:true,requestDays:['2030-01-07'],booking:{...base.booking!,data:{...base.booking!.data,requirements},pilot:{...base.booking!.pilot,available:false,unavailableReason:'configuration-unavailable',offers:[]},pricing:{payments:null,catalog:requirements.map((t,i)=>({testKey:t.id,nameEn:t.title,nameHy:t.title,includedInPackage:false,priceAmd:i?3000:6000,priceSource:'partner-approved'}))}}};
 const request=await mount(l,true,true);
 assert.equal(request.root.findAllByProps({'data-visit-preference':true}).length,1);
 for(const test of requirements)assert.ok(text(request).includes(test.title),'Every suggested test is shown before the request form');
 assert.ok(text(request).includes(amd(9000,l)),'The request path shows the full-set catalog total');
 assert.equal(request.root.findAll(n=>n.type==='input'&&n.props.type==='checkbox'||n.props.role==='switch'||n.props['data-test-remove']).length,0);
 await act(async()=>request.unmount());
}
read=base;
let uploadCalls=0,finishUpload!: (r:Response)=>void;
globalThis.fetch=(async(url:RequestInfo|URL)=>{
 assert.equal(url,'/patient/progress/earlier/upload','The attach button uses the existing secure-app upload route');uploadCalls++;
 return new Promise<Response>(r=>{finishUpload=r;});
}) as typeof fetch;
const {ZoeAttach}=load('components/patient/zoe-attach.tsx') as typeof import('../components/patient/zoe-attach');
let attachment!:ReactTestRenderer;
await act(async()=>{attachment=create(React.createElement(ZoeAttach,{locale:'en'}),{createNodeMock:()=>({value:'',click(){}})});});
const picker=attachment.root.findByType('input'),file=new File(['synthetic'],'synthetic.pdf',{type:'application/pdf'});
await act(async()=>{picker.props.onChange({target:{files:[file]}});picker.props.onChange({target:{files:[file]}});});
assert.equal(uploadCalls,1,'Two synchronous file events upload once');
await act(async()=>finishUpload(Response.json({status:'stored'})));
assert.match(text(attachment),/Your file is saved. It has not been read yet/);
await act(async()=>attachment.unmount());
console.log('Actual booking UI: EN/HY/RU choices, clinic date/time/confirm, double press, locked result, in-chat recovery, home request, stale and crisis/questionnaire holds. Greeting boundaries pass. Mocked actions; no browser or database.');
