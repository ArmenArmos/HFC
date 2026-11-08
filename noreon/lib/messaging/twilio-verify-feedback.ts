import 'server-only';
import {createClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {Database} from '@/lib/db/types';
import {authSmsHookRuntime,messagingServiceRoleKey} from './auth-sms-hook-runtime';
import {verifyAssociationDigest} from './auth-sms-hook';
import {approveTwilioVerification} from './twilio-verify';
const claimSchema=z.object({webhookId:z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),claimToken:z.uuid(),reference:z.string().regex(/^VE[0-9a-fA-F]{32}$/)}).strict();
/** No browser-supplied SID is accepted. The digest selects an accepted, recent send. */
export async function reportVerifiedPhone(phone:string,code:string,signal?:AbortSignal):Promise<void>{
 if(signal?.aborted)return;
 const runtime=authSmsHookRuntime();if(runtime?.config.provider!=='twilio-verify')return;
 const db=createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,messagingServiceRoleKey(process.env),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 const result=await db.rpc('claim_auth_verify_feedback',{p_verification_digest:verifyAssociationDigest(runtime.config,phone,code)}).abortSignal(AbortSignal.timeout(900));
 if(result.error||!result.data||signal?.aborted)return;
 const claim=claimSchema.parse(result.data);
 const outcome=await approveTwilioVerification(runtime.config.verify,claim.reference);
 await db.rpc('finish_auth_verify_feedback',{p_webhook_id:claim.webhookId,p_claim_token:claim.claimToken,p_status:outcome.status}).abortSignal(AbortSignal.timeout(900));
}
/** Called with the direct Supabase verifyOtp result, never an existing session. */
export async function completeVerifiedPhone(phone:string,code:string,result:{error:unknown;data:{user:{phone?:string}|null}},feedback:typeof reportVerifiedPhone=reportVerifiedPhone):Promise<boolean>{
 if(result.error||!result.data.user?.phone)return false;
 const verified=result.data.user.phone.startsWith('+')?result.data.user.phone:'+'+result.data.user.phone;
 if(verified!==phone)return false;
 try{await feedback(phone,code);}catch{/* Durable submitting/unknown feedback is reconciled operationally; authentication already succeeded. */}
 return true;
}
