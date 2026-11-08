import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import {cardSchema,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {requestVisitInput,visitRequestPayload,visitRequestAvailable,preferredVisitDays,visitRequestMessage} from '@/lib/zoe-chat-actions/visit-request-contract';
import {runVisitRequest,type VisitRequestPorts} from '@/lib/zoe-chat-actions/visit-request';
import * as trace from '@/lib/zoe/trace';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const now=new Date('2026-11-04T21:00:00Z'); // Already Thursday in Yerevan.
const days=preferredVisitDays([],now);
assert.equal(days[0],'2026-11-06');
assert.equal(days.at(-1),'2026-11-19');
assert.equal(days.length,10);
assert.deepEqual(preferredVisitDays([{weekday:7}],now),['2026-11-08','2026-11-15']);
assert.equal(days.includes('2026-11-05'),false,'Today is excluded in the clinic timezone');
const pilot={available:false,unavailableReason:'configuration-unavailable',offers:[],appointments:[]};
const read={hold:null,booking:{pilot,data:{available:true,requirements:[{}],clinicalHold:false,requests:[]}}};
assert.equal(visitRequestAvailable(read),true);
assert.equal(visitRequestAvailable({...read,booking:{...read.booking,data:{...read.booking.data,requirements:[]}}}),false,'No logistics request when every suggested test is already fresh');
assert.equal(visitRequestAvailable({...read,booking:{...read.booking,data:{...read.booking.data,available:false}}}),false,'An unreadable engine set cannot open logistics');
assert.equal(visitRequestAvailable({...read,booking:{...read.booking,pilot:{...pilot,unavailableReason:'source-unavailable'}}}),true);
for(const reason of ['clinical-hold','profile-mismatch','unavailable','legacy-reconciliation',null])assert.equal(visitRequestAvailable({...read,booking:{...read.booking,pilot:{...pilot,unavailableReason:reason}}}),false);
for(const hold of ['urgent','questionnaire'])assert.equal(visitRequestAvailable({...read,hold}),false);
assert.equal(visitRequestAvailable({...read,booking:{...read.booking,pilot:{...pilot,offers:[{}]}}}),false);
assert.equal(visitRequestAvailable({...read,booking:{...read.booking,pilot:{...pilot,appointments:[{}]}}}),false);
assert.equal(visitRequestAvailable({...read,booking:{...read.booking,data:{...read.booking.data,clinicalHold:true}}}),false);
const input={cardId:id(2),opId:id(4),day:days[0],window:'morning',note:' Please call first. '};
const parsed=requestVisitInput.parse(input);
assert.equal(parsed.note,'Please call first.');
for(const bad of [{day:'2026-02-30'},{window:'noon'},{note:'x'.repeat(201)},{note:'<b>test</b>'},{note:'test\ntext'},{text:'Forged whole message'},{memberId:id(99)},{locale:'ru'}])assert.equal(requestVisitInput.safeParse({...input,...bad}).success,false);
assert.equal(visitRequestMessage(parsed),'Visit request: Friday, 6 November 2026, morning. Please call first.');
const actor=mintActor(id(1),'app');
const base=()=>cardSchema.parse({id:id(2),requestId:id(3),kind:'visit',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-04T10:00:00Z',snapshot:{v:1,available:true,next:null,proposal:null,attention:false,bookingToken:'a'.repeat(64)}});
let card:ZoeCard=base(),failure='',current=true;
let availableDays:string[]|null=days;
const tasks=new Set<string>(),messages=new Map<string,string>(),events:string[]=[];
const ports:VisitRequestPorts={
 readCard:async()=>card,
 current:async()=>({token:current?'a'.repeat(64):'b'.repeat(64),available:current,days:availableDays}),
 claim:async(_m,_c,item,op,payload)=>{if(failure==='claim'){failure='';return {ok:false,code:'unavailable'};}const c=card.claims[item]??{op,payload};card={...card,claims:{...card.claims,[item]:c}};return {ok:true,claim:c};},
 raise:async source=>{events.push('task');tasks.add(source);if(failure==='task'){failure='';throw Error('Lost task reply');}return true;},
 send:async(op,text)=>{events.push('message');messages.set(op,text);if(failure==='message'){failure='';throw Error('Lost message reply');}return {status:'sent'};},
 record:async(_m,_c,item,value)=>{events.push('record');if(failure==='record'){failure='';return {ok:false,code:'unavailable'};}card={...card,state:'done',outcome:{[item]:value}};return {ok:true,card,replayed:false};},
 trace:async step=>{events.push(`trace:${step}`);},
};
const reset=()=>{card=base();tasks.clear();messages.clear();events.length=0;current=true;availableDays=days;};
for(const step of ['claim','task','message','record']){
 reset();failure=step;
 assert.equal((await runVisitRequest(actor,ports,parsed)).status,'unavailable',step);
 assert.equal(card.state,'open');
 if(step!=='claim')assert.equal(visitRequestPayload.safeParse(card.claims.booking.payload).success,true,'The request survives failure');
 assert.ok(events.includes(`trace:${step}`),'Failures are traced without member text');
 if(step!=='claim'){current=false;availableDays=[];} // Retry survives a changed configuration or a day rolling over.
 assert.equal((await runVisitRequest(actor,ports,parsed)).status,'ok',`Recover ${step}`);
 assert.equal(tasks.size,1);assert.equal(messages.size,1);
 assert.equal([...tasks][0],`visit-request:${card.id}`);
 assert.equal(messages.get(parsed.opId),visitRequestMessage(parsed));
 assert.equal((card.outcome.booking as {kind:string}).kind,'visit_request');
 const count=events.length;
 assert.equal((await runVisitRequest(actor,ports,parsed)).status,'ok','Lost final reply is a successful replay');
 assert.equal(events.length,count,'Settled replay makes no calls');
}
reset();
for(const day of ['2026-11-05','2026-11-07','2026-11-20'])assert.equal((await runVisitRequest(actor,ports,{...parsed,day})).status,'invalid');
assert.equal(tasks.size,0);
current=false;assert.equal((await runVisitRequest(actor,ports,parsed)).status,'stale');
reset();failure='task';await runVisitRequest(actor,ports,parsed);
assert.equal((await runVisitRequest(actor,ports,{...parsed,note:'Different note'})).status,'stale','A competing tab cannot replace the durable request');
assert.equal((await runVisitRequest(mintActor(id(1),'telegram'),ports,parsed)).status,'disabled');
reset();await Promise.all([runVisitRequest(actor,ports,parsed),runVisitRequest(actor,ports,parsed)]);
assert.equal(tasks.size,1);assert.equal(messages.size,1,'Concurrent retries use the same message identity');
// The adapter is also checked with injected boundaries below; SQL checks cover real RPC uniqueness separately.
assert.match(readFileSync('scripts/run-checks.mjs','utf8'),/startsWith\('check-'\)/);
console.log('Visit request: availability, clinic dates, validation, server text, replay, concurrency and partial-failure recovery (injected IO).');

// The real authenticated adapter, with IO injected at module boundaries. No secrets, network or real actors.
const {default:ts}=await import('typescript');
const {default:vm}=await import('node:vm');
const {raiseVisitRequestTask}=await import('@/lib/zoe-chat-actions/raise-admin-task');
let v3=true,newChat=true,signedIn=true,actorReads=0;
const rpcCalls:Array<{name:string;args:Record<string,unknown>}>=[],sentTexts:string[]=[],warnings:unknown[]=[];
const adapterExports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync('lib/zoe-chat-actions/visit-request-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports:adapterExports,require(name:string){
 if(name==='@/lib/observability/with-logging')return {loggedAction:(_name:string,fn:unknown)=>fn};
 if(name==='@/lib/observability/logger')return {log:{warn:(_text:string,fields:unknown)=>warnings.push(fields)}};
 if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>v3};
 if(name==='@/lib/patient/member-chat-config')return {newChatHome:()=>v3&&newChat};
 if(name==='./actor')return {sessionActor:async()=>{actorReads++;return signedIn?actor:null;},noActor:async()=>({status:'signed_out'})};
 if(name==='./server')return {readZoeCard:ports.readCard,claimCard:ports.claim,recordCard:ports.record,serviceRpc:()=>async(name:string,args:Record<string,unknown>)=>{rpcCalls.push({name,args});return {ok:true};}};
 if(name==='./booking-read')return {readVisitBooking:async()=>({...read,token:'a'.repeat(64),requestDays:days})};
 if(name==='./visit-request-contract')return {requestVisitInput,visitRequestAvailable};
 if(name==='./visit-request')return {runVisitRequest};
 if(name==='./raise-admin-task')return {raiseVisitRequestTask};
 if(name==='@/app/patient/zoe/chat-actions')return {sendZoeChatMessage:async(_id:string,text:string,toDoctor:boolean,inline:boolean)=>{assert.equal(toDoctor,true);assert.equal(inline,undefined);sentTexts.push(text);return {status:'sent'};}};
 if(name==='@/lib/zoe/trace')return trace;
 throw Error(`Unexpected visit-request adapter dependency ${name}`);
}});
const adapter=adapterExports as typeof import('../lib/zoe-chat-actions/visit-request-actions');
reset();v3=false;assert.equal((await adapter.requestVisitFromCard(parsed)).status,'disabled');
v3=true;newChat=false;assert.equal((await adapter.requestVisitFromCard(parsed)).status,'disabled');
assert.equal(actorReads,0,'Both switches stop the action before auth or database reads');
newChat=true;signedIn=false;assert.equal((await adapter.requestVisitFromCard(parsed)).status,'signed_out');
signedIn=true;
assert.equal((await adapter.requestVisitFromCard({...parsed,memberId:id(99)})).status,'invalid');
assert.equal((await adapter.requestVisitFromCard(parsed)).status,'ok');
assert.equal(rpcCalls.length,1);assert.equal(rpcCalls[0].name,'care_queue_raise');
assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls[0].args)),{p_member:actor.memberId,p_queue:'admin',p_zone:null,p_reason:'lab_booking_needed',p_rule_version:rpcCalls[0].args.p_rule_version,p_red_flags:null,p_action:'book',p_summary:{},p_sla:null,p_source_ref:`visit-request:${parsed.cardId}`});
assert.equal(sentTexts[0],visitRequestMessage(parsed));
await adapter.requestVisitFromCard(parsed);
assert.equal(sentTexts.length,1);assert.equal(rpcCalls.length,1);
reset();failure='record';
assert.equal((await adapter.requestVisitFromCard(parsed)).status,'unavailable');
assert.deepEqual(JSON.parse(JSON.stringify(rpcCalls.at(-1))),{
 name:'zoe_chat_action_trace',
 args:{p_member:actor.memberId,p_name:'zoe.visit_request',p_outcome:'block',p_reason:'record_unavailable',p_rule:'zoe.visit_request',p_rule_version:'visit-request-2026-11-04',
  p_attributes:{'noreon.card_id':parsed.cardId,'noreon.operation_id':parsed.opId,step:'record'}},
},'The real trace handler and helper send the fixed decision fields to the current service RPC');
assert.equal(JSON.stringify(warnings).includes(parsed.note),false,'No note in log attributes');
assert.equal(JSON.stringify(rpcCalls.at(-1)).includes(parsed.day),false,'No preference fields in traces');

// Definite refusals and failed reads preserve an open form without creating later effects.
reset();
assert.equal((await runVisitRequest(actor,{...ports,current:async()=>{throw Error('read failed');}},parsed)).status,'unavailable');
assert.deepEqual(events,['trace:read']);
reset();availableDays=null;
assert.equal((await runVisitRequest(actor,ports,parsed)).status,'unavailable');
assert.equal(tasks.size,0);
reset();
assert.equal((await runVisitRequest(actor,{...ports,raise:async()=>false},parsed)).status,'unavailable');
assert.equal(messages.size,0);
reset();
assert.equal((await runVisitRequest(actor,{...ports,send:async()=>({status:'unavailable'})},parsed)).status,'unavailable');
assert.equal(card.state,'open');
assert.equal((await runVisitRequest(actor,ports,parsed)).status,'ok');
reset();
const record=ports.record;
assert.equal((await runVisitRequest(actor,{...ports,record:async(...args)=>{await record(...args);throw Error('Lost recorded reply');}},parsed)).status,'unavailable');
assert.equal(card.state,'done');
assert.equal((await runVisitRequest(actor,ports,parsed)).status,'ok');
assert.equal(tasks.size,1);assert.equal(messages.size,1);
reset();card={...card,state:'done',outcome:{booking:{kind:'proposal',ok:true}}};
assert.equal((await runVisitRequest(actor,ports,parsed)).status,'closed','An existing appointment result is unchanged');
console.log('Visit request app adapter: V3/new-chat gates, auth, fixed empty admin task, server-built care-team text and privacy-safe failure trace.');

reset();failure='message';
const russian={...ports,current:async()=>({token:'a'.repeat(64),available:true,days,locale:'ru' as const})};
await runVisitRequest(actor,russian,parsed);
const russianText=messages.get(parsed.opId);
assert.match(russianText??'',/^Заявка на визит:/);
assert.equal((await runVisitRequest(actor,{...ports,current:async()=>{throw Error('Retry must use its stored language');}},parsed)).status,'ok');
assert.equal(messages.get(parsed.opId),russianText,'Changing the UI language cannot change a replayed message');
assert.match(visitRequestMessage(parsed,'hy'),/^Այցի հարցում:/);

// Render and invoke the actual form's handlers with only the server action and save hook supplied.
// In particular, a pinned claim includes server metadata which must not become client input on retry.
const React=await import('react'),jsx=await import('react/jsx-runtime');
const {act,create}=await import('react-test-renderer');
const requestContract=await import('@/lib/zoe-chat-actions/visit-request-contract');
const labCopy=await import('@/lib/zoe-chat-actions/lab-visit-copy');
const cardCopy=await import('@/lib/zoe-chat-actions/copy');
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const formCalls:unknown[]=[],uiExports:Record<string,unknown>={};
let submitted:Promise<unknown>|null=null;
const ui=ts.transpileModule(readFileSync('components/chat-v2/visit-request-form.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(ui,{exports:uiExports,require(name:string){
 if(name==='react')return React;if(name==='react/jsx-runtime')return jsx;
 if(name==='@/components/patient/sign-in-ended')return {SignInEnded:()=>null};
 if(name==='@/lib/zoe-chat-actions/visit-request-actions')return {requestVisitFromCard:async(v:unknown)=>{formCalls.push(v);return {status:'ok',card};}};
 if(name==='@/lib/zoe-chat-actions/lab-visit-copy')return labCopy;
 if(name==='@/lib/zoe-chat-actions/visit-request-contract')return requestContract;
 if(name==='@/lib/zoe-chat-actions/copy')return cardCopy;
 if(name==='./use-card-save')return {useCardSave:()=>({busy:false,problem:null,opId:id(4),save:(run:()=>Promise<unknown>)=>{submitted=run();}})};
 throw Error(`Unexpected request form dependency ${name}`);
}});
const {VisitRequestForm}=uiExports as typeof import('../components/chat-v2/visit-request-form');
const pendingCard=cardSchema.parse({...base(),claims:{booking:{op:id(4),payload:{kind:'visit_request',locale:'ru',day:parsed.day,window:parsed.window,note:parsed.note}}}});
assert.ok(pendingCard.valid&&pendingCard.kind==='visit');
let tree!:import('react-test-renderer').ReactTestRenderer;
await act(async()=>{tree=create(React.createElement(VisitRequestForm,{card:pendingCard,days:null,locale:'en',onCard:()=>{},onAct:()=>{},onReload:()=>{}}));});
assert.equal(tree.root.findByType('fieldset').props.disabled,true,'A durable request cannot be edited');
await act(async()=>{tree.root.findByType('form').props.onSubmit({preventDefault(){}});await submitted;});
assert.equal(formCalls.length,1,'The saved form really submits on retry');
assert.deepEqual(JSON.parse(JSON.stringify(formCalls[0])),parsed,'Only the validated client fields are sent, without kind or stored locale');
await act(async()=>tree.unmount());
const openCard=base();assert.ok(openCard.valid&&openCard.kind==='visit');
await act(async()=>{tree=create(React.createElement(VisitRequestForm,{card:openCard,days:null,locale:'en',onCard:()=>{},onAct:()=>{},onReload:()=>{}}));});
assert.equal(tree.root.findAllByType('form').length,0,'Unknown hours do not become fabricated weekday choices');
assert.equal(tree.root.findByType('button').children.join(''),'Load visit days again');
await act(async()=>tree.unmount());
console.log('Visit request form: actual retry handler, immutable saved preference, no server metadata in input and retryable unreadable hours.');

reset();
const redirect=Object.assign(Error('Navigation'),{digest:'NEXT_REDIRECT;replace;/patient/zoe/urgent;307;'});
await assert.rejects(()=>runVisitRequest(actor,{...ports,send:async()=>{throw redirect;}},parsed),error=>error===redirect,'Ordinary urgent navigation is never swallowed by the request card');
assert.equal(card.state,'open','Urgent navigation retains the request claim for later recovery');
assert.ok(visitRequestPayload.safeParse(card.claims.booking.payload).success);
