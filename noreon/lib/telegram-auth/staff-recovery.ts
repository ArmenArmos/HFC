import 'server-only';
import {createHash,createHmac,randomBytes,randomInt} from 'node:crypto';
import {cookies} from 'next/headers';
import type {SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {Database} from '@/lib/db/types';
import {createTelegramAdapter} from '@/lib/telegram-channel/outbound';
import {telegramHttpsPort} from '@/lib/telegram-channel/link';
import {outboundConfig,telegramEnabled} from '@/lib/telegram-runtime/config';
import {telegramAuthKeys} from './hook';
import {telegramAuthService} from './runtime';

/**
 * Password recovery by Telegram for staff and clinic accounts (T-auth B-3, design v5 §5,
 * `staff_telegram_recoveries`). Admin-requested only: the reset link goes straight to the
 * account's own Telegram chat, never through the admin. Its holder asks for a code in that chat
 * and sets a new password with it; then every session of the account ends.
 */
type Env=Record<string,string|undefined>;
export const staffTelegramRecoveryReady=(env:Env=process.env)=>telegramEnabled(env)&&env.NOREON_STAFF_TELEGRAM_RECOVERY==='true'
 &&Boolean(env.NOREON_TELEGRAM_BOT_TOKEN)&&outboundConfig(env)!==undefined;
export type RecoveryPortal='staff'|'clinic';
const COOKIE='noreon_staff_recovery';
const pending=z.strictObject({nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),challengeId:z.uuid(),recoveryId:z.uuid()});
const mac=(key:Buffer,parts:string[])=>createHmac('sha256',key).update(parts.join('\0')).digest('hex');
const keys=()=>telegramAuthKeys(process.env.NOREON_SUPABASE_SMS_HOOK_SECRET);
const deliver=(address:string,text:string)=>createTelegramAdapter({config:outboundConfig()!,http:telegramHttpsPort}).deliverText(Object.freeze({address,text})).catch(()=>null);

/** Fixed texts; no clinical content. */
export const recoveryLinkText=(url:string)=>`Noreon՝ գաղտնաբառի վերականգնում։ Նոր գաղտնաբառ սահմանելու համար բացեք այս հղումը (գործում է 24 ժամ)՝\n${url}\nԵթե դուք չեք խնդրել, դիմեք ձեր ադմինիստրատորին։\n\nNoreon password reset. Open this link to set a new password (it works for 24 hours):\n${url}\nIf you did not ask for this, contact your administrator.`;
export const recoveryCodeText=(code:string)=>`Noreon գաղտնաբառի վերականգնման կոդ՝ ${code}։ Մի՛ փոխանցեք այն ոչ մեկին։\nNoreon password reset code: ${code}. Do not share it with anyone.`;

export type RecoveryIssueResult={ok:true}|{ok:false;reason:'self'|'admin_target'|'recent_binding'|'not_found'|'not_enrolled'|'rate_limited'|'unavailable'};
/** Admin: create the reset and send its link to the account's chat. The link is never returned. */
export async function issueStaffRecovery(admin:Pick<SupabaseClient<Database>,'rpc'>,userId:string,portal:RecoveryPortal,origin:string):Promise<RecoveryIssueResult>{
 if(!staffTelegramRecoveryReady())return {ok:false,reason:'unavailable'};
 const r=await admin.rpc('staff_telegram_recovery_issue',{p_user:userId,p_portal:portal});
 const parsed=z.union([z.object({ok:z.literal(true),recoveryId:z.uuid()}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(r.data);
 if(r.error||!parsed.success)return {ok:false,reason:'unavailable'};
 if(!parsed.data.ok){const code=parsed.data.code;return {ok:false,reason:(['self','admin_target','recent_binding','not_found','not_enrolled','rate_limited'] as const).find(c=>c===code)??'unavailable'};}
 // The link token is minted by the service and goes only to the chat (review M-1).
 const l=await telegramAuthService().rpc('staff_recovery_link',{p_recovery:parsed.data.recoveryId});
 const link=z.object({ok:z.literal(true),token:z.string().regex(/^[A-Za-z0-9_-]{32}$/),address:z.string().regex(/^[1-9][0-9]{0,15}$/)}).safeParse(l.data);
 if(l.error||!link.success)return {ok:false,reason:'unavailable'};
 const url=new URL(portal==='clinic'?'/clinic/real/recover':'/staff/real/recover/telegram',origin);
 url.hash=new URLSearchParams({recovery:parsed.data.recoveryId,token:link.data.token}).toString();
 const sent=await deliver(link.data.address,recoveryLinkText(url.href));
 return sent?.kind==='accepted'?{ok:true}:{ok:false,reason:'unavailable'};
}

export type RecoveryCodeResult={ok:true}|{ok:false;reason:'busy'|'busy_day'|'unavailable'};
export async function sendRecoveryCode(recoveryId:string,token:string):Promise<RecoveryCodeResult>{
 if(!staffTelegramRecoveryReady())return {ok:false,reason:'unavailable'};
 const k=keys(),code=String(randomInt(0,1_000_000)).padStart(6,'0'),nonce=randomBytes(32).toString('base64url');
 const r=await telegramAuthService().rpc('staff_recovery_code_begin',{p_recovery:recoveryId,p_token_hash:createHash('sha256').update(token,'utf8').digest('hex'),
  p_nonce_hmac:mac(k.digestKey,['noreon-recovery-nonce-v1',nonce]),p_code_hmac:mac(k.digestKey,['noreon-recovery-code-v1',recoveryId,code])});
 const begun=z.union([z.object({ok:z.literal(true),challengeId:z.uuid(),address:z.string().regex(/^[1-9][0-9]{0,15}$/)}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(r.data);
 if(r.error||!begun.success)return {ok:false,reason:'unavailable'};
 if(!begun.data.ok)return {ok:false,reason:begun.data.code==='rate_limited'?'busy':begun.data.code==='rate_limited_day'?'busy_day':'unavailable'};
 const sent=await deliver(begun.data.address,recoveryCodeText(code));
 if(sent?.kind!=='accepted')return {ok:false,reason:'unavailable'};
 (await cookies()).set(COOKIE,JSON.stringify({nonce,challengeId:begun.data.challengeId,recoveryId}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:600});
 return {ok:true};
}

export type RecoveryCompleteResult={ok:true;portal:RecoveryPortal}|{ok:false;reason:'invalid_code'|'resend'|'unconfirmed'|'unavailable'};
/** Code → verified (10 min, this browser) → new password on that account → all its sessions end. */
export async function completeRecovery(input:{recoveryId:string;code:string;password:string}):Promise<RecoveryCompleteResult>{
 if(!staffTelegramRecoveryReady())return {ok:false,reason:'unavailable'};
 const jar=await cookies();
 let held:z.infer<typeof pending>;
 try{held=pending.parse(JSON.parse(jar.get(COOKIE)?.value??''));}catch{return {ok:false,reason:'resend'};}
 if(held.recoveryId!==input.recoveryId)return {ok:false,reason:'resend'};
 const k=keys(),nonceHmac=mac(k.digestKey,['noreon-recovery-nonce-v1',held.nonce]),service=telegramAuthService();
 const v=await service.rpc('staff_recovery_code_verify',{p_challenge:held.challengeId,p_recovery:input.recoveryId,p_nonce_hmac:nonceHmac,
  p_code_hmac:mac(k.digestKey,['noreon-recovery-code-v1',input.recoveryId,input.code])});
 const verified=z.union([z.object({ok:z.literal(true),authUserId:z.uuid(),portal:z.enum(['staff','clinic'])}),z.object({ok:z.literal(false),code:z.string()})]).safeParse(v.data);
 if(v.error||!verified.success)return {ok:false,reason:'unavailable'};
 if(!verified.data.ok)return {ok:false,reason:verified.data.code==='wrong_code'?'invalid_code':'resend'};
 const updated=await service.auth.admin.updateUserById(verified.data.authUserId,{password:input.password});
 if(updated.error)return {ok:false,reason:'resend'};
 // The password is changed now; ending every session must be confirmed (review I-2). One retry.
 let done=false;
 for(let i=0;i<2&&!done;i++){const f=await service.rpc('staff_recovery_finish',{p_recovery:input.recoveryId,p_nonce_hmac:nonceHmac});done=!f.error&&z.object({ok:z.literal(true)}).safeParse(f.data).success;}
 if(!done)return {ok:false,reason:'unconfirmed'};
 jar.delete(COOKIE);
 return {ok:true,portal:verified.data.portal};
}
