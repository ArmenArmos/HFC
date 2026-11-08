import 'server-only';
import {createHmac} from 'node:crypto';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {CAREGIVER_CONSENT_VERSION,caregiverConsentText,consentTextHash} from '@/lib/consents/copy';
import type {MemberActor} from '@/lib/zoe-chat-actions/actor';
import {claim,ownCard,record,type CardPorts,type CardResult} from '@/lib/zoe-chat-actions/commands';
import {
 caregiverAnswerResultSchema,caregiverBpLogResultSchema,caregiverChangeResultSchema,caregiverInvitationsSchema,caregiverInviteResultSchema,
 caregiverItem,caregiverLandingPath,caregiverPlanSchema,caregiverScopeSchema,caregiversEnabled,caregiverReadingsSchema,caregiverSnapshotFrom,caredMembersSchema,memberCaregiversSchema,
 type CaregiverInviteInput,type CaregiverReceipt,type CaregiverRevokeInput,type CaregiverScopesInput,
} from './schema';

/**
 * Caregiver RPCs (WP F) and the caregiver card's commands. Every function takes an injected RPC port, so checks run
 * without a database; the session client is the default. The database authorises every call (_member_self,
 * _caregiver_self, _caregiver_can) and writes the audit rows; nothing here decides access.
 */
export type CaregiverRpc={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string}|null}>};
export const sessionCaregiverRpc=async():Promise<CaregiverRpc>=>await createClient() as unknown as CaregiverRpc;

export type RpcRead<T>={ok:true;data:T}|{ok:false;code:'access'|'unavailable'};
/** One RPC, parsed. A refusal is 'access'; anything else that fails, including an unexpected shape, is 'unavailable'. */
export async function call<S extends z.ZodType>(rpc:CaregiverRpc,name:string,args:Record<string,unknown>,schema:S):Promise<RpcRead<z.infer<S>>>{
 try{
  const {data,error}=await rpc.rpc(name,args);
  if(error)return {ok:false,code:error.code==='42501'?'access':'unavailable'};
  const parsed=schema.safeParse(data);
  return parsed.success?{ok:true,data:parsed.data}:{ok:false,code:'unavailable'};
 }catch{return {ok:false,code:'unavailable'};}
}

// Member side ------------------------------------------------------------------------------------------------------
export const readMemberCaregivers=(rpc:CaregiverRpc)=>call(rpc,'member_caregivers_read',{},memberCaregiversSchema);
export const inviteCaregiver=(rpc:CaregiverRpc,v:{requestId:string;name:string;relationship:string;phone:string;scopes:readonly string[];wordingVersion:string;textHash:string;method:'tap'|'voice'})=>
 call(rpc,'member_caregiver_invite',{p_request_id:v.requestId,p_display_name:v.name,p_relationship:v.relationship,p_phone:v.phone,p_scopes:[...v.scopes],p_wording_version:v.wordingVersion,p_text_hash:v.textHash,p_method:v.method},caregiverInviteResultSchema);
export const updateCaregiverScopes=(rpc:CaregiverRpc,v:{linkId:string;revision:number;scopes:readonly string[];wordingVersion:string;textHash:string;method:'tap'|'voice'})=>
 call(rpc,'member_caregiver_update_scopes',{p_id:v.linkId,p_revision:v.revision,p_scopes:[...v.scopes],p_wording_version:v.wordingVersion,p_text_hash:v.textHash,p_method:v.method},caregiverChangeResultSchema);
export const revokeCaregiver=(rpc:CaregiverRpc,v:{linkId:string;revision:number})=>
 call(rpc,'member_caregiver_revoke',{p_id:v.linkId,p_revision:v.revision},caregiverChangeResultSchema);

// Caregiver side ---------------------------------------------------------------------------------------------------
export const readCaregiverInvitations=(rpc:CaregiverRpc)=>call(rpc,'caregiver_invitations_read',{},caregiverInvitationsSchema);
export const answerCaregiverInvitation=(rpc:CaregiverRpc,v:{id:string;accept:boolean})=>
 call(rpc,v.accept?'caregiver_invitation_accept':'caregiver_invitation_decline',{p_id:v.id},caregiverAnswerResultSchema);
export const readCaredMembers=(rpc:CaregiverRpc)=>call(rpc,'caregiver_members_read',{},caredMembersSchema);
export const logCaregiverBp=(rpc:CaregiverRpc,v:{memberId:string;requestId:string;systolic:number;diastolic:number;pulse:number|null;measuredAt:string})=>
 call(rpc,'caregiver_bp_log',{p_member:v.memberId,p_request_id:v.requestId,p_systolic:v.systolic,p_diastolic:v.diastolic,p_pulse:v.pulse,p_measured_at:v.measuredAt},caregiverBpLogResultSchema);
export const readCaregiverPlan=(rpc:CaregiverRpc,memberId:string)=>call(rpc,'caregiver_plan_read',{p_member:memberId},caregiverPlanSchema);
export const readCaregiverReadings=(rpc:CaregiverRpc,memberId:string)=>call(rpc,'caregiver_readings_read',{p_member:memberId},caregiverReadingsSchema);

export type CaregiverLandingReads={member():Promise<boolean>;invitations():Promise<number>;activeLinks():Promise<number>};
/** The session's own rows only (owner RLS and the caller's phone): nothing here reads another member, so nothing is audited. */
export async function sessionLandingReads(userId:string):Promise<CaregiverLandingReads>{
 type Count=PromiseLike<{count:number|null;error:unknown}>;
 const client=await createClient() as unknown as CaregiverRpc&{from(table:string):{select(cols:string,o:{count:'exact';head:true}):Count&{eq(col:string,v:string):Count&{eq(col:string,v:string):Count}}}};
 const count=async(q:Count)=>{const {count:n,error}=await q;if(error)throw Error('Caregiver landing is unavailable.');return n??0;};
 return {
  member:async()=>await count(client.from('patient_assessments').select('user_id',{count:'exact',head:true}).eq('user_id',userId))>0,
  invitations:async()=>{const r=await readCaregiverInvitations(client);if(!r.ok)throw Error('Caregiver landing is unavailable.');return r.data.invitations.length;},
  activeLinks:()=>count(client.from('member_caregivers').select('id',{count:'exact',head:true}).eq('caregiver_user_id',userId).eq('status','active')),
 };
}
/**
 * After sign-in: /patient/caring for a phone account that is no member but is a caregiver or has an invitation waiting,
 * otherwise null. Off unless NOREON_CAREGIVERS; any failed read keeps the ordinary member journey.
 */
export async function caregiverLanding(reads:CaregiverLandingReads|null,env:Record<string,string|undefined>=process.env){
 if(!caregiversEnabled(env)||!reads)return null;
 try{
  if(await reads.member())return null;
  const [invitations,activeLinks]=await Promise.all([reads.invitations(),reads.activeLinks()]);
  return caregiverLandingPath({enabled:true,member:false,invitations,activeLinks});
 }catch{return null;}
}

/** The caregiver card's snapshot from the member's own links. */
export async function caregiverCardSnapshot(rpc:CaregiverRpc){
 const read=await readMemberCaregivers(rpc);
 if(!read.ok)throw Error('Caregiver links are unavailable.');
 return caregiverSnapshotFrom(read.data.links);
}

// The caregiver card's commands: claim the item, then the feature's own RPC, then record (lib/zoe-chat-actions/commands.ts).
export type CaregiverCardPorts=Pick<CardPorts,'readCard'|'claim'|'record'>&{rpc:CaregiverRpc;unclaim(cardId:string,item:string,op:string):Promise<boolean>;proof(v:CaregiverInviteInput):string};
export type CaregiverCardResult=CardResult&{reason?:string};

/** Keyed, because a phone number's plain hash can be guessed: the claim holds this, never the name or the number. */
export const caregiverProof=(v:Pick<CaregiverInviteInput,'name'|'phone'|'relationship'|'scopes'>,key=process.env.SUPABASE_SERVICE_ROLE_KEY??'')=>
 createHmac('sha256',key).update(JSON.stringify([v.name,v.phone,v.relationship,[...v.scopes].sort()])).digest('hex');
const inviteClaim=z.object({proof:z.string().min(1),relationship:z.string(),scopes:z.array(z.string())});
const now=()=>new Date().toISOString();

/**
 * Invites one caregiver from the card. The consent text is rebuilt here from the same inputs the card showed, and its
 * hash is what the database stores: the browser never supplies a hash. The claim's op id is the request id, so a retry
 * repeats the same invitation. A definite refusal (limit, duplicate, own number) releases the claim so the member can
 * correct the form on the same card.
 */
export async function runCaregiverInvite(actor:MemberActor,ports:CaregiverCardPorts,v:CaregiverInviteInput):Promise<CaregiverCardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'caregiver');
 if(!card)return {status:'invalid'};
 if(card.state==='done')return {status:'closed',card};
 const proof=ports.proof(v);
 const c=await claim(actor,ports,card,caregiverItem.invite,v.opId,{proof,relationship:v.relationship,scopes:[...v.scopes]});
 if(!c.ok)return c.result;
 const held=inviteClaim.safeParse(c.claim.payload);
 if(!held.success)return {status:'invalid',card};
 if(held.data.proof!==proof)return {status:'stale',card};
 const textHash=await consentTextHash(caregiverConsentText(v.locale,v.name,v.scopes));
 const r=await inviteCaregiver(ports.rpc,{requestId:c.claim.op,name:v.name,relationship:v.relationship,phone:v.phone,scopes:v.scopes,wordingVersion:CAREGIVER_CONSENT_VERSION,textHash,method:v.method});
 if(!r.ok)return {status:r.code==='access'?'signed_out':'unavailable',card};
 if(!r.data.ok){
  await ports.unclaim(card.id,caregiverItem.invite,c.claim.op).catch(()=>false);
  return {status:'invalid',card,reason:r.data.code};
 }
 const receipt:CaregiverReceipt={action:'invite',status:r.data.replayed?'unchanged':'done',linkId:r.data.link.id,scopes:r.data.link.scopes,relationship:r.data.link.relationship,doneAt:now()};
 return record(actor,ports,card,caregiverItem.invite,receipt,false);
}

/**
 * Changes what one caregiver may do. Optimistic on the link's revision; a stale card says so. The member confirmed the
 * statement for the new scopes, shown with the name on this card: that text is rebuilt and hashed here, and the
 * database records it on the link and as a caregiver-sharing consent, as on invite.
 */
export async function runCaregiverScopes(actor:MemberActor,ports:CaregiverCardPorts,v:CaregiverScopesInput):Promise<CaregiverCardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'caregiver');
 const link=card?.snapshot.links.find(l=>l.id===v.linkId);
 if(!card||!link)return {status:'invalid'};
 const item=caregiverItem.scopes(v.linkId);
 const c=await claim(actor,ports,card,item,v.opId,{linkId:v.linkId,revision:v.revision,scopes:[...v.scopes],locale:v.locale});
 if(!c.ok)return c.result;
 const held=z.object({revision:z.number(),scopes:z.array(caregiverScopeSchema).min(1),locale:z.enum(['hy','en','ru'])}).safeParse(c.claim.payload);
 if(!held.success)return {status:'invalid',card};
 const textHash=await consentTextHash(caregiverConsentText(held.data.locale,link.name,held.data.scopes));
 const r=await updateCaregiverScopes(ports.rpc,{linkId:v.linkId,revision:held.data.revision,scopes:held.data.scopes,wordingVersion:CAREGIVER_CONSENT_VERSION,textHash,method:'tap'});
 if(!r.ok)return {status:r.code==='access'?'signed_out':'unavailable',card};
 if(!r.data.ok){
  await ports.unclaim(card.id,item,c.claim.op).catch(()=>false);
  return {status:r.data.code==='stale'?'stale':r.data.code==='closed'?'closed':'invalid',card,reason:r.data.code};
 }
 const receipt:CaregiverReceipt={action:'scopes',status:r.data.changed?'done':'unchanged',linkId:v.linkId,scopes:r.data.link.scopes,doneAt:now()};
 return record(actor,ports,card,item,receipt,false);
}

/** Ends one caregiver's access at once. */
export async function runCaregiverRevoke(actor:MemberActor,ports:CaregiverCardPorts,v:CaregiverRevokeInput):Promise<CaregiverCardResult>{
 if(actor.channel!=='app')return {status:'disabled'};
 const card=await ownCard(ports,v.cardId,'caregiver');
 if(!card||!card.snapshot.links.some(l=>l.id===v.linkId))return {status:'invalid'};
 const item=caregiverItem.revoke(v.linkId);
 const c=await claim(actor,ports,card,item,v.opId,{linkId:v.linkId,revision:v.revision});
 if(!c.ok)return c.result;
 const held=z.object({revision:z.number()}).safeParse(c.claim.payload);
 if(!held.success)return {status:'invalid',card};
 const r=await revokeCaregiver(ports.rpc,{linkId:v.linkId,revision:held.data.revision});
 if(!r.ok)return {status:r.code==='access'?'signed_out':'unavailable',card};
 if(!r.data.ok){
  await ports.unclaim(card.id,item,c.claim.op).catch(()=>false);
  return {status:r.data.code==='stale'?'stale':r.data.code==='closed'?'closed':'invalid',card,reason:r.data.code};
 }
 const receipt:CaregiverReceipt={action:'revoke',status:r.data.changed?'done':'unchanged',linkId:v.linkId,doneAt:now()};
 return record(actor,ports,card,item,receipt,false);
}
