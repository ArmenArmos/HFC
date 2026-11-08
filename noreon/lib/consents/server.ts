import 'server-only';
import {z} from 'zod';
import {MEMBER_CONSENT_VERSION,consentText,consentTextHash} from './copy';
import {consentCardInputSchema,consentHistorySchema,consentItem,consentSetResultSchema,consentsCurrentSchema,type ConsentCardInput,type ConsentDecision,type ConsentsCardSnapshot} from './schema';
import {call,type CaregiverRpc} from '@/lib/caregivers/server';
import type {MemberActor} from '@/lib/zoe-chat-actions/actor';
import {claim,ownCard,record,type CardPorts,type CardResult} from '@/lib/zoe-chat-actions/commands';

/**
 * Member consents (WP F): RPC wrappers and the consents card's command. The port is injected so checks run without a
 * database. The text hash is computed here from the wording the card showed in that locale; the browser never sends it.
 */
export type ConsentRpc=CaregiverRpc;
export const readConsentsCurrent=(rpc:ConsentRpc)=>call(rpc,'member_consents_current',{},consentsCurrentSchema);
export const readConsentHistory=(rpc:ConsentRpc)=>call(rpc,'member_consent_history',{},consentHistorySchema);
export const setConsent=(rpc:ConsentRpc,v:{kind:string;granted:boolean;wordingVersion:string;textHash:string;method:'tap'|'voice';source:'chat_card'|'settings'|'enrolment'|'telegram'})=>
 call(rpc,'member_consent_set',{p_kind:v.kind,p_granted:v.granted,p_wording_version:v.wordingVersion,p_text_hash:v.textHash,p_method:v.method,p_source:v.source},consentSetResultSchema);

export async function consentsCardSnapshot(rpc:ConsentRpc):Promise<ConsentsCardSnapshot>{
 const [current,history]=await Promise.all([readConsentsCurrent(rpc),readConsentHistory(rpc)]);
 if(!current.ok||!history.ok)throw Error('Consents are unavailable.');
 return {v:1,version:MEMBER_CONSENT_VERSION,current:current.data.consents,history:history.data.history.slice(0,30)};
}

export type ConsentCardPorts=Pick<CardPorts,'readCard'|'claim'|'record'>&{rpc:ConsentRpc;unclaim(cardId:string,item:string,op:string):Promise<boolean>};
const decisionClaim=z.object({granted:z.boolean(),method:z.enum(['tap','voice']),locale:z.enum(['hy','en','ru'])});

/**
 * One explicit decision on the consents card: grant or withdraw one statement. The claim holds the decision, so a
 * retry repeats it and a second tab cannot record a different one for the same statement on this card.
 */
export async function runConsentDecision(actor:MemberActor,ports:ConsentCardPorts,raw:ConsentCardInput):Promise<CardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const v=consentCardInputSchema.parse(raw);
 const card=await ownCard(ports,v.cardId,'consents');
 if(!card)return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 // The card shows the version it was posted with; a newer wording needs a fresh card.
 if(card.snapshot.version!==MEMBER_CONSENT_VERSION)return {status:'stale',card};
 const item=consentItem(v.kind);
 const c=await claim(actor,ports,card,item,v.opId,{granted:v.granted,method:v.method,locale:v.locale});
 if(!c.ok)return c.result;
 const held=decisionClaim.safeParse(c.claim.payload);
 if(!held.success)return {status:'invalid',card};
 if(held.data.granted!==v.granted)return {status:'stale',card};
 const textHash=await consentTextHash(consentText(v.kind,held.data.locale));
 const r=await setConsent(ports.rpc,{kind:v.kind,granted:held.data.granted,wordingVersion:MEMBER_CONSENT_VERSION,textHash,method:held.data.method,source:'chat_card'});
 if(!r.ok)return {status:r.code==='access'?'signed_out':'unavailable',card};
 if(!r.data.ok){await ports.unclaim(card.id,item,c.claim.op).catch(()=>false);return {status:'invalid',card};}
 const decision:ConsentDecision={kind:v.kind,granted:held.data.granted,method:held.data.method,wordingVersion:MEMBER_CONSENT_VERSION,changed:r.data.changed,doneAt:new Date().toISOString()};
 return record(actor,ports,card,item,decision,false);
}
