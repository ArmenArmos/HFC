import 'server-only';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {confirmationAnswer} from '@/lib/voice-core/confirm';

/**
 * Spoken confirmation for staff action cards (WP V), the staff twin of lib/zoe-chat-actions/voice-card.ts. Words only
 * open a card; the clinician's spoken yes, bound to that card's nonce and revision, runs the same command the button
 * runs. First card: a nurse (or physician, or administrator) acknowledges a care alert. The nonce covers the staff id,
 * the alert and its state sequence, so an alert that changed since it was shown refuses the yes; the command re-checks
 * the sequence and the assignment in SQL anyway. A recorded turn must carry its staff voice receipt.
 */
export const STAFF_VOICE_CONFIRM_VERSION='staff-voice-confirm-1';
const TTL_MS=10*60_000;
export const staffVoiceTargetSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('care_alert_ack'),alertId:z.uuid(),seq:z.number().int().min(0)}),
]);
export type StaffVoiceTarget=z.infer<typeof staffVoiceTargetSchema>;
export const staffVoiceConfirmInputSchema=z.strictObject({target:staffVoiceTargetSchema,nonce:z.string().max(80),transcript:z.string().trim().min(1).max(300),
 locale:z.enum(['hy','en','ru']),origin:z.enum(['batch','live']),receipt:z.string().max(128).optional()});
export type StaffVoiceConfirmResult={status:'saved';alert?:unknown}|{status:'cancelled'|'not_confirmed'|'stale'|'unverified'|'invalid'|'access'|'changed'|'unavailable'};
export type StaffVoiceConfirmPorts={
 verifyReceipt(receipt:unknown,staffId:string,text:string):boolean;
 /** The button's own command (changeCareAlert acknowledge). */
 perform(target:StaffVoiceTarget):Promise<{ok:true;alert?:unknown}|{ok:false;code:string}>;
 now?():number;secret?:string;
};

const key=(secret:string)=>{if(secret.length<32)throw Error('Voice nonce unavailable');return createHmac('sha256',secret).update('noreon:staff-voice-card-nonce:v1').digest();};
const mac=(secret:string,staffId:string,target:StaffVoiceTarget,issuedAt:number)=>createHmac('sha256',key(secret)).update(JSON.stringify({staffId,target:[target.kind,target.alertId,target.seq],issuedAt})).digest('base64url');
export function signStaffVoiceNonce(staffId:string,target:StaffVoiceTarget,now=Date.now(),secret=process.env.SUPABASE_SERVICE_ROLE_KEY??''):string{
 return `${now}.${mac(secret,staffId,target,now)}`;
}
export function verifyStaffVoiceNonce(nonce:unknown,staffId:string,target:StaffVoiceTarget,now=Date.now(),secret=process.env.SUPABASE_SERVICE_ROLE_KEY??''):boolean{
 try{
  if(typeof nonce!=='string'||!/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(nonce))return false;
  const [time,given]=nonce.split('.'),issuedAt=Number(time);
  if(issuedAt>now+30_000||now-issuedAt>TTL_MS)return false;
  return timingSafeEqual(Buffer.from(given!),Buffer.from(mac(secret,staffId,target,issuedAt)));
 }catch{return false;}
}

export async function confirmStaffVoice(staffId:string,ports:StaffVoiceConfirmPorts,raw:unknown):Promise<StaffVoiceConfirmResult>{
 const parsed=staffVoiceConfirmInputSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const v=parsed.data;
 if(!verifyStaffVoiceNonce(v.nonce,staffId,v.target,ports.now?.()??Date.now(),ports.secret))return {status:'stale'};
 if(v.origin==='batch'&&!ports.verifyReceipt(v.receipt,staffId,v.transcript))return {status:'unverified'};
 const answer=confirmationAnswer(v.transcript,v.locale);
 if(answer==='cancel')return {status:'cancelled'};
 if(answer!=='confirm')return {status:'not_confirmed'};
 try{
  const r=await ports.perform(v.target);
  if(r.ok)return {status:'saved',...(r.alert!==undefined?{alert:r.alert}:{})};
  return {status:r.code==='changed'?'changed':r.code==='access'?'access':r.code==='invalid'?'invalid':'unavailable'};
 }catch{return {status:'unavailable'};}
}
