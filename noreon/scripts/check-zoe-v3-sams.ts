import assert from 'node:assert/strict';
import {cardSchema} from '@/lib/zoe-chat-actions/registry';
import {redOutcome,withOpenEmergencies} from '@/lib/zoe-chat-actions/bp-flow';
import {cardTurns} from '@/lib/zoe-chat-actions/thread';
const requestId=crypto.randomUUID(),at='2026-11-02T16:00:00Z';
const card=cardSchema.parse({id:crypto.randomUUID(),requestId,kind:'sams',source:'chip',sourceSeq:null,state:'done',at,snapshot:{v:1,episodeId:crypto.randomUUID()},outcome:{'a:musclepain':{answer:true,doneAt:at},'a:darkurine':{answer:true,zone:'red',requestId,text:'I have muscle pain and dark urine.',alerted:true,doneAt:at}}});
assert.equal(card.valid,true,'SAMS is a typed safety card');
assert.equal(redOutcome(card)?.requestId,requestId,'SAMS uses the existing saved-outcome 103 route');
assert.equal(cardTurns(card).length,1,'Only the final safety answer becomes a dialog turn');
console.log('V3 SAMS: typed card, shared emergency outcome and one dialog turn passed');

const {evaluateSams,nextSamsQuestion,SAMS_QUESTIONS}=await import('@/lib/zoe-chat-actions/dose-flow');
const {answerSams}=await import('@/lib/zoe-chat-actions/dose-flow-server');
const {mintActor}=await import('@/lib/zoe-chat-actions/actor');
import type {ValidCard} from '@/lib/zoe-chat-actions/registry';
import type {FlagPorts} from '@/lib/zoe-chat-actions/bp-flow-server';
assert.equal(evaluateSams({musclePain:true,darkUrine:true}).zone,'red');
assert.equal(evaluateSams({weakness:true,fever:true}).zone,'red');
assert.equal(evaluateSams({musclePain:true,jaundice:true}).zone,'red');
assert.equal(evaluateSams({musclePain:true,darkUrine:false,fever:false,jaundice:false}).zone,'orange');
assert.equal(nextSamsQuestion({musclePain:true}),'weakness','A muscle symptom alone does not bypass warning questions');
process.env.NOREON_ZOE_APP_V3='true';
for(const red of [true,false]){
 let held=cardSchema.parse({...card,state:'open',outcome:{}}) as Extract<ValidCard,{kind:'sams'}>;
 const calls:Array<{name:string;args:Record<string,unknown>}>=[];
 let sends=0;
 const task={id:crypto.randomUUID(),memberId:crypto.randomUUID(),memberName:'Synthetic',queue:'physician',zone:'orange',reason:'sams_orange',ruleVersion:'fixture',redFlagsStatus:'cleared',suggestedAction:null,summary:{},slaDeadline:at,status:'sent',stateSeq:1,sandbox:true,createdAt:at,seenAt:null,answeredAt:null};
 const ports={
  readCard:async()=>held,readCards:async()=>({enabled:true,cards:[held],clearedSeq:null}),
  post:async()=>({ok:false as const,code:'unavailable' as const}),
  claim:async(_m:string,_c:string,item:string,op:string,payload:Record<string,unknown>)=>{assert.match(item,/^[a-z0-9:_.+-]{1,120}$/,'The actual card RPC rejects uppercase keys');held={...held,claims:{...held.claims,[item]:held.claims[item]??{op,payload}}};return {ok:true as const,claim:held.claims[item]};},
  record:async(_m:string,_c:string,item:string,value:Record<string,unknown>,close:boolean)=>{held={...held,state:close?'done':'open',outcome:{...held.outcome,[item]:{...value,doneAt:at}}};return {ok:true as const,replayed:false,card:held};},
  rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return name==='care_alert_screen'?{ok:true,replayed:false,alertId:crypto.randomUUID()}:{ok:true,replayed:false,task};},
  send:async()=>{sends++;return {status:'sent' as const,thread:null};},
 }satisfies FlagPorts;
 const who=mintActor(task.memberId,'app');
 for(const question of SAMS_QUESTIONS){
  if(held.state==='done')break;
  const result=await answerSams(who,ports,{cardId:held.id,opId:crypto.randomUUID(),question,answer:question==='musclePain'||(red&&question==='darkUrine'),locale:'en'});
  assert.equal(result.status,'ok');
 }
 assert.equal(held.state,'done');
 if(red){assert.ok(redOutcome(held));assert.equal(sends,1);assert.equal(calls.filter(c=>c.name==='care_alert_screen').length,1);assert.equal(calls.some(c=>c.name==='care_queue_raise'),false);}
 else {const raise=calls.find(c=>c.name==='care_queue_raise')!;assert.equal(raise.args.p_queue,'physician');assert.equal(raise.args.p_zone,'orange');assert.equal(sends,0);}
 const last=red?'darkUrine':'rightUpperPain';
 await answerSams(who,ports,{cardId:held.id,opId:crypto.randomUUID(),question:last,answer:red,locale:'en'});
 assert.equal(calls.filter(c=>c.name==='care_alert_screen'||c.name==='care_queue_raise').length,1,'Replayed final answer does not duplicate an alert or task');
}

// Real dose flow, isolated database/chat IO. These assertions cover missing routing and false receipts.
const {flowOf}=await import('@/lib/zoe-chat-actions/bp-flow');
const {retryRedMessages}=await import('@/lib/zoe-chat-actions/bp-flow-server');
function scenario(){
 let held=cardSchema.parse({...card,id:crypto.randomUUID(),state:'open',outcome:{}}) as Extract<ValidCard,{kind:'sams'}>;
 const memberId=crypto.randomUUID(),who=mintActor(memberId,'app');
 const state={failQueue:false,failAlert:false,failSend:false,loseReceipt:false};
 const tasks=new Map<string,Record<string,unknown>>(),messages=new Map<string,string>();
 const alertRefs:string[]=[],requests:string[]=[];
 const ports:FlagPorts={
  readCard:async()=>structuredClone(held),readCards:async()=>({enabled:true,cards:[held],clearedSeq:null}),post:async()=>({ok:false,code:'unavailable'}),
  claim:async(_m,_c,item,op,payload)=>{held.claims[item]??={op,payload};return {ok:true,claim:held.claims[item]};},
  record:async(_m,_c,item,value,close)=>{
   if(state.loseReceipt){state.loseReceipt=false;return {ok:false,code:'unavailable'};}
   held={...held,state:close?'done':'open',outcome:{...held.outcome,[item]:{...value,doneAt:at}}};
   return {ok:true,replayed:false,card:structuredClone(held)};
  },
  rpc:async(name,args)=>{
   if(name==='care_alert_screen'){
    alertRefs.push(String(args.p_source_ref));
    return state.failAlert?{ok:false,code:'unavailable'}:{ok:true,replayed:false,alertId:crypto.randomUUID()};
   }
   if(name==='zoe_bp_messages_pending')return held.outcome.delivery?[]:[structuredClone(held)];
   if(name==='zoe_bp_delivery_record'){
    assert.equal(args.p_request,redOutcome(held)?.requestId);
    held.outcome.delivery={delivered:true,requestId:args.p_request};return {ok:true};
   }
   assert.equal(name,'care_queue_raise');
   if(state.failQueue)return {ok:false,code:'unavailable'};
   const key=`${args.p_source_ref}:${args.p_queue}`,replayed=tasks.has(key);
   if(!replayed)tasks.set(key,{id:crypto.randomUUID(),memberId,memberName:'Synthetic',queue:args.p_queue,zone:args.p_zone,reason:args.p_reason,ruleVersion:args.p_rule_version,redFlagsStatus:args.p_red_flags,suggestedAction:args.p_action,summary:args.p_summary,slaDeadline:args.p_sla,status:'sent',stateSeq:1,sandbox:true,createdAt:at,seenAt:null,answeredAt:null});
   return {ok:true,replayed,task:tasks.get(key)};
  },
  send:async(id,text)=>{requests.push(id);if(state.failSend)throw Error('Synthetic send outage');messages.set(id,text);return {status:'sent',thread:null};},
 };
 const answer=(question:typeof SAMS_QUESTIONS[number],value:boolean)=>answerSams(who,ports,{cardId:held.id,opId:crypto.randomUUID(),question,answer:value,locale:'hy'});
 return {ports,state,tasks,messages,alertRefs,requests,answer,memberId,card:()=>structuredClone(held)};
}
for(const sign of [null,'darkUrine','fever','jaundice','rightUpperPain','musclePain'] as const){
 const w=scenario();
 for(const q of SAMS_QUESTIONS.slice(0,-1))assert.equal((await w.answer(q,q===sign)).status,'ok');
 w.state.failQueue=true;
 const last=sign==='rightUpperPain';
 assert.equal((await w.answer('rightUpperPain',last)).status,'unavailable','A failed physician raise keeps the final answer recoverable');
 assert.equal(w.card().state,'open');
 assert.equal(flowOf(w.card())?.sentTo??null,null,'An outage cannot claim notification');
 w.state.failQueue=false;w.state.loseReceipt=true;
 assert.equal((await w.answer('rightUpperPain',last)).status,'unavailable','A task can land before its receipt is lost');
 assert.equal((await w.answer('rightUpperPain',last)).status,'ok','Reload retries the held final answer');
 assert.equal(w.tasks.size,1,'Recovery and replay create one physician task');
 const task=[...w.tasks.values()][0];
 const warning=sign!==null&&sign!=='musclePain';
 assert.deepEqual([task.queue,task.zone],['physician',sign==='musclePain'||warning?'orange':'yellow']);
 if(sign!=='musclePain'){
  assert.equal(task.reason,warning?'sams_sign_without_muscle':'side_effect_reported');
  assert.ok((task.summary as {reasons:string[]}).reasons.includes(String(task.reason)),'The staff receipt includes the follow-up reason');
 }
 else assert.ok((task.summary as {reasons:string[]}).reasons.includes('sams_orange'));
 const hours=(Date.parse(String(task.slaDeadline))-Date.parse(at))/3_600_000;
 assert.equal(hours,sign==='musclePain'||warning?4:48,'Same-day uses the existing four-hour deadline');
 const flow=flowOf(w.card());
 assert.equal(flow?.sentTo,'physician');
 assert.deepEqual(flow?.taskIds,[task.id]);
 assert.equal(flow?.nurseTask,false);
 if(sign==='musclePain')assert.equal((flow as typeof flow&{mandatoryTemplateId?:string})?.mandatoryTemplateId,'NO_TITRATION');
 else assert.equal(evaluateSams(Object.fromEntries(SAMS_QUESTIONS.map(q=>[q,q===sign]))).zone,null,'The evaluator still reports no zone');
 assert.equal((await w.answer('rightUpperPain',last)).status,'ok');
 assert.equal(w.tasks.size,1);
}
{
 const w=scenario();w.state.failAlert=true;w.state.failSend=true;
 await w.answer('musclePain',true);await w.answer('weakness',false);
 assert.equal((await w.answer('darkUrine',true)).status,'ok');
 const red=redOutcome(w.card())!;
 assert.equal(red.alerted,false);assert.equal(w.card().state,'done');assert.equal(w.messages.size,0);
 assert.equal((w.card().outcome['a:darkurine'] as {ruleVersion?:string}).ruleVersion,evaluateSams({musclePain:true,darkUrine:true}).ruleVersion,'Recovery retains the evaluated rule version');
 assert.deepEqual(w.alertRefs,[`sams:${w.card().snapshot.episodeId}`],'Keep the original SAMS alert identity');
 w.state.failSend=false;
 await w.answer('darkUrine',true);
 assert.equal(w.messages.size,1,'Answer replay recovers delivery');
 assert.equal(w.messages.get(red.requestId),red.text,'Delivery uses the original text and request');
 await retryRedMessages(w.ports,w.memberId);
 assert.equal(w.messages.size,1);assert.equal(w.requests.length,2,'Acknowledged messages leave the pending retry');
 assert.deepEqual(w.alertRefs,[`sams:${w.card().snapshot.episodeId}`],'The sweep owns failed-alert recovery, without a new source key');
 const page=Array.from({length:40},()=>cardSchema.parse({...card,id:crypto.randomUUID(),kind:'bp',state:'open',snapshot:{v:1,week:null},outcome:{}}));
 const reload=withOpenEmergencies(page,[w.card()]);
 assert.equal(reload.length,41);assert.equal(redOutcome(reload.find(c=>c.id===w.card().id)!)?.cleared,false);
 assert.equal(redOutcome(withOpenEmergencies(reload,[],at).find(c=>c.id===w.card().id)!)?.cleared,true);
}
{
 const w=scenario();w.state.failSend=true;
 await w.answer('musclePain',true);await w.answer('weakness',false);await w.answer('darkUrine',true);
 w.state.failSend=false;
 await retryRedMessages(w.ports,w.memberId);
 await retryRedMessages(w.ports,w.memberId);
 assert.equal(w.messages.size,1,'Reload recovers a failed message without replaying the answer');
 assert.equal(w.requests.length,2);
}
delete process.env.NOREON_ZOE_APP_V3;
console.log('V3 SAMS: real evaluator and flow route red to the existing alert, orange to the doctor, and replay once');
