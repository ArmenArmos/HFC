import 'server-only';
import {isDeepStrictEqual} from 'node:util';
import {stableRequestId} from './next-step-id';
import {z} from 'zod';
import type {MedicineResult} from '@/lib/member-medicines/actions';
import type {BpWeekResult} from '@/lib/bp-week/actions';
import {currentWeek,nextSlot,yerevanDate,type BpWeekRead} from '@/lib/bp-week/model';
import type {AskReason} from '@/lib/member-medicines/ask-copy';
import type {MedicineAsk,MemberAsksRead} from '@/lib/member-medicines/asks';
import type {MemberMedicinesRead} from '@/lib/member-medicines/model';
import type {BpStep} from '@/lib/clinical/rules/bp-check';
import type {DueDose} from '@/lib/patient-care/types';
import type {MemberActor} from './actor';
import type {BpFlow} from './bp-flow';
import type {claimCard,postCard,recordCard,Claim,StoreCode} from './server';
import {visitAcceptanceItem,visitProposalAccepted,findLivingVisit,SNAPSHOTS,urgentHoldResult,doseItem,type CardActionResult,type CardKind,type ValidCard,type ZoeCard,type ZoeCards,type BpFlowContext} from './registry';

/**
 * The card commands, one per task, shared by the app and Telegram. Each takes a verified actor and the channel's ports
 * (how that channel reads and writes the feature for this member); authorization, the card's claim, idempotency and the
 * feature's own checks are the same either way. Not a 'use server' file on purpose: nothing here is reachable from a
 * client, and the channel adapters (actions.ts, lib/telegram-runtime/cards.ts) are the only callers.
 */

export type CardResult=CardActionResult&{ask?:MedicineAsk};
/** What the blood pressure flow decided about a saved reading, and the card it posted next. */
export type BpFlowResult={flow:BpFlow;next:ZoeCard|null};
export type CardPorts={
 post:typeof postCard;
 claim:typeof claimCard;
 record:typeof recordCard;
 readCard(id:string):Promise<ZoeCard|null>;
 readCards?():Promise<ZoeCards>;
 snapshot(kind:CardKind,input?:OpenInput):Promise<unknown>;
 readMedicines():Promise<MemberMedicinesRead>;
 readAsks():Promise<MemberAsksRead>;
 tickDose(input:{medicineId:string;dueAt:string;status:'taken'|'skipped';revision:number}):Promise<MedicineResult>;
 /** Today's doses from the published plan; null when they could not be read. */
 readPlanDoses():Promise<DueDose[]|null>;
 tickPlanDose(input:{medicationId:string;dueAt:string;status:'taken'|'skipped';planId:string;revision:number}):Promise<MedicineResult>;
 readBpWeek():Promise<BpWeekRead|null>;
 saveBpWeek(input:BpEntry&{weekId:string;slot:'morning'|'evening'}):Promise<BpWeekResult>;
 saveBp(input:BpEntry):Promise<{status:'saved'|'conflict'|'failed';bp?:BpStep}>;
 /** The blood pressure flow, after a save. Absent on Telegram; null with V3 off, and nothing about the save changes. */
 afterBp?(memberId:string,saved:{submissionId:string;systolic:number;diastolic:number}&BpFlowContext):Promise<BpFlowResult|null>;
 /** Accepts a time the clinic proposed, by that feature's own rules; code is its refusal. */
 /** The answer to a missed-dose ask, by its own rules (once per ask). */
 answerAsk(input:{askId:string;reason:AskReason}):Promise<{status:string;next?:string}>;
 acceptProposal(input:{commandId:string;proposalId:string}):Promise<{ok:boolean;code?:string}>;
};
/** What a card opens with beyond its kind: typed numbers for the BP card, or which page of results. */
export type OpenInput={typed?:TypedBp;page?:number;ask?:MedicineAsk;askId?:string};
/** Numbers a member typed, shown back on a BP card (typed-reading.ts); measuredAt is when they sent them. */
/** entrySource: 'patient_voice_confirmed' only after a verified server receipt; 'patient_voice_live_confirmed' for a Live-dictated reading (WP V). */
export type TypedBp={systolic:number;diastolic:number;pulse:number|null;measuredAt:string;entrySource?:'patient_voice_confirmed'|'patient_voice_live_confirmed'};
type BpEntry=TypedBp&{submissionId:string;photoConfirmed?:boolean};

export const fromStore=(code:StoreCode,card?:ZoeCard):CardResult=>({status:code==='recorded'||code==='conflict'?'stale':code==='not_found'?'invalid':code,...(card?{card}:{})});

export async function ownCard<K extends ValidCard['kind']>(ports:Pick<CardPorts,'readCard'>,id:string,kind:K){
 const card=await ports.readCard(id);
 return card&&card.valid&&card.kind===kind?card as Extract<ValidCard,{kind:K}>:null;
}
/**
 * Claims the card item for this operation, or gets the claim another tab or an earlier try made (Astra ZCA-01). The
 * write that follows always uses the claim's op id and payload, so the feature replays instead of writing twice.
 */
export async function claim(actor:MemberActor,ports:Pick<CardPorts,'claim'>,card:ZoeCard,item:string,op:string,payload:Record<string,unknown>):Promise<{ok:true;claim:Claim}|{ok:false;result:CardResult}>{
 const c=await ports.claim(actor.memberId,card.id,item,op,payload);
 return c.ok?c:{ok:false,result:fromStore(c.code,c.card??card)};
}
export async function record(actor:MemberActor,ports:Pick<CardPorts,'record'>,card:ZoeCard,item:string,value:Record<string,unknown>,close:boolean):Promise<CardResult>{
 const r=await ports.record(actor.memberId,card.id,item,value,close);
 return r.ok?{status:'ok',card:r.card}:fromStore(r.code,r.card);
}

/**
 * Zoe posts a card: from a chip or button (no member text), or from the member's typed message, which the database
 * accepts only once Zoe's pipeline has cleared that message (zoe_chat_card_post re-checks it).
 */
export async function openCard(actor:MemberActor,ports:Pick<CardPorts,'snapshot'|'post'|'readCards'>,input:{requestId:string;kind:CardKind;sourceSeq:number|null;reuseCurrent?:boolean}&OpenInput):Promise<CardResult>{
 let snapshot:unknown;
 try{snapshot=await ports.snapshot(input.kind,{...(input.typed?{typed:input.typed}:{}),...(input.page?{page:input.page}:{}),...(input.ask?{ask:input.ask}:{}),...(input.askId?{askId:input.askId}:{})});}catch{return {status:'unavailable'};}
 if(input.kind==='visit'){const held=urgentHoldResult.safeParse(snapshot);if(held.success)return held.data;}
 // Page opens survive a reload's new request id. Only the newest open card of the same kind/view is considered;
 // a changed snapshot needs a new card, and completed choices are never reopened.
 const menu=input.kind==='menu'?SNAPSHOTS.menu.safeParse(snapshot):null;
 const view=menu?.success?menu.data.view:undefined;
 if(input.kind==='visit'){
  const parsed=SNAPSHOTS.visit.safeParse(snapshot);
  if(parsed.success&&parsed.data.living){
   const read=await ports.readCards?.();
   const existing=read?.cards.find(c=>c.valid&&c.kind==='visit'&&c.snapshot.living?.visitId===parsed.data.living!.visitId);
   if(existing?.valid)return {status:'ok',card:existing};
   // Living snapshots are written only by the database reconciliation, never by generic posting.
   return {status:'unavailable'};
  }
 }
 if(input.reuseCurrent&&actor.channel==='app'&&input.sourceSeq===null&&(input.kind!=='menu'||view)&&ports.readCards){
  const read=await ports.readCards();
  if(input.kind==='visit'){const current=findLivingVisit(read.cards);if(current)return {status:'ok',card:current};}
  const newest=read.enabled?read.cards.filter(c=>c.kind===input.kind&&c.state==='open'&&(!view||c.valid&&c.kind==='menu'&&c.snapshot.view===view)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at))[0]:null;
  if(newest?.valid&&isDeepStrictEqual(newest.snapshot,snapshot))return {status:'ok',card:newest};
 }
 const r=await ports.post(actor.memberId,input.requestId,input.kind,input.sourceSeq===null?'chip':'typed',input.sourceSeq,snapshot);
 return r.ok?{status:'ok',card:r.card}:fromStore(r.code,r.card);
}

const doseClaim=z.object({status:z.enum(['taken','skipped'])});
/** Marks a dose shown on the card, through the feature's own tick (its revision check). */
export async function logDose(actor:MemberActor,ports:CardPorts,v:{cardId:string;opId:string;medicineId:string;dueAt:string;status:'taken'|'skipped'}):Promise<CardResult>{
 const card=await ownCard(ports,v.cardId,'dose');
 const slot=card?.snapshot.slots.find(s=>s.medicineId===v.medicineId&&Date.parse(s.dueAt)===Date.parse(v.dueAt));
 if(!card||!slot)return {status:'invalid'};
 const item=doseItem(slot);
 const c=await claim(actor,ports,card,item,v.opId,{status:v.status});
 if(!c.ok)return c.result;
 const want=doseClaim.safeParse(c.claim.payload);
 if(!want.success)return {status:'invalid',card};
 // Another tab claimed this dose for the other answer: this one is stale.
 if(want.data.status!==v.status)return {status:'stale',card};
 const value={status:want.data.status};
 const findAsk=async()=>{
  if(value.status!=='skipped')return undefined;
  const asks=await ports.readAsks();
  return asks.enabled?asks.asks.find(a=>a.source===(slot.planId?'plan':'self')&&a.medicineId===slot.medicineId&&Date.parse(a.dueAt)===Date.parse(slot.dueAt)&&a.state==='open'):undefined;
 };
 const done=async()=>{const r=await record(actor,ports,card,item,value,false);return r.status==='ok'?{...r,ask:await findAsk()}:r;};
 // What is stored now, for a retry or a replay: the record decides, never the card.
 const recorded=async()=>{
  if(slot.planId)return (await ports.readPlanDoses())?.find(d=>d.medication.id===slot.medicineId&&Date.parse(d.dueAt)===Date.parse(slot.dueAt))?.status;
  const now=await ports.readMedicines();
  return now.enabled?now.medicines.find(m=>m.id===slot.medicineId)?.doses.find(d=>Date.parse(d.dueAt)===Date.parse(slot.dueAt))?.status:undefined;
 };
 // Logged on this card already. The dose may have changed since, in the app or elsewhere (QA a9-01): only a match is a replay.
 if(card.outcome[item]!==undefined)return (card.outcome[item] as {status?:unknown}).status===value.status&&await recorded()===value.status?{status:'ok',card,ask:await findAsk()}:{status:'stale',card};
 const tick=slot.planId?await ports.tickPlanDose({medicationId:slot.medicineId,dueAt:slot.dueAt,status:value.status,planId:slot.planId,revision:slot.revision})
  :await ports.tickDose({medicineId:slot.medicineId,dueAt:slot.dueAt,status:value.status,revision:slot.revision});
 if(tick.status==='saved')return done();
 if(tick.status==='conflict'){
  // A retry or another tab after a save that did not reach the card, or a change made elsewhere: the record decides.
  return await recorded()===value.status?done():{status:'stale',card};
 }
 if(tick.status==='not-due')return {status:'stale',card};
 return {status:tick.status==='disabled'||tick.status==='signed_out'?tick.status:tick.status==='invalid'||tick.status==='not-found'?'invalid':'failed',card};
}

/** Records a saved reading, with the flow's reply when it ran. */
async function savedReading(actor:MemberActor,ports:CardPorts,card:ZoeCard,r:z.infer<typeof bpClaim>,submissionId:string,bp?:BpStep,weekOverride?:BpFlowContext['week']):Promise<CardResult>{
 const after=await ports.afterBp?.(actor.memberId,{submissionId,systolic:r.systolic,diastolic:r.diastolic,follows:{cardId:card.id,item:'bp'},...(card.valid&&card.kind==='repeat'&&card.snapshot.episodeId?{episodeId:card.snapshot.episodeId}:{}),...(card.valid&&(card.kind==='bp'||card.kind==='repeat')?{week:weekOverride===undefined?card.snapshot.week:weekOverride}:{})})??null;
 const voice=card.valid&&card.kind==='bp'?card.snapshot.typed?.entrySource:undefined;
 const entrySource=r.photoConfirmed?'patient_photo_confirmed':voice==='patient_voice_confirmed'||voice==='patient_voice_live_confirmed'?voice:'patient_text_entry';
 const done=await record(actor,ports,card,'bp',{...r,entrySource,submissionId,...(bp?{bp}:{}),...(after?{flow:after.flow}:{})},true);
 return after?.next&&done.status==='ok'?{...done,next:after.next}:done;
}

const bpClaim=z.object({systolic:z.number().int(),diastolic:z.number().int(),pulse:z.number().int().nullable(),measuredAt:z.iso.datetime({offset:true}),photoConfirmed:z.boolean().optional()});
/**
 * Saves the reading the member confirmed, through the BP week's or the BP form's own rules (their validation and their
 * submission id, so a retry replays). The one BP check runs where the reading is saved: the step comes back and is kept on
 * the card, so a replay shows the same words. With V3 on, afterBp then runs the care flow; otherwise a saved reading raises
 * nothing more here. One reading per card: the first claim's submission is the one saved.
 */
export async function logBp(actor:MemberActor,ports:CardPorts,v:BpEntry&{cardId:string}):Promise<CardResult>{
 const card=await ownCard(ports,v.cardId,'bp');
 if(!card)return {status:'invalid'};
 const week=card.snapshot.week;
 // A BP week card only for the slot it showed (Astra ZCA-03): the week saves by the reading's time, so a card from
 // another day or slot would file the reading elsewhere. Checked before the first claim; a replay keeps its claim.
 if(week&&!card.claims.bp){
  const read=await ports.readBpWeek().catch(()=>null);
  const live=read?currentWeek(read,new Date()):null;
  const slot=live?nextSlot(live,new Date()):null;
  if(!live||live.id!==week.weekId||!slot||slot.date!==week.date||slot.slot!==week.slot||(slot.state!=='due'&&slot.state!=='partial')
   ||yerevanDate(new Date(v.measuredAt))!==week.date)return {status:'stale',card};
 }
 const c=await claim(actor,ports,card,'bp',v.submissionId,{systolic:v.systolic,diastolic:v.diastolic,pulse:v.pulse,measuredAt:v.measuredAt,...(v.photoConfirmed!==undefined?{photoConfirmed:actor.channel==='app'&&v.photoConfirmed}:{})});
 if(!c.ok)return c.result;
 const b=bpClaim.safeParse(c.claim.payload);
 if(!b.success)return {status:'invalid',card};
 const r=b.data,submissionId=c.claim.op;
 // The claim holds other numbers: another tab's, or this card's own after an edit that followed a failed save (same
 // submission id, test gap 7). This reading is not saved here, and the member is told so, never the old numbers as saved.
 if(r.systolic!==v.systolic||r.diastolic!==v.diastolic||r.pulse!==v.pulse||Boolean(r.photoConfirmed)!==Boolean(v.photoConfirmed))return {status:'stale',card};
 if(card.outcome.bp!==undefined)return {status:'ok',card};
 if(week){
  const w=await ports.saveBpWeek({weekId:week.weekId,slot:week.slot,submissionId,...r});
  if(w.status==='saved'||w.status==='replayed')return savedReading(actor,ports,card,r,submissionId,w.bp);
  if(['slot-full','not-today','outside-week','not-open','conflict'].includes(w.status))return {status:'stale',card};
  return {status:w.status==='invalid'||w.status==='disabled'||w.status==='signed_out'?w.status:'failed',card};
 }
 const m=await ports.saveBp({submissionId,...r});
 if(m.status==='saved')return savedReading(actor,ports,card,r,submissionId,m.bp);
 return {status:m.status==='conflict'?'stale':'failed',card};
}

/** The second reading of an episode: the same save and the same flow as the BP card, one reading per card. */
export async function logRepeat(actor:MemberActor,ports:CardPorts,v:BpEntry&{cardId:string}):Promise<CardResult>{
 const card=await ownCard(ports,v.cardId,'repeat');
 if(!card)return {status:'invalid'};
 const c=await claim(actor,ports,card,'bp',v.submissionId,{systolic:v.systolic,diastolic:v.diastolic,pulse:v.pulse,measuredAt:v.measuredAt,...(v.photoConfirmed!==undefined?{photoConfirmed:actor.channel==='app'&&v.photoConfirmed}:{})});
 if(!c.ok)return c.result;
 const b=bpClaim.safeParse(c.claim.payload);
 if(!b.success)return {status:'invalid',card};
 const r=b.data,submissionId=c.claim.op;
 if(r.systolic!==v.systolic||r.diastolic!==v.diastolic||r.pulse!==v.pulse||Boolean(r.photoConfirmed)!==Boolean(v.photoConfirmed))return {status:'stale',card};
 if(card.outcome.bp!==undefined)return {status:'ok',card};
 const week=card.snapshot.week;
 let standalone=card.outcome.bp_week_full!==undefined;
 if(week&&!standalone){
  // The week owns slot capacity, date, state and replay checks. A retry must reach it even after its first save filled the slot.
  if(yerevanDate(new Date(r.measuredAt))!==week.date)return {status:'stale',card};
  const w=await ports.saveBpWeek({weekId:week.weekId,slot:week.slot,submissionId,...r});
  if(w.status==='saved'||w.status==='replayed')return savedReading(actor,ports,card,r,submissionId,w.bp);
  if(w.status==='slot-full'){
   // Capacity can fill on the first reading or another device. The safety repeat still saves, without a third week link.
   // Persist the route before saving: a lost outcome must retry the plain submission, which the week would reject as unlinked.
   const route=await claim(actor,ports,card,'bp_week_full',submissionId,{});
   if(!route.ok)return route.result;
   const routed=await record(actor,ports,card,'bp_week_full',{submissionId},false);
   if(routed.status!=='ok')return routed;
   standalone=true;
  }else{
   if(['not-today','outside-week','not-open','conflict'].includes(w.status))return {status:'stale',card};
   return {status:w.status==='invalid'||w.status==='disabled'||w.status==='signed_out'?w.status:'failed',card};
  }
 }
 const m=await ports.saveBp({submissionId,...r});
 if(m.status==='saved')return savedReading(actor,ports,card,r,submissionId,m.bp,standalone?null:undefined);
 return {status:m.status==='conflict'?'stale':'failed',card};
}

/** Accepts the time the clinic proposed, through the visits page's own rules (its command id and checks). */
export async function acceptVisit(actor:MemberActor,ports:CardPorts,v:{cardId:string;commandId:string;proposalId?:string}):Promise<CardResult>{
 const card=await ownCard(ports,v.cardId,'visit');
 if(!card)return {status:'invalid'};
 const proposal=card.snapshot.proposal;
 const living=!!card.snapshot.living;
 // A living card changes in place. Require the proposal the member actually saw, before any claim or receipt replay.
 if(living&&!v.proposalId)return {status:'invalid',card};
 if(v.proposalId&&proposal&&v.proposalId!==proposal.proposalId)return {status:'stale',card};
 if((living&&v.proposalId&&visitProposalAccepted(card,v.proposalId))||(!living&&card.outcome.accepted!==undefined))return {status:'ok',card};
 const proposalId=proposal?.proposalId??(living?v.proposalId:undefined);
 if(!proposalId)return {status:living?'stale':'invalid',card};
 // Recover a persisted claim even after a poll cleared the proposal. Claims are immutable;
 // the booking command replays its own result if its reply or the receipt write was lost.
 const legacy=card.claims.accepted?.payload.proposalId===proposalId;
 const item=living&&!legacy?visitAcceptanceItem(proposalId):'accepted';
 const existing=living?card.claims[item]:undefined;
 if(!proposal&&!existing)return {status:'stale',card};
 if(!card.snapshot.available)return {status:'unavailable',card};
 const op=living?stableRequestId(`zoe-visit-proposal:${card.id}:${proposalId}`):v.commandId;
 const c=await claim(actor,ports,card,item,op,{proposalId});
 if(!c.ok)return c.result;
 if(c.claim.payload.proposalId!==proposalId)return {status:'stale',card};
 const r=await ports.acceptProposal({commandId:c.claim.op,proposalId});
 if(r.ok)return record(actor,ports,card,item,{proposalId,commandId:c.claim.op},true);
 return {status:r.code==='conflict'||r.code==='declined'?'stale':r.code==='invalid'?'invalid':r.code==='unavailable'?'unavailable':'failed',card};
}

/**
 * Accepts the nurse visit proposed for an LDL re-test, on Telegram; the app card uses the booking form itself. The card's
 * snapshot names the request and revision it showed, so a request that moved on is stale, never accepted as something else.
 */
export async function acceptLdlVisit(actor:MemberActor,ports:CardPorts,accept:(v:{id:string;revision:number;commandId:string})=>Promise<'saved'|'stale'|'failed'>,v:{cardId:string;commandId:string}):Promise<CardResult>{
 const card=await ownCard(ports,v.cardId,'ldl');
 const data=card?.snapshot.data;
 const q=data&&data.enabled&&data.inPathway?data.retest?.request:null;
 if(!card||!q||q.status!=='provider-proposed'||!q.proposal)return {status:'invalid'};
 const c=await claim(actor,ports,card,'ldl_visit',v.commandId,{requestId:q.id,revision:q.revision});
 if(!c.ok)return c.result;
 if(card.outcome.ldl_visit!==undefined)return {status:'ok',card};
 const r=await accept({id:q.id,revision:q.revision,commandId:c.claim.op});
 if(r==='saved')return record(actor,ports,card,'ldl_visit',{requestId:q.id,commandId:c.claim.op},true);
 return {status:r,card};
}

const askClaim=z.object({reason:z.string()});
/** Why a dose was missed: the same ask as the app's, answered once, whichever channel answers first. */
export async function answerDoseAsk(actor:MemberActor,ports:CardPorts,v:{cardId:string;opId:string;reason:AskReason}):Promise<CardResult>{
 const card=await ownCard(ports,v.cardId,'ask');
 if(!card)return {status:'invalid'};
 const c=await claim(actor,ports,card,'answer',v.opId,{reason:v.reason});
 if(!c.ok)return c.result;
 const want=askClaim.safeParse(c.claim.payload);
 if(!want.success)return {status:'invalid',card};
 if(want.data.reason!==v.reason)return {status:'stale',card};
 if(card.outcome.answer!==undefined)return {status:'ok',card};
 const r=await ports.answerAsk({askId:card.snapshot.askId,reason:v.reason});
 if(r.status==='answered')return record(actor,ports,card,'answer',{reason:v.reason},true);
 return {status:r.status==='closed'||r.status==='not-found'?'closed':r.status==='disabled'?'disabled':r.status==='invalid'?'invalid':'failed',card};
}
