/** Real card views; only server action IO is replaced. No browser/database evidence. */
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,resolve} from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {cardSchema,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {MESSAGE} from '@/lib/zoe-chat-actions/copy';
import {LAB_VISIT} from '@/lib/zoe-chat-actions/lab-visit-copy';
import {NEXT_STEP} from '@/lib/zoe-chat-actions/next-step-copy';
import {dialogThread} from '@/lib/zoe-chat-actions/thread';
import {chatNextStep} from '@/lib/zoe-chat-actions/next-step';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const native=createRequire(import.meta.url),cache=new Map<string,Record<string,unknown>>();
let finish:((r:unknown)=>void)|undefined;
const inputs:unknown[]=[];
const action=(input:unknown)=>{inputs.push(input);return new Promise(resolve=>{finish=resolve;});};
function load(file:string):Record<string,unknown>{
 file=resolve(file);if(cache.has(file))return cache.get(file)!;
 const exports:Record<string,unknown>={};cache.set(file,exports);
 const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
 vm.runInNewContext(code,{exports,process:{env:{}},window:{dispatchEvent(){}},Event,CustomEvent,crypto:globalThis.crypto,Date,Intl,setTimeout,clearTimeout,console,require(name:string):unknown{
  if(name==='@/components/patient/zoe-booking')return {ZoeBooking:()=>React.createElement('div',{'data-shared-booking':true})};
  if(name==='@/components/patient/zoe-everyday')return {ZoePlanDetails:()=>null};
  if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
  if(name==='@/lib/zoe-chat-actions/next-step-actions')return {followNextStep:action,requestReviewFromCard:action};
  if(name==='@/lib/zoe-chat-actions/actions')return {sendFromCard:action,openZoeCard:action};
  if(name==='@/lib/zoe-chat-actions/labs-actions')return {askAdminToChangeVisit:action};
  if(name==='@/lib/zoe-chat-actions/booking-actions')return {bookVisitFromCard:action};

  if(name==='@/components/patient/sign-in-ended'||name==='./sign-in-ended')return {SignInEnded:()=>React.createElement('p',null,'Sign in again'),signInAgain:()=>'/patient'};
  if(name==='next/link')return {default:({children,...props}:React.ComponentProps<'a'>)=>React.createElement('a',props,children)};
  if(name==='@/components/ui/button')return {Button:({children,...props}:React.ComponentProps<'button'>)=>React.createElement('button',props,children)};
  if(name.startsWith('@/')||name.startsWith('.')){const path=name.startsWith('@/')?resolve(name.slice(2)):resolve(dirname(file),name);for(const ext of ['','.tsx','.ts'])if(existsSync(path+ext))return load(path+ext);}
  return native(name);
 }});return exports;
}
const {NextStepCard,ReviewCard}=load('components/chat-v2/next-step-card.tsx') as typeof import('../components/chat-v2/next-step-card');
const card=cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'next_step',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-02T10:00:00Z',snapshot:chatNextStep({questionnaireComplete:true,review:null,appointments:[],clinics:{},canBook:true,hasOpenRequest:false,lab:null,planPublished:false,now:new Date()},{episode:'a'})});
assert.ok(card.valid&&(card.kind==='next_step'||card.kind==='tests_needed'));
const updates:ZoeCard[]=[];
for(const locale of ['hy','en','ru']as const){
 let view:ReactTestRenderer;
 await act(async()=>{view=create(React.createElement(NextStepCard,{card,locale,onCard:c=>updates.push(c),onAct:()=>{},onMessage:()=>{}}));});
 assert.match(JSON.stringify(view!.toJSON()),new RegExp(NEXT_STEP.seeTests[locale]));
 const button=()=>view!.root.findByProps({'data-next-step-target':'tests_needed'});
 await act(async()=>{button().props.onClick();});
 assert.equal(button().props.disabled,true,'An in-flight press is disabled');
 await act(async()=>{finish!({status:'unavailable'});});
 const rendered=JSON.stringify(view!.toJSON());
 assert.ok(!rendered.includes(NEXT_STEP.unavailable[locale]),'Old bare unavailable alert is gone');
 const retry=view!.root.findAllByType('button').find(b=>b.props.children===NEXT_STEP.retry[locale]);
 assert.ok(retry,'Failure has a real retry button');
 assert.ok(view!.root.findAllByType('button').some(b=>b.props.children===NEXT_STEP.careTeam[locale]));
 assert.equal(retry.props.disabled,false);
 await act(async()=>{retry.props.onClick();});
 const done=cardSchema.parse({...card,state:'done',outcome:{next_step:{target:'visit',doneAt:'2026-11-02T11:00:00Z'}}});
 const target=cardSchema.parse({...card,id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'visit',snapshot:{v:1,available:true,next:null,proposal:null,attention:false}});
 await act(async()=>{finish!({status:'ok',card:done,next:target});});
 assert.equal(updates.at(-2)?.state,'done');assert.equal(updates.at(-1)?.kind,'visit');
 await act(async()=>view!.unmount());
}
for(const input of inputs)assert.deepEqual(Object.keys(input as object),['cardId'],'Browser cannot supply member, target, tests or clinical payload');
// Failed follows and partially delivered receipts must not claim a card opened.
assert.equal(dialogThread([],[card]).filter(e=>e.type==='turn').length,0);
const target=cardSchema.parse({...card,id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'visit',snapshot:{v:1,available:true,next:null,proposal:null,attention:false}});
const saved=cardSchema.parse({...card,state:'done',outcome:{next_step:{target:'visit',requestId:target.requestId,doneAt:target.at}}});
assert.equal(dialogThread([],[saved]).filter(e=>e.type==='turn').length,0,'No orphan opened line before its target arrives');
const dialog=dialogThread([],[saved,target]);
assert.equal(dialog.filter(e=>e.type==='turn').length,1);assert.equal(dialog.filter(e=>e.type==='card'&&e.card.id===target.id).length,1,'Success has its linked card');
for(const kind of ['next_step','review']as const){
 const failedCard=kind==='next_step'?card:cardSchema.parse({...card,kind:'review',snapshot:{v:1}});
 assert.ok(failedCard.valid&&(failedCard.kind==='next_step'||failedCard.kind==='review'));
 let messages=0;let view:ReactTestRenderer;
 const props={card:failedCard,locale:'hy' as const,onCard:()=>{},onAct:()=>{},onMessage:()=>{messages++;}};
 await act(async()=>{view=create(failedCard.kind==='review'?React.createElement(ReviewCard,{...props,card:failedCard}):React.createElement(NextStepCard,{...props,card:failedCard}));});
 await act(async()=>{view!.root.findByType('button').props.onClick();});
 await act(async()=>{finish!({status:'unavailable'});});
 const rendered=JSON.stringify(view!.toJSON());assert.ok(rendered.includes('Փորձել նորից'));assert.ok(!rendered.includes(NEXT_STEP.unavailable.hy));
 const buttons=view!.root.findAllByType('button');
 assert.notEqual(buttons.find(b=>b.props.children===NEXT_STEP.careTeam.hy)!.props.disabled,true,'Care-team recovery remains actionable');
 await act(async()=>buttons.find(b=>b.props.children===NEXT_STEP.careTeam.hy)!.props.onClick());assert.equal(messages,1,'Care team uses the supplied menu opener');
 const count=inputs.length;await act(async()=>buttons.find(b=>b.props.children==='Փորձել նորից')!.props.onClick());assert.equal(inputs.length,count+1,'Retry reruns the action');
 await act(async()=>finish!({status:'signed_out'}));
 assert.ok(JSON.stringify(view!.toJSON()).includes('Sign in again'));assert.ok(!JSON.stringify(view!.toJSON()).includes('Փորձել նորից'),'Signed-out stays unchanged');
 await act(async()=>view!.unmount());
}
// The wrapper's failure/empty decisions are tested with actual schema-backed cards.
const {ResultsMessageCard}=load('components/chat-v2/results-message-card.tsx') as typeof import('../components/chat-v2/results-message-card');
for(const [available,want]of [[false,NEXT_STEP.unavailable.en],[true,NEXT_STEP.waitingResults.en]]as const){
 const result=cardSchema.parse({...card,kind:'results',snapshot:{v:1,available,publishedAt:null,rows:[],more:0}});assert.ok(result.valid&&result.kind==='results');
 let view:ReactTestRenderer;await act(async()=>{view=create(React.createElement(ResultsMessageCard,{card:result,locale:'en',onCard:()=>{},onAct:()=>{}}));});
 assert.match(JSON.stringify(view!.toJSON()),new RegExp(want));await act(async()=>view!.unmount());
}
console.log('Next-step views: HY/EN/RU, pending/disabled/retry, action payload, target delivery and explicit read failures passed');

const pdf=cardSchema.parse({...card,kind:'results',snapshot:{v:1,available:true,publishedAt:null,rows:[],more:0,documents:[{fileId:'00000000-0000-4000-8000-000000000009',clinic:'Fixture lab',uploadedAt:'2026-11-02T08:00:00Z',releasedAt:'2026-11-02T09:00:00Z'}]}});
assert.ok(pdf.valid&&pdf.kind==='results');
let pdfView:ReactTestRenderer;await act(async()=>{pdfView=create(React.createElement(ResultsMessageCard,{card:pdf,locale:'en',onCard:()=>{},onAct:()=>{}}));});
const link=pdfView!.root.findByType('a');assert.equal(link.props.href,'/patient/documents/00000000-0000-4000-8000-000000000009');assert.equal(link.props.target,'_blank');
assert.ok(!JSON.stringify(pdfView!.toJSON()).includes(NEXT_STEP.waitingResults.en),'Released PDF must not be called waiting');await act(async()=>pdfView!.unmount());
const message=cardSchema.parse({...card,kind:'message',snapshot:{v:1}});assert.ok(message.valid&&message.kind==='message');
let messageView:ReactTestRenderer;await act(async()=>{messageView=create(React.createElement(ResultsMessageCard,{card:message,locale:'en',onCard:()=>{},onAct:()=>{}}));});
assert.equal(messageView!.root.findByType('textarea').props.maxLength,4096);
await act(async()=>messageView!.root.findByType('textarea').props.onChange({target:{value:'A question for my doctor'}}));
await act(async()=>messageView!.root.findByType('form').props.onSubmit({preventDefault(){}}));
const send=()=>messageView!.root.findAllByType('button').find(b=>b.props.children===MESSAGE.send.en)!;
await act(async()=>{send().props.onClick();});assert.equal(send().props.disabled,true);const sent=inputs.at(-1) as {kind:string;text:string;requestId:string};assert.equal(sent.kind,'message');assert.equal(sent.text,'A question for my doctor');
await act(async()=>{finish!({status:'unavailable'});});await act(async()=>{send().props.onClick();});assert.equal((inputs.at(-1)as {requestId:string}).requestId,sent.requestId,'Same confirmed text retries through existing request id');await act(async()=>{finish!({status:'unavailable'});});await act(async()=>messageView!.unmount());
console.log('Released PDF opens the audited document path; doctor message retains confirmation, 4096 limit and retry identity');

// The labs visit owns the booking form; PR 13 adds its shared in-chat recovery control.
const {VisitCard,SavedVisitTurn}=load('components/chat-v2/visit-card.tsx') as typeof import('../components/chat-v2/visit-card');
const visit=cardSchema.parse({...card,kind:'visit',snapshot:{v:1,available:true,next:null,proposal:null,attention:false,bookingToken:'a'.repeat(64)}});
assert.ok(visit.valid&&visit.kind==='visit');
for(const current of [false,true]){
 let view:ReactTestRenderer;
 await act(async()=>{view=create(React.createElement(VisitCard,{card:visit,locale:'en',onCard:c=>updates.push(c),onAct:()=>{},current}));});
 assert.equal(view!.root.findAllByProps({'data-shared-booking':true}).length,1,'A visit delegates to one shared booking form');
 assert.equal(view!.root.findAll(n=>n.type==='button'&&n.props['data-zoe-show-current']===true).length,current?1:0,'Continuation recovery is opt-in; the main view stays unchanged');
 if(current){
  await act(async()=>{view!.root.findAll(n=>n.type==='button'&&n.props['data-zoe-show-current']===true)[0].props.onClick();});
  assert.equal((inputs.at(-1) as {kind:string}).kind,'visit');
  await act(async()=>{finish!({status:'ok',card:visit});});
  assert.equal(updates.at(-1)?.id,visit.id,'Shared recovery delivers the refreshed visit');
 }
 await act(async()=>view!.unmount());
}
for(const [booking,expected]of [[{kind:'admin_change',ok:true},LAB_VISIT.adminReply.en],[{kind:'select',ok:false,outcomeUnknown:true},'Your visit is not confirmed.']] as const){
 const saved=cardSchema.parse({...visit,state:'done',outcome:{booking}});assert.ok(saved.valid&&saved.kind==='visit');
 let view:ReactTestRenderer;
 await act(async()=>{view=create(React.createElement(SavedVisitTurn,{card:saved,locale:'en',time:'10:00',onCard:()=>{}}));});
 const rendered=JSON.stringify(view!.toJSON());
 assert.equal(view!.root.findAll(n=>n.type==='button'&&n.props['data-zoe-show-current']===true).length,1,'Every saved visit retains in-chat recovery');
 assert.ok(rendered.includes(expected),'Main’s saved admin-change or unconfirmed reply is preserved');
 await act(async()=>view!.unmount());
}
console.log('Merged visit views: one shared booking form, opt-in in-chat recovery, admin-change and unknown-outcome receipts pass. Mocked booking IO.');
