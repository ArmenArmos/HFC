import * as bpLabel from "@/components/chat-v2/reported-bp-label";
import * as memberStaffNames from "@/lib/member-staff-name.mjs";
import {runChatView} from './zoe-chat-test-view';
import * as memberDates from '@/lib/patient/date-format';
import * as suggestions from '@/lib/chat/suggestions';
import * as tasks from '@/lib/chat/tasks';
import {ChatSuggestions} from '@/components/conversation/chat-suggestions';
/**
 * The member app Zoe chat (one conversation across app and Telegram). SYNTHETIC, no network:
 * 1. the thread layout: both channels in time order, one acknowledgement per run of member
 *    messages, approved replies at their approval time, the plain status while the wording is unapproved;
 * 2. the deterministic test path: an app message runs the same Zoe pipeline as Telegram, so urgent
 *    words stop before any model, logistics routes low, and with real model calls off a real
 *    provider is never called (the database refuses the reservation);
 * 3. the send action: red always wins (urgent opens the 103 screen, even when storing hangs or the
 *    text is over-long), the size cap is Telegram's, retries keep their request id, every call
 *    needs a signed-in member;
 * 4. the chat renders its bubbles, chips, composer and states in EN and HY;
 * 5. the page keeps Call 103 visible in chat mode.
 */
import {loadUrgentViews} from './zoe-urgent-test-view';
import * as cardRegistry from '@/lib/zoe-chat-actions/registry';
import * as cardCopy from '@/lib/zoe-chat-actions/copy';
import * as cardThread from '@/lib/zoe-chat-actions/thread';
import * as everydayContract from '@/lib/zoe-chat-actions/everyday-contract';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {tx} from '@/lib/patient/copy';
import * as screen from '@/lib/zoe/member-screen';
import * as contracts from '@/lib/zoe/app-chat-contracts';
import {chatItems,threadSchema,ZOE_CHAT_MAX,type ZoeThread} from '@/lib/zoe/app-chat-contracts';
import {runZoeJob,type ZoePorts,type ZoeRouting} from '@/lib/zoe/pipeline';
import {createFakeProvider,type ZoeProvider} from '@/lib/zoe/provider';
import {job} from '@/lib/zoe/eval/harness';
import {DEFAULT_ROUTE_CONFIG} from '@/lib/zoe/eval/routing-cases';
import {realtimeStubs} from './realtime-test-stubs';
const realtimeBoundaries=await realtimeStubs();

// 1. Thread layout.
const thread:ZoeThread={ok:true,version:4,ack:'Approved acknowledgement.',zoeReplies:false,settledSeq:0,
 messages:[{seq:1,text:'App one',at:'2026-10-17T10:00:00Z',channel:'app',requestId:'a7000000-0000-4000-8000-0000000000a1'},
  {seq:2,text:'Telegram two',at:'2026-10-17T10:01:00Z',channel:'telegram',requestId:null},
  {seq:3,text:'App three',at:'2026-10-17T11:00:00Z',channel:'app',requestId:'a7000000-0000-4000-8000-0000000000a3'}],
 replies:[{id:'a7000000-0000-4000-8000-0000000000f1',text:'Doctor reply',at:'2026-10-17T10:30:00Z',doctorName:'Dr Synthetic'}],
 answers:[{id:'a7000000-0000-4000-8000-0000000000e1',text:'Zoe logistics answer',at:'2026-10-17T11:04:00Z'}]};
assert.ok(threadSchema.safeParse(thread).success,'The thread contract parses');
assert.ok(!threadSchema.safeParse({...thread,messages:[{...thread.messages[0],author:'doctor'}]}).success,'Strict: unknown fields are refused');
assert.deepEqual(chatItems(thread).map(i=>i.kind),['member','member','reply','member','answer'],'Both channels in time order; no acknowledgement once a reply or Zoe answered; the reply at its approval time; Zoe’s answer at its time');
assert.deepEqual(chatItems({...thread,answers:[]}).map(i=>i.kind),['member','member','reply','member','ack'],'The acknowledgement only after the newest run, never after every message (Khikar 16:24)');
assert.ok(!threadSchema.safeParse({...thread,answers:[{...thread.answers[0],summary:'x'}]}).success,'Strict: an answer carries only id, text and time');
assert.ok(!threadSchema.safeParse({...thread,answers:undefined}).success,'Answers are part of the contract');
assert.equal(chatItems({...thread,answers:[],ack:null}).find(i=>i.kind==='ack')!.text,null,'Unapproved wording: the UI shows a plain status');
// Khikar, 18 Oct 23:56: the app never shows the Telegram acknowledgement (staging wording, STAGING label, 103 line).
assert.equal(chatItems({...thread,answers:[]}).find(i=>i.kind==='ack')!.text,null,'Approved Telegram ack: still only the plain status in the app');
{
 // Conversational replies off (prod today): the same "Zoe is writing", then the plain status.
 const off={...thread,zoeReplies:false,settledSeq:0,answers:[]};
 const at3=Date.parse('2026-10-17T11:00:00Z');
 assert.deepEqual(chatItems(off,at3+60_000).map(i=>i.kind).slice(-2),['member','pending'],'Replies off, run not settled, within the wait: Zoe is writing');
 assert.deepEqual(chatItems({...off,settledSeq:3},at3+1_000).map(i=>i.kind).slice(-2),['member','ack'],'Replies off, run settled with no text: the plain status at once');
 assert.deepEqual(chatItems(off,at3+3*60_000+1).map(i=>i.kind).slice(-2),['member','ack'],'Replies off, no run (sweep off): the plain status after the wait');
 assert.ok(chatItems(off,at3+3*60_000+1).every(i=>i.kind!=='ack'||i.text===null),'Never the ack text');
}
assert.deepEqual(chatItems({messages:[],replies:[],answers:[],ack:null}),[],'Empty thread');
// Conversational replies on (20261018121002 §8): Zoe's own text replaces the acknowledgement; until it comes a
// short status, and the acknowledgement once her run ended with no text or after the 3-minute backstop.
{
 const on={...thread,zoeReplies:true,settledSeq:0};
 const at3=Date.parse('2026-10-17T11:00:00Z');
 assert.deepEqual(chatItems(on,at3+60_000).map(i=>i.kind),['member','member','reply','member','answer'],'Zoe answered the last run: no acknowledgement anywhere');
 const waiting={...on,answers:[]};
 assert.deepEqual(chatItems(waiting,at3+60_000).map(i=>i.kind).slice(-2),['member','pending'],'Within 3 minutes and not settled: Zoe is writing');
 assert.deepEqual(chatItems(waiting,at3+3*60_000+1).map(i=>i.kind).slice(-2),['member','ack'],'After 3 minutes: the plain status');
 assert.deepEqual(chatItems({...waiting,settledSeq:3},at3+1_000).map(i=>i.kind).slice(-2),['member','ack'],'Run finished without a Zoe text: the plain status at once');
 assert.ok(!threadSchema.safeParse({...thread,zoeReplies:undefined}).success,'zoeReplies is part of the contract');
 // Codex follow-up F6: a released doctor reply answers the run too, before and after the wait.
 const doc={...on,messages:[thread.messages[0]!],replies:[{...thread.replies[0]!,at:'2026-10-17T10:01:00Z'}],answers:[]};
 for(const t of [Date.parse('2026-10-17T10:02:00Z'),Date.parse('2026-10-17T10:04:00Z')])assert.deepEqual(chatItems(doc,t).map(i=>i.kind),['member','reply'],'doctor reply: no pending, no acknowledgement');
}
assert.equal(ZOE_CHAT_MAX,4096,'Same cap as a Telegram text message');

// 2. The deterministic test path: an app message through the same pipeline as Telegram.
const TEST={NOREON_ZOE_TEST_LEXICON:'true'};
type Calls={reserve:number;finish:{outcome:string;reason:string}[];provider:number};
const spy=(local:boolean):[ZoeProvider,{n:number}]=>{const count={n:0};const fake=createFakeProvider();return [{...fake,local,complete:async r=>{count.n++;return fake.complete(r);}},count];};
// Mirrors zoe_run_reserve: a non-local provider is refused while model_calls_allowed is false.
const ports=(calls:Calls,modelCallsAllowed:boolean):ZoePorts=>({
 reserve:async(_id,_e,local)=>{calls.reserve++;return local||modelCallsAllowed?{ok:true}:{ok:false,code:'model_calls_not_permitted'};},
 finish:async(_id,input)=>{calls.finish.push({outcome:input.outcome,reason:input.reason});return {ok:true,outcome:input.outcome};}});
const run=async(text:string,opts:{local:boolean;allowed:boolean;env?:Record<string,string>})=>{
 const calls:Calls={reserve:0,finish:[],provider:0};const [provider,count]=spy(opts.local);
 const routing:ZoeRouting={config:{tiers:DEFAULT_ROUTE_CONFIG.tiers},providerFor:()=>provider};
 const r=await runZoeJob(job(text),{provider,ports:ports(calls,opts.allowed),seal:()=>null,env:opts.env??TEST,routing});
 calls.provider=count.n;return {r,calls};
};
// Urgent words: stopped before routing, reservation or any provider.
for(const text of ['My chest hurts and I cannot breathe','կրծքավանդակի ցավ ունեմ']){
 const {r,calls}=await run(text,{local:false,allowed:true});
 assert.equal(r.reason,'urgent_route_no_model_call',`urgent: ${text}`);assert.equal(calls.reserve,0);assert.equal(calls.provider,0);
}
// The unsigned S1 list (no test list): nothing reaches a model, and it is not read as safe.
{const {r,calls}=await run('When is my visit?',{local:true,allowed:true,env:{}});
 assert.equal(r.reason,'urgent_check_unavailable');assert.equal(calls.provider,0);}
// Real model calls off: a real provider is refused at the reservation and never called.
for(const text of ['When is my visit tomorrow?','I have had a mild headache since yesterday']){
 const {r,calls}=await run(text,{local:false,allowed:false});
 assert.equal(r.outcome,'no_output');assert.equal(r.reason,'model_calls_not_permitted',`switch off: ${text}`);
 assert.equal(calls.reserve,1);assert.equal(calls.provider,0,'No model call while the switch is off');
}
// The deterministic fake (local) makes a pending draft only: the doctor still approves.
{const {r,calls}=await run('When is my visit tomorrow?',{local:true,allowed:false});
 assert.equal(r.outcome,'draft_proposed','Fake provider: a draft for the doctor, never a send');assert.equal(calls.provider,1);}

// 3. The send action, with every boundary stubbed.
const transpile=(path:string)=>ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
type Store={ok:true}|{ok:false;code:string};
const loadAction=(store:(rid:string,text:string,toDoctor?:boolean)=>Promise<Store>,chatOn=true,threadState?:string,intake:{enabled:boolean;active:boolean}|null={enabled:false,active:false},enrols=false)=>{
 const state={auth:0,stored:[] as string[],after:0,reads:0,enrolled:0,signedOut:false,work:[] as (()=>Promise<void>)[],screened:0,sweeps:0};
 const exports:Record<string,unknown>={};
 new vm.Script(transpile('app/patient/zoe/chat-actions.ts')).runInNewContext({exports,process,setTimeout,Promise,require(name:string){if(name in realtimeBoundaries)return realtimeBoundaries[name];
 if(name==='@/lib/patient/date-format')return memberDates;if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};
  if(name==='next/server')return {after:(run:()=>Promise<void>)=>{state.after++;state.work.push(run);}};
  if(name==='next/navigation')return {redirect:(to:string)=>{throw Error(`redirect:${to}`);}};
  if(name==='@/lib/patient/auth')return {patientIdentity:async()=>{state.auth++;return state.signedOut?null:{userId:'fictional',phone:'+37499000000'};}};
  if(name==='@/lib/zoe/member-screen')return screen;
  if(name==='@/lib/zoe/app-chat-contracts')return contracts;
  if(name==='@/lib/zoe/sweep-trigger')return {requestZoeSweep:async()=>{state.sweeps++;return true;}};
  if(name==='@/lib/patient-care/enrolment')return {enrolForZoeChat:async()=>{state.enrolled++;return enrols;}};
  if(name==='@/lib/zoe-chat-actions/voice-message')return {storeMessageWithVoiceReceipt:async(rid:string,text:string,toDoctor?:boolean)=>{state.stored.push(rid);return store(rid,text,toDoctor);}};
  if(name==='@/lib/zoe/app-chat')return {utf16Length:(t:string)=>t.length,readZoeThread:async()=>{state.reads++;return chatOn?thread:null;},readZoeThreadState:async()=>{state.reads++;return threadState??(chatOn?thread:'unavailable');},screenNewMessages:async()=>{state.screened++;return null;},readIntakeState:async()=>intake};
  throw Error(`Unexpected boundary: ${name}`);
 }});
 return {send:exports.sendZoeChatMessage as (rid:string,text:string,toDoctor?:boolean,inlineEmergency?:boolean)=>Promise<{status:string;thread?:unknown;request?:string|null}>,redCheck:exports.openUrgentIfRed as (rid:string,text:string,toDoctor?:boolean)=>Promise<void>,state};
};
const RID='a7000000-0000-4000-8000-0000000000a9';
const prev=process.env.NOREON_ZOE_TEST_LEXICON;process.env.NOREON_ZOE_TEST_LEXICON='true';
try{
 {const {send,state}=loadAction(async()=>({ok:true}));
  await assert.rejects(send(RID,'My chest hurts since this morning'),/redirect:\/patient\/zoe\/urgent/,'Urgent opens the 103 screen');
  assert.deepEqual(state.stored,[RID],'Urgent text is stored first, so the care team screening sees it');
  assert.equal(state.after,1,'Care-alert screening runs right after');
  assert.equal(state.auth,0,'Urgent words come before the session check, so an ended session never costs the 103 screen');}
 // For-doctor routing survives both the ordinary and urgent send paths.
 {const modes:(boolean|undefined)[]=[];
  const {send}=loadAction(async(_id,_text,toDoctor)=>{modes.push(toDoctor);return {ok:true};});
  assert.equal((await send(RID,'A question for my doctor',true)).status,'sent');
  await assert.rejects(send(RID,'My chest hurts',true),/redirect:\/patient\/zoe\/urgent/,'Urgent for-doctor text still opens 103');
  assert.deepEqual(modes,[true,true],'The routing intent is stored with each message');}
 {const {send,state}=loadAction(()=>new Promise(()=>{}));
  const started=Date.now();
  await assert.rejects(send(RID,'My chest hurts'),/redirect:\/patient\/zoe\/urgent/,'A hanging store never holds back the 103 screen');
  assert.ok(Date.now()-started<4500,'Bounded wait');assert.equal(state.after,0);}
 {const {send,state}=loadAction(async()=>({ok:false,code:'failed'}));
  await assert.rejects(send(RID,'My chest hurts'),/redirect:\/patient\/zoe\/urgent/,'A failed store still opens the 103 screen');
  await assert.rejects(send(RID,`${'x'.repeat(ZOE_CHAT_MAX+10)} chest pain`),/redirect:\/patient\/zoe\/urgent/,'Red wins over the size cap');
  assert.deepEqual(state.stored,[RID],'Over-long urgent text is not stored (the database would refuse it) but still routes to 103');
  await assert.rejects(send('not-a-uuid','My chest hurts'),/redirect:\/patient\/zoe\/urgent/,'F3: red wins over a malformed request id');
  assert.deepEqual(state.stored,[RID],'A malformed id is never stored');}
 {const {send,state}=loadAction(async()=>({ok:true}),false);
  assert.equal((await send(RID,'When is my visit?')).status,'unavailable','F4: chat off, no new app text');
  assert.deepEqual(state.stored,[],'Nothing stored while the switch is off');}
 {const {send,state}=loadAction(async()=>({ok:true}));
  const sent=await send(RID,'When is my visit?');
  assert.equal(sent.status,'sent');assert.deepEqual(sent.thread,thread,'The stored thread comes back');
  assert.deepEqual(state.stored,[RID],'The client request id is kept, so a retry replays');
  assert.equal((await send(RID,'x'.repeat(ZOE_CHAT_MAX+1))).status,'too_long');
  assert.equal((await send(RID,'   ')).status,'empty');
  assert.equal((await send('not-a-uuid','Hello')).status,'failed');
  assert.equal(state.stored.length,1,'Nothing else was stored');
  assert.equal(state.auth,4,'Every call requires a signed-in member');
  // BC-05: an ended session is an answer, not a redirect, so the composer keeps the text and says why.
  state.signedOut=true;
  assert.equal((await send(RID,'Hello')).status,'sign_in_again');
  assert.equal(state.stored.length,1,'Nothing stored without a session');
  state.signedOut=false;}
 // The red check alone (test gap 1, for a Zoe card that may refuse a text): the same urgent path, and nothing else.
 {const modes:(boolean|undefined)[]=[];
  const {redCheck,state}=loadAction(async(_id,_text,toDoctor)=>{modes.push(toDoctor);return {ok:true};});
  await assert.rejects(redCheck(RID,'My chest hurts',true),/redirect:\/patient\/zoe\/urgent/,'Urgent opens the 103 screen');
  assert.deepEqual(state.stored,[RID],'and is stored for the care team');assert.deepEqual(modes,[true],'with its for-doctor routing');assert.equal(state.after,1,'and screened right after');
  await redCheck(RID,'When is my visit?',true);
  await redCheck(RID,'   ',true);
  assert.deepEqual(state.stored,[RID],'Text that is not urgent stores nothing');assert.equal(state.auth,0,'A lost session cannot cost the 103 screen');}
 {const {redCheck}=loadAction(()=>new Promise(()=>{}));
  const started=Date.now();
  await assert.rejects(redCheck(RID,'My chest hurts'),/redirect:\/patient\/zoe\/urgent/,'A hanging store never holds back the 103 screen');
  assert.ok(Date.now()-started<4500,'Bounded wait');}
 {const {redCheck,state}=loadAction(async()=>({ok:true}),true,undefined,{enabled:true,active:true});
  await assert.rejects(redCheck(RID,'Now my left arm is numb'),/redirect:\/patient\/zoe\/urgent/,'Intake on: a symptom red flag counts too');
  assert.deepEqual(state.stored,[RID]);}
 // Symptom intake on: the symptom red flags open the 103 screen too (deterministic, before storing); off, they do not.
 {const {send,state}=loadAction(async()=>({ok:true}),true,undefined,{enabled:true,active:true});
  await assert.rejects(send(RID,'Now my left arm is numb'),/redirect:\/patient\/zoe\/urgent/,'Intake on: a symptom red flag opens the 103 screen');
  assert.deepEqual(state.stored,[RID],'and is stored for the sweep (intake stop, care-team alert)');
  assert.equal((await send(RID,'No numbness, no weakness')).status,'sent','A negated answer is not red');}
 {const {send}=loadAction(async()=>({ok:true}),true,undefined,{enabled:false,active:false});
  assert.equal((await send(RID,'Now my left arm is numb')).status,'sent','Intake off: unchanged behaviour');}
 {const {send}=loadAction(async()=>({ok:true}),true,undefined,null);
  assert.equal((await send(RID,'When is my visit?')).status,'sent','Unreadable intake state: unchanged behaviour');}
 for(const code of ['rate_limited','unavailable','needs_review_request','not_eligible','sign_in_again'] as const){
  const {send}=loadAction(async()=>({ok:false,code}));
  assert.equal((await send(RID,'When is my visit?')).status,code,`${code} is reported, the text stays with the member`);
 }
 // 18 Oct: a member the thread refuses still reaches the store, which says why; a read error is transient.
 {const {send,state}=loadAction(async()=>({ok:false,code:'needs_review_request'}),true,'not_eligible');
  assert.equal((await send(RID,'When is my visit?')).status,'needs_review_request','Thread refusal: the store explains it');
  assert.deepEqual(state.stored,[RID]);}
 // Lead, 18 Oct 23:15: no clinical case yet, the first message enrols the member and the same id is stored.
 {let n=0;const {send,state}=loadAction(async()=>(n++===0?{ok:false,code:'needs_review_request'}:{ok:true}),true,'not_eligible',undefined,true);
  assert.equal((await send(RID,'Hello Zoe')).status,'sent','Enrolled on the first message, then sent');
  assert.equal(state.enrolled,1);assert.deepEqual(state.stored,[RID,RID],'The refused request id is stored after enrolment');}
 // Codex R2 F1: an urgent first message without a case is enrolled and stored too, inside the bounded wait.
 {let n=0;const {send,state}=loadAction(async()=>(n++===0?{ok:false,code:'needs_review_request'}:{ok:true}),true,'not_eligible',undefined,true);
  await assert.rejects(send(RID,'My chest hurts since this morning'),/redirect:\/patient\/zoe\/urgent/,'Urgent still opens the 103 screen');
  assert.equal(state.enrolled,1);assert.deepEqual(state.stored,[RID,RID],'Enrolled, then the urgent text is stored');assert.equal(state.after,1,'Care-alert screening runs');}
 {const {send,state}=loadAction(async()=>({ok:false,code:'needs_review_request'}),true,'not_eligible',undefined,false);
  assert.equal((await send(RID,'Hello Zoe')).status,'needs_review_request','Enrolment refused: the composer says to send the review request');
  assert.equal(state.enrolled,1);assert.deepEqual(state.stored,[RID],'No second store without a case');}
 {const {send,state}=loadAction(async()=>({ok:false,code:'not_eligible'}),true,'not_eligible',undefined,true);
  assert.equal((await send(RID,'Hello Zoe')).status,'not_eligible');assert.equal(state.enrolled,0,'Only a missing case triggers enrolment');}
 {const {send,state}=loadAction(async()=>({ok:true}),true,'failed');
  assert.equal((await send(RID,'When is my visit?')).status,'failed','Unreadable thread: transient, Try again');
  assert.deepEqual(state.stored,[]);}
}finally{if(prev===undefined)delete process.env.NOREON_ZOE_TEST_LEXICON;else process.env.NOREON_ZOE_TEST_LEXICON=prev;}

// Emergency card: the new client opts in, and only an exact-true deployment switch changes routing.
{
 const old=process.env.NOREON_ZOE_EMERGENCY_CARD,oldLexicon=process.env.NOREON_ZOE_TEST_LEXICON;
 process.env.NOREON_ZOE_TEST_LEXICON='true';
 try{
  for(const flag of [undefined,'false','1','TRUE','true']){
   if(flag===undefined)delete process.env.NOREON_ZOE_EMERGENCY_CARD;else process.env.NOREON_ZOE_EMERGENCY_CARD=flag;
   const {send,state}=loadAction(async()=>({ok:true}),false);
   if(flag==='true'){
    const r=await send(RID,'My chest hurts',true,true);
    assert.equal(r.status,'urgent');assert.equal(r.request,RID);
    assert.deepEqual(state.stored,[RID]);assert.equal(state.after,1);
    assert.equal(state.reads,0,'103 never depends on a thread read');assert.equal(state.auth,0);
    await state.work[0]();assert.equal(state.screened,1);assert.equal(state.sweeps,1,'Same care screening and saved-message run trigger');
   }else await assert.rejects(send(RID,'My chest hurts',true,true),/redirect:\/patient\/zoe\/urgent/,'Flag off retains the full urgent page');
  }
  process.env.NOREON_ZOE_EMERGENCY_CARD='true';
  for(const store of [async()=>({ok:false as const,code:'failed'}),async()=>{throw Error('store failed');},()=>new Promise<Store>(()=>{})]){
   const {send}=loadAction(store);
   const r=await send(RID,'My chest hurts',false,true);
   assert.equal(r.status,'urgent');assert.equal(r.request,null,'Unstored text never borrows another message’s care alert');
  }
  {const {send}=loadAction(async()=>({ok:true}));
   await assert.rejects(send(RID,'My chest hurts'),/redirect:\/patient\/zoe\/urgent/,'A client unable to render the card keeps the direct-page fallback');}
  {const {send,state}=loadAction(async()=>({ok:true}),true,undefined,{enabled:true,active:true});
   const r=await send(RID,'Now my left arm is numb',false,true);
   assert.equal(r.status,'urgent');assert.equal(state.after,1,'Same symptom screening and sweep');}
 }finally{if(oldLexicon===undefined)delete process.env.NOREON_ZOE_TEST_LEXICON;else process.env.NOREON_ZOE_TEST_LEXICON=oldLexicon;if(old===undefined)delete process.env.NOREON_ZOE_EMERGENCY_CARD;else process.env.NOREON_ZOE_EMERGENCY_CARD=old;}
}

// 4. The chat renders in EN and HY.
const quickActions:Record<string,unknown>={};
new vm.Script(transpile('components/patient/zoe-quick-actions.tsx')).runInNewContext({exports:quickActions,require(name:string){if(name in realtimeBoundaries)return realtimeBoundaries[name];
 if(name==='@/lib/patient/date-format')return memberDates;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
 if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
 if(name==='@/lib/patient/copy')return {tx};
 throw Error(`Unexpected boundary: ${name}`);
}});
const chatExports:Record<string,unknown>={};
runChatView('components/patient/zoe-chat.tsx',{exports:chatExports,crypto,require(name:string){if(name in realtimeBoundaries)return realtimeBoundaries[name];
 if(name==='@/components/chat-v2/reported-bp-label')return bpLabel;
 if(name==='@/lib/patient/date-format')return memberDates;if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};
 if(name==='@/lib/member-staff-name.mjs')return memberStaffNames;
 if(name==='react/jsx-runtime')return jsx;
 if(name==='react')return React;
 if(name==='next/link')return {default:({children,...props}:{children:React.ReactNode})=>React.createElement('a',props,children)};
 if(name==='lucide-react')return new Proxy({},{get:()=>()=>null});
 if(name==='@/lib/zoe/member-screen')return screen;
 if(name==='@/components/patient/zoe-emergency-card')return loadUrgentViews().card;
 if(name==='@/components/patient/zoe-cards')return {ZoeCardView:()=>null,CARD_REPLY_LOST:'synthetic-card-reply-lost'};
 if(name==='@/components/patient/sign-in-ended')return {SignInEnded:()=>null,signInAgain:async()=>{}};
 if(name==='@/components/patient/tab-draft')return {readDraft:()=>null,keepDraft:()=>{}};
 if(name==='@/lib/zoe-chat-actions/actions')return {openZoeCard:async()=>({status:'failed'})};
 if(name==='@/lib/zoe-chat-actions/registry')return cardRegistry;
 if(name==='@/lib/zoe-chat-actions/copy')return cardCopy;
 if(name==='@/lib/zoe-chat-actions/thread')return cardThread;
 if(name==='@/lib/chat/suggestions')return suggestions;
 if(name==='@/lib/chat/tasks')return tasks;
 if(name==='@/components/conversation/chat-suggestions')return {ChatSuggestions};
 if (name === "@/components/patient/use-chat-viewport") return { useChatFollow: () => {}, useChatViewport: () => {} };
 if(name==='@/lib/zoe-chat-actions/everyday-contract')return everydayContract;
 if(name==='@/lib/zoe-chat-actions/everyday-actions')return {openEverydayCard:async()=>({status:'failed'})};
 if(name==='@/components/patient/zoe-quick-actions')return quickActions;
 if(name==='@/components/patient/zoe-attach')return {ZoeAttach:()=>null};
 if(name==='@/lib/patient/copy')return {tx};
 if(name==='@/app/patient/zoe/chat-actions')return {sendZoeChatMessage:async()=>({status:'failed'}),};
 if(name==='@/lib/zoe/app-chat-contracts')return contracts;
 throw Error(`Unexpected boundary: ${name}`);
}});
const Chat=chatExports.ZoeChat as (p:{locale:'en'|'hy';initial:ZoeThread;upload:boolean})=>React.ReactElement;
for(const locale of ['en','hy'] as const){
 const html=renderToStaticMarkup(React.createElement(Chat,{locale,initial:thread,upload:true}));
 assert.equal((html.match(/data-zoe-bubble="member"/g)??[]).length,3);
 assert.equal((html.match(/data-zoe-bubble="ack"/g)??[]).length,0,'Answered thread: no acknowledgement');
 assert.equal((html.match(/data-zoe-bubble="reply"/g)??[]).length,1);
 assert.ok(html.includes('Dr Synthetic'));
 const unanswered=renderToStaticMarkup(React.createElement(Chat,{locale,initial:{...thread,answers:[]},upload:true}));
 assert.equal((unanswered.match(/data-zoe-bubble="ack"/g)??[]).length,1,'One acknowledgement, after the newest run');
 assert.ok(!unanswered.includes('Approved acknowledgement.'),'The Telegram ack text never shows in the app');
 assert.ok(unanswered.includes(locale==='en'?'Sent to your care team.':'Ուղարկված է ձեր խնամքի թիմին։'),'The plain status instead');
 assert.doesNotMatch(unanswered,/STAGING|tel:103/,'No STAGING label or 103 in the chat');
 assert.equal((html.match(/data-zoe-bubble="answer"/g)??[]).length,1);
 const answerBubble=html.slice(html.indexOf('data-zoe-bubble="answer"'),html.indexOf('Zoe logistics answer'));
 assert.ok(answerBubble.includes(locale==='en'?'Zoe · AI assistant':'Զոյա · ԱԲ օգնական')&&!answerBubble.includes('Dr Synthetic'),'Zoe’s answer is labelled as Zoe, never as the doctor');
 assert.ok(html.includes(locale==='en'?'via Telegram':'Telegram-ով'),'Telegram messages are marked');
 for(const href of ['/patient/service','/patient/reports','/patient/measurements/new'])assert.ok(html.includes(`href="${href}"`),`chip ${href}`);
 assert.ok(html.includes(locale==='en'?'Write to your doctor':'Գրել ձեր բժշկին'),'Write-to-doctor chip');
 assert.ok(!html.includes(locale==='en'?'If this is urgent, do not write. Call 103.':'Եթե սա շտապ է, մի գրեք։ Զանգահարեք 103։'),'No 103 line above the composer (Khikar 16:24; the header keeps Emergency 103)');
 assert.ok(html.includes(`maxLength="${ZOE_CHAT_MAX}"`)&&html.includes('data-zoe-composer')&&html.includes('role="log"'));
 assert.match(html,/sticky top-auto! bottom-\[calc\(var\(--member-tabbar-height,4\.75rem\+env\(safe-area-inset-bottom\)\)\+0\.5rem\)\]/,'Composer clears the header top rule and follows the measured bottom nav height');
 const noUpload=renderToStaticMarkup(React.createElement(Chat,{locale,initial:thread,upload:false}));
 assert.ok(!noUpload.includes('href="/patient/reports"'),'Upload chip only when uploads are on');
 const empty=renderToStaticMarkup(React.createElement(Chat,{locale,initial:{...thread,messages:[],replies:[],answers:[],ack:null},upload:false}));
 assert.ok(empty.includes(locale==='en'?'Write to your care team here.':'Գրեք ձեր խնամքի թիմին այստեղ։'),'Empty thread explains itself');
}
// 18 Oct: every refusal code has its own actionable message; none is the transient "Not sent".
const Notice=chatExports.ZoeNotice as (p:{locale:'en'|'hy';notice:string|null})=>React.ReactElement;
const notices:Record<string,{en:string;hy:string;href?:string;button?:{en:string;hy:string}}>={
 needs_review_request:{en:'Send your review request first to start chatting with your care team.',hy:'Նախ ուղարկեք ձեր վերանայման հարցումը',href:'/patient/review'},
 not_eligible:{en:'This account cannot write to the care team.',hy:'Այս հաշվից հնարավոր չէ գրել խնամքի թիմին',href:'/patient/account'},
 sign_in_again:{en:'Your sign-in has ended. Sign in again, then send your message.',hy:'Ձեր մուտքի ժամկետն ավարտվել է',button:{en:'Sign in again',hy:'Մուտք գործել նորից'}},
 unavailable:{en:'Writing here is not available right now.',hy:'Այստեղ գրելը հիմա հասանելի չէ'},
 rate_limited:{en:'You sent many messages in a short time',hy:'Կարճ ժամանակում շատ հաղորդագրություն'},
};
for(const locale of ['en','hy'] as const)for(const [code,want] of Object.entries(notices)){
 const html=renderToStaticMarkup(React.createElement(Notice,{locale,notice:code}));
 assert.ok(html.includes(want[locale]),`${code} ${locale}: its own message`);
 assert.ok(html.includes('role="alert"'),`${code} ${locale}: announced`);
 assert.ok(!html.includes('Not sent')&&!html.includes('Չուղարկվեց')&&!html.includes('Try again'),`${code} ${locale}: never the transient Not sent`);
 if(want.href)assert.ok(html.includes(`href="${want.href}"`),`${code} ${locale}: links to ${want.href}`);
 if(want.button)assert.ok(html.includes('<button')&&html.includes(want.button[locale]),`${code} ${locale}: sign-in button`);
}
assert.equal(renderToStaticMarkup(React.createElement(Notice,{locale:'en',notice:null})),'','No notice, nothing shown');
// The database codes map onto these; busy and unknown codes stay transient (Try again).
assert.deepEqual(['needs_review_request','not_eligible','sign_in_again','rate_limited','invalid_command','busy','unavailable','request_conflict'].map(contracts.zoeStoreCode),
 ['needs_review_request','not_eligible','sign_in_again','rate_limited','invalid','failed','failed','failed'],'Store codes: permanent refusals pass through, the rest are transient');
const chatSource=['components/patient/zoe-chat.tsx','components/patient/zoe-notice.tsx','components/patient/use-zoe-thread.ts'].map(path=>readFileSync(path,'utf8')).join('\n');
for(const s of ['"Sending"','"Not sent."','"Try again"','"Sent to your care team."','was not sent','not available right now'])assert.ok(chatSource.includes(s),`state copy: ${s}`);
assert.doesNotMatch(chatSource,/—|!"|!'|reviews (each|every)/,'Voice guide');

// 5. Page, chat first (Khikar, 18 Oct 22:57): no 103 control of its own in either mode (the header pill is the
// one); with the chat off, one short line and the quick actions instead of a page of cards.
const page=readFileSync('app/patient/zoe/page.tsx','utf8');
assert.doesNotMatch(page,/tel:103|WhenWeReply|ZOE_FAQ|ZoeMessage/,'No 103 card, contact block, FAQ or old composer on the Zoe screen');
assert.match(page,/await readZoeAccess\(\)/,'The page reads the member thread through chat-access');
assert.match(page,/data-zoe-off=\{access\.reason\}/,'No chat: one short line with one action, by reason');
const access=readFileSync('app/patient/zoe/chat-access.ts','utf8');
for(const reason of ['chat_off','staff_account','not_eligible','read_failed'])assert.ok(access.includes(`blocked('${reason}')`),`reason ${reason}`);
assert.match(access,/log\.info\('zoe_chat_unavailable',\{action:`zoe_chat_\$\{reason\}`,member_id:memberId\}\)/,'Each refusal is logged with allow-listed fields (ids only)');
assert.match(access,/review\.status===null\)\{[\s\S]*?thread:EMPTY_THREAD/,'No clinical case yet: the chat, enrolled on the first message');
assert.match(access,/if\(review==='failed'\)return blocked\('read_failed'\)/,'Codex R2 F3: a failed case-status read is the retry state');
// 6. Polling after a send (18 Oct: the member left 3 s after sending, the answer came 7 s later).
{
 const {pollAfterSend,pollAfterRead,pollOnReturn,pollDue,readWithin,ZOE_POLL,ZOE_POLL_IDLE}=contracts;
 const t0=1_000_000;
 let p=pollAfterSend(t0,1);
 assert.ok(pollDue(p,t0+2_000,t0),'Every tick for the first minute after a send');
 assert.equal(pollAfterRead(p,1),p,'No new answer: still waiting');
 assert.ok(!pollDue(p,t0+65_000,t0+62_000)&&pollDue(p,t0+72_000,t0+62_000),'Then every 10 s');
 assert.ok(!pollDue(p,t0+7*60_000,t0+7*60_000-20_000)&&pollDue(p,t0+7*60_000,t0+7*60_000-30_000),'Then every 30 s');
 // Hidden for four minutes, back: fast again, because the send is unanswered.
 const back=pollOnReturn(p,t0+4*60_000);
 assert.ok(pollDue(back,t0+4*60_000+2_000,t0+4*60_000),'Back in view after an unanswered send: every tick again');
 assert.equal(pollOnReturn(p,t0+31*60_000),p,'Not after half an hour');
 assert.equal(pollOnReturn(ZOE_POLL_IDLE,t0),ZOE_POLL_IDLE,'No send, no fast polling');
 p=pollAfterRead(back,2);
 assert.ok(!pollDue(p,t0+4*60_000+4_000,t0+4*60_000+2_000)&&p.answered===2,'The answer arrived: the wait ends');
 assert.equal(pollOnReturn(p,t0+5*60_000),p,'An answered send never restarts fast polling');
 // A read that never settles is aborted, so the next tick can read again (PR #281 review F1).
 let aborted=false;
 const hung=await readWithin(signal=>new Promise<never>(()=>{signal.addEventListener('abort',()=>{aborted=true;});}),20);
 assert.equal(hung,null,'A hung read gives up');
 assert.ok(aborted,'and its request is aborted');
 assert.equal(await readWithin(async()=>{throw Error('x');},1_000),null,'A failed read is null');
 assert.equal(await readWithin(async()=>7,1_000),7,'A read within time passes through');
 assert.equal(ZOE_POLL.TIMEOUT_MS<ZOE_POLL.REFRESH_MS,true);
 // Polls are a plain, uncached GET of the member's own thread, never a Server Action (Next queues those one at a time).
 const {fetchZoeThread,ZOE_THREAD_URL}=contracts;
 const good={ok:true,version:1,ack:null,zoeReplies:false,settledSeq:0,messages:[],replies:[],answers:[{id:'d4952bb3-2248-49a3-928d-5444833afab7',text:'When did it start?',at:'2026-10-18T12:09:40.28448+00:00'}]};
 const calls:{url:string;init:RequestInit|undefined}[]=[];
 const fake=(status:number,body:unknown)=>(async(url:string,init?:RequestInit)=>{calls.push({url,init});return new Response(JSON.stringify(body),{status});}) as unknown as typeof fetch;
 const signal=new AbortController().signal;
 assert.deepEqual(await fetchZoeThread(signal,fake(200,good)),good,'A valid thread passes');
 const publicCheck=screen.zoeEmergencyCheck({enabled:true,active:true},{NOREON_ZOE_EMERGENCY_CARD:'true',NOREON_ZOE_TEST_LEXICON:'true'})!;
 assert.deepEqual((await fetchZoeThread(signal,fake(200,{...good,emergencyCheck:publicCheck})))?.emergencyCheck,publicCheck,'Poll parsing preserves fresh public screening context');
 assert.equal(calls[0].url,ZOE_THREAD_URL);
 assert.equal(calls[0].init?.cache,'no-store');assert.equal(calls[0].init?.signal,signal);assert.equal(calls[0].init?.method,undefined,'GET');
 assert.equal(await fetchZoeThread(signal,fake(401,{error:'unauthorized'})),null,'Signed out: null');
 assert.equal(await fetchZoeThread(signal,fake(200,{ok:false,code:'unavailable'})),null,'Chat off: null');
 assert.equal(await fetchZoeThread(signal,fake(200,{...good,extra:1})),null,'An unexpected shape: null');
 // A poll that started before a send finished, or carries an older version, never replaces the thread (review F2).
 const {pollMayReplace}=contracts;
 assert.equal(pollMayReplace({version:3},{version:5},0,1),false,'18 Oct F2: a pre-send poll returning after the send (5 -> 3) is dropped');
 assert.equal(pollMayReplace({version:5},{version:5},0,1),false,'Any poll that straddles a send is dropped');
 assert.equal(pollMayReplace({version:4},{version:5},1,1),false,'An older version is dropped');
 assert.equal(pollMayReplace({version:5},{version:5},1,1),true,'Same version (a new answer or reply) replaces');
 assert.equal(pollMayReplace({version:6},{version:5},1,1),true,'A newer version replaces');
 for(const s of ['"visibilitychange", back','"pageshow", back','"focus", back','} finally {\n        inFlight.current = false;','readWithin((signal) => fetchZoeThread(signal), ZOE_POLL.TIMEOUT_MS)','const sendsAtStart = sends.current;','pollMayReplace(next, shown, sendsAtStart, sends.current) ? keepThreadNotices(next, shown) : shown','if (result.status === "sent") {\n        sends.current += 1;'])
  assert.ok(chatSource.includes(s),`chat polling: ${s}`);
 assert.doesNotMatch(chatSource,/refreshZoeThread/,'No polling through a Server Action');
 assert.doesNotMatch(readFileSync('app/patient/zoe/chat-actions.ts','utf8'),/refreshZoeThread/,'The old polling action is gone');
 const route=readFileSync('app/api/patient/zoe/thread/route.ts','utf8');
 assert.match(route,/export const GET=withRouteLogging/);
 assert.match(route,/if\(!await patientIdentity\(\)\)return Response\.json\(\{error:'unauthorized'\},\{status:401/,'Signed-in member only');
 assert.match(route,/'Cache-Control':'no-store'/);assert.match(route,/readZoeThread\(\)/,'Same read as the page (auth.uid())');
 assert.doesNotMatch(route,/pipeline|provider|createServiceClient|SERVICE_ROLE/,'The poll never reaches Zoe or the service role');
}
console.log('Zoe app chat: one thread across channels, same pipeline (urgent stops before any model, no model call while off, drafts only), red wins in the send action, size cap 4096, EN/HY render with chips, composer and states, Call 103 kept; after a send it polls fast, again on return to the screen, and a hung read is aborted and polls are a GET, never a queued Server Action.');

console.log("Emergency action: 5 flag values, save success/refusal/throw/timeout, incapable-client fallback, symptom red flag, unchanged care screening/run trigger pass.");

// EC-02: execute the polling GET. Starting intake after chat opens changes the next response;
// an unreadable intake keeps the feature enabled with unknown context for the local fallback.
{
 let chatOnly=false;
 let suggestionState:suggestions.SuggestionState|null=null;
 let intake:{enabled:boolean;active:boolean}|null={enabled:true,active:false};
 const exports:Record<string,unknown>={};
 new vm.Script(transpile('app/api/patient/zoe/thread/route.ts')).runInNewContext({exports,Response,require(name:string){if(name in realtimeBoundaries)return realtimeBoundaries[name];
 if(name==='@/lib/patient/date-format')return memberDates;
  if(name==='@/lib/observability/with-logging')return {withRouteLogging:(run:unknown)=>run};
  if(name==='@/lib/patient/auth')return {patientIdentity:async()=>({userId:'fictional'})};
  if(name==='@/lib/patient/demo')return {demoEnabled:()=>false};
  if(name==='@/lib/zoe/app-chat')return {readZoeThread:async()=>thread,readIntakeState:async()=>intake};
  if(name==='@/lib/zoe/member-screen')return {zoeEmergencyCardEnabled:()=>true,zoeEmergencyCheck:(value:screen.ZoeEmergencyCheck['intake'])=>screen.zoeEmergencyCheck(value,{NOREON_ZOE_EMERGENCY_CARD:'true',NOREON_ZOE_TEST_LEXICON:'true',PRIVATE_VALUE:'must not cross'})};
  if(name==='@/lib/patient/member-chat-config')return {memberChatOnlyEnabled:()=>chatOnly};
  if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>false};
  if(name==='@/lib/chat/suggestion-read')return {readMemberSuggestionState:async()=>suggestionState};
  throw Error(`Unexpected GET boundary: ${name}`);
 }});
 const get=exports.GET as ()=>Promise<Response>;
 assert.equal((await (await get()).json()).emergencyCheck.intake.active,false);
 intake={enabled:true,active:true};
 const fresh=await (await get()).json();
 assert.equal(fresh.emergencyCheck.intake.active,true,'Polling refreshes changed intake, without reopening the page');
 assert.deepEqual(Object.keys(fresh.emergencyCheck.env).sort(),['NOREON_ZOE_TEST_LEXICON','NOREON_ZOE_URGENT_PLACEHOLDER'],'Only public matcher switches leave the server');
 intake=null;
 assert.equal((await (await get()).json()).emergencyCheck.intake,null,'Unknown intake stays unknown, not inactive');
 chatOnly=true;
 suggestionState={locale:'en',consent:true,emergency:false,safetyHold:false,medicineDue:true,bpDue:false,visitProposal:false,visitToBook:false,planToRead:false,resultsToRead:false,doctorReply:false};
 assert.equal((await (await get()).json()).suggestionState.medicineDue,true,'Polling refreshes due-task facts');
 suggestionState=null;
 assert.equal((await (await get()).json()).suggestionState,null,'Unavailable safety replaces earlier suggestions with none');
 console.log('EC-02 polling GET: inactive, newly active and unavailable intake contexts pass.');
}
