/** PR 7 deterministic contracts. No database, provider, credentials or hosted IO. */
import assert from 'node:assert/strict';
import {cardSchema} from '@/lib/zoe-chat-actions/registry';
import {cardTurns,dialogThread} from '@/lib/zoe-chat-actions/thread';
import {labIsFresh,queueForTask} from '@/lib/clinical/zones/evaluate';

const id=crypto.randomUUID();
const document={id,fileName:'lipids.pdf',mime:'application/pdf',docType:null,studyDate:null,uploaderRole:null,readStatus:'not_read',classificationConfidence:null};
const card=cardSchema.parse({id:crypto.randomUUID(),requestId:crypto.randomUUID(),source:'chip',sourceSeq:null,state:'open',kind:'document',snapshot:{v:1,document},outcome:{},at:'2026-11-02T10:00:00Z'});
assert.equal(card.valid,true,'document metadata has a typed card');
const done=cardSchema.parse({...card,state:'done',outcome:{document:{docType:'lab',studyDate:'2026-10-12',medicineChangedSince:false,fresh:true,doneAt:'2026-11-02T10:01:00Z'}}});
assert.equal(cardTurns(done).length,1,'the tile leaves its old place after confirmation');
assert.equal(dialogThread([], [done])[0].type,'turn');
// Scenario A: only the date and routing. Values cannot enter this decision.
const fresh=(date:string|null,changed:boolean|'UNKNOWN'=false)=>labIsFresh({collectedOn:date,today:'2026-11-02',analyte:'lipids',medicineChangedSince:changed==='UNKNOWN'?null:changed});
assert.equal(fresh('2026-10-12').fresh,true,'21-day-old lipid panel needs no repeat');
assert.equal(fresh('2025-11-02').fresh,false,'last year is not fresh');
assert.equal(fresh('2026-07-02').fresh,false,'four months is not fresh');
assert.equal(fresh(null).fresh,false,'missing date stays unknown');
assert.equal(fresh('2026-10-12','UNKNOWN').fresh,false,'missing medicine history stays unknown');
assert.equal(fresh('2026-10-12',true).fresh,false,'medicine change defeats freshness');
assert.equal(fresh('2026-11-03').fresh,false,'future date is not fresh');
assert.deepEqual(queueForTask('logistics'),['admin'],'missing labs and booking are admin only');
console.log('Zoe V3 labs: document dialog, Scenario A recency and admin routing pass.');

const {runDocumentDetails}=await import('@/lib/zoe-chat-actions/labs');
const {mintActor}=await import('@/lib/zoe-chat-actions/actor');
const actor=mintActor(crypto.randomUUID(),'app');
let writes=0;
const live=cardSchema.parse({...card,snapshot:{v:1,document:{...document,uploaderRole:'member'}}});
const ports={readCard:async()=>live,claim:async(_m:string,_c:string,_i:string,op:string,payload:Record<string,unknown>)=>({ok:true as const,claim:{op,payload}}),
 record:async(_m:string,_c:string,item:string,value:Record<string,unknown>)=>({ok:true as const,replayed:false,card:cardSchema.parse({...live,state:'done',outcome:{[item]:{...value,doneAt:'2026-11-02T10:01:00Z'}}})}),save:async()=>{writes++;return true;}};
const input={cardId:live.id,opId:crypto.randomUUID(),docType:'lab' as const,studyDate:'2026-10-12',medicineChangedSince:false};
const result=await runDocumentDetails(actor,ports,input,new Date('2026-11-02T10:00:00Z'));
assert.equal(result.status,'ok');assert.equal((result.card!.outcome.document as {fresh:boolean}).fresh,true);
assert.equal(writes,1);
const unknown=await runDocumentDetails(actor,ports,{...input,medicineChangedSince:'UNKNOWN'},new Date('2026-11-02T10:00:00Z'));
assert.equal((unknown.card!.outcome.document as {fresh:boolean}).fresh,false);
const nonLab=await runDocumentDetails(actor,ports,{...input,docType:'ecg'},new Date('2026-11-02T10:00:00Z'));
assert.equal((nonLab.card!.outcome.document as {fresh:boolean}).fresh,false);
assert.equal((await runDocumentDetails(actor,ports,{...input,studyDate:'2026-11-03'},new Date('2026-11-02T10:00:00Z'))).status,'invalid');
assert.equal((await runDocumentDetails(mintActor(actor.memberId,'telegram'),ports,input)).status,'disabled');
assert.equal((await runDocumentDetails(actor,{...ports,save:async()=>false},input,new Date('2026-11-02T10:00:00Z'))).status,'failed');
assert.equal((await runDocumentDetails(actor,{...ports,claim:async()=>({ok:true as const,claim:{op:input.opId,payload:{...input,medicineChangedSince:true}}})},input,new Date('2026-11-02T10:00:00Z'))).status,'stale');
console.log('Document save: server freshness, unknown, date rejection, failed save and pinned claim pass.');
const visit=cardSchema.parse({...card,id:crypto.randomUUID(),kind:'visit',snapshot:{v:1,available:true,next:null,proposal:null,attention:false},state:'done',outcome:{booking:{kind:'select',dialog:true,ok:true,doneAt:'2026-11-02T11:00:00Z'}}});
assert.equal(cardTurns(visit).length,1,'the reused visit card becomes a member dialog turn');
for(const kind of ['prep','fasting']){
 const pending=cardSchema.parse({...card,kind,snapshot:{v:1,appointmentId:crypto.randomUUID(),revision:1,startsAt:'2026-11-03T05:00:00Z',location:'Your clinic',preparation:'Clinic preparation'},state:'open'});
 assert.equal(pending.valid,true,`${kind} has a typed card`);
 const answered=cardSchema.parse({...pending,state:'done',outcome:{[kind]:{answer:kind==='fasting'?'ate':'read',doneAt:'2026-11-02T16:00:00Z'}}});
 assert.equal(cardTurns(answered).length,1,`${kind} leaves its old form`);
}
const gate=cardSchema.parse({...card,kind:'symptom_gate',snapshot:{v:1},state:'open'});
assert.equal(gate.valid,true,'consult requests begin with a typed symptom gate');
const questions=cardSchema.parse({...card,kind:'consult_questions',snapshot:{v:1,appointmentId:null,groups:[{label:'symptoms',text:''},{label:'medicines',text:''},{label:'results',text:''}]},state:'open'});
assert.equal(questions.valid,true,'doctor questions have editable groups');

const {runLabReply}=await import('@/lib/zoe-chat-actions/labs');
const {raiseAdminTask}=await import('@/lib/zoe-chat-actions/raise-admin-task');
const appointment={v:1 as const,appointmentId:crypto.randomUUID(),revision:1,startsAt:'2026-11-03T05:00:00Z',location:'Clinic',preparation:'Clinic preparation'};
const fastingCard=cardSchema.parse({...card,kind:'fasting',snapshot:appointment});
let raised:unknown;
const labPorts={...ports,readCard:async()=>fastingCard,current:async()=>appointment,raise:async(v:unknown)=>{raised=v;return true;}};
const ate=await runLabReply(actor,labPorts,{cardId:fastingCard.id,opId:crypto.randomUUID(),answer:'ate'});
assert.equal(ate.status,'ok');assert.equal((raised as {reason:string}).reason,'fasting_failed');
assert.equal((await runLabReply(actor,{...labPorts,current:async()=>null},{cardId:fastingCard.id,opId:crypto.randomUUID(),answer:'ate'})).status,'stale');
assert.equal((await runLabReply(actor,{...labPorts,raise:async()=>false},{cardId:fastingCard.id,opId:crypto.randomUUID(),answer:'ate'})).status,'unavailable','never claim the admin has a task if raising failed');
let queueArgs:Record<string,unknown>={};
assert.equal(await raiseAdminTask({rpc:async(name,args)=>{assert.equal(name,'care_queue_raise');queueArgs=args;return {data:{ok:true},error:null};}},
 {memberId:actor.memberId,appointmentId:appointment.appointmentId,requestId:crypto.randomUUID(),reason:'fasting_failed'}),true);
assert.equal(queueArgs.p_queue,'admin');assert.equal(queueArgs.p_zone,null);assert.deepEqual(queueArgs.p_summary,{});assert.equal(queueArgs.p_reason,'fasting_failed');
assert.deepEqual(Object.keys(queueArgs).sort(),['p_action','p_member','p_queue','p_reason','p_red_flags','p_rule_version','p_sla','p_source_ref','p_summary','p_zone']);

const {runSymptomGate,runConsultQuestions}=await import('@/lib/zoe-chat-actions/consult');
const {CONSULT}=await import('@/lib/zoe-chat-actions/consult-copy');
const {isZoeEmergency}=await import('@/lib/zoe/member-screen');
const check={env:{NOREON_ZOE_URGENT_PLACEHOLDER:'true'},intake:{enabled:true,active:true}};
for(const locale of ['hy','en','ru']as const){
 let sent='';
 const gatePorts={...ports,readCard:async()=>gate,send:async(_id:string,text:string)=>{sent=text;return {status:'sent'};}};
 assert.equal((await runSymptomGate(actor,gatePorts,{cardId:gate.id,opId:crypto.randomUUID(),choice:'acute',locale})).status,'ok');
 assert.equal(sent,CONSULT.acuteMessage[locale],'acute uses the fixed localized text in the normal send adapter');
 const red={hy:'Հիմա կրծքավանդակի ուժեղ ցավ ունեմ',en:'I have severe chest pain right now',ru:'У меня сейчас сильная боль в груди'}[locale];
 assert.equal(isZoeEmergency(red,check),true,`${locale} follow-up reaches the unchanged 103 matcher`);
 assert.equal((await runSymptomGate(actor,gatePorts,{cardId:gate.id,opId:crypto.randomUUID(),choice:'planned',locale})).status,'ok');
 assert.equal(sent,CONSULT.plannedMessage[locale]);
 const groups=[{label:'symptoms' as const,text:'My question'},{label:'medicines' as const,text:''},{label:'results' as const,text:'My other question'}];
 let stored=false,marked=false;
 const questionsPorts={...ports,readCard:async()=>questions,save:async()=>{stored=true;return true;},send:async(_id:string,text:string)=>{assert.equal(stored,true);sent=text;return {status:'sent'};},markSent:async()=>{marked=true;return true;}};
 const r=await runConsultQuestions(actor,questionsPorts,{cardId:questions.id,opId:crypto.randomUUID(),locale,groups});
 assert.equal(r.status,'ok');assert.equal(marked,true);assert.ok(sent.includes('My other question'));
 marked=false;
 assert.equal((await runConsultQuestions(actor,{...questionsPorts,send:async()=>({status:'failed'})},{cardId:questions.id,opId:crypto.randomUUID(),locale,groups})).status,'unavailable');assert.equal(marked,false);
}
console.log('Lab replies, admin payload boundary and HY/EN/RU consult send/safety checks pass.');
// Copy and safety adapter contracts are read back as well as exercising the pure commands.
const {readFileSync}=await import('node:fs');
for(const file of ['labs-copy','lab-visit-copy','consult-copy']){
 const copy=await import(`../lib/zoe-chat-actions/${file}.ts`);
 const visit=(v:unknown):void=>{if(typeof v!=='object'||v===null)return;const obj=v as Record<string,unknown>;if('en'in obj){for(const locale of ['hy','en','ru']){assert.equal(typeof obj[locale],'string');assert.ok(!/[!—]/u.test(obj[locale] as string));}}else for(const child of Object.values(obj))visit(child);};
 visit(copy);
}
const adapter=readFileSync('lib/zoe-chat-actions/consult-actions.ts','utf8');
for(const name of ['answerSymptomGate','sendConsultQuestions']){
 const part=adapter.slice(adapter.indexOf(`async function ${name}`),adapter.indexOf('});',adapter.indexOf(`async function ${name}`)));
 assert.ok(part.indexOf('await screenBeforeCard(')<part.indexOf('await sessionActor()'),'existing urgent redirect precedes session/claims/save');
}
assert.ok(!adapter.includes('sendZoeChatMessage(id,text,true,true)'),'ordinary send keeps its existing urgent redirect, even when storage fails');
console.log('Draft copy and urgent-before-card adapter contracts pass (source readback, not end-to-end).');
