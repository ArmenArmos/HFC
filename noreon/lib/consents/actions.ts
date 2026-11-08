'use server';
import {revalidatePath} from 'next/cache';
import {loggedAction} from '@/lib/observability/with-logging';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {noActor,sessionActor} from '@/lib/zoe-chat-actions/actor';
import type {CardActionResult} from '@/lib/zoe-chat-actions/registry';
import {claimCard,readZoeCard,recordCard,unclaimCard} from '@/lib/zoe-chat-actions/server';
import {sessionCaregiverRpc} from '@/lib/caregivers/server';
import {consentCardInputSchema,memberConsentsEnabled,type ConsentRow} from './schema';
import {readConsentHistory,readConsentsCurrent,runConsentDecision} from './server';

/**
 * Member consent server actions (WP F). A decision is an explicit press on the consents card, for the member of this
 * session only; the wording hash is computed on the server from the text the card showed.
 */
export const setConsentFromCard=loggedAction('setConsentFromCard',async function setConsentFromCard(raw:unknown):Promise<CardActionResult>{
 if(!memberConsentsEnabled()||!zoeAppV3Enabled())return {status:'disabled'};
 const parsed=consentCardInputSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 const r=await runConsentDecision(who,{readCard:readZoeCard,claim:claimCard,record:recordCard,unclaim:(c,i,o)=>unclaimCard(who.memberId,c,i,o),rpc:await sessionCaregiverRpc()},parsed.data);
 if(r.status==='ok')revalidatePath('/patient/chat');
 return r;
});

export type MemberConsentsRead={status:'ok';current:ConsentRow[];history:ConsentRow[]}|{status:'disabled'|'signed_out'|'unavailable'};
/** The member's current consents and their history, for a screen outside the chat. */
export const readMemberConsents=loggedAction('readMemberConsents',async function readMemberConsents():Promise<MemberConsentsRead>{
 if(!memberConsentsEnabled())return {status:'disabled'};
 const who=await sessionActor();
 if(!who){const n=await noActor();return {status:n.status==='disabled'?'unavailable':n.status};}
 const rpc=await sessionCaregiverRpc();
 const [current,history]=await Promise.all([readConsentsCurrent(rpc),readConsentHistory(rpc)]);
 if(!current.ok||!history.ok)return {status:'unavailable'};
 return {status:'ok',current:current.data.consents,history:history.data.history};
});
