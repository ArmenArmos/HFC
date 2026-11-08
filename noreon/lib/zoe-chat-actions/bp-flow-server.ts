import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {recordScreen} from '@/lib/care-alerts/server';
import {raiseCareQueueTasks} from '@/lib/care-queue/server';
import {taskFromZone,type RedFlagsStatus} from '@/lib/care-queue/contracts';
import {ZONE_RULES_V1} from '@/lib/clinical/zones/config-v1';
import {evaluateBp,isOutOfHours,outOfHoursDisclosure} from '@/lib/clinical/zones/evaluate';
import {answersOn,decide,episodeSymptoms,failedFlow,FLAG_RED_FLAG,flagItem,nextQuestion,sentToFrom,redOutcome,symptomsFrom,UNASKED,type BpFlow,type BpSymptoms,type Reading,type RedFlagQuestion} from './bp-flow';
import {claim,ownCard,record,type BpFlowResult,type CardPorts,type CardResult} from './commands';
import {FLAG_MESSAGE,say,type CardLocale} from './copy';
import type {MemberActor} from './actor';
import type {ZoeSendResult} from '@/lib/zoe/app-chat-contracts';
import {cardSchema,type BpFlowContext,type ZoeCards} from './registry';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import type {Rpc,postCard} from './server';
import {bpTargetsEnabled} from '@/lib/clinical-review/config';
import {readBpPersonalContext} from '@/lib/bp-target/runtime';
import {personalTarget} from '@/lib/bp-target/schema';
import {DEFAULT_PERSONAL_BP_TARGET,evaluatePersonalBp,personalAlertRaises,PERSONAL_BP_VERSION} from '@/lib/clinical/rules/personal-bp';
import {slaDeadline} from '@/lib/clinical/zones/evaluate';
import type {PersonalBpFlow} from './bp-flow';

/** One reading saved by the card, and what the flow needs to reach. All service-role calls; injected so checks need no database. */
export type FlowPorts={rpc:Rpc|null;post:typeof postCard;readCards():Promise<ZoeCards>};
/** Stable from its parts, so a retry posts the same card and sends the same message. */
const flowId=(key:string)=>createHash('sha256').update(key).digest('hex').replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,'$1-$2-5$3-8$4-$5');

const episode=z.object({ok:z.literal(true),readingId:z.uuid(),readings:z.array(z.object({id:z.uuid(),submissionId:z.uuid().nullish(),sbp:z.number().int(),dbp:z.number().int()})).min(1)});
const hours=z.array(z.object({weekday:z.number().int(),opens:z.string(),closes:z.string()}));
const readingAlert=z.object({id:z.uuid(),sentTo:z.literal('physician').nullable(),reason:z.enum(['bp_doctor_today','bp_doctor_48h'])});
const staffItem=z.object({ok:z.literal(true),alert:readingAlert.nullable()});

const best=async<T>(op:()=>Promise<T>):Promise<T|null>=>{try{return await op();}catch{return null;}};

async function isClosed(rpc:Rpc,memberId:string,at:string){
 const h=hours.safeParse(await best(()=>rpc('zoe_member_clinic_hours',{p_member:memberId})));
 // No schedule on file says nothing about the hours, so nothing is said.
 return h.success&&h.data.length>0&&isOutOfHours({at,hours:h.data});
}

/** Follows what the rules said for one episode: stores the zone, posts the next card, or raises the tasks when the result is final. */
async function follow(ports:FlowPorts,memberId:string,v:{episodeId:string;readingId:string|null;submissionId?:string;readings:Reading[];symptoms:BpSymptoms;first:Reading}&BpFlowContext):Promise<BpFlowResult>{
 const {rpc}=ports;
 const {result,next}=decide(v.readings,v.symptoms);
 const base:BpFlow={...failedFlow(),zone:result.zone,provisional:result.provisional,ruleVersion:result.ruleVersion,slaHours:result.slaHours};
 if(rpc&&v.readingId&&result.zone)await best(()=>rpc('zoe_bp_reading_zone',{p_member:memberId,p_reading:v.readingId,p_zone:result.zone,p_rule_version:result.ruleVersion}));
 // A prior same-day reading already committed this episode to its tasks. A lower mean cannot replace or double them.
 const sameDay=v.readings.map(reading=>evaluateBp({readings:[reading],symptoms:UNASKED})).find(r=>r.reasons.includes('bp_same_day'));
 const taskResult=result.zone!=='red'&&sameDay?sameDay:result;
 const link={p_member:memberId,p_episode:v.episodeId,p_reading:v.readingId,p_submission:v.submissionId??null,p_minutes:ZONE_RULES_V1.repeatEpisodeMinutes};
 const existing=staffItem.safeParse(rpc&&zoeAppV3Enabled()&&result.zone!=='red'?await best(()=>rpc('zoe_bp_staff_item',link)):null);
 let alert=existing.success?existing.data.alert:null;
 // Same-day work starts with the first save; yellow still waits for confirmation.
 if(rpc&&zoeAppV3Enabled()&&taskResult.zone!=='red'&&(!taskResult.provisional||taskResult.reasons.includes('bp_same_day'))){
  const signs=Object.values(v.symptoms);
  const redFlagsStatus:RedFlagsStatus=signs.includes(true)?'positive':signs.every(s=>s===false)?'cleared':'unknown';
  const at=new Date().toISOString();
  const raises=taskFromZone(taskResult,{memberId,sourceRef:`${v.episodeId}:${taskResult.zone}`,at,redFlagsStatus,summary:{readings:v.readings.map(({sbp,dbp})=>({sbp,dbp}))}});
  // The database repeats the check under the same member lock as #528, closing the preflight race.
  const report=await raiseCareQueueTasks(async(_name,args)=>{
   const r=await rpc('zoe_bp_task_raise',{...args,...link});
   const merged=z.object({ok:z.literal(false),code:z.literal('bp_alert'),alert:readingAlert}).safeParse(r);
   if(merged.success)alert=merged.data.alert;
   return r;
  },alert?[]:raises);
  // SQL replays the original row. Receipts must describe that row, including its original deadline.
  const stored=report.tasks.find(t=>t.queue==='physician')??report.tasks.find(t=>t.queue==='nurse');
  if(stored){
   base.sentTo=sentToFrom(report.tasks.flatMap(t=>t.queue==='admin'?[]:[t.queue]));
   base.taskIds=report.taskIds;
   base.nurseTask=report.tasks.some(t=>t.queue==='nurse');
   base.zone=stored.zone;
   base.slaDeadline=stored.slaDeadline;
   base.slaHours=stored.slaDeadline?Math.round((Date.parse(stored.slaDeadline)-Date.parse(stored.createdAt))/3_600_000):null;
   base.outOfHours=!!base.sentTo&&outOfHoursDisclosure(stored.zone==='orange'?'orange':null,await isClosed(rpc,memberId,at));
  }
 }
 if(alert){
  base.alertId=alert.id;
  base.alertReason=alert.reason;
  base.sentTo=alert.sentTo;
  base.taskIds=[];
  base.nurseTask=false;
  base.slaHours=null;
  base.slaDeadline=null;
  base.outOfHours=false;
 }
 // WP T: the reading against the member's own target. Red belongs to the emergency rules alone; a reading alert already sent stays the only message.
 if(rpc&&bpTargetsEnabled()&&result.zone!=='red'){
  const personal=await personalCompare(rpc,memberId,v,!!alert);
  if(personal){
   base.personal=personal.flow;
   if(personal.flow.raised){base.taskIds=[...new Set([...base.taskIds,...personal.taskIds])];}
  }
 }
 if(next){
  const context={...(v.follows?{follows:v.follows}:{}),...(v.week?{week:v.week}:{})};
  const snapshot=next==='repeat'?{v:1,episodeId:v.episodeId,first:{systolic:v.first.sbp,diastolic:v.first.dbp},...context}:{v:1,episodeId:v.episodeId,readingId:v.readingId,readings:v.readings.map(({sbp,dbp})=>({sbp,dbp})),...context};
  const posted=await ports.post(memberId,flowId(`${v.episodeId}:${next}:${v.readings.length}`),next,'chip',null,snapshot);
  return {flow:{...base,next:posted.ok?next:null},next:posted.ok?posted.card:null};
 }
 return {flow:base,next:null};
}

/**
 * The member's target (or the THRESHOLD defaults) against the newest reading of the episode, with the member's earlier home
 * readings for the consecutive rule. A clinician-set alert raises the same-day nurse task through care_queue_raise, once per
 * episode (source ref). Null when the target cannot be read: no comparison is better than one against the wrong numbers.
 * Member-typed and caregiver-reported readings stay unverified: the task carries the entry source for the nurse.
 */
async function personalCompare(rpc:Rpc,memberId:string,v:{episodeId:string;readingId:string|null;readings:Reading[];symptoms:BpSymptoms},alerted:boolean):Promise<{flow:PersonalBpFlow;taskIds:string[]}|null>{
 const ctx=await readBpPersonalContext(rpc,memberId);
 if(!ctx)return null;
 const last=v.readings.at(-1);
 if(!last)return null;
 const signs=Object.values(v.symptoms);
 const symptoms=signs.includes(true)?true:signs.length&&signs.every(s=>s===false)?false:'unknown' as const;
 const current=v.readingId?ctx.readings.find(r=>r.id===v.readingId):undefined;
 let earlier=ctx.readings.filter(r=>r.id!==v.readingId&&(!current||Date.parse(r.measuredAt)<=Date.parse(current.measuredAt)));
 // No reading id (the episode read failed): the newest stored reading with these numbers is this one.
 if(!current){const i=earlier.findLastIndex(r=>r.systolic===last.sbp&&r.diastolic===last.dbp);if(i>=0)earlier=earlier.filter((_,n)=>n!==i);}
 const target=personalTarget(ctx.target);
 const r=evaluatePersonalBp({systolic:last.sbp,diastolic:last.dbp,pulse:current?.pulse??null,symptoms},earlier.map(x=>({systolic:x.systolic,diastolic:x.diastolic,pulse:x.pulse,symptoms:'unknown' as const})),target);
 const shown=target??DEFAULT_PERSONAL_BP_TARGET;
 let taskIds:string[]=[];
 if(personalAlertRaises(r)&&!alerted&&zoeAppV3Enabled()){
  const at=new Date().toISOString();
  const entrySource=current?.entrySource??null;
  const report=await raiseCareQueueTasks(rpc,[{memberId,queue:'nurse',zone:'orange',reason:r.status==='alert_low'?'bp_personal_alert_low':'bp_personal_alert_high',ruleVersion:PERSONAL_BP_VERSION,
   redFlagsStatus:symptoms===true?'positive':symptoms===false?'cleared':'unknown',suggestedAction:null,
   summary:{readings:v.readings.map(({sbp,dbp})=>({sbp,dbp})),rule:r.ruleId,usedPersonalTarget:r.usedPersonalTarget,...(entrySource==='patient_text_entry'||entrySource==='caregiver_reported'?{entrySource}:{})},
   slaDeadline:slaDeadline({slaHours:ZONE_RULES_V1.slaHours.orange},at),sourceRef:`${v.episodeId}:personal`.slice(0,128)}]);
  taskIds=report.taskIds;
 }
 return {flow:{status:r.status,ruleId:r.ruleId,usedPersonalTarget:r.usedPersonalTarget,target:{systolic:shown.homeSystolicTarget,diastolic:shown.homeDiastolicTarget},raised:taskIds.length>0},taskIds};
}

/** After a reading is saved. Never loses the reading: anything that fails here leaves a neutral reply, with no "sent" words. */
export async function runBpFlow(ports:FlowPorts,memberId:string,saved:{submissionId:string;systolic:number;diastolic:number}&BpFlowContext):Promise<BpFlowResult>{
 if(!zoeAppV3Enabled())return {flow:failedFlow(),next:null};
 try{
  const read=episode.safeParse(ports.rpc?await best(()=>ports.rpc!('zoe_bp_episode',{p_member:memberId,p_submission:saved.submissionId,p_minutes:ZONE_RULES_V1.repeatEpisodeMinutes})):null);
  const first={sbp:saved.systolic,dbp:saved.diastolic};
  const cards=await best(()=>ports.readCards());
  const symptoms=cards?.enabled?episodeSymptoms(cards.cards):UNASKED;
  // A stale repeat cannot name a new episode. SQL joins fallback identities by their saved readings.
  if(!read.success)return await follow(ports,memberId,{episodeId:`bp:${saved.submissionId}`,readingId:null,submissionId:saved.submissionId,readings:[first],symptoms,first,follows:saved.follows,week:saved.week});
  const belongs=saved.episodeId&&read.data.readings.some(r=>r.id===saved.episodeId||(r.submissionId&&`bp:${r.submissionId}`===saved.episodeId));
  const episodeId=belongs?saved.episodeId!:read.data.readings[0].id;
  return await follow(ports,memberId,{episodeId,readingId:read.data.readingId,submissionId:saved.submissionId,readings:read.data.readings.map(({sbp,dbp})=>({sbp,dbp})),symptoms,first,follows:saved.follows,week:saved.week});
 }catch{return {flow:failedFlow(),next:null};}
}

/** The existing care alert, called with the flow's stable key. BP's durable sweep retries the same key. */
export async function raiseSafetyAlert(rpc:Rpc|null,v:{memberId:string;sourceRef:string;reason:string;rule:string;ruleVersion:string;redFlags:string[]}){
 if(!rpc)return false;
 for(let attempt=0;attempt<2;attempt++){
  const r=await best(()=>recordScreen(rpc,{source:'zoe',sourceRef:v.sourceRef,memberId:v.memberId},{outcome:'escalate',reason:v.reason,rule:v.rule,ruleVersion:v.ruleVersion,redFlags:v.redFlags}));
  if(r)return r.ok&&!!r.alertId;
 }
 return false;
}

const answerClaim=z.object({answer:z.boolean(),locale:z.enum(['hy','en','ru'])});
export type FlagPorts=FlowPorts&Pick<CardPorts,'readCard'|'claim'|'record'>&{
 /** The member's own words through the normal chat path, with confirmed storage. */send(requestId:string,text:string):Promise<ZoeSendResult>};

/**
 * One answer. A yes ends the questions at once: the rules say red, the alert goes, and the saved outcome is what shows the
 * 103 card everywhere. The member's message follows through the normal chat path, after the outcome is safe.
 */
export async function answerRedFlag(who:MemberActor,ports:FlagPorts,v:{cardId:string;opId:string;question:RedFlagQuestion;answer:boolean;locale:CardLocale}):Promise<CardResult>{
 const card=await ownCard(ports,v.cardId,'red_flags');
 if(!card)return {status:'invalid'};
 const item=flagItem(v.question);
 if(card.outcome[item]===undefined&&nextQuestion(answersOn(card))!==v.question)return {status:'stale',card};
 const c=await claim(who,ports,card,item,v.opId,{answer:v.answer,locale:v.locale});
 if(!c.ok)return c.result;
 const want=answerClaim.safeParse(c.claim.payload);
 if(!want.success)return {status:'invalid',card};
 if(want.data.answer!==v.answer)return {status:'stale',card};
 if(card.outcome[item]!==undefined){await deliverRedMessage(ports,who.memberId,card);return {status:'ok',card};}
 const answers={...answersOn(card),[v.question]:v.answer};
 const {readings,readingId,episodeId}=card.snapshot;
 if(v.answer){
  const result=evaluateBp({readings,symptoms:symptomsFrom(answers)});
  const rpc=ports.rpc;
  if(rpc&&readingId&&result.zone)await best(()=>rpc('zoe_bp_reading_zone',{p_member:who.memberId,p_reading:readingId,p_zone:result.zone,p_rule_version:result.ruleVersion}));
  const alerted=await raiseSafetyAlert(rpc,{memberId:who.memberId,sourceRef:`bp-flag:${card.id}`,reason:'bp_red_flag_answered',rule:'zoe.bp_red_flags',ruleVersion:result.ruleVersion,redFlags:[FLAG_RED_FLAG[v.question]]});
  const requestId=flowId(`${card.id}:${v.question}:message`),text=say(want.data.locale,FLAG_MESSAGE[v.question]);
  const done=await record(who,ports,card,item,{answer:true,zone:result.zone,alerted,requestId,text,ruleVersion:result.ruleVersion},true);
  if(done.status==='ok')await deliverRedMessage(ports,who.memberId,done.card);
  return done;
 }
 if(nextQuestion(answers))return record(who,ports,card,item,{answer:false},false);
 const last=readings.at(-1)!;
 const after=await follow(ports,who.memberId,{episodeId,readingId,readings,symptoms:symptomsFrom(answers),first:last,follows:{cardId:card.id,item},week:card.snapshot.week});
 const done=await record(who,ports,card,item,{answer:false,flow:after.flow},true);
 return after.next&&done.status==='ok'?{...done,next:after.next}:done;
}


/** Delivery is append-only and independent of completion. An ambiguous send replays its original request id. */
export async function deliverRedMessage(ports:Pick<FlagPorts,'rpc'|'send'>,memberId:string,card:ZoeCards['cards'][number]){
 const red=redOutcome(card);
 if(!red||(card.outcome.delivery as {delivered?:boolean}|undefined)?.delivered)return;
 const sent=await best(()=>ports.send(red.requestId,red.text));
 if(sent?.status!=='sent'&&!(sent?.status==='urgent'&&sent.request===red.requestId))return;
 if(ports.rpc)await best(()=>ports.rpc!('zoe_bp_delivery_record',{p_member:memberId,p_card:card.id,p_request:red.requestId}));
}

/** Called on the next authenticated chat load, even when the original card is outside ordinary paging. */
export async function retryRedMessages(ports:Pick<FlagPorts,'rpc'|'send'>,memberId:string){
 if(!ports.rpc)return;
 const pending=z.array(cardSchema).safeParse(await best(()=>ports.rpc!('zoe_bp_messages_pending',{p_member:memberId,p_limit:20})));
 if(pending.success)for(const card of pending.data)await deliverRedMessage(ports,memberId,card);
}
