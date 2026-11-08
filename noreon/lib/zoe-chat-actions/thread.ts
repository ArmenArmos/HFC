import {TASK_REPLY} from '@/lib/chat/tasks';
import {findLivingVisit,visitTransitions,VISIT_STEPS} from './living-visit';
import {typedReading} from './typed-reading';
import type {ChatItem,ZoeThread} from '@/lib/zoe/app-chat-contracts';
import {cardIntent} from './intent';
import {emergencyWasCleared,flagItem,redOutcome,RED_FLAG_QUESTIONS} from './bp-flow';
import {SAMS_QUESTIONS,samsItem} from './dose-flow';
import {doseItem,zoeCardsSchema,type CardKind,type ValidCard,type ZoeCard,type ZoeCards} from './registry';

/** Where the chat reads its cards (app/api/patient/zoe/cards): a plain GET, like the thread. */
export const ZOE_CARDS_URL='/api/patient/zoe/cards';
export async function fetchZoeCards(signal:AbortSignal,fetcher:typeof fetch=fetch):Promise<ZoeCards|null>{
 const response=await fetcher(ZOE_CARDS_URL,{cache:'no-store',credentials:'same-origin',signal});
 if(!response.ok)return null;
 const parsed=zoeCardsSchema.safeParse(await response.json());
 return parsed.success?parsed.data:null;
}

export type ThreadEntry={type:'item';item:ChatItem}|{type:'card';card:ZoeCard};
const at=(item:ChatItem)=>item.kind==='member'||item.kind==='answer'||item.kind==='reply'?Date.parse(item.at):null;

/**
 * The thread with each card at the time Zoe posted it: before the first message, answer or reply that came later.
 * Status lines ("Sent to your care team", "Zoe is writing") stay with the message they follow.
 */
export function withCards(items:readonly ChatItem[],cards:readonly ZoeCard[]):ThreadEntry[]{
 return cardsAt(items,cards,entryAt(at));
}
function cardsAt(items:readonly ChatItem[],cards:readonly ZoeCard[],time:(e:DialogEntry)=>number):ThreadEntry[]{
 const out:ThreadEntry[]=items.map(item=>({type:'item',item}));
 for(const card of [...cards].sort((a,b)=>Date.parse(a.at)-Date.parse(b.at)))place<DialogEntry>(out,{type:'card',card},time);
 return out;
}
const entryAt=(itemAt:typeof at)=>(e:DialogEntry)=>e.type==='item'?itemAt(e.item)??-Infinity:Date.parse(e.type==='turn'?e.at:e.card.at);
function place<E>(out:E[],entry:E,time:(e:E)=>number){
 const t=time(entry),i=out.findIndex(e=>time(e)>t);
 if(i<0)out.push(entry);else out.splice(i,0,entry);
}

/**
 * The dialog rule (output/chat-v2/BLOCKS.md), for any role's thread: every finished action goes in at the time it was
 * done, so the thread reads in time order and the newest action is last. Whoever is still writing stays after it, where
 * their reply will land, but above an open form, so the keyboard does not push the form up. Pure over any entry type.
 */
export function dialogOrder<E>(thread:readonly E[],finished:readonly E[],{at:time,writing}:{at:(e:E)=>number;writing:(e:E)=>boolean}):E[]{
 const out=[...thread];
 for(const entry of [...finished].sort((a,b)=>time(a)-time(b)))place(out,entry,time);
 const writer=out.findIndex(writing),last=out.findLastIndex(e=>finished.includes(e));
 if(writer>=0&&writer<last)out.splice(last,0,...out.splice(writer,1));
 return out;
}

/** The time of one recorded action, stamped by zoe_chat_card_record. Actions recorded before doneAt existed keep their own or the card's. */
const doneAt=(card:ZoeCard,item:string)=>{const v=card.outcome[item] as {doneAt?:string;measuredAt?:string}|undefined;return v?.doneAt??v?.measuredAt??card.at;};
type Turn={item:string;at:string;said:boolean};
/**
 * What each block counts as a finished action, and whether the member's own message already said it (said). A block
 * joins the dialog by adding one line here and its words in the chat view.
 */
const TURNS:{[K in CardKind]?:(card:Extract<ValidCard,{kind:K}>)=>Turn[]}={
 review:card=>card.outcome.review?[{item:'review',at:doneAt(card,'review'),said:false}]:[],
 next_step:card=>card.outcome.next_step?[{item:'next_step',at:doneAt(card,'next_step'),said:false}]:[],
 tests_needed:card=>card.outcome.tests_needed?[{item:'tests_needed',at:doneAt(card,'tests_needed'),said:false}]:[],
 message:card=>Object.keys(card.outcome).filter(k=>k.startsWith('sent:')).map(item=>({item,at:doneAt(card,item),said:true})),
 ask:card=>card.snapshot.v3&&card.outcome.answer?[{item:'answer',at:doneAt(card,'answer'),said:false}]:[],
 sams:card=>card.state==='done'?SAMS_QUESTIONS.filter(q=>card.outcome[samsItem(q)]).slice(-1).map(q=>({item:samsItem(q),at:doneAt(card,samsItem(q)),said:false})):[],
 dose:card=>card.snapshot.v3?card.snapshot.slots.filter(s=>card.outcome[doseItem(s)]).map(s=>({item:doseItem(s),at:doneAt(card,doseItem(s)),said:false})):[],
 plan:card=>card.outcome.plan?[{item:'plan',at:doneAt(card,'plan'),said:false}]:card.claims.everyday?.payload.view==='plan_ack'&&card.outcome['everyday:result']?[{item:'everyday:result',at:doneAt(card,'everyday:result'),said:false}]:[],
 bp:card=>{
  const typed=card.snapshot.typed,saved=savedBp(card);
  if(!saved)return [];
  return [{item:'bp',at:doneAt(card,'bp'),said:!!typed&&typed.systolic===saved.systolic&&typed.diastolic===saved.diastolic&&(typed.pulse??null)===(saved.pulse??null)}];
 },
 repeat:card=>savedBp(card)?[{item:'bp',at:doneAt(card,'bp'),said:false}]:[],
 // Answered questions collapse into one turn, at the last answer.
 red_flags:card=>{
  if(card.state!=='done')return [];
  const item=RED_FLAG_QUESTIONS.map(flagItem).filter(i=>card.outcome[i]!==undefined).at(-1);
  return item?[{item,at:doneAt(card,item),said:false}]:[];
 },
 visit:card=>(card.outcome.booking as {dialog?:boolean}|undefined)?.dialog?[{item:'booking',at:doneAt(card,'booking'),said:(card.outcome.booking as {kind?:string}).kind==='visit_request'}]:[],
 prep:card=>card.outcome.prep?[{item:'prep',at:doneAt(card,'prep'),said:false}]:[],
 fasting:card=>card.outcome.fasting?[{item:'fasting',at:doneAt(card,'fasting'),said:false}]:[],
 consult_questions:card=>card.outcome.consult_questions?[{item:'consult_questions',at:doneAt(card,'consult_questions'),said:true}]:[],
 symptom_gate:card=>card.outcome.symptom_gate?[{item:'symptom_gate',at:doneAt(card,'symptom_gate'),said:true}]:[],
 document:card=>card.outcome.document?[{item:'document',at:doneAt(card,'document'),said:false}]:[],
 profile:card=>savedProfile(card)?[{item:'profile',at:doneAt(card,'profile'),said:false}]:[],
 medicines:card=>savedMedicines(card)?[{item:'medicines',at:(card.outcome.medicines as {actionAt?:string}).actionAt??doneAt(card,'medicines'),said:false}]:[],
};
export const cardTurns=(card:ZoeCard,journeyEnabled=false):Turn[]=>card.valid&&card.kind==='visit'&&card.snapshot.living
 // The living card already shows its current status. Only a later transition not yet on it needs a line.
 ?visitTransitions(card).filter(t=>t.item===`visit:${card.snapshot.living!.visitId}:${t.status}`
  &&Date.parse(t.doneAt)>Date.parse(card.at)
  &&VISIT_STEPS.indexOf(t.status)>VISIT_STEPS.indexOf(card.snapshot.living!.status))
  .map(t=>({item:t.item,at:t.doneAt,said:false}))
 :journeyEnabled&&card.valid&&card.kind==='visit'
 ?['booking','accepted'].filter(item=>card.outcome[item]).map(item=>({item,at:doneAt(card,item),said:false}))
 :card.valid?(TURNS[card.kind] as ((c:ZoeCard)=>Turn[])|undefined)?.(card)??[]:[];
export type BpReading={systolic:number;diastolic:number;pulse:number|null;entrySource?:string|null;photoConfirmed?:boolean};
export const savedBp=(card:ZoeCard)=>card.outcome.bp as BpReading|undefined;
export type SavedProfile={channel:'voice'|'text';wake:string;sleep:string;caregiver:boolean};
export const savedProfile=(card:ZoeCard)=>card.outcome.profile as SavedProfile|undefined;
export type MedicineRow={name:string;status:string|null;stopReason:string|null;added:boolean};
/** Only the list saved in the new chat counts as a turn; a change on the older medicines card stays that card's. */
export const savedMedicines=(card:ZoeCard)=>{const v=card.outcome.medicines as {kind?:string;status?:string;rows?:MedicineRow[]}|undefined;return v?.kind==='review'&&v.status==='saved'?v.rows??[]:undefined;};

/** One finished action in the thread. The block that took it leaves its old place once it is done. */
export type TurnEntry=Turn&{type:'turn';card:ValidCard};
export type DialogEntry=ThreadEntry|TurnEntry;
/** The member chat in dialog order, worked out from the cards' outcomes, so every read and every device gets the same. */
export function dialogThread(items:readonly ChatItem[],cards:readonly ZoeCard[],journeyEnabled=false):DialogEntry[]{
 const living=findLivingVisit(cards);
 const shownCards=cards.filter(card=>!(card.valid&&card.kind==='visit'&&card.snapshot.living)||card.id===living?.id);
 // A receipt can arrive before its child (or outside the history window). Never say
 // a card opened until that exact card is present and readable in this thread.
 const hasTarget=(card:ZoeCard)=>{
  if(card.kind!=='next_step'&&card.kind!=='tests_needed')return true;
  const receipt=card.outcome[card.kind] as {requestId?:string;target?:string}|undefined;
  return !!receipt?.requestId&&cards.some(c=>c.valid&&c.requestId===receipt.requestId&&c.kind===receipt.target);
 };
 const turns=shownCards.filter(hasTarget).flatMap(card=>cardTurns(card,journeyEnabled).map((turn):TurnEntry=>({...turn,type:'turn',card:card as ValidCard})));
 // Flow cards can be posted before their parent's record finishes. The persisted link puts the form after that
 // action (and its rendered reply), independently of clock ties, request latency or the order returned by the database.
 const byId=new Map(cards.map(card=>[card.id,card]));
 const follows=(card:ZoeCard)=>{
  if(card.valid&&(card.kind==='repeat'||card.kind==='red_flags')&&card.snapshot.follows)return card.snapshot.follows;
  const parent=cards.find(c=>(c.kind==='next_step'||c.kind==='tests_needed')&&(c.outcome[c.kind] as {requestId?:string}|undefined)?.requestId===card.requestId);
  return parent?{cardId:parent.id,item:parent.kind}:undefined;
 };
 const causalAt=(card:ZoeCard,seen=new Set<string>()):number=>{
  const own=Date.parse(card.at),link=follows(card),parent=link?byId.get(link.cardId):undefined;
  if(!link||!parent||seen.has(card.id))return own;
  seen.add(card.id);
  const value=parent.outcome[link.item] as {doneAt?:string}|undefined;
  return Math.max(own,Date.parse(value?.doneAt??doneAt(parent,link.item))+1,causalAt(parent,seen)+1);
 };
 const ready=(card:ZoeCard)=>{const link=follows(card),parent=link?byId.get(link.cardId):undefined;return !link||!parent||parent.outcome[link.item]!==undefined;};
 const open=shownCards.filter(card=>!((card.kind==='next_step'||card.kind==='tests_needed')&&card.state==='done')&&(card.valid&&card.kind==='visit'&&card.snapshot.living||card.state!=='done'||!cardTurns(card,journeyEnabled).length)&&ready(card));
 // Nurse messages and notices have a time here too, so an action never lands above a newer one. withCards keeps its old placement.
 const baseTime=entryAt(item=>item.kind==='nurse'||item.kind==='notice'?Date.parse(item.at):at(item));
 const time=(e:DialogEntry)=>e.type==='card'?causalAt(e.card):e.type==='turn'?Math.max(baseTime(e),causalAt(e.card)):baseTime(e);
 return dialogOrder<DialogEntry>(cardsAt(items,open,time),turns,{at:time,writing:e=>e.type==='item'&&e.item.kind==='pending'});
}

/**
 * The thread without Zoe's fixed "on the card here" reply to a request whose card opened, is opening or is about to (opened: the
 * request's seq), where the card itself is the answer. Every other reply stays, so no request goes unanswered.
 */
export function withoutCardReplies(items:readonly ChatItem[],opened:ReadonlySet<number>):readonly ChatItem[]{
 if(!opened.size)return items;
 const replies=Object.values(TASK_REPLY) as string[];
 let request:string|null=null;
 return items.filter(item=>{
  if(item.kind==='member')request=item.key;
  return !(item.kind==='answer'&&replies.includes(item.text)&&request!==null&&opened.has(Number(request.slice(1))));
 });
}

/**
 * The card Zoe offers for the member's newest message, when the database says Zoe's pipeline cleared it (clearedSeq)
 * and its words ask for one. Never for any other message, and nothing opens until the member taps.
 */
export function cardOffer(thread:Pick<ZoeThread,'messages'>,cards:Pick<ZoeCards,'enabled'|'clearedSeq'|'readingSeq'>):{kind:CardKind;seq:number}|null{
 if(!cards.enabled)return null;
 const newest=thread.messages.at(-1);
 if(!newest)return null;
 // A message that is a reading, or asks to log one, opens the BP card under the wider rule; the server fills in the numbers.
 if(newest.seq===(cards.readingSeq??cards.clearedSeq)&&(typedReading(newest.text)||cardIntent(newest.text)==='bp'))return {kind:'bp',seq:newest.seq};
 if(newest.seq!==cards.clearedSeq)return null;
 const kind=cardIntent(newest.text);
 return kind?{kind,seq:newest.seq}:null;
}

/**
 * A poll's cards over the ones on screen. A card's recorded items only grow and a done card stays done, so the one
 * with more recorded is the newer: a poll that started before an action finished never puts back the older card.
 */
function newerCard(a:ZoeCard,b:ZoeCard):ZoeCard{
 if(b.kind==='visit'&&!b.valid)return b;
 if(a.valid&&b.valid&&a.kind==='visit'&&b.kind==='visit'&&a.snapshot.living&&b.snapshot.living){
  return a.snapshot.living.revision>b.snapshot.living.revision?a:b;
 }
 return Object.keys(a.outcome).length>Object.keys(b.outcome).length||(a.state==='done'&&b.state!=='done')?a:b;
}
export function mergeCards(shown:ZoeCards,next:ZoeCards):ZoeCards{
 let clearedAt=shown.emergencyClearedAt;
 if(next.emergencyClearedAt&&(!clearedAt||emergencyWasCleared({at:clearedAt},next.emergencyClearedAt)))clearedAt=next.emergencyClearedAt;
 const byId=new Map(shown.cards.map(c=>[c.id,c]));
 const cards=next.cards.map(c=>{
  const s=byId.get(c.id),merged=s?newerCard(s,c):c;
  // Empty or stale polls cannot clear a later action. Only the persisted explicit-clear time is authoritative.
  const red=redOutcome(merged);
  return red&&emergencyWasCleared(red,clearedAt)?{...merged,outcome:{...merged.outcome,emergencyCleared:true}}:merged;
 });
 // A card just opened on screen that the poll does not have yet stays.
 for(const c of shown.cards)if(!next.cards.some(n=>n.id===c.id)){
  // V3 reminders are authoritative reads of the current confirmed publication. A newer plan may
  // have hidden this card; the ordinary grace period must not keep its old prescription actionable.
  if(c.valid&&c.kind==='dose'&&c.snapshot.v3&&c.state==='open')continue;
  const red=redOutcome(c);
  if(red){if(!red.cleared&&!emergencyWasCleared(red,clearedAt))cards.push(c);}
  else if(Date.now()-Date.parse(c.at)<60_000)cards.push(c);
 }
 return {...next,cards,...(clearedAt!==undefined?{emergencyClearedAt:clearedAt}:{})};
}

/** One card into the shown list (an action's answer); the offer it answered goes away. */
export function upsertCard(shown:ZoeCards,card:ZoeCard):ZoeCards{
 const cards=shown.cards.some(c=>c.id===card.id)?shown.cards.map(c=>c.id===card.id?newerCard(c,card):c):[...shown.cards,card];
 return {...shown,cards,clearedSeq:card.sourceSeq!==null&&card.sourceSeq===shown.clearedSeq?null:shown.clearedSeq,readingSeq:card.sourceSeq!==null&&card.sourceSeq===shown.readingSeq?null:shown.readingSeq};
}

/** Everyday menu views are separate cards; a generic menu remains its own kind. */
export const cardKeyOf = (card: ZoeCard): string => card.valid && card.kind === 'menu' && card.snapshot.view ? `menu:${card.snapshot.view}` : card.kind;
