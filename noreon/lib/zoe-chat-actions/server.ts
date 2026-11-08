import 'server-only';
import {createClient as createServiceClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {createClient} from '@/lib/supabase/server';
import {sideEffectNurseFirstEnabled,sideEffectRoute} from '@/lib/member-medicines/side-effect-routing';
import type {SideEffect} from './copy';
import {loadMemberMedicines} from '@/lib/member-medicines/server';
import {todaysDoses,yerevanDate,type MemberMedicinesRead} from '@/lib/member-medicines/model';
import {memberLdl} from '@/lib/ldl/member';
import {readMemberBpWeek} from '@/lib/bp-week/server';
import {currentWeek,nextSlot,weekSummary,type BpWeekRead} from '@/lib/bp-week/model';
import {currentPatientPublishedReview} from '@/lib/patient-care/current-published-review';
import {currentPublishedSourceRows,type CurrentPublishedReview} from '@/lib/patient-care/published-review';
import {getCareData} from '@/lib/patient-care/repository';
import {armeniaDate,dosesForDay} from '@/lib/patient-care/model';
import type {DueDose} from '@/lib/patient-care/types';
import {medicineAskSchema,type MedicineAsk} from '@/lib/member-medicines/asks';
import {doctorCompletionEnabled} from '@/lib/doctor-completion/config';
import {readMemberDocuments,readMemberPlanVersions,type DocumentRpc} from '@/lib/doctor-completion/document-runtime';
import {getMemberAppointmentSummary} from '@/lib/real-booking/appointment-repository';
import {memberChatOnlyEnabled} from '@/lib/patient/member-chat-config';
import {readV3Plan,readConfirmedPlanDoses} from './plan-read';
import {medicinesCardEnabled,zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {verifyLiveMarker,verifyVoiceReceipt} from './voice-receipt';
import type {TypedBp} from './commands';
import {typedReading} from './typed-reading';
import {readMedicines} from './medicines-read';
import {readAccountSettings} from './account-read';
import {z} from 'zod';
import {findLivingVisit} from './living-visit';
import {log,errorFields} from '@/lib/observability/logger';
import {memberTasks,redOutcome,withOpenEmergencies,RED_FLAG_QUESTIONS,flagItem} from './bp-flow';
import {SAMS_QUESTIONS,samsItem} from './dose-flow';
import {cardSchema,cardsReadSchema,MEMBER_SETTINGS_KINDS,V3_LAB_CARD_KINDS,V3_NEXT_STEP_KINDS,NO_CARDS,RESULT_PAGES,SNAPSHOTS,urgentHoldResult,type CardKind,type Snapshot,type ZoeCard,type ZoeCards} from './registry';

/**
 * Server side of the Zoe chat cards. Snapshots are built here from the member's own reads (the same reads and
 * filters as each feature's page), and stored with the service role so a member can never write a snapshot of
 * their own. The member's own session reads the cards back (zoe_chat_cards_member, auth.uid()).
 */

export type Rpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export function serviceRpc(env:Record<string,string|undefined>=process.env):Rpc|null{
 const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return null;
 const client=createServiceClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 return async(name,args)=>{
  const {data,error}=await client.rpc(name as keyof Database['public']['Functions'],args as never);
  if(error)throw Error(`Zoe card database unavailable (${error.code??'rpc'})`);
  return data;
 };
}

/** The member's cards and the message a typed card may open from; off or unreadable reads as no cards. */
export async function readZoeCards():Promise<ZoeCards>{
 let visitStatusUnavailable=false,syncDisabled=false;
 const unavailable=():ZoeCards=>zoeAppV3Enabled()?{...NO_CARDS,enabled:true,nextStepStatus:'unavailable',...(visitStatusUnavailable?{visitStatusUnavailable}:{})}:NO_CARDS;
 try{
  const client=await createClient();
  let living:ZoeCard|null=null;
  if(zoeAppV3Enabled()&&process.env.NOREON_MEMBER_CHAT_V2==='true'){
   const {syncLivingVisit}=await import('./living-visit-read');
   const {data:{user}}=await client.auth.getUser();
   if(user){try{living=await syncLivingVisit(serviceRpc(),user.id,()=>{syncDisabled=true;});}catch(error){visitStatusUnavailable=true;log.error('living_visit.sync_failed',errorFields(error));}}
  }
  const {data,error}=await client.rpc('zoe_chat_cards_member');
  if(error)return unavailable();
  const parsed=cardsReadSchema.safeParse(data);
  if(!parsed.success)return unavailable();
  if(!parsed.data.enabled)return NO_CARDS;
  let cards=parsed.data.cards.filter(c=>zoeAppV3Enabled()||(!V3_NEXT_STEP_KINDS.includes(c.kind as CardKind)&&!V3_LAB_CARD_KINDS.includes(c.kind as CardKind)&&!MEMBER_SETTINGS_KINDS.includes(c.kind as CardKind)));
  if(living){const id=living.id;cards=[...cards.filter(c=>c.id!==id),living];}
  let emergencyAvailable=true;
  let emergencyClearedAt:string|null|undefined;
  if(zoeAppV3Enabled()){
   const {data:open,error:openError}=await client.rpc('zoe_bp_open_emergencies' as never);
   const emergency=z.object({cards:z.array(cardSchema),clearedAt:z.string().nullable()}).safeParse(open);
   // A failed read cannot claim a clear. The ordinary history remains available without that projection.
   emergencyAvailable=!openError&&emergency.success;
   if(!openError&&emergency.success){emergencyClearedAt=emergency.data.clearedAt;cards=withOpenEmergencies(cards,emergency.data.cards,emergencyClearedAt);}
   const {data:{user}}=await client.auth.getUser();
   if(user){
    const {retryRedMessages}=await import('./bp-flow-server');
    await retryRedMessages({rpc:serviceRpc(),send:async(requestId,text)=>{
     const {sendZoeChatMessage}=await import('@/app/patient/zoe/chat-actions');
     return sendZoeChatMessage(requestId,text,false,true);
    }},user.id);
   }
  }
  const tasks=await memberTasks(async()=>(await client.rpc('care_queue_member_tasks')).data);
  // A failed first sync may have no living card yet. Only a successful sync can confirm absence.
  // Not eligible (no case yet, or consent withdrawn) is quiet, unless a stored visit is on screen that can no longer refresh.
  if(syncDisabled&&findLivingVisit(cards))visitStatusUnavailable=true;
  const read:ZoeCards={enabled:true,cards,...(visitStatusUnavailable?{visitStatusUnavailable}:{}),...(emergencyClearedAt!==undefined?{emergencyClearedAt}:{}),clearedSeq:parsed.data.clearedSeq,readingSeq:parsed.data.readingSeq,...(tasks?{tasks}:{})};
  if(zoeAppV3Enabled()&&process.env.NOREON_MEMBER_CHAT_V2==='true'){if(!emergencyAvailable)return {...read,nextStepStatus:'unavailable'};const {reconcileNextStep}=await import('./next-step-read');return reconcileNextStep(read);}
  return read;
 }catch{return unavailable();}
}

/** The numbers on a BP card opened from a message: read from the stored message, never taken from the browser. */
export async function typedFromMessage(seq:number):Promise<{typed?:TypedBp}>{
 const client=await createClient();
 const {data,error}=await client.rpc('conversation_member_voice_receipt' as never,{p_seq:seq} as never);
 // A failed read must not turn a stored voice message into a permanently typed card.
 if(error)throw Error('Voice provenance unavailable');
 if(data===null)return {};
 const m=z.object({receipt:z.string().nullable(),memberId:z.string(),text:z.string(),at:z.string()}).parse(data);
 const typed=typedReading(m.text);
 if(!typed)return {};
 const voiceConfirmed=verifyVoiceReceipt(m.receipt,m.memberId,m.text,Date.parse(m.at));
 // WP V: a Live turn's server-signed marker labels the reading as Live-dictated (unverified, like a typed one).
 const live=!voiceConfirmed&&verifyLiveMarker(m.receipt,m.memberId,m.text,Date.parse(m.at));
 return {typed:{...typed,measuredAt:m.at,...(voiceConfirmed?{entrySource:'patient_voice_confirmed' as const}:live?{entrySource:'patient_voice_live_confirmed' as const}:{})}};
}

/** One stored card as the server answers it (the session read below, or a verified actor's zoe_chat_card_get). */
export const parseStoredCard=(data:unknown):ZoeCard|null=>{const parsed=cardSchema.safeParse(data);return parsed.success?parsed.data:null;};

/** One of the member's own cards (RLS: member_id is the caller), or null. */
export async function readZoeCard(id:string):Promise<ZoeCard|null>{
 try{
  const client=await createClient();
  const {data,error}=await client.from('zoe_chat_cards').select('id,request_id,kind,source,source_seq,snapshot,state,outcome,claims,created_at').eq('id',id).maybeSingle();
  if(error||!data)return null;
  const parsed=cardSchema.safeParse({id:data.id,requestId:data.request_id,kind:data.kind,source:data.source,sourceSeq:data.source_seq,snapshot:data.snapshot,state:data.state,outcome:data.outcome,claims:data.claims,at:data.created_at});
  return parsed.success?parsed.data:null;
 }catch{return null;}
}

export type StoreCode='busy'|'invalid'|'disabled'|'conflict'|'not_cleared'|'rate_limited'|'not_found'|'recorded'|'closed'|'unavailable';
type StoreResult={ok:true;card:ZoeCard;replayed:boolean}|{ok:false;code:StoreCode;card?:ZoeCard};
function storeResult(data:unknown):StoreResult{
 const r=data as {ok?:unknown;code?:unknown;replayed?:unknown;card?:unknown}|null;
 const card=r?.card?cardSchema.safeParse(r.card):null;
 if(r?.ok===true&&card?.success)return {ok:true,card:card.data,replayed:r.replayed===true};
 const code=typeof r?.code==='string'?r.code as StoreCode:'unavailable';
 return {ok:false,code,...(card?.success?{card:card.data}:{})};
}

export async function postCard(memberId:string,requestId:string,kind:CardKind,source:'chip'|'typed',sourceSeq:number|null,snapshot:unknown,rpc:Rpc|null=serviceRpc()):Promise<StoreResult>{
 if(!rpc)return {ok:false,code:'unavailable'};
 try{return storeResult(await rpc('zoe_chat_card_post',{p_member:memberId,p_request:requestId,p_kind:kind,p_source:source,p_source_seq:sourceSeq,p_snapshot:snapshot}));}
 catch{return {ok:false,code:'unavailable'};}
}

/** attempt: a send's lease (zoe_chat_card_claim); absent when the text was already sent and nothing goes out again. */
export type Claim={op:string;payload:Record<string,unknown>;attempt?:string};
/**
 * Claims one item of the member's card for one operation before its write (Astra ZCA-01). The first claim wins and
 * comes back to every later caller, who replays its op id and payload; both switches are checked here (ZCA-02).
 */
export async function claimCard(memberId:string,cardId:string,item:string,op:string,payload:Record<string,unknown>,rpc:Rpc|null=serviceRpc()):Promise<{ok:true;claim:Claim}|{ok:false;code:StoreCode;card?:ZoeCard}>{
 if(!rpc)return {ok:false,code:'unavailable'};
 try{
  const r=await rpc('zoe_chat_card_claim',{p_member:memberId,p_card:cardId,p_item:item,p_op:op,p_payload:payload}) as {ok?:unknown;code?:unknown;claim?:{op?:unknown;payload?:unknown};attempt?:unknown;card?:unknown}|null;
  if(r?.ok===true&&typeof r.claim?.op==='string'&&r.claim.payload&&typeof r.claim.payload==='object')return {ok:true,claim:{op:r.claim.op,payload:r.claim.payload as Record<string,unknown>,...(typeof r.attempt==='string'?{attempt:r.attempt}:{})}};
  const card=r?.card?cardSchema.safeParse(r.card):null;
  return {ok:false,code:typeof r?.code==='string'?r.code as StoreCode:'unavailable',...(card?.success?{card:card.data}:{})};
 }catch{return {ok:false,code:'unavailable'};}
}

/** Ends one send attempt (its own lease only), so another text on the card may go once this one is settled. */
export async function releaseCard(memberId:string,cardId:string,attempt:string):Promise<void>{
 const rpc=serviceRpc();
 if(!rpc)return;
 // A lease that is not released expires after 15 minutes; the send's outcome is already recorded either way.
 try{await rpc('zoe_chat_card_release',{p_member:memberId,p_card:cardId,p_attempt:attempt});}catch{}
}

/** Lets go of a claim whose write was definitely refused, so nothing was changed. Only the card kinds that retry a form. */
export async function unclaimCard(memberId:string,cardId:string,item:string,op:string,rpc:Rpc|null=serviceRpc()):Promise<boolean>{
 if(!rpc)return false;
 try{return (await rpc('zoe_chat_card_unclaim',{p_member:memberId,p_card:cardId,p_item:item,p_op:op}) as {ok?:unknown}|null)?.ok===true;}catch{return false;}
}

export async function recordCard(memberId:string,cardId:string,item:string,value:Record<string,unknown>,close:boolean,rpc:Rpc|null=serviceRpc()):Promise<StoreResult>{
 if(!rpc)return {ok:false,code:'unavailable'};
 try{return storeResult(await rpc('zoe_chat_card_record',{p_member:memberId,p_card:cardId,p_item:item,p_value:value,p_close:close}));}
 catch{return {ok:false,code:'unavailable'};}
}

// Snapshots: each from the same read and filter the feature's own screen uses. A read that fails reads as "not
// available here", with the page one tap away; never as an empty record presented as complete.

/**
 * The dose card's snapshot from the member's two lists, each read by the channel (their session, or a verified actor's
 * service read): their own medicines and the published plan's doses, the same list the medicines page shows. Each read
 * must be a real answer: either one failing throws, so no card looks complete with half a list (Astra M01-R1).
 */
export function doseSnapshotFrom(read:MemberMedicinesRead,plan:readonly DueDose[],now:Date):Snapshot<'dose'>{
 const date=yerevanDate(now);
 // As the Home card: the member's current rows, with today's kept times through a change (QA 118).
 const own=!read.enabled?[]:read.medicines.filter(m=>!m.stoppedAt).flatMap(m=>todaysDoses(m,now,read.medicines).map(s=>{
  const owner=read.medicines.find(x=>x.id===s.medicineId)??m;
  return {medicineId:s.medicineId,name:owner.name.slice(0,120),dose:owner.dose?.slice(0,120)??null,dueAt:s.dueAt,time:s.time,status:s.status,revision:s.revision};
 }));
 const planned=plan.map(d=>({medicineId:d.medication.id,name:d.medication.name.slice(0,120),dose:d.medication.dose.slice(0,120)||null,dueAt:d.dueAt,
  time:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(d.dueAt)),status:d.status,revision:d.revision??0,planId:d.medication.planId}));
 const slots=[...own,...planned].sort((a,b)=>a.dueAt.localeCompare(b.dueAt)||a.name.localeCompare(b.name)).slice(0,24);
 return {v:1,enabled:read.enabled||planned.length>0,date,slots};
}

/** The BP card's snapshot from the member's own reads, on either channel. */
export function bpSnapshotFrom(read:BpWeekRead|null,latest:Snapshot<'bp'>['latest'],now:Date,typed?:TypedBp):Snapshot<'bp'>{
 const week=read?currentWeek(read,now):null;
 const slot=week?nextSlot(week,now):null;
 const base={v:1 as const,...(latest===undefined?{}:{latest}),...(typed?{typed}:{})};
 // Only a slot due now: an upcoming one would put an early reading into the wrong slot.
 if(!week||!slot||(slot.state!=='due'&&slot.state!=='partial'))return {...base,week:null};
 const sum=weekSummary(week,now);
 return {...base,week:{weekId:week.id,date:slot.date,slot:slot.slot,time:slot.time,day:slot.day,days:week.days,saved:sum.saved,expected:sum.expected}};
}
/** The newest saved reading (RLS: the member's own); undefined when it could not be read, so the card just leaves it out. */
async function latestBp():Promise<Snapshot<'bp'>['latest']>{
 try{
  const client=await createClient();
  const {data,error}=await client.from('patient_measurements').select('systolic,diastolic,pulse,measured_at,entry_source').order('measured_at',{ascending:false}).limit(1).maybeSingle();
  if(error)return undefined;
  return data&&{systolic:data.systolic,diastolic:data.diastolic,pulse:data.pulse,measuredAt:data.measured_at,entrySource:data.entry_source as 'patient_text_entry'|'patient_photo_confirmed'|'patient_voice_confirmed'|'patient_voice_live_confirmed'|'caregiver_reported'|null};
 }catch{return undefined;}
}
async function bpSnapshot(now:Date,typed?:TypedBp):Promise<Snapshot<'bp'>>{
 return bpSnapshotFrom(await readMemberBpWeek().catch(()=>null),await latestBp(),now,typed);
}

/** The results as the page shows them, LDL first so it never falls off the first card; twelve at a time. */
export function resultsSnapshotFrom(publication:CurrentPublishedReview|null,reviewed:readonly {marker:string;value:unknown;unit:string|null;referenceText?:string|null;collectedAt:string}[],page=0):Snapshot<'results'>{
 const published=currentPublishedSourceRows(publication);
 const rows=published.length?published.map(r=>({name:r.source.name.slice(0,160),value:r.source.literal.slice(0,200),unit:r.source.unit,reference:r.source.reference,at:r.reportDate}))
  :[...reviewed].sort((a,b)=>b.collectedAt.localeCompare(a.collectedAt)).map(r=>({name:r.marker.slice(0,160),value:String(r.value).slice(0,200),unit:r.unit||null,reference:r.referenceText?.slice(0,160)??null,at:r.collectedAt}));
 const ldl=(name:string)=>/\bldl\b|ՑԽԼ|лпнп/iu.test(name);
 const ordered=[...rows.filter(r=>ldl(r.name)),...rows.filter(r=>!ldl(r.name))];
 const from=page*12;
 const left=Math.max(0,ordered.length-from-12),more=Math.min(left,(RESULT_PAGES-1-page)*12);
 return {v:1,available:true,publishedAt:published.length?publication?.publishedAt??null:null,rows:ordered.slice(from,from+12),more,...(page?{page}:{}),...(left>more?{older:left-more}:{})};
}
async function resultsSnapshotRows(page=0):Promise<Snapshot<'results'>>{
 // As the results page: the current publication's checked rows first, else the doctor-reviewed results.
 const publication=await currentPatientPublishedReview().catch(()=>undefined);
 if(publication===undefined)return {v:1,available:false,publishedAt:null,rows:[],more:0};
 if(currentPublishedSourceRows(publication??null).length)return resultsSnapshotFrom(publication??null,[],page);
 const care=await getCareData().catch(()=>null);
 if(!care)return {v:1,available:false,publishedAt:null,rows:[],more:0};
 return resultsSnapshotFrom(null,care.results,page);
}

/** Same audited, doctor-released PDF read as the Results page, under V3 only. */
async function resultsSnapshot(page=0):Promise<Snapshot<'results'>>{
 const rows=await resultsSnapshotRows(page);
 if(!zoeAppV3Enabled()||!doctorCompletionEnabled())return rows;
 const documents=await readMemberDocuments(await createClient() as unknown as DocumentRpc);
 return documents?{...rows,documents}:{v:1,available:false,publishedAt:null,rows:[],more:0};
}

/** The plan card's snapshot from a read of the published plan, on either channel. */
export function planSnapshotFrom(p:{id:string;version:number|null;clinician:string;publishedAt:string;instructions:string;medicines:readonly {name:string;dose:string;times:readonly string[]}[];acknowledged?:boolean}|null):Snapshot<'plan'>{
 return {v:1,available:true,plan:p&&{id:p.id,version:p.version,clinician:p.clinician.slice(0,200),publishedAt:p.publishedAt,instructions:p.instructions.slice(0,4000),
  medicines:p.medicines.slice(0,20).map(m=>({name:m.name.slice(0,200),dose:m.dose.slice(0,200),times:m.times.slice(0,8)})),...(p.acknowledged===undefined?{}:{acknowledged:p.acknowledged})}};
}
async function planSnapshot(now:Date):Promise<Snapshot<'plan'>>{
 if(zoeAppV3Enabled()){
  const read=await readV3Plan();
  if(!read)return {v:1,available:true,plan:null,v3:null};
  const {plan:p,details}=read;
  return {...planSnapshotFrom({id:p.id,version:details.version,clinician:details.clinician??'',publishedAt:p.publishedAt,
   instructions:p.publishedReview?.instructions??p.instructions,medicines:p.medications.filter(m=>m.active&&(!m.endDate||m.endDate>=armeniaDate(now))),acknowledged:!!details.teachBackConfirmedAt}),v3:details};
 }

 const care=await getCareData().catch(()=>null);
 if(!care)return {v:1,available:false,plan:null};
 const p=care.plan;
 if(!p)return {v:1,available:true,plan:null};
 let version:number|null=null;
 if(doctorCompletionEnabled()){
  const versions=await createClient().then(c=>readMemberPlanVersions(c as unknown as DocumentRpc)).catch(()=>null);
  version=versions?.find(v=>v.current&&v.planId===p.id)?.version??null;
 }
 // In force today, as the dose list reads it (test gap 6): the card shows no dates, so an ended course would read as current.
 return planSnapshotFrom({id:p.id,version,clinician:p.clinician,publishedAt:p.publishedAt,instructions:p.publishedReview?.instructions||p.instructions,medicines:p.medications.filter(m=>m.active!==false&&(!m.endDate||m.endDate>=armeniaDate(now))),acknowledged:!!(p.acknowledged||p.acknowledgedAt)});
}

type VisitAppointment={id:string;revision:number;status:string;current?:{startsAt:string;endsAt:string;mode:string;location:string}|null;portal?:{proposal?:{id:string;startsAt:string;endsAt:string;clinicName:string;clinicAddress:string}|null}|null};
/** The visit card's snapshot from the member's appointments, on either channel. */
export function visitSnapshotFrom(appointments:readonly VisitAppointment[],now:Date):Snapshot<'visit'>{
 const open=appointments.filter(a=>a.current&&a.status!=='cancelled'&&Date.parse(a.current.endsAt)>now.getTime())
  .sort((a,b)=>Date.parse(a.current!.startsAt)-Date.parse(b.current!.startsAt));
 const next=open[0]??null;
 const withProposal=appointments.find(a=>a.status!=='cancelled'&&a.portal?.proposal);
 const proposal=withProposal?.portal?.proposal??null;
 return SNAPSHOTS.visit.parse({v:1,available:true,
  next:next?{appointmentId:next.id,revision:next.revision,status:next.status,startsAt:next.current!.startsAt,endsAt:next.current!.endsAt,mode:next.current!.mode,location:next.current!.location.slice(0,1000)}:null,
  proposal:proposal&&withProposal?{appointmentId:withProposal.id,proposalId:proposal.id,startsAt:proposal.startsAt,endsAt:proposal.endsAt,clinicName:proposal.clinicName.slice(0,300),clinicAddress:proposal.clinicAddress.slice(0,1000)}:null,
  attention:appointments.some(a=>['failed','unknown','reconciliation'].includes(a.status))});
}
async function visitSnapshot(now:Date):Promise<Snapshot<'visit'>|z.infer<typeof urgentHoldResult>>{
 if(memberChatOnlyEnabled()||zoeAppV3Enabled()){
  const {readVisitBooking}=await import('./booking-read');
  const read=await readVisitBooking();
  if(read.hold==='urgent'||read.crisis)return {status:'held_urgent',call103:true};
  if(read.booking&&(read.booking.data.clinicalHold||read.booking.pilot.unavailableReason==='clinical-hold')){
   // Use the same saved, explicitly uncleared 103 cards as the thread. A historical reading is not a new alarm.
   const {data,error}=await (await createClient()).rpc('zoe_bp_open_emergencies' as never);
   if(error)throw Error('Emergency status is unavailable.');
   const open=z.object({cards:z.array(cardSchema),clearedAt:z.string().nullable()}).parse(data);
   // This RPC returns red entries only. An unreadable entry is not evidence that its alarm was cleared.
   // Parse every entry before using the absence of an uncleared red outcome as reassurance.
   const redAnswer=z.object({answer:z.literal(true),requestId:z.uuid(),text:z.string().min(1)});
   const alarms=open.cards.map(card=>{
    if(!card.valid||(card.kind!=='red_flags'&&card.kind!=='sams'))throw Error('Emergency status is unavailable.');
    z.object({emergencyCleared:z.boolean().optional()}).parse(card.outcome);
    const items:string[]=card.kind==='red_flags'?RED_FLAG_QUESTIONS.map(flagItem):SAMS_QUESTIONS.map(samsItem);
    for(const [item,value] of Object.entries(card.outcome)){
     if(!item.startsWith('a:'))continue;
     if(!items.includes(item))throw Error('Emergency status is unavailable.');
     const answer=z.object({answer:z.boolean(),zone:z.enum(['green','yellow','orange','red']).nullable().optional()}).parse(value);
     if((card.kind==='red_flags'&&answer.answer)||answer.zone==='red')redAnswer.parse(value);
    }
    const red=redOutcome(card);
    if(!red)throw Error('Emergency status is unavailable.');
    return z.object({requestId:z.uuid(),text:z.string().min(1),cleared:z.boolean()}).parse(red);
   });
   return {status:'held_urgent',call103:alarms.some(red=>!red.cleared)};
  }
  const summary=read.booking?visitSnapshotFrom(read.booking.pilot.appointments,now):{v:1 as const,available:false,next:null,proposal:null,attention:false};
  if(zoeAppV3Enabled()&&process.env.NOREON_MEMBER_CHAT_V2==='true'){
   const {syncLivingVisit}=await import('./living-visit-read');
   const {data:{user}}=await (await createClient()).auth.getUser();
   if(!user)throw Error('Visit status unavailable');
   const card=await syncLivingVisit(serviceRpc(),user.id);
   if(card?.valid&&card.kind==='visit')return {...card.snapshot,bookingToken:read.token,
    proposal:summary.proposal?.appointmentId===card.snapshot.living?.visitId?summary.proposal:null};
  }
  return {...summary,bookingToken:read.token};
 }
 const data=await getMemberAppointmentSummary().catch(()=>null);
 if(!data)return {v:1,available:false,next:null,proposal:null,attention:false};
 return visitSnapshotFrom(data.appointments as readonly VisitAppointment[],now);
}

async function ldlSnapshot():Promise<Snapshot<'ldl'>>{
 return {v:1,data:await memberLdl().catch(()=>undefined)??null};
}

/** The ask's card, built by whoever found the ask: the press on "missed", or the sweep. */
export const askSnapshotFrom=(a:MedicineAsk):Snapshot<'ask'>=>({v:1,askId:a.id,name:(a.medicine.name||'').slice(0,120),dueAt:a.dueAt,trigger:a.trigger});

/** The snapshot a new card of this kind carries, checked against its schema. */
export async function buildSnapshot(kind:CardKind,now=new Date(),page=0,askId?:string,typed?:TypedBp):Promise<unknown>{
 // WP F: the member's own caregiver links and consents, read with the member's session (the database scopes them).
 if(kind==='caregiver'||kind==='consents'){
  const [{caregiversEnabled},{memberConsentsEnabled}]=await Promise.all([import('@/lib/caregivers/schema'),import('@/lib/consents/schema')]);
  if(!zoeAppV3Enabled()||!(kind==='caregiver'?caregiversEnabled():memberConsentsEnabled()))throw Error('Member chat is disabled.');
  const {sessionCaregiverRpc,caregiverCardSnapshot}=await import('@/lib/caregivers/server');
  const rpc=await sessionCaregiverRpc();
  if(kind==='caregiver')return SNAPSHOTS.caregiver.parse(await caregiverCardSnapshot(rpc));
  const {consentsCardSnapshot}=await import('@/lib/consents/server');
  return SNAPSHOTS.consents.parse(await consentsCardSnapshot(rpc));
 }
 if(kind==='review'){if(!zoeAppV3Enabled())throw Error('Member chat is disabled.');return {v:1};}
 if(kind==='next_step')throw Error('Next steps are server posted.');
 if(kind==='tests_needed'){if(!zoeAppV3Enabled())throw Error('Member chat is disabled.');const {readTestsNeeded}=await import('./next-step-read');return readTestsNeeded();}
 if(kind==='medicines'||kind==='account'){
  if(!(kind==='medicines'?medicinesCardEnabled():memberChatOnlyEnabled()))throw Error('Member chat is disabled.');
  const data=kind==='medicines'?await readMedicines():await readAccountSettings();
  return SNAPSHOTS[kind].parse({v:1,token:data.token});
 }
 if(kind==='ask'){
  // The member's own, still open; a closed one opens no card, and the chat says it could not open.
  const client=await createClient();
  const {data,error}=await client.rpc('member_medicine_ask_mine' as never,{p_ask:askId} as never);
  const ask=error?null:medicineAskSchema.safeParse(data);
  if(!ask?.success)throw Error('This ask is no longer open.');
  return SNAPSHOTS.ask.parse(askSnapshotFrom(ask.data));
 }
 if(kind==='consult_questions'){if(!zoeAppV3Enabled())throw Error('Member chat is disabled.');return SNAPSHOTS.consult_questions.parse({v:1,appointmentId:null,groups:['symptoms','medicines','results'].map(label=>({label,text:''}))});}
 if(kind==='symptom_gate'){if(!zoeAppV3Enabled())throw Error('Member chat is disabled.');return SNAPSHOTS.symptom_gate.parse({v:1});}
 if(kind==='document'){
  if(!zoeAppV3Enabled())throw Error('Member chat is disabled.');
  const {data,error}=await (await createClient()).rpc('zoe_v3_document_read' as never,{} as never);
  if(error)throw Error('Document metadata is unavailable.');
  return SNAPSHOTS.document.parse(data);
 }
 if(kind==='profile'){
  const {getReminderPreferences}=await import('@/lib/patient-care/reminder-repository');
  const {preferences}=await getReminderPreferences();
  return SNAPSHOTS.profile.parse({v:1,wake:preferences.quietEnd,sleep:preferences.quietStart});
 }
 if(kind==='dose'&&zoeAppV3Enabled()){
  const doses=(await readConfirmedPlanDoses(now)).filter(d=>d.status==='due').slice(0,1);
  // Do not truncate the approved strings on this path.
  return SNAPSHOTS.dose.parse({v:1,v3:true,enabled:doses.length>0,date:armeniaDate(now),slots:doses.map(d=>({medicineId:d.medication.id,planId:d.medication.planId,name:d.medication.name,dose:d.medication.dose,dueAt:d.dueAt,time:new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(d.dueAt)),status:d.status,revision:d.revision??0}))});
 }
 const raw=kind==='dose'?doseSnapshotFrom(await loadMemberMedicines(),dosesForDay(await getCareData(),now),now):kind==='bp'?await bpSnapshot(now,typed):kind==='results'?await resultsSnapshot(page)
  :kind==='plan'?await planSnapshot(now):kind==='ldl'?await ldlSnapshot():kind==='visit'?await visitSnapshot(now):{v:1 as const};
 if(kind==='visit'){const held=urgentHoldResult.safeParse(raw);if(held.success)return held.data;}
 return SNAPSHOTS[kind].parse(raw);
}

/** Dizziness and nausea also give the assigned nurse a call task. Extra to the doctor's copy, so it never fails the send. */
export async function routeSideEffectToNurse(what:SideEffect,requestId:string):Promise<void>{
 if(!sideEffectNurseFirstEnabled()||sideEffectRoute(what)!=='nurse')return;
 try{
  const client=await createClient();
  const {error}=await (client as unknown as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{error:unknown}>}).rpc('member_side_effect_nurse_task',{p_what:what,p_request_id:requestId});
  if(error)console.error('Side effect nurse task failed');
 }catch{console.error('Side effect nurse task failed');}
}
