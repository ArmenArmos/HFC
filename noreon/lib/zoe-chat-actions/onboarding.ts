import 'server-only';
import {z} from 'zod';
import {ASK_REASONS} from '@/lib/member-medicines/ask-copy';
import type {MemberActor} from './actor';
import {bookingToken} from './booking';
import {claim,ownCard,record,type CardPorts,type CardResult} from './commands';
import type {MedicineRow,SavedProfile} from './thread';
import type {StopIntent} from './plan-followup';

const hhmm=z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const CAREGIVER_PHONE=/^\+?[0-9][0-9 ()-]{5,19}$/;
export const profileInputSchema=z.strictObject({cardId:z.uuid(),opId:z.uuid(),channel:z.enum(['voice','text']),wake:hhmm,sleep:hhmm,
 caregiver:z.strictObject({name:z.string().trim().min(1).max(80),phone:z.string().trim().regex(CAREGIVER_PHONE)}).nullable()}).refine(v=>v.wake!==v.sleep);
export type ProfileInput=z.infer<typeof profileInputSchema>;
type CardPort=Pick<CardPorts,'readCard'|'claim'|'record'>;

const profileClaim=z.object({channel:z.enum(['voice','text']),wake:hhmm,sleep:hhmm,caregiver:z.boolean(),proof:z.string().min(1)});
/** What a landed or replayed save says; the claim holds it, so the receipt is always the operation that was written. */
const receipt=(p:z.infer<typeof profileClaim>):SavedProfile=>({channel:p.channel,wake:p.wake,sleep:p.sleep,caregiver:p.caregiver});

/**
 * Saves the communication profile. The first claim owns the card: it holds this payload, with a keyed proof in place of
 * the caregiver's details, which never enter the card. The same payload again, from a retry or a second tab, repeats a
 * safe write. Different details change nothing: if the first save landed its receipt is recorded, otherwise this one is told so.
 */
export async function runProfileSave(actor:MemberActor,ports:CardPort&{proof(input:ProfileInput):string;landed(claim:{channel:string;wake:string;sleep:string;proof:string}):Promise<boolean>;save(input:ProfileInput):Promise<'saved'|'stale'|'failed'>},v:ProfileInput):Promise<CardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'profile');
 if(!card)return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 const proof=ports.proof(v);
 const c=await claim(actor,ports,card,'profile',v.opId,{channel:v.channel,wake:v.wake,sleep:v.sleep,caregiver:!!v.caregiver,proof});
 if(!c.ok)return c.result;
 const held=profileClaim.safeParse(c.claim.payload);
 if(!held.success)return {status:'invalid',card};
 if(held.data.proof!==proof){
  if(!await ports.landed(held.data).catch(()=>false))return {status:'stale',card};
  const r=await record(actor,ports,card,'profile',receipt(held.data),true);
  return {status:'stale',card:r.card??card};
 }
 const saved=await ports.save(v);
 if(saved!=='saved')return {status:saved,card};
 return record(actor,ports,card,'profile',receipt(held.data),true);
}

export const MEDICINE_STATUSES=['continuous','course_stopped','prn']as const;
export const STOP_REASONS=[...ASK_REASONS,'values_normal']as const;
const status=z.enum(MEDICINE_STATUSES),stopReason=z.enum(STOP_REASONS).nullable();
const chosen={stopReason,/** The member saw that reminders stop and said yes, on this card. */stopConfirmed:z.boolean()};
const line=<T extends z.ZodRawShape>(shape:T)=>z.strictObject({...shape,...chosen});
const reviewShape=z.strictObject({cardId:z.uuid(),opId:z.uuid(),
 changes:z.array(line({id:z.uuid(),status})).max(20),
 added:z.array(line({requestId:z.uuid(),name:z.string().trim().min(1).max(120),dose:z.string().trim().max(120),time:hhmm,status:status.nullable()})).max(20),
});
export const reviewInputSchema=reviewShape.refine(v=>v.changes.length+v.added.length>0&&[...v.changes,...v.added].every(x=>(!x.stopReason||x.status==='course_stopped')&&(x.status!=='course_stopped'||x.stopConfirmed)));
export type ReviewInput=z.infer<typeof reviewInputSchema>;
type ReviewStatus='saved'|'not-found'|'limit'|'invalid'|'disabled'|'unavailable';
type Review={status:ReviewStatus;rows?:MedicineRow[];stops?:StopIntent[];savedAt?:string};
type Current={enabled:boolean;token:string;names:ReadonlyMap<string,string>};
type ReviewPorts=CardPort&{unclaim(card:string,item:string,op:string):Promise<boolean>;current():Promise<Current>;save(v:Pick<ReviewInput,'changes'|'added'>,cardId:string):Promise<Review>;afterSave?:(rows:MedicineRow[],stops:StopIntent[])=>Promise<'none'|'sent'|'pending'>};
export type ReviewResult=CardResult&{review?:'limit';released?:boolean};
const heldReview=z.object({kind:z.literal('review'),digest:z.string(),changes:reviewShape.shape.changes,added:reviewShape.shape.added});

/**
 * Saves the list from the medicines card as one action: one member message, one reply, and the form leaves. The first
 * claim holds the whole list, and whatever arrives next replays that list: the database applies it all or not at all and
 * repeats nothing. So a second tab with other choices changes nothing and is told so, a reply lost after the write still
 * ends in the right receipt, and a definite refusal lets go of the claim, so a corrected list can go. Names enter the
 * outcome for the member's own message, as they do in the dose card's snapshot; this row never reaches a log or an error.
 */
export async function runMedicinesReview(actor:MemberActor,ports:ReviewPorts,v:ReviewInput):Promise<ReviewResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'medicines');
 if(!card)return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 const live=await ports.current();
 if(!live.enabled)return {status:'disabled',card};
 // An earlier try may have saved, which moves the token: the claim's list replays below.
 if(!card.claims.medicines&&card.snapshot.token!==live.token)return {status:'stale',card};
 const digest=bookingToken({changes:v.changes,added:v.added});
 const c=await claim(actor,ports,card,'medicines',v.opId,{kind:'review',digest,changes:v.changes,added:v.added});
 if(!c.ok)return c.result;
 const held=heldReview.safeParse(c.claim.payload);
 // A restore holds this card.
 if(!held.success)return {status:'stale',card};
 const mine=held.data.digest===digest;
 const saved=await ports.save(held.data,card.id);
 if(saved.status==='saved'){
  const rows:MedicineRow[]=saved.rows??[...held.data.changes.map(x=>({name:live.names.get(x.id)??'',status:x.status,stopReason:x.stopReason,added:false})),
   ...held.data.added.map(x=>({name:x.name,status:x.status,stopReason:x.stopReason,added:true}))].filter(x=>x.name);
  const followup=await ports.afterSave?.(rows,saved.stops??[]).catch(()=>'pending' as const)??'none';
  // The save RPC replays its durable marker. Keep this claim open until the mandatory follow-up
  // can be recorded truthfully; the existing held-save read resumes it after a reload.
  if(followup==='pending')return {status:'unavailable',card};
  const r=await record(actor,ports,card,'medicines',{kind:'review',status:'saved',rows,...(saved.savedAt?{actionAt:saved.savedAt}:{}),...(followup==='sent'?{noTitration:true}:{})},true);
  return mine?r:{status:'stale',card:r.card??card};
 }
 if(saved.status==='unavailable')return {status:'failed',card};
 const released=await ports.unclaim(card.id,'medicines',c.claim.op);
 if(!mine)return {status:'stale',card};
 if(saved.status==='not-found')return {status:'stale',card,released};
 if(saved.status==='disabled')return {status:'disabled',card,released};
 return saved.status==='limit'?{status:'failed',card,review:'limit',released}:{status:'invalid',card,released};
}

export const restoreInputSchema=z.strictObject({cardId:z.uuid(),opId:z.uuid(),id:z.uuid()});
export type RestoreInput=z.infer<typeof restoreInputSchema>;
type RestorePorts=CardPort&{unclaim:ReviewPorts['unclaim'];names():Promise<ReadonlyMap<string,string>>;restore(id:string):Promise<'saved'|'not-found'|'duplicate'|'limit'|'disabled'|'unavailable'>};
/** Undoes "Was a course" for one medicine: the same row, with its reminders back. Doctor plan medicines are not on that table. */
export async function runMedicineRestore(actor:MemberActor,ports:RestorePorts,v:RestoreInput):Promise<ReviewResult&{restore?:'duplicate'}>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'medicines');
 if(!card)return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 const c=await claim(actor,ports,card,'medicines',v.opId,{kind:'restore',id:v.id});
 if(!c.ok)return c.result;
 const held=c.claim.payload as {kind?:unknown;id?:unknown};
 if(held.kind!=='restore'||held.id!==v.id)return {status:'stale',card};
 const r=await ports.restore(v.id);
 if(r==='saved'){
  const name=(await ports.names()).get(v.id)??'';
  return record(actor,ports,card,'medicines',{kind:'review',status:'saved',rows:[{name,status:'restored',stopReason:null,added:false}]},true);
 }
 if(r==='unavailable')return {status:'failed',card};
 const released=await ports.unclaim(card.id,'medicines',c.claim.op);
 return r==='duplicate'?{status:'failed',card,restore:'duplicate',released}:r==='limit'?{status:'failed',card,review:'limit',released}:r==='disabled'?{status:'disabled',card,released}:{status:'stale',card,released};
}
