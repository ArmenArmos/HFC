import 'server-only';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {Database} from '@/lib/db/types';
import {messagingServiceRoleKey} from '@/lib/messaging/auth-sms-hook-runtime';
import {createTelegramAdapter} from '@/lib/telegram-channel/outbound';
import {telegramHttpsPort} from '@/lib/telegram-channel/link';
import {outboundConfig,telegramEnabled} from '@/lib/telegram-runtime/config';
import {telegramAuthKeys,type TelegramAuthHookStore,type TelegramCodeSender} from './hook';

type Env=Record<string,string|undefined>;

/**
 * Telegram sign-in codes are on only when every switch agrees: the Telegram channel,
 * the auth flag, the hook provider and its readiness. Ships with all of them off.
 */
export const telegramAuthEnabled=(env:Env=process.env)=>telegramEnabled(env)&&env.NOREON_TELEGRAM_AUTH_ENABLED==='true'
 &&env.NOREON_PHONE_OTP_PROVIDER==='telegram-hook'&&env.NOREON_PHONE_OTP_HOOK_READY==='true'&&Boolean(env.NOREON_TELEGRAM_BOT_TOKEN)&&outboundConfig(env)!==undefined;

/** Privileged client for the T-auth RPCs; never the member's session. */
export function telegramAuthService(env:Env=process.env):SupabaseClient<Database>{
 return createClient<Database>(z.url().parse(env.NEXT_PUBLIC_SUPABASE_URL),messagingServiceRoleKey(env),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}

export function telegramAuthHookStore(db:SupabaseClient<Database>,env:Env=process.env):TelegramAuthHookStore{
 return {
  async claim(phone,webhookId,bodyHmac,ms){const r=await (phone.startsWith('+999')?db.rpc('test_signin_claim' as never,{p_phone:phone,p_webhook_id:webhookId,p_body_hmac:bodyHmac,p_env_enabled:env.NOREON_TEST_SIGNIN_ENABLED==='true'} as never):db.rpc('auth_code_request_claim',{p_phone:phone,p_webhook_id:webhookId,p_body_hmac:bodyHmac})).abortSignal(AbortSignal.timeout(ms));if(r.error)throw Error('storage');return r.data;},
  async finish(requestId,webhookId,outcome,digest,ms){const r=await db.rpc('auth_code_request_finish',{p_request:requestId,p_webhook_id:webhookId,p_outcome:outcome,p_code_digest:digest??undefined}).abortSignal(AbortSignal.timeout(ms));if(r.error)throw Error('storage');return r.data;},
  async seal(requestId,webhookId,sealed,ms){const r=await db.rpc('auth_code_request_seal',{p_request:requestId,p_webhook_id:webhookId,p_sealed:sealed}).abortSignal(AbortSignal.timeout(ms));if(r.error)throw Error('storage');return r.data;},
 };
}

/** Configuration resolved without creating a privileged client before the signature is checked. */
export function telegramAuthHookRuntime(env:Env=process.env){
 if(!telegramAuthEnabled(env))return null;
 const keys=telegramAuthKeys(env.NOREON_SUPABASE_SMS_HOOK_SECRET);
 const config=outboundConfig(env)!;
 const send:TelegramCodeSender=async(address,text)=>createTelegramAdapter({config,http:telegramHttpsPort}).deliverText(Object.freeze({address,text}));
 return {keys,store:()=>telegramAuthHookStore(telegramAuthService(env),env),send};
}
