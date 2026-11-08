/** Actual card-opening boundary with synthetic stored messages; no DB or network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import * as voiceReceipt from '@/lib/zoe-chat-actions/voice-receipt';
import * as zod from 'zod';
import {typedReading} from '@/lib/zoe-chat-actions/typed-reading';
const require=createRequire(import.meta.url);
function load(file:string,deps:Record<string,unknown>){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{}},Date,Buffer,require:(name:string)=>name in deps?deps[name]:require(name)});
 return exports;
}
const memberId='11111111-1111-4111-8111-111111111111';
const now=Date.now(),secret='synthetic-test-key-that-is-at-least-32-characters';
let receipt:unknown=null,readFailure=false;
const text='145/92',at=new Date(now).toISOString();
const thread={messages:[{seq:1,text,at,requestId:'22222222-2222-4222-8222-222222222222'}]};
const client={rpc:async()=>({data:{receipt,memberId,text,at},error:readFailure?{code:'synthetic'}:null})};
const unused=Object.fromEntries([...readFileSync('lib/zoe-chat-actions/server.ts','utf8').matchAll(/from '([^']+)'/g)].map(m=>[m[1],{}]));
const server=load('lib/zoe-chat-actions/server.ts',{...unused,
 'server-only':{},'@supabase/supabase-js':{},'@/lib/db/types':{},
 '@/lib/supabase/server':{createClient:async()=>client},
 '@/lib/zoe/app-chat':{readZoeThread:async()=>thread},
 './typed-reading':{typedReading},'zod':zod,
 './voice-receipt':{verifyVoiceReceipt:(r:unknown,m:string,t:string,at:number)=>voiceReceipt.verifyVoiceReceipt(r,m,t,at,secret)},
});
const typedFromMessage=server.typedFromMessage as (seq:number,forged?:boolean)=>Promise<{typed?:{entrySource?:string}}>;
assert.equal((await typedFromMessage(1,true)).typed?.entrySource,undefined,'Client voiceConfirmed cannot label a stored typed message, including with provider off');
receipt=voiceReceipt.signVoiceReceipt(memberId,text,secret,now);
assert.equal(voiceReceipt.verifyVoiceReceipt(receipt,memberId,text,now,secret),true);
for(const [m,t,time] of [[memberId,'146/93',now],['other-member',text,now],[memberId,text,now+11*60_000],[memberId,text,now-31_000]] as const){
 assert.equal(voiceReceipt.verifyVoiceReceipt(receipt,m,t,time,secret),false);
}
assert.equal(voiceReceipt.verifyVoiceReceipt('forged',memberId,text,now,secret),false);
assert.equal((await typedFromMessage(1)).typed?.entrySource,'patient_voice_confirmed','Recovery reads persisted evidence with no client flag');
const originalNow=Date.now;Date.now=()=>now+31*60_000;
try{assert.equal((await typedFromMessage(1)).typed?.entrySource,'patient_voice_confirmed','Recovery after 30 minutes uses message time, not receipt expiry now');}finally{Date.now=originalNow;}
readFailure=true;await assert.rejects(typedFromMessage(1),/Voice provenance unavailable/,'Failed provenance read must not create a typed card');readFailure=false;
receipt='forged';assert.equal((await typedFromMessage(1,true)).typed?.entrySource,undefined);
console.log('Voice provenance: forged flags/receipts, exact member/text/time binding and persisted recovery after 30 minutes passed');

// Actual send action -> receipt-verifying store -> synthetic DB boundary. Provider is off.
const contracts=await import('@/lib/conversation-persistence/contracts');
const appContracts=await import('@/lib/zoe/app-chat-contracts');
let typedSends=0,voiceSends=0,failedStore=false,repositoryAvailable=true;
const storedMessages:Record<string,unknown>[]=[];
const store=load('lib/zoe-chat-actions/voice-message.ts',{
 'server-only':{},
 '@/lib/conversation-persistence/server':{authenticatedMemberConversation:async()=>repositoryAvailable?{call:async(name:string,args:Record<string,unknown>)=>{
  assert.equal(name,'conversation_receive');if(failedStore)throw Error('Synthetic outage');voiceSends++;storedMessages.push(args);
  return {ok:true,conversationId:memberId,version:1,replayed:false};
 }}:null},
 '@/lib/zoe/app-chat':{storeZoeMessage:async()=>{typedSends++;return {ok:true};}},
 '@/lib/zoe/app-chat-contracts':appContracts,
 '@/lib/conversation-persistence/contracts':contracts,
 './actor':{sessionActor:async()=>({memberId})},
 './voice-receipt':{verifyVoiceReceipt:(r:unknown,m:string,t:string)=>voiceReceipt.verifyVoiceReceipt(r,m,t,now,secret)},
});
const sendModule=load('app/patient/zoe/chat-actions.ts',{
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 'next/server':{after:()=>{}},'next/navigation':{redirect:()=>{throw Error('Unexpected redirect');}},
 '@/lib/patient/auth':{patientIdentity:async()=>({userId:memberId})},
 '@/lib/zoe/member-screen':{zoeTextRoute:()=> 'ordinary',symptomRedFlagRoute:()=>false},
 '@/lib/zoe/sweep-trigger':{requestZoeSweep:async()=>{}},
 '@/lib/zoe/app-chat-contracts':appContracts,
 '@/lib/patient-care/enrolment':{enrolForZoeChat:async()=>false},
 '@/lib/zoe/app-chat':{readIntakeState:async()=>null,readZoeThread:async()=>thread,readZoeThreadState:async()=>thread,screenNewMessages:async()=>{},utf16Length:(s:string)=>s.length},
 '@/lib/zoe-chat-actions/voice-message':store,
});
const send=sendModule.sendZoeChatMessage as (id:string,text:string,doctor:boolean,inline:boolean,receipt:unknown)=>Promise<{status:string}>;
const requestId=thread.messages[0].requestId;
receipt=voiceReceipt.signVoiceReceipt(memberId,text,secret,now);
for(const invalid of [undefined,true,{voiceConfirmed:true},'forged',voiceReceipt.signVoiceReceipt(memberId,text,secret,now-11*60_000),voiceReceipt.signVoiceReceipt('other-member',text,secret,now)]){
 assert.equal((await send(requestId,text,false,false,invalid)).status,'sent');
}
assert.equal(voiceSends,0);assert.equal(typedSends,6);
assert.equal((await send(requestId,'146/93',false,false,receipt)).status,'sent');assert.equal(voiceSends,0,'Edited transcript is typed');
assert.equal((await send(requestId,text,false,false,receipt)).status,'sent');assert.equal(voiceSends,1);
assert.equal(storedMessages[0].p_voice_receipt,receipt,'Proof is part of the atomic message send');
receipt=voiceReceipt.signVoiceReceipt(memberId,text,secret,now,{primary:text,urgent:'different secondary transcript'});
assert.equal((await send(requestId,text,false,false,receipt)).status,'sent');assert.equal(voiceSends,2);
assert.equal(storedMessages[1].p_voice_receipt,receipt,'Both signed engine hashes persist through the ordinary send');
failedStore=true;assert.equal((await send(requestId,text,false,false,receipt)).status,'failed','Failed persistence never claims voice send success');failedStore=false;
repositoryAvailable=false;assert.equal((await send(requestId,text,false,false,receipt)).status,'unavailable','Voice preserves the ordinary authenticated repository gate');
console.log('Actual send action: forged/expired/wrong-member/edited receipts stay typed; valid evidence persists with send; unavailable repository fails closed');

// Exercise the actual public card action too: it rejects a forged client flag, then recovers
// from the stored proof after a failed card post, with the provider/feature env absent.
const registry=await import('@/lib/zoe-chat-actions/registry');
const commands=await import('@/lib/zoe-chat-actions/commands');
let failPost=true,postedSnapshot:unknown;
const actionUnused=Object.fromEntries([...readFileSync('lib/zoe-chat-actions/actions.ts','utf8').matchAll(/from '([^']+)'/g)].map(m=>[m[1],{}]));
const cardActions=load('lib/zoe-chat-actions/actions.ts',{...actionUnused,
 'node:crypto':require('node:crypto'),'zod':zod,'next/server':{after:()=>{}},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/member-medicines/ask-copy':await import('@/lib/member-medicines/ask-copy'),
 '@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:()=>false},
 './actor':{sessionActor:async()=>({memberId,channel:'app'})},
 './bp-flow':await import('@/lib/zoe-chat-actions/bp-flow'),'./registry':registry,'./copy':await import('@/lib/zoe-chat-actions/copy'),
 './commands':commands,
 './server':{...server,buildSnapshot:async(_kind:unknown,_now:unknown,_page:unknown,_ask:unknown,typed:unknown)=>({v:1,week:null,typed}),postCard:async(_member:string,rid:string,_kind:string,_source:string,seq:number,snapshot:unknown)=>{
  if(failPost)return {ok:false,code:'unavailable'};
  postedSnapshot=snapshot;
  return {ok:true,replayed:false,card:registry.cardSchema.parse({id:requestId,requestId:rid,kind:'bp',source:'typed',sourceSeq:seq,snapshot,state:'open',outcome:{},claims:{},at})};
 }},
});
const open=cardActions.openZoeCard as (input:unknown)=>Promise<{status:string}>;
assert.equal((await open({requestId,kind:'bp',sourceSeq:1,voiceConfirmed:true})).status,'invalid','Actual card action rejects forged voiceConfirmed with provider off');
assert.equal((await open({requestId,kind:'bp',sourceSeq:1})).status,'unavailable','Send can succeed while card posting fails');
failPost=false;Date.now=()=>now+31*60_000;
try{assert.equal((await open({requestId,kind:'bp',sourceSeq:1})).status,'ok');}finally{Date.now=originalNow;}
assert.equal(registry.SNAPSHOTS.bp.parse(postedSnapshot).typed?.entrySource,'patient_voice_confirmed','Recovered card snapshot carries persisted provenance after 30 minutes');
console.log('Actual card action: forged flag rejected; failed card post recovers persisted voice snapshot after 31 minutes');
