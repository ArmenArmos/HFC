import 'server-only';
import {requireRegistered} from '@/lib/patient/repository';
import {patientPresentation} from '@/lib/patient/presentation';
import {getMemberPricing} from '@/lib/pilot-commerce/member';
import {memberBookingContext} from '@/lib/real-booking/repository';
import {readZoeConsents} from '@/lib/zoe/member';
import {readJourneyStage} from '@/lib/patient/journey-read';
import {parseStoredCard,serviceRpc} from './server';
import {chatNextStep,testsNeeded,type NextStep} from './next-step';
import {stepRequestId} from './next-step-id';
import {cardSchema,type ZoeCards,type Snapshot} from './registry';
import {ZONE_RULES_V1} from '@/lib/clinical/zones/config-v1';
import {yerevanToday} from '@/lib/member-history/measures';
import {openFlags,redOutcome} from './bp-flow';
import {testById} from '@/lib/clinical/seed/tests';

/** Shared member reads, exactly as Home. Failed required reads never invent an earlier stage. */
export async function readChatNextStep(cards:ZoeCards):Promise<{memberId:string;step:NextStep}|null>{
 if(!cards.enabled)return null;
 const [member,consents]=await Promise.all([requireRegistered(),readZoeConsents()]);
 const {assessment}=member;
 if(!assessment.completedAt||patientPresentation(assessment).urgent||!consents?.readsMessages||openFlags(cards.cards)||cards.cards.some(c=>{const red=redOutcome(c);return red&&!red.cleared;}))return null;
 const current=await readJourneyStage(member);
 if(!current)throw Error('Next step unavailable');
 return {memberId:current.memberId,step:chatNextStep(current.input,current.options)};
}

/** Booking already removes proven fresh tests using the member’s saved results and document receipts. */
export async function readTestsNeeded(){
 const [{engine},pricing]=await Promise.all([memberBookingContext(),getMemberPricing()]);
 const snapshot=testsNeeded(engine.tests.map(t=>({id:t.id,title:t.title,method:t.method as 'lab'|'clinic'|'home-log'})),[],yerevanToday(new Date()));
 return {...snapshot,...(pricing?{pricing:{catalog:pricing.catalog}}:{}),rows:snapshot.rows.map(row=>{const name=testById(row.id)?.name;return {...row,name:{hy:name?.hy??row.title,en:name?.en??row.title,ru:name?.ru??row.title}};})};
}

/** Reconcile on page load/poll. Stable stage ids and a compare-and-swap protect retries and stale overlapping polls. */
export async function reconcileNextStep(cards:ZoeCards):Promise<ZoeCards>{
 try{
  const current=await readChatNextStep(cards);
  if(!current)return cards;
  const rpc=serviceRpc();if(!rpc)throw Error('Next step unavailable');
  const prior=cards.cards.filter(c=>c.kind==='next_step').sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.at.localeCompare(a.at)||b.id.localeCompare(a.id))[0];
  const raw=await rpc('zoe_v3_next_step_sync',{p_member:current.memberId,p_request:stepRequestId(current.memberId,current.step),p_previous:prior?.id??null,p_seen:[...cards.cards].sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.at.localeCompare(a.at))[0]?.at??new Date(0).toISOString(),p_snapshot:current.step}) as {ok?:boolean;card?:unknown;cards?:unknown};
  const card=parseStoredCard(raw?.card);if(!raw?.ok||!card)throw Error('Next step unavailable');
  // The service projection follows this stage's saved request ids, independently of history pagination.
  const targets=cardSchema.array().parse(raw.cards);
  const recovered=[card,...targets];
  const ids=new Set(recovered.map(c=>c.id));
  const closed=cards.cards.map(c=>c.kind==='next_step'&&c.id!==card.id&&c.state==='open'?cardSchema.parse({...c,state:'done',outcome:{...c.outcome,replaced:{}}}):c);
  const leaf=targets.at(-1)??card;
  if((leaf.kind==='next_step'||leaf.kind==='tests_needed')&&leaf.outcome[leaf.kind])throw Error('Next step unavailable');
  return {...cards,cards:[...closed.filter(c=>!ids.has(c.id)),...recovered],nextStepStatus:leaf.state==='done'?'waiting':undefined};
 }catch{return {...cards,nextStepStatus:'unavailable'};}
}
/** Missing baseline labs are logistics only. No clinical text or values enter this task. */
export async function queueMissingTests(memberId:string,requestId:string,snapshot:Snapshot<'tests_needed'>){
 if(!snapshot.rows.some(r=>r.method==='lab'&&!r.fresh))return true;
 const rpc=serviceRpc();if(!rpc)return false;
 try{const r=await rpc('care_queue_raise',{p_member:memberId,p_queue:'admin',p_zone:null,p_reason:'missing_baseline_labs',p_rule_version:ZONE_RULES_V1.version,p_red_flags:null,p_action:'book',p_summary:{},p_sla:null,p_source_ref:requestId}) as {ok?:boolean};return r?.ok===true;}catch{return false;}
}
