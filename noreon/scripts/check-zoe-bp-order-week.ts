/** Focused BP4-R3/R4 regressions. In-memory ports exercise the actual commands and dialog projection. */
import assert from 'node:assert/strict';
process.env.NOREON_ZOE_APP_V3='true';
import {cardSchema,type Snapshot,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {dialogThread} from '@/lib/zoe-chat-actions/thread';
import {logBp,logRepeat,type CardPorts} from '@/lib/zoe-chat-actions/commands';
import {runBpFlow,answerRedFlag,type FlowPorts,type FlagPorts} from '@/lib/zoe-chat-actions/bp-flow-server';
import {RED_FLAG_QUESTIONS,flagItem} from '@/lib/zoe-chat-actions/bp-flow';
import {weekSummary,type BpWeek} from '@/lib/bp-week/model';
import type {MemberActor} from '@/lib/zoe-chat-actions/actor';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const who={memberId:id(1),channel:'app'} as MemberActor;
const at='2026-11-02T08:00:00Z',doneAt='2026-11-02T08:00:05Z';
const make=(n:number,kind:string,snapshot:unknown,outcome={},state='open')=>cardSchema.parse({id:id(n),requestId:id(n+100),kind,snapshot,outcome,state,source:'chip',sourceSeq:null,at});
const parent=make(2,'bp',{v:1,week:null},{bp:{systolic:166,diastolic:98,doneAt}},'done');
const flags=make(3,'red_flags',{v:1,episodeId:'episode',readingId:id(20),readings:[{sbp:166,dbp:98}],follows:{cardId:parent.id,item:'bp'}});
const order=(cards:ZoeCard[])=>dialogThread([],cards).map(e=>e.type==='item'?e.item.key:e.card.id);
assert.ok(flags.valid,'New followups retain the causal parent');
assert.deepEqual(order([parent,flags]),[parent.id,flags.id],'Save: reading/reply precede safety form despite earlier post timestamp');
const completeFlags=make(3,'red_flags',flags.snapshot,{'a:faint':{answer:false,doneAt:'2026-11-02T08:00:10Z'}},'done');
const repeat=make(4,'repeat',{v:1,first:{systolic:166,diastolic:98},follows:{cardId:flags.id,item:'a:faint'}});
const expected=[parent.id,flags.id,repeat.id];
assert.deepEqual(order([repeat,completeFlags,parent]),expected,'Final No precedes repeat form');
assert.deepEqual(order(JSON.parse(JSON.stringify([repeat,completeFlags,parent])).map((c:unknown)=>cardSchema.parse(c))),expected,'Reload/second device derives same causal order from persisted cards');
const pending=make(2,'bp',{v:1,week:null});
assert.deepEqual(order([pending,flags]),[pending.id],'Poll between followup post and parent record does not expose the next form');

const now=new Date(),date=new Date(now.getTime()+4*3600000).toISOString().slice(0,10);
const week:Snapshot<'bp'>['week']={weekId:id(40),date,slot:'morning',time:'00:00',day:1,days:7,saved:0,expected:28};
const baseWeek:BpWeek={id:week.weekId,startsOn:date,days:7,readingsPerSlot:2,morningTime:'00:00',eveningTime:'23:59',reminders:false,startedByRole:'member',createdAt:at,stoppedAt:null,stopReason:null,device:null,readings:[]};
const bp=make(5,'bp',{v:1,week});
const rp=make(6,'repeat',{v:1,first:{systolic:166,diastolic:98},week});
assert.ok(rp.valid,'Repeat snapshot carries BP week slot');
const cards=[bp,rp],writes:Record<string,unknown>[]=[],after:Record<string,unknown>[]=[];
let loseRecord=false,weekStatus:string|null=null,plainSaves=0;
const standalone=new Set<string>();
const ports={
 readCard:async(n:string)=>cards.find(c=>c.id===n)??null,
 readBpWeek:async()=>({version:'bp-week-v1',enabled:true,today:date,currentDevice:null,weeks:[baseWeek]}),
 claim:async(_m:string,n:string,item:string,op:string,payload:Record<string,unknown>)=>{const c=cards.find(c=>c.id===n)!;c.claims[item]??={op,payload};return {ok:true,claim:c.claims[item]};},
 record:async(_m:string,n:string,item:string,value:Record<string,unknown>,close:boolean)=>{if(loseRecord&&item==='bp'){loseRecord=false;return {ok:false,code:'failed'};}const c=cards.find(c=>c.id===n)!;c.outcome[item]={...value,doneAt};if(close)c.state='done';return {ok:true,card:c};},
 saveBp:async(v:{submissionId:string})=>{plainSaves++;standalone.add(v.submissionId);return {status:'saved'};},
 saveBpWeek:async(v:Record<string,unknown>)=>{writes.push(v);if(baseWeek.readings.some(r=>r.id===v.submissionId))return {status:'replayed'};if(standalone.has(v.submissionId as string))return {status:'conflict'};if(weekStatus)return {status:weekStatus};if(baseWeek.readings.length>=2)return {status:'slot-full'};baseWeek.readings.push({id:v.submissionId as string,day:1,slot:'morning',systolic:v.systolic as number,diastolic:v.diastolic as number,pulse:null,measuredAt:v.measuredAt as string});return {status:'saved'};},
 afterBp:async(_m:string,v:Record<string,unknown>)=>{after.push(v);return null;},
} as unknown as CardPorts;
const reading={systolic:166,diastolic:98,pulse:null,measuredAt:now.toISOString()};
assert.equal((await logBp(who,ports,{cardId:bp.id,submissionId:id(50),...reading})).status,'ok');
loseRecord=true;
const input={cardId:rp.id,submissionId:id(51),...reading};
assert.equal((await logRepeat(who,ports,input)).status,'failed','Simulated lost outcome after week save');
weekStatus='not-open'; // The real week RPC replays before checking expiry, closure or capacity.
assert.equal((await logRepeat(who,ports,{...input,submissionId:id(52)})).status,'ok','Retry uses claimed submission after slot became full and week expired');
weekStatus=null;
assert.equal(baseWeek.readings.length,2,'Initial and repeat create two week links');
assert.equal(weekSummary(baseWeek,now).completeSlots,1,'Two readings complete the slot');
assert.equal(writes.at(-1)?.submissionId,id(51),'Retry replays the original week submission');
assert.equal(plainSaves,0,'An applicable week repeat uses week validation and links to its slot');
assert.deepEqual(after[0]?.week,week,'Week survives initial reading flow');
assert.deepEqual(after[1]?.week,week,'Week survives repeat flow');
for(const status of ['not-today','outside-week','not-open']){
 const fresh=make(70+cards.length,'repeat',{v:1,first:{systolic:166,diastolic:98},week});cards.push(fresh);
 weekStatus=status;
 assert.equal((await logRepeat(who,ports,{cardId:fresh.id,submissionId:id(90+cards.length),...reading})).status,'stale',status);
 assert.equal(fresh.outcome.bp,undefined,`${status}: no saved turn`);
}
// A week slot may fill on the initial reading or on another device before the required safety repeat.
for(const filledBy of ['initial','other-device']){
 weekStatus=null;
 baseWeek.readings.splice(1); // One existing reading, so the slot starts partial.
 if(filledBy==='initial'){
  const initialCard=make(310,'bp',{v:1,week});cards.push(initialCard);
  assert.equal((await logBp(who,ports,{cardId:initialCard.id,submissionId:id(311),...reading})).status,'ok');
 }else{
  baseWeek.readings.push({...baseWeek.readings[0],id:id(312)});
 }
 const next=make(filledBy==='initial'?313:314,'repeat',{v:1,first:{systolic:166,diastolic:98},week});cards.push(next);
 const plainBefore:number=plainSaves;
 const submissionId=id(filledBy==='initial'?315:316);
 const result=await logRepeat(who,ports,{cardId:next.id,submissionId,...reading});
 assert.equal(result.status,'ok',`${filledBy}: a full week slot does not block the required safety repeat`);
 assert.equal(plainSaves,plainBefore+1,`${filledBy}: repeat is still saved as a measurement`);
 assert.equal(after.at(-1)?.week,null,'Standalone repeat does not propagate a false week slot');
 assert.ok(next.outcome.bp_week_full,'Fallback route is durable before the ordinary save');
 assert.equal(baseWeek.readings.length,2,`${filledBy}: no third week link`);
 const retryCard=make(filledBy==='initial'?317:318,'repeat',{v:1,first:{systolic:166,diastolic:98},week});cards.push(retryCard);
 const retrySubmission=id(filledBy==='initial'?319:320);
 loseRecord=true;
 assert.equal((await logRepeat(who,ports,{cardId:retryCard.id,submissionId:retrySubmission,...reading})).status,'failed');
 assert.equal((await logRepeat(who,ports,{cardId:retryCard.id,submissionId:id(321),...reading})).status,'ok','Lost outcome on ordinary fallback replays its original submission');
 assert.ok(standalone.has(retrySubmission));
 assert.ok(!standalone.has(id(321)),'Fallback retry never creates another measurement');
}
// Actual flow transitions must carry provenance through the safety questions, not only parse a synthetic snapshot.
for(const episodeReadable of [true,false]){
 const flowCards:ZoeCard[]=[make(200,'bp',{v:1,week},{bp:{...reading,doneAt}},'done')];
 const posted:unknown[]=[];
 const flowPorts:FlowPorts={
  rpc:episodeReadable?async(name)=>{
   if(name==='zoe_bp_episode')return {ok:true,readingId:id(210),readings:[{id:id(210),sbp:166,dbp:98}]};
   if(name==='zoe_bp_reading_zone')return {ok:true};
   throw Error(`Unexpected RPC ${name}`);
  }:null,
  readCards:async()=>({enabled:true,cards:flowCards,clearedSeq:null}),
  post:async(_m,requestId,kind,source,sourceSeq,snapshot)=>{
   const previous=flowCards.find(c=>c.requestId===requestId);
   if(previous)return {ok:true,card:previous,replayed:true};
   posted.push(snapshot);
   const card=cardSchema.parse({id:id(220+flowCards.length),requestId,kind,source,sourceSeq,snapshot,outcome:{},claims:{},state:'open',at});
   assert.ok(card.valid);flowCards.push(card);return {ok:true,card,replayed:false};
  },
 };
 const source=flowCards[0],follows={cardId:source.id,item:'bp'};
 const initial=await runBpFlow(flowPorts,who.memberId,{submissionId:id(211),systolic:166,diastolic:98,follows,week});
 assert.equal(initial.next?.kind,'red_flags');
 const safety=initial.next!;
 assert.ok(safety.valid&&safety.kind==='red_flags');
 assert.deepEqual(safety.snapshot.follows,follows,'runBpFlow persists causal parent');
 assert.deepEqual(safety.snapshot.week,week,'runBpFlow persists week even if episode lookup is unavailable');
 const flagsPorts:FlagPorts={...flowPorts,
  readCard:async(n)=>flowCards.find(c=>c.id===n)??null,
  claim:async(_m,n,item,op,payload)=>{const c=flowCards.find(c=>c.id===n)!;c.claims[item]??={op,payload};return {ok:true,claim:c.claims[item]};},
  record:async(_m,n,item,value,close)=>{const c=flowCards.find(c=>c.id===n)!;c.outcome[item]={...value,doneAt:'2026-11-02T08:00:10Z'};if(close)c.state='done';return {ok:true,card:c,replayed:false};},
  send:async()=>{throw Error('An all-No response does not send a red-flag message');},
 };
 let final;
 for(const [i,question] of RED_FLAG_QUESTIONS.entries()){
  final=await answerRedFlag(who,flagsPorts,{cardId:safety.id,opId:id(250+i),question,answer:false,locale:'en'});
  assert.equal(final.status,'ok');
  if(i<RED_FLAG_QUESTIONS.length-1)assert.equal(posted.length,1,'No followup before the final No');
 }
 assert.ok(final?.status==='ok'&&final.next?.valid&&final.next.kind==='repeat');
 assert.deepEqual(final.next.snapshot.follows,{cardId:safety.id,item:flagItem(RED_FLAG_QUESTIONS.at(-1)!)},'Final No is the repeat form causal parent');
 assert.deepEqual(final.next.snapshot.week,week,'Week slot survives the entire safety question set');
 assert.deepEqual(order(flowCards),[source.id,safety.id,final.next.id],'Actual flow cards project in causal order');
 const reloaded=JSON.parse(JSON.stringify(flowCards)).map((c:unknown)=>cardSchema.parse(c));
 assert.deepEqual(order(reloaded),[source.id,safety.id,final.next.id],'Actual transition survives second-device persisted load');
}
console.log('BP causal order, actual followup provenance and week repeat checks passed');
