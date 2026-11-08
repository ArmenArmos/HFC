import assert from 'node:assert/strict';
import {runVisitBooking,bookingToken} from '@/lib/zoe-chat-actions/booking';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import {cardSchema,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';
import {visitRequestPayload} from '@/lib/zoe-chat-actions/visit-request-contract';

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const token=bookingToken({revision:1});
const actor=mintActor(id(1),'app');
const base=()=>cardSchema.parse({id:id(2),requestId:id(3),source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-01T10:00:00Z',kind:'visit',snapshot:{v:1,available:true,next:null,proposal:null,attention:false,bookingToken:token}});
let card:ZoeCard=base(),current=token,writes=0;
let result={ok:true,code:'saved' as const};
const seen:FormData[]=[];
const ports={
 readCard:async()=>card,
 currentToken:async()=>current,
 claim:async(_member:string,_card:string,item:string,op:string,payload:Record<string,unknown>)=>{
  const c=card.claims[item]??{op,payload};card={...card,claims:{...card.claims,[item]:c}};
  return {ok:true as const,claim:c};
 },
 record:async(_member:string,_card:string,item:string,value:Record<string,unknown>)=>{
  card={...card,state:'done',outcome:{...card.outcome,[item]:value}};return {ok:true as const,card,replayed:false};
 },
 execute:async(_kind:string,form:FormData)=>{writes++;seen.push(form);return result;},
};
const input={cardId:id(2),opId:id(4),kind:'select' as const,fields:{offerId:id(5),offerVersion:'1',homeAddress:''}};
assert.equal((await runVisitBooking(actor,ports,input)).status,'ok');
assert.equal(writes,1);
assert.equal(seen[0].get('commandId'),id(4));
assert.equal(card.state,'done');
assert.equal((await runVisitBooking(actor,ports,input)).status,'closed','A settled card never submits again');
card=base();current='changed';
assert.equal((await runVisitBooking(actor,ports,input)).status,'stale');
assert.equal(writes,1,'Stale context writes nothing');
current=token;card=base();
card.claims.booking={op:id(7),payload:{kind:'select',fields:input.fields}};
assert.equal((await runVisitBooking(actor,ports,{...input,fields:{...input.fields,offerId:id(9)}})).status,'stale','Two tabs cannot substitute a choice');
assert.equal(writes,1);
assert.equal((await runVisitBooking(actor,ports,input)).status,'ok');
assert.equal(seen[1].get('commandId'),id(7),'A retry uses the durable command id');
card=base();result={ok:false,code:'saved'};
await runVisitBooking(actor,ports,{...input,kind:'legacy',fields:{operation:'create',requestId:id(99),commandId:id(98)}});
assert.equal(seen[2].get('requestId'),id(4),'Legacy creation shares the durable id');
assert.equal(seen[2].get('commandId'),id(4));
assert.equal((await runVisitBooking(mintActor(id(1),'telegram'),ports,input)).status,'disabled','No booking forms through Telegram');
assert.equal(bookingToken({b:2,a:1}),bookingToken({a:1,b:2}),'Object key order cannot stale a card');
card=base();
const lost=await runVisitBooking(actor,{...ports,execute:async()=>{throw Error('synthetic transport failure');}},input);
assert.equal(lost.result?.outcomeUnknown,true);
assert.equal(card.state,'done','An unknown result cannot start another choice on this card');
card=base();
await runVisitBooking(actor,{...ports,execute:async()=>({ok:true,code:'saved',providerPending:true})},{...input,kind:'legacy'});
assert.equal((card.outcome.booking as {providerPending?:boolean}).providerPending,true,'Provider-pending cancellation cannot become confirmed cancellation');

// Actual logged app adapters, with member/session/storage and booking actions supplied at their IO boundary.
let enabled=true,signedIn=true,reads=0,journeyMode=false;
const dispatched:string[]=[],logged:string[]=[];
const exports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync('lib/zoe-chat-actions/booking-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const feature=(kind:string)=>async()=>{dispatched.push(kind);return {ok:true,code:'saved'};};
vm.runInNewContext(code,{exports,require(name:string){
 if(name==='zod')return zod;
 if(name==='@/lib/observability/with-logging')return {loggedAction:(name:string,fn:unknown)=>{logged.push(name);return fn;}};
 if(name==='@/lib/patient/member-chat-config')return {memberChatOnlyEnabled:()=>enabled};
 if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>journeyMode};
 if(name==='./visit-request-contract')return {visitRequestPayload};
 if(name==='./actor')return {sessionActor:async()=>signedIn?actor:null,noActor:async()=>({status:'signed_out'})};
 if(name==='./server')return {readZoeCard:ports.readCard,claimCard:ports.claim,recordCard:ports.record};
 if(name==='./booking-read')return {readVisitBooking:async()=>{reads++;return {token:current};}};
 if(name==='./booking')return {runVisitBooking};
 if(name==='@/lib/real-booking/appointment-actions')return {selectMemberAppointment:feature('select'),changeMemberAppointment:feature('change'),cancelMemberAppointment:feature('cancel'),answerMemberProposal:feature('proposal')};
 if(name==='@/lib/real-booking/actions')return {memberBookingCommand:async()=>{dispatched.push('legacy');return {ok:true,message:'Must never enter card outcomes',providerPending:true};}};
 throw Error(`Unexpected adapter boundary ${name}`);
}});
const adapters=exports as typeof import('../lib/zoe-chat-actions/booking-actions');
enabled=false;card=base();
assert.equal((await adapters.bookVisitFromCard(input)).status,'disabled');
assert.equal((await adapters.readVisitBookingFromCard(card.id)).status,'disabled');
assert.equal(reads,0,'Disabled adapters read no booking data');
journeyMode=true;signedIn=false;
assert.equal((await adapters.bookVisitFromCard(input)).status,'signed_out');
assert.equal((await adapters.readVisitBookingFromCard(card.id)).status,'signed_out');
signedIn=true;current=token;
assert.equal((await adapters.readVisitBookingFromCard(card.id)).status,'ok','V3 alone enables the existing inline booking view');
journeyMode=false;enabled=true;
assert.equal((await adapters.readVisitBookingFromCard(card.id)).status,'ok');
current='changed';assert.equal((await adapters.readVisitBookingFromCard(card.id)).status,'stale');current=token;
assert.equal((await adapters.bookVisitFromCard({...input,memberId:id(99)})).status,'invalid','No member id is accepted from the client');
for(const kind of ['select','change','cancel','proposal','legacy'] as const){
 card=base();
 assert.equal((await adapters.bookVisitFromCard({...input,kind})).status,'ok');
 assert.equal(dispatched.at(-1),kind,'Each adapter calls the existing feature action');
 assert.equal('message'in(card.outcome.booking as object),false,'Feature error text never enters the card');
}
assert.deepEqual(logged,['readVisitBookingFromCard','bookVisitFromCard'],'Every new server action is logged');
console.log('Chat booking commands: stale context, settled card, competing payloads, durable ids and app-only boundary. Mocked IO; no database or provider calls.');
