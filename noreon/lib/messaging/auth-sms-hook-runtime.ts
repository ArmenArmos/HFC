import 'server-only';
import {createClient,type SupabaseClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {Database} from '@/lib/db/types';
import {parseAuthSmsHookConfig,type AuthSmsHookStore,type HookClaim} from './auth-sms-hook';
const claimSchema=z.union([z.object({status:z.literal('send'),claimToken:z.uuid(),previousReference:z.string().regex(/^VE[0-9a-fA-F]{32}$/).optional()}).strict(),z.object({status:z.enum(['accepted','submitting','failed','unknown'])}).strict()]);
export function authSmsHookEnabled(env:Record<string,string|undefined>):boolean {
 return env.NOREON_DEPLOYMENT_TARGET==='app'&&env.NOREON_SHARED_DEMO!=='true'
 &&env.NOREON_REGISTRATION_ENABLED==='true'&&['brevo-sms-hook','twilio-sms-hook','twilio-verify-hook'].includes(env.NOREON_PHONE_OTP_PROVIDER??'')&&env.NOREON_PHONE_OTP_HOOK_READY==='true'
 &&(env.NOREON_PHONE_OTP_PROVIDER==='twilio-verify-hook'?env.NOREON_TWILIO_VERIFY_READY==='true':env.NOREON_PHONE_OTP_PROVIDER==='twilio-sms-hook'?env.NOREON_TWILIO_SMS_READY==='true':env.NOREON_BREVO_SMS_READY==='true')&&env.NOREON_REGISTRATION_ALLOWED_PREFIXES?.trim()==='+374';
}
export function authSmsHookStore(db:SupabaseClient<Database>,provider:'brevo'|'twilio'|'twilio-verify'='brevo'):AuthSmsHookStore {
 return {
  async claim(id,digest,ms,verificationDigest,recipientDigest):Promise<HookClaim>{const r=await (provider==='twilio-verify'?db.rpc('claim_auth_sms_verify_hook',{p_webhook_id:id,p_body_digest:digest,p_verification_digest:verificationDigest!,p_recipient_digest:recipientDigest!}):db.rpc('claim_auth_sms_hook',{p_webhook_id:id,p_body_digest:digest,p_provider:provider,p_channel:'sms'})).abortSignal(AbortSignal.timeout(ms));if(r.error)throw Error('storage');return claimSchema.parse(r.data);},
  async finish(id,token,outcome,ms){const r=await db.rpc('finish_auth_sms_hook',{p_webhook_id:id,p_claim_token:token,p_status:outcome.status,p_reference:outcome.status==='accepted'?outcome.reference:undefined}).abortSignal(AbortSignal.timeout(ms));if(r.error)throw Error('storage');return r.data===true;}
 };
}
/** Configuration is resolved without creating any privileged client before verification. */
export function authSmsHookRuntime(env:Record<string,string|undefined>=process.env){
 if(!authSmsHookEnabled(env))return null;
 const config=parseAuthSmsHookConfig(env.NOREON_PHONE_OTP_PROVIDER==='twilio-verify-hook'?{hookSecret:env.NOREON_SUPABASE_SMS_HOOK_SECRET,provider:'twilio-verify',verify:{accountSid:env.NOREON_TWILIO_ACCOUNT_SID,serviceSid:env.NOREON_TWILIO_VERIFY_SERVICE_SID,apiKeySid:env.NOREON_TWILIO_VERIFY_API_KEY_SID,apiKeySecret:env.NOREON_TWILIO_VERIFY_API_KEY_SECRET}}:env.NOREON_PHONE_OTP_PROVIDER==='twilio-sms-hook'?{hookSecret:env.NOREON_SUPABASE_SMS_HOOK_SECRET,provider:'twilio',twilio:{accountSid:env.NOREON_TWILIO_ACCOUNT_SID,authToken:env.NOREON_TWILIO_AUTH_TOKEN,apiKeySid:env.NOREON_TWILIO_API_KEY_SID,apiKeySecret:env.NOREON_TWILIO_API_KEY_SECRET,smsFrom:env.NOREON_TWILIO_SMS_FROM}}:{hookSecret:env.NOREON_SUPABASE_SMS_HOOK_SECRET,brevo:{apiKey:env.NOREON_BREVO_API_KEY,sender:env.NOREON_BREVO_SMS_SENDER}});
 const url=z.url().parse(env.NEXT_PUBLIC_SUPABASE_URL);
 return {config,store:()=>authSmsHookStore(createClient<Database>(url,messagingServiceRoleKey(env),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}}),config.provider)};
}

/** An explicitly configured invalid/empty messaging key must never fall back. */
export function messagingServiceRoleKey(env:Record<string,string|undefined>):string {return z.string().min(32).parse(env.NOREON_MESSAGING_SERVICE_ROLE_KEY===undefined?env.SUPABASE_SERVICE_ROLE_KEY:env.NOREON_MESSAGING_SERVICE_ROLE_KEY);}
