import 'server-only';
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {Locale} from '@/lib/locale';
import {memberConsentKindSchema} from '@/lib/consents/schema';
import {caregiverRelationshipSchema,caregiverScopeSchema,E164,normalizePhone} from '@/lib/caregivers/schema';
import {confirmationAnswer} from '@/lib/voice-core/confirm';
import type {MemberActor} from './actor';
import type {CardActionResult,ZoeCard,ZoeCards} from './registry';

/**
 * Spoken confirmation bound to a card (WP V). A card that waits for an explicit yes gets a nonce from the server: an HMAC
 * over the member, the card id, the card's revision (its state, outcome and claims) and the exact pending action the
 * card shows. A spoken yes performs that action only when
 *  - the card is the member's own (session read, RLS), of the action's kind, and still open;
 *  - it is the most recent open action card in the member's chat;
 *  - the nonce verifies for this member, card, revision and action, within ten minutes;
 *  - the transcript is a strict whole-utterance yes (lib/voice-core/confirm.ts), with no negation;
 *  - a server-transcribed turn carries its valid voice receipt (a Live turn has none and is labelled as such).
 * The write then goes through exactly the command a tap uses. The transcript alone, or any model, never writes.
 */
export const VOICE_CARD_VERSION='voice-card-nonce-1';
const NONCE_TTL_MS=10*60_000;
const HHMM=/^([01]\d|2[0-3]):[0-5]\d$/;
const locale=z.enum(['hy','en','ru']);
const scopes=z.array(caregiverScopeSchema).min(1).max(6);

export const voicePendingSchema=z.discriminatedUnion('kind',[
 z.strictObject({kind:z.literal('bp')}),
 z.strictObject({kind:z.literal('reminders'),time:z.string().regex(HHMM),target:z.enum(['bp','medicine'])}),
 z.strictObject({kind:z.literal('consent'),consent:memberConsentKindSchema,granted:z.boolean(),locale}),
 z.strictObject({kind:z.literal('caregiver_invite'),name:z.string().trim().min(1).max(80),relationship:caregiverRelationshipSchema,
  phone:z.string().trim().transform(normalizePhone).pipe(z.string().regex(E164)),scopes,locale}),
 z.strictObject({kind:z.literal('caregiver_scopes'),linkId:z.uuid(),revision:z.number().int().positive(),scopes,locale}),
 z.strictObject({kind:z.literal('caregiver_revoke'),linkId:z.uuid(),revision:z.number().int().positive()}),
]);
export type VoicePending=z.infer<typeof voicePendingSchema>;
/** The card kind each pending action lives on. */
export const PENDING_CARD_KIND:Readonly<Record<VoicePending['kind'],string>>={bp:'bp',reminders:'account',consent:'consents',
 caregiver_invite:'caregiver',caregiver_scopes:'caregiver',caregiver_revoke:'caregiver'};
/** Informational cards never compete with a pending confirmation for "most recent open card". */
const INFORMATIONAL=new Set(['next_step','review','tests_needed','results','plan','ldl','menu']);

const canonical=(value:unknown):string=>Array.isArray(value)?`[${value.map(canonical).join(',')}]`
 :value&&typeof value==='object'?`{${Object.keys(value).sort().map(k=>`${JSON.stringify(k)}:${canonical((value as Record<string,unknown>)[k])}`).join(',')}}`:JSON.stringify(value);
/** The card's revision: what a tap on it would see. Any recorded outcome or claim changes it. */
export const cardRevision=(card:ZoeCard)=>createHash('sha256').update(canonical({id:card.id,state:card.state,outcome:card.outcome,claims:card.claims,snapshot:card.snapshot})).digest().subarray(0,16).toString('base64url');
const key=(secret:string)=>{if(secret.length<32)throw Error('Voice nonce unavailable');return createHmac('sha256',secret).update('noreon:voice-card-nonce:v1').digest();};
const mac=(secret:string,memberId:string,card:ZoeCard,action:VoicePending,issuedAt:number)=>
 createHmac('sha256',key(secret)).update(canonical({memberId,cardId:card.id,revision:cardRevision(card),action,issuedAt})).digest('base64url');

export function signVoiceNonce(memberId:string,card:ZoeCard,action:VoicePending,now=Date.now(),secret=process.env.SUPABASE_SERVICE_ROLE_KEY??''):string{
 return `${now}.${mac(secret,memberId,card,action,now)}`;
}
export function verifyVoiceNonce(nonce:unknown,memberId:string,card:ZoeCard,action:VoicePending,now=Date.now(),secret=process.env.SUPABASE_SERVICE_ROLE_KEY??''):boolean{
 try{
  if(typeof nonce!=='string'||!/^\d{13}\.[A-Za-z0-9_-]{43}$/.test(nonce))return false;
  const [time,given]=nonce.split('.'),issuedAt=Number(time);
  if(issuedAt>now+30_000||now-issuedAt>NONCE_TTL_MS)return false;
  return timingSafeEqual(Buffer.from(given!),Buffer.from(mac(secret,memberId,card,action,issuedAt)));
 }catch{return false;}
}

/** The newest open action card, by time then id. */
export function newestOpenActionCard(read:ZoeCards):ZoeCard|null{
 return read.cards.filter(card=>card.state==='open'&&!INFORMATIONAL.has(card.kind)).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at)||b.id.localeCompare(a.id))[0]??null;
}

export const voiceConfirmInputSchema=z.strictObject({cardId:z.uuid(),opId:z.uuid(),nonce:z.string().max(80),transcript:z.string().trim().min(1).max(300),
 locale,origin:z.enum(['batch','live']),receipt:z.string().max(128).optional(),action:voicePendingSchema});
export type VoiceConfirmInput=z.infer<typeof voiceConfirmInputSchema>;
export type VoiceConfirmResult={status:'saved';card?:ZoeCard;next?:ZoeCard}|{status:'cancelled'|'not_confirmed'|'not_latest'|'stale'|'unverified'|'invalid'|'closed'|'disabled'|'signed_out'|'failed'|'unavailable';card?:ZoeCard};

export type VoiceConfirmPorts={
 readCard(id:string):Promise<ZoeCard|null>;
 readCards():Promise<ZoeCards>;
 /** A server-transcribed turn's receipt (lib/zoe-chat-actions/voice-receipt.ts). */
 verifyReceipt(receipt:unknown,memberId:string,text:string):boolean;
 /** The same command the tap on this card runs. opId is the claim's operation id (idempotent on retry). */
 perform(card:ZoeCard,action:VoicePending,opId:string):Promise<CardActionResult>;
 now?():number;secret?:string;
};

const fromCard=(r:CardActionResult):VoiceConfirmResult=>r.status==='ok'?{status:'saved',...(r.card?{card:r.card}:{}),...(r.next?{next:r.next}:{})}
 :{status:r.status==='held_urgent'?'failed':r.status==='busy'||r.status==='rate_limited'||r.status==='not_cleared'?'failed':r.status,...('card'in r&&r.card?{card:r.card}:{})};

/** Every check, in order, before the tap's own command runs. Nothing is written unless every check passes. */
export async function confirmVoiceCard(actor:MemberActor,ports:VoiceConfirmPorts,raw:unknown):Promise<VoiceConfirmResult>{
 const parsed=voiceConfirmInputSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const v=parsed.data,now=ports.now?.()??Date.now();
 const card=await ports.readCard(v.cardId);
 if(!card||!card.valid||card.kind!==PENDING_CARD_KIND[v.action.kind])return {status:'invalid'};
 if(card.state!=='open')return {status:'closed',card};
 const newest=newestOpenActionCard(await ports.readCards());
 if(newest?.id!==card.id)return {status:'not_latest',card};
 if(!verifyVoiceNonce(v.nonce,actor.memberId,card,v.action,now,ports.secret))return {status:'stale',card};
 if(v.origin==='batch'&&!ports.verifyReceipt(v.receipt,actor.memberId,v.transcript))return {status:'unverified',card};
 const answer=confirmationAnswer(v.transcript,v.locale as Locale);
 if(answer==='cancel')return {status:'cancelled',card};
 if(answer!=='confirm')return {status:'not_confirmed',card};
 try{return fromCard(await ports.perform(card,v.action,v.opId));}catch(error){
  if(String((error as {digest?:unknown})?.digest??'').startsWith('NEXT_REDIRECT'))throw error;
  return {status:'failed',card};
 }
}

/** Issues the nonce for a pending action on one of the member's own open cards, or null when the card cannot take it. */
export async function issueVoiceNonce(actor:MemberActor,ports:Pick<VoiceConfirmPorts,'readCard'|'now'|'secret'>,cardId:string,action:VoicePending):Promise<string|null>{
 const card=await ports.readCard(cardId);
 if(!card||!card.valid||card.kind!==PENDING_CARD_KIND[action.kind]||card.state!=='open')return null;
 if(action.kind==='bp'&&!(card.kind==='bp'&&card.snapshot.typed))return null;
 return signVoiceNonce(actor.memberId,card,action,ports.now?.()??Date.now(),ports.secret);
}

/** A BP reminder at the spoken time added to the saved times; medicine reminders switched on. Null when it cannot fit. */
export function withReminder(preferences:{medicationEnabled:boolean;bpEnabled:boolean;bpTimes:string[]}&Record<string,unknown>,action:Extract<VoicePending,{kind:'reminders'}>){
 if(action.target==='medicine')return {...preferences,medicationEnabled:true};
 if(preferences.bpTimes.includes(action.time))return {...preferences,bpEnabled:true};
 if(preferences.bpTimes.length>=4)return null;
 return {...preferences,bpEnabled:true,bpTimes:[...preferences.bpTimes,action.time].sort()};
}
