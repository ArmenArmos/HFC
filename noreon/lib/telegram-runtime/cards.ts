import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {MedicineResult} from '@/lib/member-medicines/actions';
import {canReportDose,dosesForDay} from '@/lib/patient-care/model';
import {memberMedicinesReadSchema,type MemberMedicinesRead} from '@/lib/member-medicines/model';
import {ASK_REASONS,type AskReason} from '@/lib/member-medicines/ask-copy';
import {medicineAskSchema,memberAsksReadSchema,type MedicineAsk} from '@/lib/member-medicines/asks';
import type {BpWeekResult} from '@/lib/bp-week/actions';
import {bpWeekReadSchema} from '@/lib/bp-week/model';
import {memberLdlSchema} from '@/lib/ldl/schema';
import {ldlRetestEngine,ldlRetestHold} from '@/lib/ldl/retest';
import {clinicSchedulingEnabled} from '@/lib/clinic-scheduling/schema';
import {snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import {answerClinicProposal,type BookingRpc} from '@/lib/real-booking/appointment-runtime';
import {appointmentSchema,portalDetailsSchema} from '@/lib/real-booking/appointment-schema';
import {realBookingEnabled} from '@/lib/real-booking/config';
import {currentPublishedReviewSchema} from '@/lib/patient-care/published-review';
import {realReviewEnabled} from '@/lib/patient-care/real-review-config';
import type {TelegramCallbackRow,TelegramChannelAdapter} from '@/lib/telegram-channel/outbound';
import {mintActor,type MemberActor} from '@/lib/zoe-chat-actions/actor';
import {bpStepAfterSave,type BpRead} from '@/lib/patient/bp-after-save';
import {acceptLdlVisit,acceptVisit,answerDoseAsk,claim,logBp,logDose,openCard,record,type CardPorts,type CardResult} from '@/lib/zoe-chat-actions/commands';
import {newChatHome} from '@/lib/patient/member-chat-config';
import {sideEffectNurseFirstEnabled,sideEffectRoute} from '@/lib/member-medicines/side-effect-routing';
import {BP,CHIP,COMMON,DOSE,NOTICE,SIDE_EFFECTS,TELEGRAM,TG_WRITE,say,sideEffectMessage,type CardLocale,type SideEffect} from '@/lib/zoe-chat-actions/copy';
import {cardIntent} from '@/lib/zoe-chat-actions/intent';
import {CARD_BUTTON_ACTIONS,SNAPSHOTS,TELEGRAM_CARD_KINDS,TELEGRAM_MENU_KINDS,RESULT_PAGES,type CardKind,type ZoeCard} from '@/lib/zoe-chat-actions/registry';
import {askSnapshotFrom,bpSnapshotFrom,claimCard,doseSnapshotFrom,parseStoredCard,planSnapshotFrom,postCard,recordCard,resultsSnapshotFrom,visitSnapshotFrom} from '@/lib/zoe-chat-actions/server';
import {telegramCardView,telegramStaleView,type TelegramCardView} from '@/lib/zoe-chat-actions/telegram';
import {typedReading} from '@/lib/zoe-chat-actions/typed-reading';
import type {TelegramServiceRpc} from './dispatch';

/**
 * Zoe's chat cards on Telegram: the channel adapter around the shared commands. The member comes from the database's
 * answer about the bound chat (channel_inbox_process), never from the update. A saved action is final: what happens to
 * the answer or the message edit afterwards changes nothing, and is never a reason to act again.
 */

const locale=z.enum(['hy','en']);
const pressSchema=z.strictObject({inboxId:z.uuid(),callbackId:z.string().min(1),chatId:z.number().int().positive(),messageId:z.number().int().positive(),
 memberId:z.uuid(),endpointId:z.uuid(),generation:z.number().int().positive(),cardId:z.uuid(),action:z.enum(CARD_BUTTON_ACTIONS),item:z.record(z.string(),z.unknown()),locale});
const refusedSchema=z.strictObject({code:z.string(),callbackId:z.string().min(1),locale});
const menuSchema=z.strictObject({inboxId:z.uuid(),memberId:z.uuid(),locale});
const redoSchema=z.strictObject({inboxId:z.uuid(),memberId:z.uuid(),locale});
export const processedSchema=z.object({press:pressSchema.optional(),refused:refusedSchema.optional(),menu:menuSchema.optional(),redo:redoSchema.optional()});
export type CardPress=z.infer<typeof pressSchema>;
const doseItemSchema=z.strictObject({medicineId:z.uuid(),dueAt:z.iso.datetime({offset:true})});
const tickResult=z.object({status:z.string(),revision:z.number().int().optional()}).loose();
const candidates=z.array(z.strictObject({memberId:z.uuid(),seq:z.number().int().positive(),requestId:z.uuid(),text:z.string(),locale,at:z.iso.datetime({offset:true}),cleared:z.boolean()}));
const forMessage=z.strictObject({card:z.unknown(),memberId:z.uuid(),endpointId:z.uuid(),generation:z.number().int().positive(),locale}).nullable();
const armed=z.strictObject({ok:z.literal(true),refs:z.array(z.string())});

const planRead=z.strictObject({offset:z.union([z.literal(-15),z.literal(0),z.literal(15)]),
 plan:z.strictObject({id:z.uuid(),publishedAt:z.string(),medications:z.array(z.strictObject({id:z.uuid(),planId:z.uuid(),effectiveAt:z.string().nullable(),name:z.string(),dose:z.string(),
  times:z.array(z.string().regex(/^\d{2}:\d{2}$/)),startDate:z.string(),endDate:z.string().nullable(),active:z.boolean()}))}).nullable(),
 events:z.array(z.strictObject({medicationId:z.uuid(),dueAt:z.string(),status:z.enum(['taken','skipped']),revision:z.number().int(),recordedAt:z.string()}))});

const bpRead=z.strictObject({week:bpWeekReadSchema,latest:z.strictObject({systolic:z.number().int(),diastolic:z.number().int(),pulse:z.number().int().nullable(),measuredAt:z.string(),entrySource:z.enum(['patient_text_entry','patient_voice_confirmed','patient_photo_confirmed']).nullable().optional()}).nullable()});
const resultsRead=z.strictObject({publication:currentPublishedReviewSchema,results:z.array(z.strictObject({marker:z.string(),value:z.unknown(),unit:z.string().nullable(),referenceText:z.string().nullable(),collectedAt:z.string()}))});
const planCardRead=z.strictObject({plan:z.strictObject({id:z.uuid(),clinician:z.string(),publishedAt:z.string(),instructions:z.string(),version:z.number().int().min(1).nullable(),
 medicines:z.array(z.strictObject({name:z.string(),dose:z.string(),times:z.array(z.string())})),review:z.strictObject({planId:z.string(),instructions:z.string()}).nullable()}).nullable()});
const visitsRead=z.strictObject({appointments:z.array(appointmentSchema),portal:z.strictObject({memberId:z.uuid(),enabled:z.boolean(),appointments:z.record(z.uuid(),portalDetailsSchema)})});
const ldlSource=z.object({token:z.string().min(1),data:snapshotSchema.shape.evidence});
/** The service entry points as the booking runtime reads them: an error keeps its database code. */
const bookingRpc=(rpc:TelegramServiceRpc):BookingRpc=>({rpc:async(name,args)=>{
 try{return {data:await rpc(name,args??{}),error:null};}
 catch(e){return {data:null,error:{code:/\(([^()]+)\)$/.exec(String((e as Error).message))?.[1]??'rpc'}};}
}});
const statusOf=z.object({status:z.string()}).loose();
const KNOWN_WEEK=new Set<BpWeekResult['status']>(['saved','replayed','not-open','slot-full','outside-week','not-today','conflict','invalid','disabled','not-member','not-found']);

const KNOWN_TICKS=new Set<MedicineResult['status']>(['saved','not-found','not-due','conflict','invalid','disabled']);
const OFF:MemberMedicinesRead={version:'member-medicines-v1',enabled:false};

/** The card ports for a member verified by the bound chat: the same features, through their service entry points. */
export function telegramPorts(rpc:TelegramServiceRpc,actor:MemberActor):CardPorts{
 /** Throws on an outage, so a card never takes it for the feature being off. */
 const loadMedicines=async()=>memberMedicinesReadSchema.parse(await rpc('member_medicines_read_for',{p_member:actor.memberId}));
 /** The published plan, shaped for the same pure rules the pages use. */
 const plan=async()=>{
  const read=planRead.safeParse(await rpc('member_plan_doses_read_for',{p_member:actor.memberId}).catch(()=>null));
  if(!read.success)return null;
  const {offset,plan:p,events}=read.data;
  const care={events,plan:p&&{...p,clinician:'',instructions:'',acknowledgedAt:null,medications:p.medications.map(m=>({...m,effectiveAt:m.effectiveAt??undefined,instructions:''}))}};
  return {care,offset};
 };
 const reported=(data:unknown):MedicineResult=>{
  const parsed=tickResult.safeParse(data);
  return parsed.success&&KNOWN_TICKS.has(parsed.data.status as MedicineResult['status'])?{status:parsed.data.status as MedicineResult['status'],...(parsed.data.revision===undefined?{}:{revision:parsed.data.revision})}:{status:'unavailable'};
 };
 return {
  post:(m,r,k,s,q,sn)=>postCard(m,r,k,s,q,sn,rpc),
  readCards:async()=>{const {syncLivingVisit}=await import('@/lib/zoe-chat-actions/living-visit-read');const card=await syncLivingVisit(rpc,actor.memberId);return {enabled:true,cards:card?[card]:[],clearedSeq:null};},
  claim:(m,c,i,o,p)=>claimCard(m,c,i,o,p,rpc),
  record:(m,c,i,v,close)=>recordCard(m,c,i,v,close,rpc),
  readCard:async id=>parseStoredCard(await rpc('zoe_chat_card_get',{p_member:actor.memberId,p_card:id}).catch(()=>null)),
  snapshot:async(kind,input)=>{
   if(kind==='bp'){
    const read=bpRead.parse(await rpc('member_bp_read_for',{p_member:actor.memberId}));
    return SNAPSHOTS.bp.parse(bpSnapshotFrom(read.week,read.latest,new Date(),input?.typed));
   }
   if(kind==='results'){
    // The same rules as the page; a failed read opens no card, so an outage never reads as no results.
    const read=resultsRead.parse(await rpc('member_results_read_for',{p_member:actor.memberId}));
    return SNAPSHOTS.results.parse(resultsSnapshotFrom(realReviewEnabled(process.env)?read.publication:null,read.results,input?.page));
   }
   if(kind==='plan'){
    const {plan:p}=planCardRead.parse(await rpc('member_plan_read_for',{p_member:actor.memberId}));
    // The doctor's published words first, as on the care page.
    return SNAPSHOTS.plan.parse(planSnapshotFrom(p&&{...p,instructions:(realReviewEnabled(process.env)&&p.review?.planId===p.id&&p.review.instructions)||p.instructions}));
   }
   if(kind==='ldl')return SNAPSHOTS.ldl.parse({v:1,data:memberLdlSchema.parse(await rpc('member_ldl_read_for',{p_member:actor.memberId}))});
   if(kind==='visit'){
    if(newChatHome({})){
     const {syncLivingVisit}=await import('@/lib/zoe-chat-actions/living-visit-read');
     const living=await syncLivingVisit(rpc,actor.memberId);
     if(living?.valid&&living.kind==='visit')return living.snapshot;
    }
    const read=visitsRead.parse(await rpc('member_visits_read_for',{p_member:actor.memberId}));
    const portal=realBookingEnabled(process.env)&&clinicSchedulingEnabled();
    return SNAPSHOTS.visit.parse(visitSnapshotFrom(read.appointments.map(a=>({...a,...(portal&&read.portal.appointments[a.id]?{portal:read.portal.appointments[a.id]}:{})})),new Date()));
   }
   if(kind==='ask'){
    if(!input?.ask)throw Error('An ask card comes from its ask.');
    return SNAPSHOTS.ask.parse(askSnapshotFrom(input.ask));
   }
   if(kind==='side_effect'||kind==='message')return SNAPSHOTS[kind].parse({v:1});
   if(kind==='menu')return SNAPSHOTS.menu.parse({v:1});
   if(kind!=='dose')throw Error('Card kind is not available on Telegram');
   // Unreadable: no card, rather than one that looks complete without the plan's medicines.
   const read=await plan(),now=new Date();
   if(!read)throw Error('Plan doses unavailable');
   return SNAPSHOTS.dose.parse(doseSnapshotFrom(await loadMedicines(),dosesForDay(read.care,now),now));
  },
  readMedicines:()=>loadMedicines().catch(()=>OFF),
  // Unreadable reads as off: the dose is saved either way, and the ask waits for the next look.
  readAsks:async()=>{
   const r=memberAsksReadSchema.safeParse(await rpc('member_medicine_asks_read_for',{p_member:actor.memberId}).catch(()=>null));
   return r.success?r.data:{version:'medicine-asks-v1',enabled:false};
  },
  answerAsk:async v=>{
   const r=statusOf.safeParse(await rpc('member_medicine_ask_answer_for',{p_member:actor.memberId,p_ask:v.askId,p_reason:v.reason}).catch(()=>null));
   return r.success?{status:r.data.status}:{status:'unavailable'};
  },
  tickDose:async v=>reported(await rpc('member_medicine_dose_report_for',{p_member:actor.memberId,p_medicine:v.medicineId,p_due_at:v.dueAt,p_status:v.status,p_expected_revision:v.revision}).catch(()=>null)),
  readPlanDoses:async()=>{const read=await plan();return read&&dosesForDay(read.care,new Date());},
  tickPlanDose:async v=>{
   // The care page's own gate before the database's: the dose is on today's list, for the plan the card was shown for.
   const read=await plan();
   if(!read)return {status:'unavailable'};
   if(read.care.plan?.id!==v.planId||!canReportDose(read.care,v.medicationId,v.dueAt,new Date(),read.offset))return {status:'not-due'};
   return reported(await rpc('report_patient_dose_for',{p_member:actor.memberId,p_medication_id:v.medicationId,p_due_at:v.dueAt,p_status:v.status,p_expected_revision:v.revision}).catch(()=>null));
  },
  readBpWeek:async()=>bpRead.parse(await rpc('member_bp_read_for',{p_member:actor.memberId})).week,
  saveBpWeek:async v=>{
   const r=statusOf.safeParse(await rpc('bp_week_record_for',{p_member:actor.memberId,p_week:v.weekId,p_slot:v.slot,p_submission:v.submissionId,p_systolic:v.systolic,p_diastolic:v.diastolic,p_pulse:v.pulse,p_measured_at:v.measuredAt}).catch(()=>null));
   const status=r.success&&KNOWN_WEEK.has(r.data.status as BpWeekResult['status'])?r.data.status as BpWeekResult['status']:'unavailable';
   return status==='saved'||status==='replayed'?{status,bp:await bpStepAfterSave(rpc as unknown as BpRead,actor.memberId,v)}:{status};
  },
  acceptProposal:v=>answerClinicProposal({memberId:actor.memberId,actorId:actor.memberId,write:bookingRpc(rpc),portal:realBookingEnabled(process.env)&&clinicSchedulingEnabled(),invalidate:()=>{}},{...v,accept:true}),
  saveBp:async v=>{
   const r=statusOf.safeParse(await rpc('member_measurement_record_for',{p_member:actor.memberId,p_submission:v.submissionId,p_systolic:v.systolic,p_diastolic:v.diastolic,p_pulse:v.pulse,p_measured_at:v.measuredAt}).catch(()=>null));
   const status=r.success&&(r.data.status==='saved'||r.data.status==='conflict')?r.data.status:'failed';
   return status==='saved'?{status,bp:await bpStepAfterSave(rpc as unknown as BpRead,actor.memberId,v)}:{status};
  },
 };
}

/**
 * The nurse visit proposed for an LDL re-test: the booking command the app's form runs, with the LDL eligibility contract
 * (lib/ldl/retest.ts) checked now, on the member's current record. A hold reads as stale, and nothing is accepted.
 */
async function acceptLdlRequest(rpc:TelegramServiceRpc,memberId:string,v:{id:string;revision:number;commandId:string}):Promise<'saved'|'stale'|'failed'>{
 if(!realBookingEnabled(process.env))return 'failed';
 const source=ldlSource.safeParse(await rpc('booking_program_source',{p_member:memberId,p_actor:memberId}).catch(()=>null));
 if(!source.success)return 'failed';
 try{ldlRetestHold(source.data.data);}catch{return 'stale';}
 try{
  await rpc('command_patient_test_request',{p_user_id:memberId,p_actor:memberId,p_staff:false,p_id:v.id,p_revision:v.revision,p_command_id:v.commandId,p_operation:'accept',p_input:{engine:ldlRetestEngine(source.data.token)}});
  return 'saved';
 }catch(e){return /\((?:40001|55P03|40P01)\)$/.test(String((e as Error).message))?'stale':'failed';}
}

/** The exact link a message is about to go to. */
type Route={memberId:string;endpointId:string;generation:number};
/**
 * References for the view's buttons, as rows for the adapter, on exactly this link. Null means that link is gone or could
 * not be confirmed, and the caller sends nothing: this is the last check before card content leaves.
 */
async function armRows(rpc:TelegramServiceRpc,route:Route,cardId:string,view:TelegramCardView):Promise<TelegramCallbackRow[]|null>{
 const flat=view.rows.flat();
 const r=armed.safeParse(await rpc('zoe_chat_card_arm',{p_member:route.memberId,p_card:cardId,p_endpoint:route.endpointId,p_generation:route.generation,p_buttons:flat.map(b=>({action:b.action,item:b.item}))}).catch(()=>null));
 if(!r.success||r.data.refs.length!==flat.length)return null;
 let i=0;
 return view.rows.map(row=>row.map(b=>({label:b.label,ref:r.data.refs[i++]})));
}

/** Queues a card's message for the member's linked chat, once per inbox event. Buttons are issued when it is sent. */
async function queueCard(rpc:TelegramServiceRpc,memberId:string,card:ZoeCard,inboxId:string,l:CardLocale):Promise<boolean>{
 const view=telegramCardView(card,l);
 if(!view)return false;
 const r=await rpc('zoe_chat_card_send',{p_member:memberId,p_card:card.id,p_inbox:inboxId,p_body:view.text}).catch(()=>null) as {ok?:boolean}|null;
 return r?.ok===true;
}

/**
 * The buttons of a claimed system message, when it carries a card. 'failed': no card message goes out without its
 * buttons (it would show a dose with no way to log it); the caller records that nothing was sent.
 */
export async function cardKeyboard(rpc:TelegramServiceRpc,messageId:string):Promise<Readonly<{kind:'callback';rows:TelegramCallbackRow[]}>|'failed'|null>{
 const read=forMessage.safeParse(await rpc('zoe_chat_card_for_message',{p_message:messageId}).catch(()=>undefined));
 if(!read.success)return 'failed';
 if(!read.data)return null;
 const card=parseStoredCard(read.data.card),view=card&&telegramCardView(card,read.data.locale);
 if(!card||!view)return 'failed';
 const rows=await armRows(rpc,read.data,card.id,view);
 return rows?{kind:'callback',rows}:'failed';
}

/** The short line under the press. Nothing clinical: a saved state, or why nothing happened. */
function answerFor(r:CardResult,action:CardPress['action'],l:CardLocale):string|undefined{
 if(r.status==='ok')return action==='dose_taken'?say(l,DOSE.doneTaken):action==='dose_skipped'?say(l,DOSE.doneMissed):action==='bp_save'||action==='visit_accept'||action==='ldl_visit_accept'||action==='ask_reason'?say(l,BP.done):action==='side_effect_pick'?say(l,TG_WRITE.sent):undefined;
 if(r.status==='stale')return say(l,COMMON.staleInChat);
 if(r.status==='closed')return say(l,COMMON.closed);
 if(r.status==='rate_limited')return say(l,COMMON.rateLimited);
 if(r.status==='disabled'||r.status==='unavailable')return say(l,TELEGRAM.unavailable);
 return say(l,COMMON.saveFailed);
}

const sideItem=z.strictObject({what:z.enum(SIDE_EFFECTS)});
const askItem=z.strictObject({reason:z.enum(ASK_REASONS as [string,...string[]])});
const openItem=z.strictObject({kind:z.enum([...TELEGRAM_MENU_KINDS,'ask'] as unknown as [string,...string[]]),page:z.number().int().min(1).max(RESULT_PAGES-1).optional(),ask:z.uuid().optional()});
/** The inbox row is the request: a redelivery or retry opens the same card and queues the same message. */
async function openAndQueue(rpc:TelegramServiceRpc,actor:MemberActor,ports:CardPorts,kind:CardKind,inboxId:string,l:CardLocale,page?:number):Promise<CardResult>{
 const r=await openCard(actor,ports,{requestId:inboxId,kind,sourceSeq:null,...(page?{page}:{})});
 if(r.status!=='ok')return r;
 return await queueCard(rpc,actor.memberId,r.card,inboxId,l)?r:{status:'unavailable'};
}

/** The ask as its own card, once: the ask is the request, so a replay finds the same card and the same message. */
async function postAsk(rpc:TelegramServiceRpc,actor:MemberActor,ports:CardPorts,ask:MedicineAsk,inboxId:string,l:CardLocale){
 const r=await openCard(actor,ports,{requestId:ask.id,kind:'ask',sourceSeq:null,ask}).catch(():CardResult=>({status:'failed'}));
 if(r.status==='ok')await queueCard(rpc,actor.memberId,r.card,inboxId,l);
}

async function queueLine(rpc:TelegramServiceRpc,actor:MemberActor,press:CardPress,line:typeof TG_WRITE.other){
 const r=await postCard(actor.memberId,press.inboxId,'menu','chip',null,SNAPSHOTS.menu.parse({v:1,line:say(press.locale,line)}),rpc);
 if(r.ok)await queueCard(rpc,actor.memberId,r.card,press.inboxId,press.locale);
}

async function openAndQueueAsk(rpc:TelegramServiceRpc,actor:MemberActor,ports:CardPorts,ask:MedicineAsk,press:CardPress):Promise<CardResult>{
 const r=await openCard(actor,ports,{requestId:ask.id,kind:'ask',sourceSeq:null,ask});
 if(r.status!=='ok')return r;
 return await queueCard(rpc,actor.memberId,r.card,press.inboxId,press.locale)?r:{status:'unavailable'};
}

async function runPress(rpc:TelegramServiceRpc,press:CardPress,actor:MemberActor,ports:CardPorts,newId:()=>string):Promise<CardResult>{
 if(press.action==='open_card'){
  const want=openItem.safeParse(press.item);
  if(!want.success)return {status:'invalid'};
  if(want.data.page&&want.data.kind!=='results')return {status:'invalid'};
  if(want.data.kind==='ask'){
   // From a notice: this ask, if it is still open. A closed one is told as closed; an outage is nothing done, and can be pressed again.
   const read=medicineAskSchema.nullable().safeParse(await rpc('member_medicine_ask_open_for',{p_member:actor.memberId,p_ask:want.data.ask}).catch(()=>undefined));
   if(!read.success)return {status:'unavailable'};
   if(!read.data)return {status:'closed'};
   return openAndQueueAsk(rpc,actor,ports,read.data,press);
  }
  return openAndQueue(rpc,actor,ports,want.data.kind as CardKind,press.inboxId,press.locale,want.data.page);
 }
 if(press.action==='show_current'){
  const shown=await ports.readCard(press.cardId);
  if(!shown||!shown.valid)return {status:'invalid'};
  return openAndQueue(rpc,actor,ports,shown.kind,press.inboxId,press.locale);
 }
 if(press.action==='bp_save'){
  // The numbers are the card's own, as the member saw them; nothing in the press carries a reading.
  const card=await ports.readCard(press.cardId);
  if(!card?.valid||card.kind!=='bp'||!card.snapshot.typed)return {status:'invalid'};
  const {entrySource,...typed}=card.snapshot.typed;
  return logBp(actor,ports,{cardId:card.id,submissionId:newId(),...typed,...(entrySource==='patient_voice_confirmed'?{entrySource}:{})});
 }
 if(press.action==='ask_reason'){
  const item=askItem.safeParse(press.item);
  if(!item.success)return {status:'invalid'};
  return answerDoseAsk(actor,ports,{cardId:press.cardId,opId:newId(),reason:item.data.reason as AskReason});
 }
 if(press.action==='side_effect_pick'){
  const item=sideItem.safeParse(press.item);
  const card=await ports.readCard(press.cardId);
  if(!item.success||!card?.valid||card.kind!=='side_effect')return {status:'invalid'};
  const what=item.data.what as SideEffect;
  // Nothing to send yet: the member's own words come as an ordinary message.
  if(what==='other'){await queueLine(rpc,actor,press,TG_WRITE.other);return {status:'ok',card};}
  const c=await claim(actor,ports,card,'picked',newId(),{what});
  if(!c.ok)return c.result;
  if((c.claim.payload as {what?:string}).what!==what)return {status:'stale',card};
  if(card.outcome.picked!==undefined)return {status:'ok',card};
  // Through the inbox as the member's message, so the pipeline, care alerts and the doctor see it as typed.
  const sent=await rpc('channel_inbox_card_text',{p_press:press.inboxId,p_card:card.id,p_text:sideEffectMessage(press.locale,what,'')}).catch(()=>null) as {ok?:boolean}|null;
  if(sent?.ok!==true)return {status:'failed',card};
  const done=await record(actor,ports,card,'picked',{what},true);
  // The doctor already has it. A nurse task is extra, so it never fails the press.
  if(sideEffectNurseFirstEnabled()&&sideEffectRoute(what)==='nurse')await rpc('channel_side_effect_nurse_task',{p_member:actor.memberId,p_what:what,p_request_id:c.claim.op}).catch(()=>null);
  return done;
 }
 if(press.action==='visit_accept')return acceptVisit(actor,ports,{cardId:press.cardId,commandId:newId()});
 if(press.action==='ldl_visit_accept')return acceptLdlVisit(actor,ports,v=>acceptLdlRequest(rpc,actor.memberId,v),{cardId:press.cardId,commandId:newId()});
 const item=doseItemSchema.safeParse(press.item);
 if(!item.success)return {status:'invalid'};
 const r=await logDose(actor,ports,{cardId:press.cardId,opId:newId(),...item.data,status:press.action==='dose_taken'?'taken':'skipped'});
 // The dose is saved; the question that follows is a separate message, and its failure changes nothing about the dose.
 if(r.status==='ok'&&r.ask)await postAsk(rpc,actor,ports,r.ask,press.inboxId,press.locale);
 return r;
}

/**
 * One verified press: the command, its result on the inbox row, then the answer and the edit. Anything after the command
 * may fail or time out; the member can press again and the card's claim replays, so nothing is ever repeated.
 */
export async function handleCardPress(rpc:TelegramServiceRpc,adapter:Pick<TelegramChannelAdapter,'acknowledgeCallback'|'editText'>,press:CardPress,newId:()=>string=randomUUID):Promise<CardResult>{
 const actor=mintActor(press.memberId,'telegram');
 const r=await runPress(rpc,press,actor,telegramPorts(rpc,actor),newId).catch(():CardResult=>({status:'failed'}));
 await rpc('channel_inbox_press_done',{p_id:press.inboxId,p_result:r.status}).catch(()=>null);
 // "Something else" sends nothing yet, so its answer must not say sent.
 const nothingSent=press.action==='side_effect_pick'&&press.item.what==='other'&&r.status==='ok';
 await adapter.acknowledgeCallback(press.callbackId,nothingSent?undefined:answerFor(r,press.action,press.locale)).catch(()=>null);
 if(press.action!=='show_current'&&press.action!=='open_card'&&r.card){
  const view=r.status==='stale'?telegramStaleView(r.card,press.locale):telegramCardView(r.card,press.locale);
  if(view){
   const rows=await armRows(rpc,press,press.cardId,view);
   if(rows)await adapter.editText({address:String(press.chatId),messageId:press.messageId,text:view.text,keyboard:{kind:'callback',rows}}).catch(()=>null);
  }
 }
 return r;
}

/**
 * /menu from a verified chat: the list of tasks, as a card, once per inbox row. An outage leaves the row leased, so it comes
 * back and the card's own request replays to one message; a refusal that will not change (the hourly card limit) ends it.
 */
export async function openMenu(rpc:TelegramServiceRpc,menu:z.infer<typeof menuSchema>):Promise<CardResult>{
 const actor=mintActor(menu.memberId,'telegram');
 const r=await openAndQueue(rpc,actor,telegramPorts(rpc,actor),'menu',menu.inboxId,menu.locale).catch(():CardResult=>({status:'failed'}));
 if(r.status!=='unavailable'&&r.status!=='failed')await rpc('channel_inbox_press_done',{p_id:menu.inboxId,p_result:r.status}).catch(()=>null);
 return r;
}

/** An edited or forwarded text: one line asking for a new message. An outage leaves the row to come back. */
export async function handleRedo(rpc:TelegramServiceRpc,redo:z.infer<typeof redoSchema>):Promise<void>{
 const r=await postCard(redo.memberId,redo.inboxId,'menu','chip',null,SNAPSHOTS.menu.parse({v:1,line:say(redo.locale,NOTICE.redo)}),rpc);
 if(r.ok&&await queueCard(rpc,redo.memberId,r.card,redo.inboxId,redo.locale))await rpc('channel_inbox_press_done',{p_id:redo.inboxId,p_result:'asked_again'}).catch(()=>null);
}

const noticeRead=z.strictObject({memberId:z.uuid(),endpointId:z.uuid(),generation:z.number().int().positive(),kind:z.enum(['dose','bp','results','plan','ldl','ask']),key:z.string(),locale}).nullable();
/**
 * The button of a claimed member notice, when its task has a card: it opens the card in the chat instead of a page. The notice
 * stays the notice, with every gate at its claim and its own record of delivery. Null on any doubt, and the link button goes.
 * The holder card is what the button hangs on, and it shows the notice in the app's thread; the message id is its request.
 */
export async function noticeKeyboard(rpc:TelegramServiceRpc,messageId:string,line:string):Promise<Readonly<{kind:'callback';rows:TelegramCallbackRow[]}>|null>{
 const read=noticeRead.safeParse(await rpc('zoe_chat_card_notice',{p_message:messageId}).catch(()=>undefined));
 if(!read.success||!read.data)return null;
 const n=read.data,actor=mintActor(n.memberId,'telegram'),askId=n.kind==='ask'?n.key.slice(n.key.indexOf(':')+1):null;
 const r=await postCard(actor.memberId,messageId,'menu','chip',null,SNAPSHOTS.menu.parse({v:1,line:line.slice(0,4000),kinds:[n.kind],...(askId?{askId}:{})}),rpc);
 if(!r.ok)return null;
 const item={kind:n.kind,...(askId?{ask:askId}:{})};
 const label=say(n.locale,n.kind==='ask'?NOTICE.answer:CHIP[n.kind]);
 const rows=await armRows(rpc,n,r.card.id,{text:'',rows:[[{label,action:'open_card',item}]]});
 return rows?{kind:'callback',rows}:null;
}

/** A press the database refused: nothing was done, and the member is told so in one short line. */
export async function answerRefusedPress(adapter:Pick<TelegramChannelAdapter,'acknowledgeCallback'>,refused:z.infer<typeof refusedSchema>){
 const line=refused.code==='not_linked'?TELEGRAM.notLinked:refused.code==='unknown'||refused.code==='expired'?TELEGRAM.expired:TELEGRAM.unavailable;
 await adapter.acknowledgeCallback(refused.callbackId,say(refused.locale,line)).catch(()=>null);
}

/**
 * Posts the card a Telegram member's cleared message asks for, as the app offers it: only for a message the database
 * says Zoe's pipeline cleared, and the post checks that again. The card goes after Zoe's own reply; the member still
 * taps to do anything. Returns how many were queued.
 */
export async function offerTelegramCards(rpc:TelegramServiceRpc):Promise<number>{
 const rows=candidates.safeParse(await rpc('zoe_chat_card_telegram_candidates',{p_limit:20}).catch(()=>null));
 if(!rows.success)return 0;
 let queued=0;
 for(const row of rows.data){
  const settle=()=>rpc('zoe_chat_card_telegram_settle',{p_member:row.memberId,p_seq:row.seq}).catch(()=>null);
  // A message that is only a reading brings the card that shows it back, and one that asks to log a reading the BP card; any other card needs the plain rule.
  const asked=cardIntent(row.text);
  // SQL preserves the original reading across small talk, including its request and timestamp.
  const typed=typedReading(row.text);
  const kind=typed?'bp':row.cleared||asked==='bp'?asked:null;
  if(!kind||!TELEGRAM_CARD_KINDS.includes(kind)){await settle();continue;}
  const actor=mintActor(row.memberId,'telegram');
  // The message's own request: a retry after a failed queue finds this card and queues it, once.
  const r=await openCard(actor,telegramPorts(rpc,actor),{requestId:row.requestId,kind,sourceSeq:row.seq,...(typed?{typed:{...typed,measuredAt:row.at}}:{})});
  if(r.status==='ok'){if(await queueCard(rpc,row.memberId,r.card,row.requestId,row.locale))queued++;}
  else if(r.status==='not_cleared')await settle();
 }
 return queued;
}
