import 'server-only';
import {createHash,createHmac,randomBytes,randomInt} from 'node:crypto';
import {cookies} from 'next/headers';
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {Database} from '@/lib/db/types';
import {createTelegramAdapter} from '@/lib/telegram-channel/outbound';
import {telegramHttpsPort} from '@/lib/telegram-channel/link';
import {outboundConfig} from '@/lib/telegram-runtime/config';
import {telegramAuthKeys} from './hook';
import {telegramAuthService} from './runtime';
import {clinicTelegramInvitesReady} from './clinic-invite-config';

/**
 * Clinic-portal invitations by Telegram (T-auth B-2b-2). The admin reserves an invitation; the
 * server creates the Auth account (confirmed email, no password) and hands the admin one link.
 * The invitee proves the invited phone in the bot, gets a code there, and sets a password with it.
 * The membership exists only after that (`clinic_invitation_finalize`). No email is sent.
 */
const COOKIE='noreon_clinic_invite';
const pending=z.strictObject({nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),challengeId:z.uuid(),invitationId:z.uuid(),generation:z.number().int().positive()});
const mac=(key:Buffer,parts:string[])=>createHmac('sha256',key).update(parts.join('\0')).digest('hex');
const keys=()=>telegramAuthKeys(process.env.NOREON_SUPABASE_SMS_HOOK_SECRET);
const invitationSchema=z.object({id:z.uuid(),clinicId:z.uuid(),email:z.string(),name:z.string(),phone:z.string(),generation:z.number().int().positive(),
 status:z.enum(['pending','verified','accepted','revoked','expired']),expiresAt:z.string(),createdAt:z.string()});
export type ClinicInvitation=z.infer<typeof invitationSchema>;
const rpcResult=z.union([z.object({ok:z.literal(true),invitation:invitationSchema}),z.object({ok:z.literal(false),code:z.string()})]);

/** Fixed invitation code text; no clinical content. */
export const clinicInviteCodeText=(code:string)=>`Նորեոն Հելթ կլինիկայի հրավերի կոդ՝ ${code}։ Մի՛ փոխանցեք այն ոչ մեկին։\nNoreon clinic invitation code: ${code}. Do not share it with anyone.`;

type AdminRpc=Pick<SupabaseClient<Database>,'rpc'>;
export type ClinicInviteIssue={ok:true;url:string;invitation:ClinicInvitation}|{ok:false;reason:'invalid'|'email_in_use'|'clinic_unavailable'|'changed'|'accepted'|'unavailable'};
const failure=(code:string):ClinicInviteIssue=>({ok:false,reason:(['invalid','email_in_use','clinic_unavailable','changed','accepted'] as const).find(c=>c===code)??(code==='conflict'?'changed':'unavailable')});

/** The account for this invitation: created once, or found again on a retry. */
async function ensureAccount(service:SupabaseClient<Database>,invitation:ClinicInvitation):Promise<string|null>{
 const known=await service.rpc('clinic_invitation_account',{p_invitation_id:invitation.id,p_generation:invitation.generation});
 const account=z.object({ok:z.literal(true),email:z.string(),authUserId:z.uuid().nullable()}).safeParse(known.data);
 if(known.error||!account.success)return null;
 if(account.data.authUserId)return account.data.authUserId;
 const created=await service.auth.admin.createUser({email:account.data.email,email_confirm:true});
 if(created.data.user?.id)return created.data.user.id;
 // A concurrent attempt may have created it first.
 const again=await service.rpc('clinic_invitation_account',{p_invitation_id:invitation.id,p_generation:invitation.generation});
 const found=z.object({ok:z.literal(true),authUserId:z.uuid()}).safeParse(again.data);
 return found.success?found.data.authUserId:null;
}

async function linkFor(invitation:ClinicInvitation,origin:string):Promise<ClinicInviteIssue>{
 const service=telegramAuthService();
 const userId=await ensureAccount(service,invitation);
 if(!userId)return {ok:false,reason:'unavailable'};
 const issued=await service.rpc('clinic_invitation_telegram_issue',{p_invitation_id:invitation.id,p_generation:invitation.generation,p_auth_user_id:userId});
 const parsed=z.object({ok:z.literal(true),token:z.string().regex(/^[A-Za-z0-9_-]{32}$/)}).safeParse(issued.data);
 if(issued.error||!parsed.success)return {ok:false,reason:'unavailable'};
 const url=new URL('/clinic/real/invite',origin);
 url.hash=new URLSearchParams({invitation:invitation.id,generation:String(invitation.generation),telegram:parsed.data.token}).toString();
 return {ok:true,url:url.href,invitation};
}

export async function issueClinicInvitation(admin:AdminRpc,input:{requestId:string;clinicId:string;email:string;name:string;phone:string},origin:string):Promise<ClinicInviteIssue>{
 if(!clinicTelegramInvitesReady())return {ok:false,reason:'unavailable'};
 const r=await admin.rpc('clinic_invitation_reserve',{p_request_id:input.requestId,p_clinic_id:input.clinicId,p_email:input.email,p_display_name:input.name,p_phone:input.phone});
 const parsed=rpcResult.safeParse(r.data);
 if(r.error||!parsed.success)return {ok:false,reason:'unavailable'};
 return parsed.data.ok?linkFor(parsed.data.invitation,origin):failure(parsed.data.code);
}

export async function reissueClinicInvitation(admin:AdminRpc,input:{invitationId:string;generation:number;phone:string},origin:string):Promise<ClinicInviteIssue>{
 if(!clinicTelegramInvitesReady())return {ok:false,reason:'unavailable'};
 const r=await admin.rpc('clinic_invitation_reissue',{p_invitation_id:input.invitationId,p_expected_generation:input.generation,p_phone:input.phone});
 const parsed=rpcResult.safeParse(r.data);
 if(r.error||!parsed.success)return {ok:false,reason:'unavailable'};
 return parsed.data.ok?linkFor(parsed.data.invitation,origin):failure(parsed.data.code);
}

export async function revokeClinicInvitation(admin:AdminRpc,input:{invitationId:string;generation:number}):Promise<boolean>{
 const r=await admin.rpc('clinic_invitation_revoke',{p_invitation_id:input.invitationId,p_expected_generation:input.generation});
 return !r.error&&rpcResult.safeParse(r.data).data?.ok===true;
}

export async function listClinicInvitations(admin:AdminRpc,clinicId:string):Promise<ClinicInvitation[]|null>{
 const r=await admin.rpc('clinic_invitations_list',{p_clinic_id:clinicId});
 const parsed=z.array(invitationSchema).safeParse(r.data);
 return r.error||!parsed.success?null:parsed.data;
}

export type ClinicInviteCodeResult={ok:true}|{ok:false;reason:'not_proven'|'busy'|'unavailable'};
export async function sendClinicInviteCode(invitationId:string,generation:number,startToken:string):Promise<ClinicInviteCodeResult>{
 if(!clinicTelegramInvitesReady())return {ok:false,reason:'unavailable'};
 const k=keys(),code=String(randomInt(0,1_000_000)).padStart(6,'0'),nonce=randomBytes(32).toString('base64url');
 const r=await telegramAuthService().rpc('clinic_invite_code_begin',{p_invitation_id:invitationId,p_generation:generation,p_start_token_hash:createHash('sha256').update(startToken,'utf8').digest('hex'),
  p_nonce_hmac:mac(k.digestKey,['noreon-clinic-invite-nonce-v1',nonce]),p_code_hmac:mac(k.digestKey,['noreon-clinic-invite-code-v1',invitationId,String(generation),code])});
 const begun=z.union([z.object({ok:z.literal(true),challengeId:z.uuid(),address:z.string().regex(/^[1-9][0-9]{0,15}$/)}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(r.data);
 if(r.error||!begun.success)return {ok:false,reason:'unavailable'};
 if(!begun.data.ok)return {ok:false,reason:begun.data.code==='not_proven'?'not_proven':begun.data.code==='rate_limited'?'busy':'unavailable'};
 const sent=await createTelegramAdapter({config:outboundConfig()!,http:telegramHttpsPort}).deliverText(Object.freeze({address:begun.data.address,text:clinicInviteCodeText(code)})).catch(()=>null);
 if(sent?.kind!=='accepted')return {ok:false,reason:'unavailable'};
 (await cookies()).set(COOKIE,JSON.stringify({nonce,challengeId:begun.data.challengeId,invitationId,generation}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:600});
 return {ok:true};
}

export type ClinicInviteAcceptResult={ok:true}|{ok:false;reason:'invalid_code'|'resend'|'telegram_in_use'|'already_member'|'unavailable'};
/** Code → verified (10 min, this browser) → password set on the reserved account → membership. */
export async function acceptClinicInvite(input:{invitationId:string;generation:number;code:string;password:string}):Promise<ClinicInviteAcceptResult>{
 if(!clinicTelegramInvitesReady())return {ok:false,reason:'unavailable'};
 const jar=await cookies();
 let held:z.infer<typeof pending>;
 try{held=pending.parse(JSON.parse(jar.get(COOKIE)?.value??''));}catch{return {ok:false,reason:'resend'};}
 if(held.invitationId!==input.invitationId||held.generation!==input.generation)return {ok:false,reason:'resend'};
 const k=keys(),nonceHmac=mac(k.digestKey,['noreon-clinic-invite-nonce-v1',held.nonce]),service=telegramAuthService();
 const v=await service.rpc('clinic_invite_code_verify',{p_challenge:held.challengeId,p_invitation_id:input.invitationId,p_generation:input.generation,p_nonce_hmac:nonceHmac,
  p_code_hmac:mac(k.digestKey,['noreon-clinic-invite-code-v1',input.invitationId,String(input.generation),input.code])});
 const verified=z.union([z.object({ok:z.literal(true),authUserId:z.uuid()}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(v.data);
 if(v.error||!verified.success)return {ok:false,reason:'unavailable'};
 if(!verified.data.ok)return {ok:false,reason:verified.data.code==='wrong_code'?'invalid_code':'resend'};
 const updated=await service.auth.admin.updateUserById(verified.data.authUserId,{password:input.password});
 if(updated.error)return {ok:false,reason:'resend'};
 const f=await service.rpc('clinic_invitation_finalize',{p_invitation_id:input.invitationId,p_generation:input.generation,p_nonce_hmac:nonceHmac});
 const done=z.union([z.object({ok:z.literal(true)}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(f.data);
 if(f.error||!done.success)return {ok:false,reason:'unavailable'};
 if(!done.data.ok){
  // A refused invitee must not keep the password just set (Fable F-6). Best effort; reissue also clears it.
  await service.rpc('clinic_invitation_clear_password',{p_invitation_id:input.invitationId,p_generation:input.generation,p_nonce_hmac:nonceHmac}).then(()=>null,()=>null);
  return {ok:false,reason:done.data.code==='telegram_in_use'?'telegram_in_use':done.data.code==='membership_exists'?'already_member':'resend'};
 }
 jar.delete(COOKIE);
 return {ok:true};
}
