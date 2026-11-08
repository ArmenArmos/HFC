'use server';
import {createHash} from 'node:crypto';
import {after} from 'next/server';
import {z} from 'zod';
import {memberChatOnlyEnabled} from '@/lib/patient/member-chat-config';
import {medicinesCardEnabled,zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {loggedAction} from '@/lib/observability/with-logging';
import {answerMedicineAsk,tickMyMedicine} from '@/lib/member-medicines/actions';
import {readMemberMedicines,readMemberMedicineAsks} from '@/lib/member-medicines/server';
import {recordMeasurement} from '@/app/patient/actions';
import {reportDose} from '@/app/patient/care/actions';
import {getCareData} from '@/lib/patient-care/repository';
import {dosesForDay} from '@/lib/patient-care/model';
import {recordBpWeekReading} from '@/lib/bp-week/actions';
import {isFutureMeasurement} from '@/lib/patient/measured-at';
import {answerMemberProposal} from '@/lib/real-booking/appointment-actions';
import {openUrgentIfRed,sendZoeChatMessage} from '@/app/patient/zoe/chat-actions';
import type {ZoeSendResult} from '@/lib/zoe/app-chat-contracts';
import {noActor,sessionActor} from './actor';
import {ASK_REASONS,type AskReason} from '@/lib/member-medicines/ask-copy';
import {acceptVisit,answerDoseAsk,claim,logBp,logDose,logRepeat,openCard,ownCard,record,type CardPorts,type CardResult} from './commands';
import {buildSnapshot,claimCard,serviceRpc,typedFromMessage,postCard,readZoeCard,readZoeCards,recordCard,releaseCard,routeSideEffectToNurse} from './server';
import {RED_FLAG_QUESTIONS} from './bp-flow';
import {answerRedFlag,runBpFlow,type FlowPorts} from './bp-flow-server';
import {readMemberBpWeek} from '@/lib/bp-week/server';
import {CARD_KINDS,FLOW_KINDS,MEMBER_SETTINGS_KINDS,V3_NEXT_STEP_KINDS,RESULT_PAGES,type ZoeCard,type ZoeCards} from './registry';
import {SIDE_EFFECTS,sideEffectMessage} from './copy';

/**
 * The Zoe chat cards' actions. Each write goes through the feature's own action (its auth, database checks and
 * idempotency), after the member confirmed it on the card; the card then records what was done, once. A retry with
 * the same ids is safe: the feature replays or reports the same state, and the card records the same value again.
 */

type Result=CardResult&{send?:ZoeSendResult['status']};
/** The member's own session reads and writes each feature, as its page does. */
const appPorts:CardPorts={post:postCard,claim:claimCard,record:recordCard,readCard:readZoeCard,readCards:readZoeCards,snapshot:(kind,input)=>buildSnapshot(kind,new Date(),input?.page,input?.askId,input?.typed),readMedicines:readMemberMedicines,readAsks:readMemberMedicineAsks,tickDose:tickMyMedicine,
 readPlanDoses:()=>getCareData().then(care=>dosesForDay(care,new Date()),()=>null),
 // The care page's own report: its schedule check, its revision check. Not current for the plan reads as stale.
 tickPlanDose:async v=>{
  const r=await reportDose(v.medicationId,v.dueAt,v.status,v.planId,v.revision);
  return {status:r.ok?'saved':'reason'in r&&r.reason==='conflict'?'conflict':'reason'in r||'error'in r?'unavailable':'not-due'};
 },
 readBpWeek:()=>readMemberBpWeek(),
 saveBpWeek:v=>recordBpWeekReading(v),
 saveBp:async({pulse,...v})=>{
  const m=await recordMeasurement({...v,...(pulse===null?{}:{pulse})});
  return {status:m.ok?'saved':m.reason==='conflict'?'conflict':'failed',...('bp'in m?{bp:m.bp}:{})};
 },
 answerAsk:v=>answerMedicineAsk(v),
 acceptProposal:async({commandId,proposalId})=>{
  const form=new FormData();
  form.set('commandId',commandId);form.set('proposalId',proposalId);form.set('accept','true');
  const r=await answerMemberProposal({ok:false},form);
  return {ok:r.ok,code:r.code};
 }};

const flowPorts=():FlowPorts=>({rpc:serviceRpc(),post:postCard,readCards:readZoeCards});
/** The new chat alone runs the flow, so no card reaches a chat that cannot show it. */
const flowOn=()=>zoeAppV3Enabled()&&process.env.NOREON_MEMBER_CHAT_V2==='true';
const appFlowPorts:CardPorts={...appPorts,afterBp:(memberId,saved)=>flowOn()?runBpFlow(flowPorts(),memberId,saved):Promise.resolve(null)};

/** The card's recorded send, if any (one per card: sending closes it). */
const sentItem=(card:ZoeCard)=>Object.entries(card.outcome).find(([k])=>k.startsWith('sent:'))?.[1] as {what?:string;urgent?:boolean}|undefined;

/** The cards for the chat's polling (also a GET route; this one for the page after an action). */
export const readMyZoeCards=loggedAction('readMyZoeCards',async function readMyZoeCards():Promise<ZoeCards>{
 return readZoeCards();
});

const openInput=z.strictObject({requestId:z.uuid(),kind:z.enum(CARD_KINDS),sourceSeq:z.number().int().positive().nullable(),reuseCurrent:z.boolean().optional(),page:z.number().int().min(0).max(RESULT_PAGES-1).optional(),askId:z.uuid().optional()});
/** Zoe posts a card (the shared command, openCard), for the signed-in member. */
export const openZoeCard=loggedAction('openZoeCard',async function openZoeCard(input:unknown):Promise<Result>{
 const parsed=openInput.safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 if(parsed.data.kind==='account'&&!memberChatOnlyEnabled())return {status:'disabled'};
 if(parsed.data.kind==='medicines'&&!medicinesCardEnabled())return {status:'disabled'};
 // WP F: the caregiver and consents cards are new-chat only; their own switches are checked where the snapshot is built.
 if(MEMBER_SETTINGS_KINDS.includes(parsed.data.kind)&&!zoeAppV3Enabled())return {status:'disabled'};
 if(['profile','document','prep','fasting','symptom_gate','consult_questions'].includes(parsed.data.kind)&&!zoeAppV3Enabled())return {status:'disabled'};
 if(parsed.data.kind==='prep'||parsed.data.kind==='fasting')return {status:'invalid'}; // Scheduled from a live appointment only.
 if(V3_NEXT_STEP_KINDS.includes(parsed.data.kind)&&!flowOn())return {status:'disabled'};
 if(parsed.data.kind==='next_step')return {status:'invalid'};
 if(FLOW_KINDS.includes(parsed.data.kind))return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 return openCard(who,appPorts,{...parsed.data,...(parsed.data.kind==='bp'&&parsed.data.sourceSeq!==null?await typedFromMessage(parsed.data.sourceSeq):{})});
});

const doseInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),medicineId:z.uuid(),dueAt:z.iso.datetime({offset:true}),status:z.enum(['taken','skipped'])});
/** Marks a dose shown on the card (the shared command, logDose), for the signed-in member. */
export const logDoseFromCard=loggedAction('logDoseFromCard',async function logDoseFromCard(input:unknown):Promise<Result>{
 // The V3 reminder/reason flow is not built in this slice. Never fall through to legacy dose writes.
 if(zoeAppV3Enabled())return {status:'disabled'};
 const parsed=doseInput.safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 return logDose(who,appPorts,parsed.data);
});

const bpInput=z.strictObject({cardId:z.uuid(),submissionId:z.uuid(),systolic:z.number().int(),diastolic:z.number().int(),pulse:z.number().int().nullable(),measuredAt:z.iso.datetime({offset:true}),photoConfirmed:z.boolean().optional()});
/** Saves the reading the member confirmed (the shared command, logBp), for the signed-in member. */
export const recordBpFromCard=loggedAction('recordBpFromCard',async function recordBpFromCard(input:unknown):Promise<Result>{
 const parsed=bpInput.safeParse(input);
 if(!parsed.success||isFutureMeasurement(parsed.data.measuredAt))return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 return logBp(who,appFlowPorts,parsed.data);
});

/** Saves the second reading from the repeat card (the shared command, logRepeat), for the signed-in member. */
export const recordRepeatFromCard=loggedAction('recordRepeatFromCard',async function recordRepeatFromCard(input:unknown):Promise<Result>{
 const parsed=bpInput.safeParse(input);
 if(!parsed.success||isFutureMeasurement(parsed.data.measuredAt))return {status:'invalid'};
 if(!flowOn())return {status:'disabled'};
 const who=await sessionActor();
 if(!who)return noActor();
 return logRepeat(who,appFlowPorts,parsed.data);
});

const flagInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),question:z.enum(RED_FLAG_QUESTIONS),answer:z.boolean(),locale:z.enum(['hy','en','ru'])});
/** One safety answer. The rules decide; nothing here reads words. The message goes through the chat's own send. */
export const answerRedFlagFromCard=loggedAction('answerRedFlagFromCard',async function answerRedFlagFromCard(input:unknown):Promise<Result>{
 const parsed=flagInput.safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 if(!flowOn())return {status:'disabled'};
 const who=await sessionActor();
 if(!who)return noActor();
 return answerRedFlag(who,{...flowPorts(),readCard:readZoeCard,claim:claimCard,record:recordCard,send:async(requestId,text)=>{
  // The 103 card already stands from the saved outcome, so a redirect to the 103 page would only take the member off it.
  return sendZoeChatMessage(requestId,text,false,true);
 }},parsed.data);
});

const visitInput=z.strictObject({cardId:z.uuid(),commandId:z.uuid(),proposalId:z.uuid().optional()});
/** Accepts the time the clinic proposed (the shared command, acceptVisit), for the signed-in member. */
export const acceptVisitFromCard=loggedAction('acceptVisitFromCard',async function acceptVisitFromCard(input:unknown):Promise<Result>{
 const parsed=visitInput.safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 const result=await acceptVisit(who,appPorts,parsed.data);
 if(result.status==='ok'&&result.card?.valid&&result.card.kind==='visit'&&result.card.snapshot.living){
  try{
   const {syncLivingVisit}=await import('./living-visit-read');
   const card=await syncLivingVisit(serviceRpc(),who.memberId);
   if(card?.id===result.card.id)return {...result,card};
  }catch{ /* The acceptance is saved; a later poll retries the status read. */ }
 }
 return result;
});

const askInput=z.strictObject({cardId:z.uuid(),opId:z.uuid(),reason:z.enum(ASK_REASONS as [AskReason,...AskReason[]])});
/** Answers a missed-dose ask posted as a card (the shared command, answerDoseAsk), for the signed-in member. */
export const answerAskFromCard=loggedAction('answerAskFromCard',async function answerAskFromCard(input:unknown):Promise<Result>{
 const parsed=askInput.safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 return answerDoseAsk(who,appPorts,parsed.data);
});

const isRedirect=(error:unknown)=>typeof error==='object'&&error!==null&&String((error as {digest?:unknown}).digest??'').startsWith('NEXT_REDIRECT');
/** After the 103 screen opened: the card shows where its text went, if the card can still take it. Best effort. */
async function noteUrgent(kind:'side_effect'|'message',cardId:string,item:string,requestId:string,payload:Record<string,unknown>){
 const who=await sessionActor();
 const card=who&&await ownCard(appPorts,cardId,kind);
 if(!who||!card)return;
 const c=await claimCard(who.memberId,card.id,item,requestId,payload);
 if(!c.ok)return;
 await recordCard(who.memberId,card.id,item,{requestId:c.claim.op,...('what'in payload?{what:payload.what}:{}),urgent:true},true);
 if(c.claim.attempt)await releaseCard(who.memberId,card.id,c.claim.attempt);
}

const sendInput=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('side_effect'),cardId:z.uuid(),requestId:z.uuid(),locale:z.enum(['hy','en','ru']),what:z.enum(SIDE_EFFECTS),detail:z.string().max(1000)}),
 z.strictObject({kind:z.literal('message'),cardId:z.uuid(),requestId:z.uuid(),text:z.string().max(4096)}),
]);
const sendClaim=z.union([
 z.strictObject({locale:z.enum(['hy','en','ru']),what:z.enum(SIDE_EFFECTS),detail:z.string().max(1000)}),
 z.strictObject({text:z.string().max(4096)}),
]);
/**
 * Sends the side effect or message to the care team as the member's own message in their conversation, through the
 * chat's own send: Zoe's safety checks run first exactly as for typed text (urgent words open the 103 screen), then
 * care-alert screening, the pipeline and the doctor, as with "Write to your doctor". The first claim's request id and
 * text are the ones sent, so a second tab or a retry replays the same message (conversation_receive is idempotent).
 */
export const sendFromCard=loggedAction('sendFromCard',async function sendFromCard(input:unknown):Promise<Result>{
 const parsed=sendInput.safeParse(input);
 if(!parsed.success)return {status:'invalid'};
 const v=parsed.data;
 // The claim is keyed by the exact text (Astra ZCA-04): the same text from another tab or a retry replays one send; an
 // edited text after a failed send is its own claim, so what the member confirmed is exactly what the chat screens and sends.
 const payload=v.kind==='side_effect'?{locale:v.locale,what:v.what,detail:v.detail}:{text:v.text};
 const confirmed=v.kind==='side_effect'?sideEffectMessage(v.locale,v.what,v.detail):v.text;
 const item=`sent:${createHash('sha256').update(confirmed).digest('hex').slice(0,32)}`;
 // Red wins over the card (test gap 1): urgent words open the 103 screen before anything below can answer busy, closed
 // or unavailable, or wait on the session. The card notes it afterwards where it can (gap 2). The id is the card's and
 // the text's, not the client's, so two tabs sending the same urgent text store it once (Astra TG-R2).
 const urgentId=createHash('sha256').update(`${v.cardId}:${item}`).digest('hex').replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,'$1-$2-5$3-8$4-$5');
 try{await openUrgentIfRed(urgentId,confirmed,true);}
 catch(error){
  if(isRedirect(error))after(()=>noteUrgent(v.kind,v.cardId,item,urgentId,payload));
  throw error;
 }
 const who=await sessionActor();
 if(!who)return noActor();
 const card=await ownCard(appPorts,v.cardId,v.kind);
 if(!card)return {status:'invalid'};
 if(v.kind==='side_effect'&&v.what==='other'&&!v.detail.trim())return {status:'invalid',card};
 if(sentItem(card)&&!card.outcome[item])return {status:'closed',card};
 const c=await claim(who,appPorts,card,item,v.requestId,payload);
 if(!c.ok)return c.result;
 if(card.outcome[item]!==undefined)return {status:'ok',card};
 const p=sendClaim.safeParse(c.claim.payload);
 if(!p.success)return {status:'invalid',card};
 const text='text'in p.data?p.data.text:sideEffectMessage(p.data.locale,p.data.what,p.data.detail);
 // Never send anything but the text this member confirmed.
 if(text!==confirmed)return {status:'stale',card};
 const requestId=c.claim.op;
 const value='what'in p.data?{requestId,what:p.data.what}:{requestId};
 // No lease: this text was sent (or the card closed) since the card was read; nothing goes out again.
 const attempt=c.claim.attempt;
 if(!attempt){const now=await ownCard(appPorts,card.id,v.kind);return now?.outcome[item]!==undefined?{status:'ok',card:now}:{status:'closed',card:now??card};}
 // The lease is held until this attempt is settled (Astra ZCA-POST-01): no other text from this card starts meanwhile.
 let opening=false;
 try{
  let sent:ZoeSendResult;
  try{sent=await sendZoeChatMessage(requestId,text,true);}
  catch(error){
   // Urgent words: the chat's send is opening the 103 screen. The redirect goes on now; the card notes it and lets go of
   // its lease afterwards, so neither can hold the screen (test gap 2). A lease left behind expires after 15 minutes.
   if(isRedirect(error)){
    opening=true;
    after(async()=>{await recordCard(who.memberId,card.id,item,{...value,urgent:true},true);await releaseCard(who.memberId,card.id,attempt);});
   }
   throw error;
  }
  if(sent.status==='sent'){
   const done=await record(who,appPorts,card,item,value,true);
   // Stored and past the urgent path. The doctor has it whatever happens here.
   if('what'in value&&value.what)await routeSideEffectToNurse(value.what,requestId);
   return done;
  }
  // Definitely not stored (the chat refused it): the member may edit and send another text from this card. A transient
  // 'failed' may have been stored, so only the same text may be sent again (it replays the same request id).
  if(sent.status!=='failed')await recordCard(who.memberId,card.id,`fail:${item.slice(5)}`,{status:sent.status},false);
  return {status:sent.status==='empty'||sent.status==='too_long'?'invalid':sent.status==='rate_limited'?'rate_limited':sent.status==='failed'?'failed':'unavailable',card,send:sent.status};
 }finally{if(!opening)await releaseCard(who.memberId,card.id,attempt);}
});
