'use server';
import {revalidatePath} from 'next/cache';
import {loggedAction} from '@/lib/observability/with-logging';
import {patientIdentity} from '@/lib/patient/auth';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {noActor,sessionActor} from '@/lib/zoe-chat-actions/actor';
import {claimCard,readZoeCard,recordCard,unclaimCard} from '@/lib/zoe-chat-actions/server';
import {
 caregiverInvitationAnswerSchema,caregiverInviteInputSchema,caregiverRevokeInputSchema,caregiverScopesInputSchema,caregiversEnabled,
 type CaredMember,type CaregiverInvitation,
} from './schema';
import {
 answerCaregiverInvitation,caregiverProof,readCaredMembers,readCaregiverInvitations,runCaregiverInvite,runCaregiverRevoke,runCaregiverScopes,
 sessionCaregiverRpc,type CaregiverCardPorts,type CaregiverCardResult,
} from './server';

/**
 * Caregiver server actions (WP F). Member side: the caregiver card's three commands, each an explicit press on the card,
 * acting only for the member of this session (sessionActor), never for a member id from input. Caregiver side: the
 * signed-in phone account reads and answers its own invitations; the database matches the invitation to the account's
 * confirmed phone number.
 */
const portsFor=async(memberId:string):Promise<CaregiverCardPorts>=>({readCard:readZoeCard,claim:claimCard,record:recordCard,
 unclaim:(cardId,item,op)=>unclaimCard(memberId,cardId,item,op),rpc:await sessionCaregiverRpc(),proof:caregiverProof});
const on=()=>caregiversEnabled()&&zoeAppV3Enabled();
const done=()=>{revalidatePath('/patient/chat');revalidatePath('/patient/caring');};

export const inviteCaregiverFromCard=loggedAction('inviteCaregiverFromCard',async function inviteCaregiverFromCard(raw:unknown):Promise<CaregiverCardResult>{
 if(!on())return {status:'disabled'};
 const parsed=caregiverInviteInputSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 const r=await runCaregiverInvite(who,await portsFor(who.memberId),parsed.data);
 if(r.status==='ok')done();
 return r;
});
export const updateCaregiverScopesFromCard=loggedAction('updateCaregiverScopesFromCard',async function updateCaregiverScopesFromCard(raw:unknown):Promise<CaregiverCardResult>{
 if(!on())return {status:'disabled'};
 const parsed=caregiverScopesInputSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 const r=await runCaregiverScopes(who,await portsFor(who.memberId),parsed.data);
 if(r.status==='ok')done();
 return r;
});
export const revokeCaregiverFromCard=loggedAction('revokeCaregiverFromCard',async function revokeCaregiverFromCard(raw:unknown):Promise<CaregiverCardResult>{
 if(!on())return {status:'disabled'};
 const parsed=caregiverRevokeInputSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 const who=await sessionActor();
 if(!who)return noActor();
 const r=await runCaregiverRevoke(who,await portsFor(who.memberId),parsed.data);
 if(r.status==='ok')done();
 return r;
});

export type CaregiverHome={status:'ok';invitations:CaregiverInvitation[];members:CaredMember[]}|{status:'disabled'|'signed_out'|'unavailable'};
/** What the signed-in phone account sees as a caregiver: its pending invitations and the members it cares for. */
export const readCaregiverHome=loggedAction('readCaregiverHome',async function readCaregiverHome():Promise<CaregiverHome>{
 if(!caregiversEnabled())return {status:'disabled'};
 try{if(!await patientIdentity())return {status:'signed_out'};}catch{return {status:'unavailable'};}
 const rpc=await sessionCaregiverRpc();
 const [invitations,members]=await Promise.all([readCaregiverInvitations(rpc),readCaredMembers(rpc)]);
 // A staff account is refused by the database: it is no caregiver, which reads as nothing to show.
 if(!invitations.ok&&invitations.code==='access')return {status:'ok',invitations:[],members:[]};
 if(!invitations.ok||!members.ok)return {status:'unavailable'};
 return {status:'ok',invitations:invitations.data.invitations,members:members.data.members};
});

export type InvitationAnswer={status:'active'|'declined'|'not_found'|'closed'|'expired'|'duplicate'|'invalid'|'disabled'|'signed_out'|'unavailable'};
/** Accept or decline one invitation: an explicit press after the invitation card showed exactly what is shared. */
export const answerCaregiverInvitationAction=loggedAction('answerCaregiverInvitation',async function answerCaregiverInvitationAction(raw:unknown):Promise<InvitationAnswer>{
 if(!caregiversEnabled())return {status:'disabled'};
 const parsed=caregiverInvitationAnswerSchema.safeParse(raw);
 if(!parsed.success)return {status:'invalid'};
 try{if(!await patientIdentity())return {status:'signed_out'};}catch{return {status:'unavailable'};}
 const r=await answerCaregiverInvitation(await sessionCaregiverRpc(),parsed.data);
 if(!r.ok)return {status:r.code==='access'?'not_found':'unavailable'};
 if(!r.data.ok)return {status:r.data.code};
 done();
 return {status:r.data.status};
});
