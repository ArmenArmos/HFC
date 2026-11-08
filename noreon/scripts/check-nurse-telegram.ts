import assert from 'node:assert/strict';
import {createTelegramAdapter,type TelegramHttpPort,type SystemTextPayload} from '@/lib/telegram-channel/outbound';
import {inboxEventFrom} from '@/lib/telegram-channel/link';
import {parseTelegramUpdate} from '@/lib/telegram-channel/protocol';
import {handleNurseInbox,dispatchNurseMessage,renderNurseTurn} from '@/lib/telegram-runtime/nurse';
import {nurseTelegramEnabled} from '@/lib/telegram-runtime/config';
import {runTelegramSweep} from '@/lib/telegram-runtime/dispatch';
import {planNurseVisitInput,nurseVisitChoices,telegramVisitQuestion,type TelegramVisitFlow,type TelegramVisitWork} from '@/lib/telegram-runtime/nurse-visit';
import {nextQuestion,questionKey} from '@/lib/nurse-visit/chat-order';
import {parseVisitMeasurement} from '@/lib/nurse-visit/chat-parser';
import {itemTitle,itemDetail,measurementRangeError,visitCopy} from '@/lib/nurse-visit/copy';
import type {NurseVisitReady,NurseVisitItem} from '@/lib/nurse-visit/schema';
import type {TelegramChannelAdapter} from '@/lib/telegram-channel/outbound';

// Synthetic IO only. SQL and webhook journeys separately exercise durable state.
globalThis.fetch=(()=>{throw Error('Network forbidden in nurse runtime checks');}) as typeof fetch;
const bot={account:'synthetic-nurse',botId:100},chat=2001;
const parsed=parseTelegramUpdate({update_id:1,message:{message_id:2,date:1760000000,from:{id:chat,is_bot:false},chat:{id:chat,type:'private'},text:'A factual note',reply_to_message:{message_id:77,chat:{id:chat,type:'private'}}}},bot);
assert.ok(parsed.ok);
assert.equal(inboxEventFrom(parsed.event).payload.replyToMessageId,77,'The durable inbox must retain the exact note prompt');
const linkReply=parseTelegramUpdate({update_id:3,message:{message_id:4,date:1760000000,from:{id:chat,is_bot:false},chat:{id:chat,type:'private'},text:'/start AbCdEfGhIjKlMnOpQrStUvWxYz012345',reply_to_message:{message_id:77,chat:{id:chat,type:'private'}}}},bot);
assert.ok(linkReply.ok);
assert.equal(inboxEventFrom(linkReply.event).kind,'link');
assert.equal('replyToMessageId' in inboxEventFrom(linkReply.event).payload,false,'Sign-in payload contract stays unchanged');

const calls:{method:string;body:Record<string,unknown>}[]=[];
const http:TelegramHttpPort=async(url,init)=>{
 const body=JSON.parse(init.body),method=url.slice(url.lastIndexOf('/')+1);calls.push({method,body});
 return Response.json({ok:true,result:{message_id:77,from:{id:100,is_bot:true},chat:{id:chat,type:'private'},text:body.text}});
};
const adapter=createTelegramAdapter({config:{...bot,enabled:true,botToken:'100:synthetic_opaque_bot_token_0123456789AB',timeoutMs:100,maxResponseBytes:262144},http});
const prompt={address:String(chat),text:'Completion note',protectContent:true,keyboard:{kind:'force_reply'}} as unknown as SystemTextPayload;
assert.equal((await adapter.deliverText(prompt)).kind,'accepted');
assert.equal(calls[0].body.protect_content,true,'Text-only nurse prompts must be protected too');
assert.deepEqual(calls[0].body.reply_markup,{force_reply:true,selective:true});
assert.equal(calls[0].body.parse_mode,undefined,'Nurse data remains plain text');
assert.deepEqual(calls[0].body.link_preview_options,{is_disabled:true});
console.log('Nurse Telegram: exact reply context, protected plain-text prompt and reply affordance passed.');

const id='aa330000-0000-4000-8000-000000000001',attempt='aa330000-0000-4000-8000-000000000002';
for(const value of [undefined,'false','TRUE','1','true '])assert.equal(nurseTelegramEnabled({NOREON_TELEGRAM_ENABLED:'true',NOREON_NURSE_TELEGRAM_ENABLED:value}),false);
assert.equal(nurseTelegramEnabled({NOREON_NURSE_TELEGRAM_ENABLED:'true'}),false);
assert.equal(nurseTelegramEnabled({NOREON_TELEGRAM_ENABLED:'true',NOREON_NURSE_TELEGRAM_ENABLED:'true'}),true);
const rendered=renderNurseTurn('en',{kind:'today',tasks:[{id,title:'Arrange <test>',memberName:'Member Example',dueAt:'2026-11-02T12:00:00Z',intentRef:'opaque_reference_0123456789'},{id,title:'Doctor referral',memberName:'Member Example',dueAt:'2026-11-02T12:00:00Z',intentRef:null}],hasMore:false});
assert.ok(rendered&&'text' in rendered);
assert.match(rendered.text,/Member Example · Arrange <test>/);
assert.equal(rendered.protectContent,true);
assert.equal(rendered.keyboard?.kind,'callback');
if(rendered.keyboard?.kind==='callback')assert.equal(rendered.keyboard.rows.flat().length,1,'Read-only tasks have no action');
function checkScalarRange(item:NurseVisitItem,locale:'en'|'hy'|'ru'):void{
 if(item.kind!=='measurement')throw new Error('measurement item expected');
 const [lo,hi]:[number,number]=item.field==='weight'?[20,400]:[30,250];
 for(const value of [String(lo),String(hi),'72,5'])assert.equal(parseVisitMeasurement(item,value,locale).error,null);
 for(const value of ['',String(lo-1),String(hi+1),'72 73','NaN'])assert.equal(parseVisitMeasurement(item,value,locale).error,measurementRangeError(item.field,locale));
}
for(const locale of ['en','hy','ru'] as const){
 const note=renderNurseTurn(locale,{kind:'task-note',title:'Task',memberName:'Member',instructions:'Factual instructions'});
 assert.ok(note&&'text' in note);assert.equal(note.keyboard?.kind,'force_reply');assert.equal(note.protectContent,true);assert.doesNotMatch(note.text,/—/);
 const saved=renderNurseTurn(locale,{kind:'task-saved',next:null});assert.ok(saved&&'text' in saved);assert.doesNotMatch(saved.text,/A factual note/);
 for(const kind of ['pending','refused','help','cancelled','followup-unavailable','task-recovered']){
  const line=renderNurseTurn(locale,{kind});assert.ok(line&&'text' in line);assert.equal(line.protectContent,true);assert.doesNotMatch(line.text,/—/);
 }
}
assert.equal(renderNurseTurn('en',{kind:'today',tasks:[{id,title:'x'.repeat(161),memberName:'Member',dueAt:null,intentRef:null}],hasMore:false}),null,'Oversized data refuses the approved renderer');
assert.equal(renderNurseTurn('en',{kind:'arbitrary',text:'Unreviewed clinical text'}),null);

let effects=0,applies=0;
const runtimeCalls:string[]=[];
const rpc=async(name:string,args:Record<string,unknown>):Promise<unknown>=>{
 runtimeCalls.push(name);
 if(name==='telegram_nurse_receive')return {handled:true,status:'ready',inboxId:id,leaseAttempt:1,callbackId:'callback_1'};
 if(name==='telegram_nurse_apply'){applies++;effects++;throw Error('Crash after committed save');}
 if(name==='telegram_nurse_resume'){assert.equal(args.p_attempt,1);return {ok:true,status:'saved'};}
 throw Error('Unexpected RPC');
};
assert.deepEqual(await handleNurseInbox(rpc,adapter,id,false),{handled:false});assert.equal(runtimeCalls.length,0);
const handled=await handleNurseInbox(rpc,adapter,id,true);
assert.equal(handled.handled,true);assert.equal(handled.ok,true);assert.equal(effects,1);assert.equal(applies,1,'An unknown save checks the same durable command, never constructs another');
const outage=await handleNurseInbox(async()=>{throw Error('DB down');},adapter,id,true);
assert.equal(outage.handled,true,'An unknown nurse route must never fall through as member input');assert.equal(outage.ok,false);
for(const refusal of ['removed','inactive','non-nurse','unassigned','revoked','replaced','foreign-prompt','stale-button','expired']){
 const refusedCalls:string[]=[];
 const refused=await handleNurseInbox(async name=>{refusedCalls.push(name);return {handled:true,status:'refused',inboxId:id,leaseAttempt:1,callbackId:null,reason:refusal};},adapter,id,true);
 assert.deepEqual(refused,{handled:true,ok:true});assert.deepEqual(refusedCalls,['telegram_nurse_receive'],'A durable refusal never executes a command or falls through to member handling');
}

let sends=0,edits=0;
const outputAdapter={deliverText:async()=>{sends++;throw Error('Send timeout');},clearKeyboard:async()=>{edits++;throw Error('Edit failed');}};
let turn:unknown={kind:'task-note',title:'Task',memberName:'Member',instructions:'Instructions'};
const outcomes:unknown[]=[];
const outputRpc=async(name:string,args:Record<string,unknown>):Promise<unknown>=>{
 if(name==='telegram_nurse_outbox_claim')return {ok:true,envelope:{outboxId:id,attemptId:attempt,address:String(chat),locale:'en',turn,rendererVersion:'nurse-tasks-v1',clinicalCopyVersion:'nurse-task-copy-v1'}};
 if(name==='telegram_nurse_outbox_outcome'){outcomes.push(args.p_result);return {ok:true};}
 throw Error('Unexpected RPC');
};
await dispatchNurseMessage(outputRpc,outputAdapter,id,true);
assert.equal(sends,1);assert.deepEqual(outcomes[0],{kind:'unknown'});assert.equal(effects,1,'Sending cannot rerun a business command');
turn={kind:'clear-controls',messageId:77};await dispatchNurseMessage(outputRpc,outputAdapter,id,true);
assert.equal(edits,1);assert.equal(effects,1,'Failed cosmetic edits cannot rerun a save');
assert.equal((await dispatchNurseMessage(outputRpc,outputAdapter,id,false)).state,'off');assert.equal(sends,1);
assert.equal((await dispatchNurseMessage(async()=>({ok:false,status:'unapproved'}),outputAdapter,id,true)).state,'not_invoked');assert.equal(sends,1);
assert.equal((await dispatchNurseMessage(async()=>({ok:true,envelope:{outboxId:id,attemptId:attempt,address:String(chat),locale:'en',turn,rendererVersion:'unapproved-version',clinicalCopyVersion:'nurse-task-copy-v1'}}),outputAdapter,id,true)).state,'claim_unconfirmed');assert.equal(sends,1,'Unknown renderer versions cannot send');

let recordedAttempts=0;const retained:unknown[]=[];
const recordLostRpc=async(name:string,args:Record<string,unknown>):Promise<unknown>=>{
 if(name==='telegram_nurse_outbox_claim')return {ok:true,envelope:{outboxId:id,attemptId:attempt,address:String(chat),locale:'en',turn:{kind:'task-saved',next:null},rendererVersion:'nurse-tasks-v1',clinicalCopyVersion:'nurse-task-copy-v1'}};
 if(name==='telegram_nurse_outbox_outcome'){retained.push(args.p_result);if(++recordedAttempts<3)throw Error('Outcome response lost');return {ok:true};}
 throw Error('Unexpected RPC');
};
const beforeSend=sends;
await dispatchNurseMessage(recordLostRpc,outputAdapter,id,true);
assert.equal(sends,beforeSend+1,'Only observation recording retries after a send');assert.equal(retained.length,3);assert.deepEqual(retained,[{kind:'unknown'},{kind:'unknown'},{kind:'unknown'}]);
console.log('Nurse Telegram: gates, bounded trilingual rendering, crash recovery and one-attempt send/edit checks passed (mocked IO).');

for(const enabled of [false,true])for(const databaseEnabled of [false,true]){
 const routeCalls:string[]=[];
 const routeRpc=async(rpcName:string):Promise<unknown>=>{
  routeCalls.push(rpcName);
  if(rpcName==='channel_inbox_next')return [id];
  if(rpcName==='telegram_nurse_receive')return databaseEnabled?{handled:true,status:'done',inboxId:id,leaseAttempt:1}:{handled:false};
  if(rpcName==='channel_inbox_process')return {ok:true};
  if(rpcName.endsWith('reconcile')||rpcName==='delivery_reconcile_stale')return {reconciled:0};
  throw Error('Unexpected route RPC');
 };
 const report=await runTelegramSweep({rpc:routeRpc,adapter:null,accountRef:'synthetic-nurse',nurseEnabled:enabled});
 assert.equal(routeCalls.includes('telegram_nurse_receive'),enabled);
 assert.equal(routeCalls.includes('channel_inbox_process'),!(enabled&&databaseEnabled),'Off nurse gates preserve old handling; consumed nurse events never reach members');
 assert.equal(report.inbox.processed,1);
}
console.log('Nurse Telegram: nurse routing precedes member processing, off gates preserve the old route.');

// NT-02: independent nurse bindings all have ready output. Slow provider calls
// must leave queued work unclaimed and allow a queued member reply to advance.
const realNow=Date.now;let clock=1_000_000;
Date.now=()=>clock;
try{
 const nurseIds=Array.from({length:8},(_,i)=>`bb330000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
 const inbox=nurseIds.map(id=>({id,status:'received',attempts:0,leaseUntil:0}));
 let leases=0;
 const unclaimed=new Set(nurseIds);let memberProgress=0,nurseClaims=0;
 const order:string[]=[];
 const timedRpc=async(name:string,args:Record<string,unknown>,timeoutMs?:number):Promise<unknown>=>{
  if(name==='channel_inbox_next'){
   assert.equal(timeoutMs,2_000,'The lease RPC must enforce the time reserved for it');
   clock+=2_000;
   for(const row of inbox)if(row.status==='processing'&&row.leaseUntil<clock&&row.attempts>=5)row.status='dead';
   const rows=inbox.filter(row=>row.status==='received'||(row.status==='processing'&&row.leaseUntil<clock)).slice(0,Number(args.p_limit));
   for(const row of rows){row.status='processing';row.attempts++;row.leaseUntil=clock+60_000;leases++;}
   return rows.map(row=>row.id);
  }
  if(name==='telegram_nurse_receive'){clock+=2_000;return {handled:true,status:'ready',inboxId:args.p_id,leaseAttempt:1};}
  if(name==='telegram_nurse_apply'){inbox.find(row=>row.id===args.p_id)!.status='done';clock+=2_000;return {ok:true,status:'queued'};}
  if(name==='telegram_nurse_outbox_queue')return {ids:[...unclaimed]};
  if(name==='telegram_nurse_outbox_claim'){
   nurseClaims++;unclaimed.delete(String(args.p_id));
   return {ok:true,envelope:{outboxId:args.p_id,attemptId:attempt,address:String(chat+nurseIds.indexOf(String(args.p_id))+1),locale:'en',turn:{kind:'help'},rendererVersion:'nurse-tasks-v1',clinicalCopyVersion:'nurse-task-copy-v1'}};
  }
  if(name==='telegram_nurse_outbox_outcome')return {ok:true};
  if(name==='telegram_dispatch_queue')return {system:[],replies:[id]};
  if(name==='telegram_auth_message_queue')return [];
  if(name==='conversation_claim')return {ok:true,fresh:true,adapter:'telegram',accountRef:'synthetic-nurse',envelope:{deliveryId:id,attemptId:attempt,attemptSeq:1,endpointId:id,address:String(chat),generation:1,body:'Synthetic member reply',contentHash:'a'.repeat(64),approvalId:id,approvedBy:{staffId:id,displayName:'Synthetic doctor',role:'doctor',clinicId:id}}};
  if(name==='delivery_observe')return {ok:true,result:'retained'};
  if(name==='conversation_outcome')return {ok:true,result:'recorded'};
  if(name.endsWith('reconcile')||name==='delivery_reconcile_stale')return {reconciled:0};
  return {state:'off'};
 };
 const slowAdapter={...adapter,
  deliver:async()=>{order.push('member');clock+=10_000;memberProgress++;return {kind:'unknown',reason:'Synthetic timeout'} as const;},
  deliverText:async()=>{order.push('nurse');clock+=10_000;return {kind:'unknown',reason:'Synthetic timeout'} as const;},
 } as TelegramChannelAdapter;
 for(let i=0;i<6;i++){
  await runTelegramSweep({rpc:timedRpc,adapter:null,accountRef:'synthetic-nurse',nurseEnabled:true,deadlineAt:clock+10_000});
  clock+=61_000; // An accidental lease would expire before the next sweep.
 }
 assert.equal(leases,0,'Short-budget deferral must not lease inbox rows');
 assert.ok(inbox.every(row=>row.status==='received'&&row.attempts===0),'Repeated deferral cannot consume attempts or dead-letter unstarted work');
 await runTelegramSweep({rpc:timedRpc,adapter:null,accountRef:'synthetic-nurse',nurseEnabled:true,deadlineAt:clock+40_000});
 assert.equal(leases,0,'Lease latency must fit in addition to processing and delivery reserves');
 const started=clock;
 await runTelegramSweep({rpc:timedRpc,adapter:slowAdapter,accountRef:'synthetic-nurse',nurseEnabled:true,deadlineAt:started+50_000});
 assert.equal(memberProgress,1,'Member delivery retains a share of the sweep');
 assert.equal(order[0],'member','Nurse work cannot monopolize the sweep before existing delivery');
 assert.ok(clock-started<=50_000,'Slow nurse sends must respect the absolute request deadline');
 assert.ok(nurseClaims>0&&nurseClaims<nurseIds.length,'Unstarted nurse items remain unclaimed for the next sweep');
 assert.equal(leases,inbox.filter(row=>row.status==='done').length,'Only inbox rows that start processing may be leased');
 assert.ok(inbox.some(row=>row.status==='received'&&row.attempts===0),'Unstarted inbox rows keep their attempt budget');
 const claimedBefore=nurseClaims;
 await dispatchNurseMessage(timedRpc,slowAdapter,nurseIds.at(-1)!,true,clock+1);
 assert.equal(nurseClaims,claimedBefore,'Insufficient remaining time refuses before the attempt claim');
}finally{Date.now=realNow;}
console.log('Nurse Telegram: slow sends preserve member progress, request budget and unclaimed work (mocked IO).');

// Every delivery path must check again before each claim, including the replies
// queued by Zoe after the first dispatch. No supplied deadline keeps batch behaviour.
for(const kind of ['system','auth','reply','afterZoe','nurse'] as const)for(const bounded of [true,false]){
 let clock=2_000_000,claims=0,dispatchQueues=0;
 const realNow=Date.now;Date.now=()=>clock;
 try{
  const queued=Array.from({length:3},(_,i)=>`cc330000-0000-4000-8000-${String(i+1).padStart(12,'0')}`);
  const claimNames=['system_message_claim','telegram_auth_message_claim','conversation_claim','telegram_nurse_outbox_claim'];
  const rpc=async(name:string,args:Record<string,unknown>,timeoutMs?:number):Promise<unknown>=>{
   if(name==='channel_inbox_next')return [];
   if(name==='telegram_dispatch_queue'){
    dispatchQueues++;
    return {system:kind==='system'||(kind==='afterZoe'&&dispatchQueues>1)?queued:[],replies:kind==='reply'?queued:[]};
   }
   if(name==='telegram_auth_message_queue')return kind==='auth'?queued:[];
   if(name==='telegram_nurse_outbox_queue')return {ids:kind==='nurse'?queued:[]};
   if(claimNames.includes(name)){
    if(kind!=='nurse')assert.equal(timeoutMs,bounded?2_000:undefined,'Only deadline-bound sends cap their RPCs');
    claims++;
    if(name==='telegram_nurse_outbox_claim')return {ok:true,envelope:{outboxId:args.p_id,attemptId:attempt,address:String(chat),locale:'en',turn:{kind:'help'},rendererVersion:'nurse-tasks-v1',clinicalCopyVersion:'nurse-task-copy-v1'}};
    if(name==='conversation_claim')return {ok:true,fresh:true,adapter:'telegram',accountRef:'synthetic-nurse',envelope:{deliveryId:args.p_delivery,attemptId:attempt,attemptSeq:1,endpointId:id,address:String(chat),generation:1,body:'Synthetic reply',contentHash:'a'.repeat(64),approvalId:id,approvedBy:{staffId:id,displayName:'Synthetic doctor',role:'doctor',clinicId:id}}};
    return {ok:true,fresh:true,adapter:'telegram',accountRef:'synthetic-nurse',envelope:{messageId:args.p_message,attemptId:attempt,address:String(chat),text:'Synthetic text',...(name==='system_message_claim'?{bodyHash:'a'.repeat(64)}:{})}};
   }
   if(name==='delivery_observe')return {ok:true,result:'retained'};
   if(name.endsWith('_outcome')){clock+=2_000;return {ok:true,result:'recorded'};}
   return {state:'off',reconciled:0};
  };
  const transport=async()=>{clock+=bounded?10_000:30_000;return {kind:'unknown',reason:'Synthetic timeout'} as const;};
  await runTelegramSweep({rpc,adapter:{...adapter,deliver:transport,deliverText:transport},accountRef:'synthetic-nurse',nurseEnabled:kind==='nurse',
   ...(bounded?{deadlineAt:clock+(kind==='nurse'?20_000:32_000)}:{}),...(kind==='afterZoe'?{zoe:async()=>({claimed:1,finished:{answered:1},failed:0})}:{})});
  assert.equal(claims,bounded?1:3,`${kind}: claim only with a full transport and recording window; no deadline keeps all sends`);
  if(bounded)assert.ok(clock<=2_000_000+(kind==='nurse'?20_000:32_000),`${kind}: claimed attempt finishes before the deadline`);
 }finally{Date.now=realNow;}
}
console.log('Nurse Telegram: all member and nurse claims require completion budget; no-deadline delivery unchanged (mocked IO).');

// System/reply recording has two retry loops, unlike nurse outcomes. Their full
// claim + transport + observation + projection path must fit before a claim.
for(const kind of ['system','reply','afterZoe'] as const)for(const budget of [26_000,32_000]){
 const realNow=Date.now,realTimeout=globalThis.setTimeout;let clock=3_000_000,claims=0,observations=0,outcomes=0,queues=0;
 Date.now=()=>clock;
 globalThis.setTimeout=((callback:()=>void,ms:number)=>{clock+=ms;callback();return realTimeout(()=>{},0);}) as typeof setTimeout;
 try{
  const rpc=async(name:string,args:Record<string,unknown>,timeoutMs?:number):Promise<unknown>=>{
   if(name==='channel_inbox_next'||name==='telegram_auth_message_queue')return [];
   if(name==='telegram_dispatch_queue'){queues++;return {system:kind==='system'||(kind==='afterZoe'&&queues>1)?[id]:[],replies:kind==='reply'?[id]:[]};}
   if(name==='system_message_claim'||name==='conversation_claim'){
    assert.equal(timeoutMs,2_000);
    claims++;clock+=2_000;
    if(name==='conversation_claim')return {ok:true,fresh:true,adapter:'telegram',accountRef:'synthetic-nurse',envelope:{deliveryId:args.p_delivery,attemptId:attempt,attemptSeq:1,endpointId:id,address:String(chat),generation:1,body:'Synthetic reply',contentHash:'a'.repeat(64),approvalId:id,approvedBy:{staffId:id,displayName:'Synthetic doctor',role:'doctor',clinicId:id}}};
    return {ok:true,fresh:true,adapter:'telegram',accountRef:'synthetic-nurse',envelope:{messageId:id,attemptId:attempt,address:String(chat),text:'Synthetic text',bodyHash:'a'.repeat(64)}};
   }
   if(name==='zoe_chat_card_for_message'||name==='telegram_signin_link_arm_reply'){assert.equal(timeoutMs,2_000);clock+=2_000;return null;}
   if(name==='delivery_observe'){assert.equal(timeoutMs,2_000);clock+=2_000;if(++observations<3)throw Error('Observation response lost');return {ok:true,result:'retained'};}
   if(name==='system_message_outcome'||name==='conversation_outcome'){assert.equal(timeoutMs,2_000);clock+=2_000;if(++outcomes<3)throw Error('Outcome response lost');return {ok:true,result:'recorded'};}
   return {state:'off',reconciled:0};
  };
  const transport=async()=>{clock+=10_000;return {kind:'unknown',reason:'Synthetic timeout'} as const;};
  await runTelegramSweep({rpc,adapter:{...adapter,deliver:transport,deliverText:transport},accountRef:'synthetic-nurse',deadlineAt:clock+budget,signinLinkOrigin:'https://app.noreon.health',
   cards:{press:async()=>false,offers:async()=>0,keyboard:async rpc=>{await rpc('zoe_chat_card_for_message',{p_message:id});return null;},noticeKeyboard:async()=>null},
   ...(kind==='afterZoe'?{zoe:async()=>({claimed:1,finished:{answered:1},failed:0})}:{})});
  assert.equal(claims,budget===26_000?0:1,`${kind}: full recording retry budget is required before claiming`);
  assert.ok(clock<=3_000_000+budget,`${kind}: all observation and outcome retries finish within the deadline`);
  if(claims){assert.equal(observations,3);assert.equal(outcomes,3);}
 }finally{Date.now=realNow;globalThis.setTimeout=realTimeout;}
}
console.log('Nurse Telegram: member transport and both recording retry loops fit before the deadline (mocked IO).');

// NT-01: the environment-off path never invokes receive. It must pass the
// original durable ID to the legacy entry point, where the SQL companion tests
// the real captured-binding guard and absence of member messages/doctor alerts.
const disabledRouteCalls:string[]=[];
const disabledRouteRpc=async(name:string,args:Record<string,unknown>):Promise<unknown>=>{
 disabledRouteCalls.push(name);
 if(name==='channel_inbox_next')return [id];
 if(name==='channel_inbox_process'){
  assert.deepEqual(args,{p_id:id},'Disabled routing must not recommit or supply a replacement identity');
  return {ok:true,status:'done',result:'nurse_access'};
 }
 if(name==='delivery_reconcile_stale')return {reconciled:0};
 throw Error(`Unexpected disabled-route operation: ${name}`);
};
const disabledReport=await runTelegramSweep({rpc:disabledRouteRpc,adapter:null,accountRef:'synthetic-nurse',nurseEnabled:false});
assert.equal(disabledReport.inbox.processed,1);
assert.deepEqual(disabledRouteCalls,['channel_inbox_next','channel_inbox_process','delivery_reconcile_stale']);
console.log('Nurse Telegram: environment-off sweeps use the original event at the guarded legacy entry (mocked IO).');

// Visit clinical wording comes from the web copy, including its existing urgent wording.
const visitOpening=renderNurseTurn('en',{kind:'visit-opening',visit:{source:'home-request',id,memberId:id,memberName:'Fictional member',arrangementToken:'1',startsAt:'2026-11-02T08:00:00Z',endsAt:null,mode:'home',location:'Fictional location',clinic:null,bookingStatus:'confirmed',completion:null},early:false});
assert.ok(visitOpening&&'text' in visitOpening,'A visit opens with its protected details');
assert.match(visitOpening.text,/Fictional member/);
assert.match(visitOpening.text,/Fictional location/);
assert.match(visitOpening.text,/Check with your care team/);
assert.equal(visitOpening.protectContent,true);

const summary={samplesPlanned:0,samplesTaken:0,bpTaken:false,deviceDone:null,openItems:[]};
const baseVisit:NurseVisitReady={version:'nurse-visit-v1',enabled:true,today:'2026-11-02',checklistVersion:'synthetic-v1',caseRevision:1,
 visit:{source:'home-request',id,memberId:id,memberName:'Fictional member',arrangementToken:'1',startsAt:'2026-11-02T08:00:00Z',endsAt:null,mode:'home',location:'Fictional location',clinic:null,bookingStatus:'confirmed',completion:null},
 steps:[],items:[],counts:summary,completion:null};
const initialFlow=():TelegramVisitFlow=>({skipped:[],editing:null,view:'question',comment:''});
const check=(section:'safety'|'sampling'|'bp'):NurseVisitItem=>({kind:'check',key:`check:${section}`,checkId:section,section,version:'synthetic-v1',label:{en:`Fictional ${section} question`,hy:`Fictional ${section} question`},source:'Fictional protocol',mark:null});
const bp:NurseVisitItem={key:'measure:bp',kind:'measurement',field:'bp',mark:null};
const weight:NurseVisitItem={key:'measure:weight',kind:'measurement',field:'weight',mark:null};
const waist:NurseVisitItem={key:'measure:waist',kind:'measurement',field:'waist',mark:null};
const sample:NurseVisitItem={key:'sample:cbc',kind:'sample',testId:'cbc',title:'Fictional CBC',mark:null};
const device:NurseVisitItem={key:`device:${id}`,kind:'device',assignmentId:id,serial:'Fictional serial',model:'Fictional monitor',mark:null};
const taken={done:true,note:null,values:null,recordedAt:'2026-11-02T08:00:00Z',nurseName:'Fictional nurse'};
const steps=(...names:('confirmed'|'started'|'samples-collected'|'samples-at-lab')[])=>names.map(step=>({step,at:'2026-11-02T08:00:00Z',by:'Fictional nurse'}));
const work=(snapshot:NurseVisitReady,flow:TelegramVisitFlow,action:string,words?:string):TelegramVisitWork=>({phase:'input',snapshot,flow,input:{action,...(words===undefined?{}:{words})},locale:'en',token:'synthetic-snapshot'});
const ask=(data:NurseVisitReady,flow:TelegramVisitFlow,l:'en'|'hy'|'ru'='en',error?:unknown)=>renderNurseTurn(l,{kind:'visit-question',data,flow:{...flow,comment:''},controls:nurseVisitChoices(data,flow).map((action,i)=>({action,ref:`synthetic_visit_ref_${String(i).padStart(5,'0')}`})),...(error?{error}:{})});
const openAck=renderNurseTurn('en',{kind:'visit-action',nurseName:'Fictional nurse',action:'answer-done',questionKey:sample.key,item:sample});
assert.ok(openAck&&'text'in openAck);assert.match(openAck.text,new RegExp(visitCopy('en').sampleTaken),'The attributed answer uses the exact sample choice');

// Exercise the actual order and parser through the Telegram planner, then render
// each next question with the same web labels and detail. No second order exists.
let round:NurseVisitReady={...baseVisit,items:[device,weight,bp,sample,check('bp'),check('sampling'),waist,check('safety')]},flow=initialFlow();
const order:string[]=[];
for(let n=0;n<20;n++){
 const q=telegramVisitQuestion(round,flow);assert.deepEqual(q,nextQuestion(round,flow.skipped));assert.ok(q);
 order.push(questionKey(q));
 const prompt=ask(round,flow);assert.ok(prompt&&'text'in prompt);assert.equal(prompt.protectContent,true);
 if(q.kind==='finish')break;
 if(q.kind==='item'){assert.ok(prompt.text.includes(itemTitle(q.item,'en')));assert.ok(prompt.text.includes(itemDetail(q.item,'en')));}
 const words=q.kind==='item'&&q.item.kind==='measurement'?q.item.field==='bp'?'148/93 72':'72.5':undefined;
 const plan=planNurseVisitInput(work(round,flow,words?'reading':'answer-done',words));assert.ok(plan);assert.equal(plan.error,null);
 assert.equal(plan.operation,q.kind==='step'?'step':'mark');
 if(q.kind==='step')round={...round,steps:[...round.steps,...steps(q.step)]};
 else round={...round,items:round.items.map(item=>item.key===q.item.key?{...item,mark:{...taken}}:item)};
 flow=plan.flow;
}
assert.deepEqual(order,['step:confirmed','step:started','check:safety','check:sampling','sample:cbc','step:samples-collected','step:samples-at-lab','check:bp','measure:weight','measure:bp','measure:waist',`device:${id}`,'finish']);
for(const locale of ['en','hy','ru'] as const){
 for(const text of ['148/93 72',' 148 / 93 72 '])assert.deepEqual(parseVisitMeasurement(bp,text,locale),{values:{systolic:148,diastolic:93,pulse:72},error:null});
 for(const text of ['60/30 20','300/200 250','148/93'])assert.equal(parseVisitMeasurement(bp,text,locale).error,null);
 for(const text of ['','148','148/93/72','148/93 72 extra','59/30','301/93','148/29','220/201','93/93','148.5/93','148/93 19','148/93 251']){
  const reading={...baseVisit,steps:steps('confirmed','started'),items:[bp]};
  const plan=planNurseVisitInput({...work(reading,initialFlow(),'reading',text),locale});assert.equal(plan?.operation,null);assert.equal(plan?.error,'measurement');
  const refused=ask(reading,initialFlow(),locale,'measurement');assert.ok(refused&&'text'in refused);assert.ok(refused.text.includes(measurementRangeError('bp',locale)));
 }
 for(const scalar of [weight,waist])checkScalarRange(scalar,locale);
}
const readings={...baseVisit,steps:steps('confirmed','started'),items:[bp]};
const readingPlan=planNurseVisitInput(work(readings,initialFlow(),'reading','148/93 72'));
assert.deepEqual(readingPlan?.values,{systolic:148,diastolic:93,pulse:72});
const readingPrompt=ask(readings,initialFlow());assert.ok(readingPrompt&&'text'in readingPrompt);assert.equal(readingPrompt.keyboard?.kind,'callback');
if(readingPrompt.keyboard?.kind==='callback')assert.equal(readingPrompt.keyboard.forceReply,true,'One exact prompt has choice buttons and the reply affordance');
const transportBefore=calls.length;await adapter.deliverText({...readingPrompt,address:String(chat)});
assert.equal(calls.length,transportBefore+1);assert.equal((calls.at(-1)!.body.reply_markup as {force_reply:boolean}).force_reply,true);
assert.ok('inline_keyboard'in (calls.at(-1)!.body.reply_markup as object));
const notTaken=planNurseVisitInput(work(readings,initialFlow(),'answer-not-done'));
assert.equal(notTaken?.done,false);assert.equal(notTaken?.values,null);
const comment=planNurseVisitInput(work(readings,initialFlow(),'comment'));assert.equal(comment?.flow.view,'comment');
const commentWords='Fictional comment: arrange a different cuff.';
const commented=planNurseVisitInput(work(readings,comment!.flow,'comment-save',commentWords));assert.equal(commented?.flow.comment,commentWords);
const withComment=planNurseVisitInput(work(readings,commented!.flow,'reading','148/93 72'));assert.deepEqual(withComment?.values,{systolic:148,diastolic:93,pulse:72});assert.equal(withComment?.flow.comment,'','A resolved reading retires the comment slot');
assert.equal(planNurseVisitInput(work(readings,comment!.flow,'reading','148/93 72')),null,'A reading cannot answer a comment prompt');
const commentPrompt=ask(readings,comment!.flow);assert.ok(commentPrompt&&'text'in commentPrompt);assert.ok(commentPrompt.text.includes(visitCopy('en').commentLabel));assert.ok(commentPrompt.text.includes(visitCopy('en').commentHelp));assert.ok(!commentPrompt.text.includes(commentWords));
assert.equal(planNurseVisitInput(work(readings,comment!.flow,'comment-save','x'.repeat(1001))),null);
assert.equal(planNurseVisitInput(work(readings,comment!.flow,'comment-save','bad\u0000slot')),null);
const safety=check('safety'),incomplete={...baseVisit,steps:steps('confirmed','started'),items:[safety]};
const skipped=planNurseVisitInput(work(incomplete,initialFlow(),'skip'));assert.deepEqual(skipped?.flow.skipped,[safety.key]);
assert.equal(telegramVisitQuestion(incomplete,skipped!.flow)?.kind,'finish');
assert.ok(nurseVisitChoices(incomplete,skipped!.flow).includes(`choose:${safety.key}`),'Skipped safety returns at finish');
const finish=planNurseVisitInput(work(incomplete,skipped!.flow,'finish'));assert.equal(finish?.flow.view,'complete');
const finishPrompt=ask(incomplete,finish!.flow);assert.ok(finishPrompt&&'text'in finishPrompt);assert.ok(finishPrompt.text.includes(itemTitle(safety,'en')),'Skipped safety remains in the not-done list');
for(const reason of ['',' ','ab'])assert.equal(planNurseVisitInput(work(incomplete,finish!.flow,'reason',reason))?.error,'reason');
const reasonPlan=planNurseVisitInput(work(incomplete,finish!.flow,'reason','Fictional reason'));assert.equal(reasonPlan?.operation,'complete');
const allDone={...incomplete,items:[{...safety,mark:taken}]};
assert.equal(planNurseVisitInput(work(allDone,{...initialFlow(),view:'complete'},'complete'))?.operation,'complete','No reason required when all are done');
const returned=planNurseVisitInput(work(incomplete,skipped!.flow,`choose:${safety.key}`));assert.equal(returned?.flow.editing,safety.key);
const future={...baseVisit,visit:{...baseVisit.visit,startsAt:'2026-11-03T08:00:00Z'},steps:steps('confirmed')};assert.equal(telegramVisitQuestion(future,initialFlow()),null);
const past={...baseVisit,visit:{...baseVisit.visit,startsAt:'2026-11-01T08:00:00Z'},steps:steps('confirmed')};assert.equal(telegramVisitQuestion(past,initialFlow())?.kind,'step');
const completed={...baseVisit,completion:{completedAt:'2026-11-02T09:00:00Z',nurseName:'Fictional nurse',reason:null,summary,visitId:id},steps:steps('samples-collected')};
assert.deepEqual(telegramVisitQuestion(completed,{...initialFlow(),editing:'measure:bp'}),{kind:'step',step:'samples-at-lab'});
assert.deepEqual(nurseVisitChoices(completed,initialFlow()),['answer-done','skip']);
assert.equal(telegramVisitQuestion({...completed,steps:steps('samples-collected','samples-at-lab')},initialFlow()),null);
assert.equal(ask({...readings,items:[{...bp,mark:{...taken,values:{systolic:148,diastolic:93,pulse:72}}}]},initialFlow()),null,'Transport snapshots must not repeat saved readings');
assert.equal(ask({...readings,items:[{...bp,mark:{...taken,note:commentWords}}]},initialFlow()),null,'Transport snapshots must not repeat comments');
console.log('Nurse Telegram visits: every web question kind, trilingual parser boundaries, readings, separate comments, skips and unchanged finish rule passed (pure planner and mocked transport).');
assert.equal(planNurseVisitInput(work(allDone,{...initialFlow(),view:'complete'},'reason','Fictional unrelated words')),null,'An all-done finish has no typed-reason slot');
for(const operation of ['mark','step','complete',null]){
 const pending=renderNurseTurn('en',{kind:'visit-pending',operation});
 assert.ok(pending&&'text'in pending);assert.ok(pending.text.includes(operation==='complete'?visitCopy('en').notConfirmedComplete:visitCopy('en').notConfirmed));
 assert.ok(pending.text.includes('/resume'));assert.equal(pending.protectContent,true);
}

// The runtime, rather than a mocked planner, drives the real parser/order and
// persists its plan before invoking apply. A lost result resumes the same inbox.
for(const lostApply of [false,true]){
 const visitCalls:{name:string;args:Record<string,unknown>}[]=[],input=work(readings,{...initialFlow(),comment:'Fictional separate comment'},'reading','148/93 72');
 const after={...readings,items:[{...bp,mark:taken}]};
 const renderWork={...input,phase:'render',snapshot:after,flow:initialFlow()};
 const visitRpc=async(name:string,args:Record<string,unknown>):Promise<unknown>=>{
  visitCalls.push({name,args});
  if(name==='telegram_nurse_receive')return {handled:true,status:'ready',inboxId:id,leaseAttempt:3,visit:input};
  assert.equal(args.p_id,id);assert.equal(args.p_attempt,3);
  if(name==='telegram_nurse_visit_prepare'){
   const plan=args.p_plan as ReturnType<typeof planNurseVisitInput>;
   assert.equal(plan?.questionKey,'measure:bp');assert.equal(plan?.operation,'mark');assert.deepEqual(plan?.values,{systolic:148,diastolic:93,pulse:72});
   assert.ok(!JSON.stringify(plan).includes('Fictional separate comment'),'The words are read from the pinned context, never resubmitted as a different item');
   assert.ok(!('submissionId'in (plan??{})),'Only the durable database creates IDs');return {ok:true,status:'ready'};
  }
  if(name==='telegram_nurse_apply'){if(lostApply)throw Error('Synthetic committed result lost');return {ok:true,status:'visit-render',visit:renderWork};}
  if(name==='telegram_nurse_resume')return {ok:true,status:'visit-render',visit:renderWork};
  if(name==='telegram_nurse_visit_render'){
   assert.deepEqual(args.p_plan,{token:input.token,questionKey:'finish',choices:['change','finish']});return {ok:true,status:'queued'};
  }
  throw Error('Unexpected visit operation');
 };
 assert.deepEqual(await handleNurseInbox(visitRpc,null,id,true),{handled:true,ok:true});
 assert.equal(visitCalls.filter(c=>c.name==='telegram_nurse_visit_prepare').length,1);
 assert.equal(visitCalls.filter(c=>c.name==='telegram_nurse_apply').length,1);
 assert.equal(visitCalls.filter(c=>c.name==='telegram_nurse_resume').length,lostApply?1:0);
 assert.equal(visitCalls.filter(c=>c.name==='telegram_nurse_visit_render').length,1);
}
const preparedCalls:string[]=[];
assert.deepEqual(await handleNurseInbox(async(name)=>{
 preparedCalls.push(name);
 if(name==='telegram_nurse_receive')return {handled:true,status:'ready',inboxId:id,leaseAttempt:1,visit:null};
 if(name==='telegram_nurse_apply')return {ok:false,status:'pending'};
 throw Error('An unresolved command is not replanned');
},null,id,true),{handled:true,ok:false});
assert.deepEqual(preparedCalls,['telegram_nurse_receive','telegram_nurse_apply']);
console.log('Nurse Telegram visits: persisted-plan ordering, lost-result resume, exact inbox/lease and frozen pending work passed (mocked RPC).');
for(const [action,label] of [['change','Change an answer'],['back',visitCopy('en').goBack],['comment-back',visitCopy('en').goBack],['comment-clear','Continue without a comment'],[`choose:${safety.key}`,itemTitle(safety,'en')]]){
 const ack=renderNurseTurn('en',{kind:'visit-action',nurseName:'Fictional nurse',action,questionKey:'finish',...(action.startsWith('choose:')?{item:safety}:{})});
 assert.ok(ack&&'text'in ack);assert.ok(ack.text.includes(label),`Acknowledgement must name ${action}`);assert.ok(!ack.text.includes(': Done'),'Navigation cannot claim an item is done');
}
const maxName='F'.repeat(160);
const maxNameList=renderNurseTurn('en',{kind:'visit-list',visits:[{source:'home-request',id,memberId:id,memberName:maxName,startsAt:baseVisit.visit.startsAt,intentRef:'synthetic_visit_ref_12345'}]});
assert.ok(maxNameList&&'text'in maxNameList);assert.ok(maxNameList.text.includes(maxName));
assert.equal((await adapter.deliverText({...maxNameList,address:String(chat)})).kind,'accepted','Every allowed visit name fits its button without truncating the name');
