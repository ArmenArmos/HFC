import 'server-only';
import {createHmac,randomBytes,randomInt} from 'node:crypto';
import {z} from 'zod';
import {createTelegramAdapter} from '@/lib/telegram-channel/outbound';
import {telegramHttpsPort} from '@/lib/telegram-channel/link';
import {outboundConfig} from '@/lib/telegram-runtime/config';
import {telegramAuthKeys} from './hook';
import {telegramAuthService} from './runtime';

export type StaffCodeSession={userId:string;sessionId:string};
export const staffCodePending=z.strictObject({nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),challengeId:z.uuid()});
const begun=z.union([z.object({ok:z.literal(true),challengeId:z.uuid(),address:z.string().regex(/^[1-9][0-9]{0,15}$/)}),z.object({ok:z.literal(false),code:z.string()})]);
const verified=z.union([z.object({ok:z.literal(true),result:z.literal('admitted')}),z.object({ok:z.literal(false),code:z.string()})]);
const mac=(key:Buffer,parts:string[])=>createHmac('sha256',key).update(parts.join('\0')).digest('hex');

/** Fixed staff code text; no clinical content. */
export const staffCodeText=(code:string)=>`Նորեոն Հելթ աշխատակցի մուտքի կոդ՝ ${code}։ Մի՛ փոխանցեք այն ոչ մեկին։\nNoreon staff sign-in code: ${code}. Do not share it with anyone.`;

export type StaffCodeSendResult={ok:true;pending:z.infer<typeof staffCodePending>}|{ok:false;reason:'not_enrolled'|'busy'|'unavailable'};
/** Same challenge and delivery for browser sign-in and the dedicated bot session. No cookies here. */
export async function beginStaffSessionCode(session:StaffCodeSession):Promise<StaffCodeSendResult>{
 const keys=telegramAuthKeys(process.env.NOREON_SUPABASE_SMS_HOOK_SECRET);
 const code=String(randomInt(0,1_000_000)).padStart(6,'0'),nonce=randomBytes(32).toString('base64url');
 const r=await telegramAuthService().rpc('staff_signin_code_begin',{p_user:session.userId,p_session:session.sessionId,
  p_nonce_hmac:mac(keys.digestKey,['noreon-staff-nonce-v1',nonce]),p_code_hmac:mac(keys.digestKey,['noreon-staff-code-v1',session.userId,session.sessionId,code])});
 const opened=begun.safeParse(r.data);
 if(r.error||!opened.success)return {ok:false,reason:'unavailable'};
 if(!opened.data.ok)return {ok:false,reason:opened.data.code==='not_enrolled'?'not_enrolled':opened.data.code==='rate_limited'?'busy':'unavailable'};
 const outcome=await createTelegramAdapter({config:outboundConfig()!,http:telegramHttpsPort}).deliverText(Object.freeze({address:opened.data.address,text:staffCodeText(code)})).catch(()=>null);
 if(outcome?.kind!=='accepted')return {ok:false,reason:'unavailable'};
 return {ok:true,pending:{nonce,challengeId:opened.data.challengeId}};
}
export type StaffCodeVerifyResult={ok:true}|{ok:false;reason:'invalid'|'resend'|'unavailable'};
export async function verifyStaffSessionCode(session:StaffCodeSession,held:z.infer<typeof staffCodePending>,code:string):Promise<StaffCodeVerifyResult>{
 if(!/^\d{6}$/.test(code))return {ok:false,reason:'invalid'};
 const keys=telegramAuthKeys(process.env.NOREON_SUPABASE_SMS_HOOK_SECRET);
 const r=await telegramAuthService().rpc('staff_signin_code_verify',{p_challenge:held.challengeId,p_user:session.userId,p_session:session.sessionId,
  p_nonce_hmac:mac(keys.digestKey,['noreon-staff-nonce-v1',held.nonce]),p_code_hmac:mac(keys.digestKey,['noreon-staff-code-v1',session.userId,session.sessionId,code])});
 const result=verified.safeParse(r.data);
 if(r.error||!result.success)return {ok:false,reason:'unavailable'};
 if(!result.data.ok)return {ok:false,reason:result.data.code==='wrong_code'?'invalid':'resend'};
 return {ok:true};
}
