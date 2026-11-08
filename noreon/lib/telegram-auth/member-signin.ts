import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {log} from '@/lib/observability/logger';
import {requestTelegramDispatch} from '@/lib/telegram-runtime/dispatch-trigger';
import {telegramBotUsername} from '@/lib/telegram-runtime/config';
import {codeDigest,nonceDigest,telegramAuthKeys,unsealCode} from './hook';
import {telegramAuthEnabled,telegramAuthService} from './runtime';

/**
 * Member sign-in with codes delivered in Telegram (T-auth v5.1 §3). This browser holds
 * a random nonce and its current request id in an HttpOnly cookie; the database keeps
 * only their keyed digests. A code is accepted only from the browser whose request
 * the hook delivered it for (app-level R3).
 */
const COOKIE='noreon_tauth';
const state=z.strictObject({nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),requestId:z.uuid().optional()});
type SignInState=z.infer<typeof state>;

async function readState():Promise<SignInState|null>{
 const raw=(await cookies()).get(COOKIE)?.value;
 if(!raw)return null;
 try{const parsed=state.safeParse(JSON.parse(raw));return parsed.success?parsed.data:null;}catch{return null;}
}
async function writeState(value:SignInState){
 (await cookies()).set(COOKIE,JSON.stringify(value),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:900});
}
async function clearState(){(await cookies()).delete(COOKIE);}

const contactRefusal=z.enum(['phone_mismatch','not_own_contact','stale']);
export type ContactRefusal=z.infer<typeof contactRefusal>;
export type TelegramCodeRequestResult=
 |{ok:true}
 |{ok:false;reason:'prove';url:string|null;contactRefusal?:ContactRefusal}
 |{ok:false;reason:'busy'|'unavailable'|'invalid'|'pending'};

const begun=z.union([z.object({ok:z.literal(true),requestId:z.uuid()}),z.object({ok:z.literal(false),code:z.string()})]);
const status=z.union([z.object({ok:z.literal(true),state:z.string(),refusal:z.string().nullable()}),z.object({ok:z.literal(false),code:z.string()})]);
const challenge=z.union([z.object({ok:z.literal(true),token:z.string().regex(/^[A-Za-z0-9_-]{32}$/),expiresAt:z.string()}),z.object({ok:z.literal(false),code:z.string()})]);

/**
 * Opens one request, asks Supabase for a code, then reads what the hook did. When the
 * phone has no usable Telegram binding (none yet, or its 30-day proof lapsed) nothing is
 * sent and the member is given a bot link to share their number first.
 */
/**
 * `shownLink`: the token of the bot link the page shows. When that exact link is still open for this phone and
 * browser, no new one is made (url null), so returns from the bot do not use up the browser's links for the hour.
 */
export async function requestTelegramCode(phone:string,captchaToken?:string,shownLink?:string):Promise<TelegramCodeRequestResult>{
 const started=Date.now();
 let errorCode='unexpected_error';
 try{
 if(!telegramAuthEnabled()){errorCode='disabled';return {ok:false,reason:'unavailable'};}
 const keys=telegramAuthKeys(process.env.NOREON_SUPABASE_SMS_HOOK_SECRET);
 const service=telegramAuthService();
 const current=await readState();
 const nonce=current?.nonce??randomBytes(32).toString('base64url');
 const nonceHmac=nonceDigest(keys,nonce);
 // A return from the bot can beat the inbox sweep. Do not spend an Auth code request
 // until this browser's queued contact is processed, or leave the member time to retry.
 if(current){
  const deadline=Date.now()+4000;
  let dispatchStarted=false;
  let seen=false;
  for(;;){
   // Every read gets only what is left of the 4 s; a slow or failed read after a pending one stays pending.
   const remaining=deadline-Date.now();
   if(remaining<=0){errorCode='pending';return {ok:false,reason:'pending'};}
   let pending=seen,timer:ReturnType<typeof setTimeout>|undefined;
   try{
    const proof=await Promise.race([service.rpc('auth_code_request_proof_state',{p_phone:phone,p_nonce_hmac:nonceHmac}),
     new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('deadline')),remaining);})]);
    pending=proof.error?seen:z.object({ok:z.literal(true),state:z.literal('pending')}).safeParse(proof.data).success;
   }catch{/* No answer: carry on unless this contact was already seen queued. */}finally{clearTimeout(timer);}
   if(!pending)break;
   seen=true;
   if(!dispatchStarted){dispatchStarted=true;void requestTelegramDispatch().catch(()=>{});}
   const left=deadline-Date.now();
   if(left<=0){errorCode='pending';return {ok:false,reason:'pending'};}
   await new Promise(resolve=>setTimeout(resolve,Math.min(500,left)));
  }
 }
 const b=await service.rpc('auth_code_request_begin',{p_phone:phone,p_nonce_hmac:nonceHmac});
 if(b.error){errorCode='begin_failed';return {ok:false,reason:'unavailable'};}
 const opened=begun.safeParse(b.data);
 if(!opened.success){errorCode='begin_invalid';return {ok:false,reason:'unavailable'};}
 if(!opened.data.ok){errorCode=`begin_${['busy','invalid'].includes(opened.data.code)?opened.data.code:'other'}`;return {ok:false,reason:opened.data.code==='busy'?'busy':opened.data.code==='invalid'?'invalid':'unavailable'};}
 const requestId=opened.data.requestId;
 await writeState({nonce,requestId});
 // The hook decides; a refused or failed send surfaces as an Auth error, read back below.
 let authFailed=true;
 try{authFailed=Boolean((await (await createClient()).auth.signInWithOtp({phone,options:{captchaToken,channel:'sms'}})).error);}catch{/* not confirmed */}
 const s=await service.rpc('auth_code_request_status',{p_request:requestId,p_nonce_hmac:nonceHmac});
 const read=status.safeParse(s.data);
 if(!s.error&&read.success&&read.data.ok){
  if(read.data.state==='sent'&&!authFailed){errorCode='sent';return {ok:true};}
  if(read.data.state==='refused'&&(read.data.refusal==='no_destination'||read.data.refusal==='reproof_required')){
   let refusal:ContactRefusal|undefined;
   // The page's link is still open: keep it instead of using up one of this browser's links for the hour.
   if(shownLink&&/^[A-Za-z0-9_-]{32}$/.test(shownLink)){
    const open=await service.rpc('auth_code_request_link_open',{p_phone:phone,p_nonce_hmac:nonceHmac,p_token_hash:createHash('sha256').update(shownLink,'utf8').digest('hex')});
    const link=z.object({ok:z.literal(true),open:z.boolean(),contactRefusal:contactRefusal.optional()}).safeParse(open.data);
    if(!open.error&&link.success){
     refusal=link.data.contactRefusal;
     if(link.data.open){errorCode=`prove_kept_${read.data.refusal}`;return {ok:false,reason:'prove',url:null,...(refusal?{contactRefusal:refusal}:{})};}
    }
   }
   const result=await proveLink(phone,nonceHmac);
   errorCode=!result.ok&&result.reason==='prove'?`prove_${read.data.refusal}`:'prove_failed';
   return !result.ok&&result.reason==='prove'&&refusal?{...result,contactRefusal:refusal}:result;
  }
  errorCode=authFailed?'auth_failed':`status_${['issuing','sending','sent','failed','unknown','verified','cancelled','refused','exhausted'].includes(read.data.state)?read.data.state:'other'}`;
 }else{
  errorCode=s.error?'status_failed':read.success&&!read.data.ok?'status_unavailable':'status_invalid';
 }
 // Auth did not confirm the send (CAPTCHA, rate limit, error after the hook): the request is
 // never verifiable and its lease is released at once (§3.5).
 await service.rpc('auth_code_request_abandon',{p_request:requestId,p_nonce_hmac:nonceHmac});
 return {ok:false,reason:'unavailable'};
 }finally{log.info('telegram_signin_code',{error_code:errorCode,duration_ms:Date.now()-started});}
}

/** A bot link for sharing this phone's contact, tied to this browser's nonce. */
async function proveLink(phone:string,nonceHmac:string):Promise<TelegramCodeRequestResult>{
 const username=telegramBotUsername();if(!username)return {ok:false,reason:'unavailable'};
 const c=await telegramAuthService().rpc('telegram_auth_challenge_create',{p_purpose:'member_signin',p_phone:phone,p_nonce_hmac:nonceHmac});
 const made=challenge.safeParse(c.data);
 if(c.error||!made.success||!made.data.ok)return {ok:false,reason:made.success&&!made.data.ok&&made.data.code==='rate_limited'?'busy':'unavailable'};
 return {ok:false,reason:'prove',url:`https://t.me/${username}?start=${made.data.token}`};
}

/**
 * For a member who no longer has the Telegram account their codes go to: prove the
 * number from another Telegram account. The next code goes there, and verifying it
 * replaces the old account and asks for one more sign-in (§2, C4).
 */
export async function startTelegramProof(phone:string):Promise<TelegramCodeRequestResult>{
 if(!telegramAuthEnabled())return {ok:false,reason:'unavailable'};
 const keys=telegramAuthKeys(process.env.NOREON_SUPABASE_SMS_HOOK_SECRET);
 const current=await readState();
 if(!current?.requestId)return {ok:false,reason:'unavailable'};
 // Only a recent request of this browser that reached the hook (so passed Auth's CAPTCHA) may ask, twice at most.
 const nonceHmac=nonceDigest(keys,current.nonce);
 const allowed=await telegramAuthService().rpc('auth_code_request_allow_proof',{p_request:current.requestId,p_nonce_hmac:nonceHmac});
 if(allowed.error||!z.object({ok:z.literal(true)}).safeParse(allowed.data).success)return {ok:false,reason:'unavailable'};
 return proveLink(phone,nonceHmac);
}

const checked=z.union([z.object({ok:z.literal(true),phone:z.string(),sealed:z.string().optional()}),z.object({ok:z.literal(false),code:z.string()})]);
const verified=z.union([z.object({ok:z.literal(true),result:z.enum(['signed_in','sign_in_again']),binding:z.string().optional()}),z.object({ok:z.literal(false),code:z.string()})]);
const claims=z.object({session_id:z.uuid(),sub:z.uuid()});

export type TelegramCodeVerifyResult={ok:true}|{ok:false;reason:'invalid'|'resend'|'sign_in_again'|'unavailable'};

/** The typed code must match this browser's request before Supabase sees it. */
export async function verifyTelegramCode(phone:string,code:string):Promise<TelegramCodeVerifyResult>{
 if(!telegramAuthEnabled())return {ok:false,reason:'unavailable'};
 const current=await readState();
 if(!current?.requestId)return {ok:false,reason:'resend'};
 const keys=telegramAuthKeys(process.env.NOREON_SUPABASE_SMS_HOOK_SECRET);
 const service=telegramAuthService();
 const nonceHmac=nonceDigest(keys,current.nonce);
 let digest=codeDigest(keys,current.requestId,phone,code);
 const c=await (phone.startsWith('+999')?service.rpc('test_signin_check' as never,{p_request:current.requestId,p_nonce_hmac:nonceHmac,p_test_code:code,p_code_digest:digest,p_env_enabled:process.env.NOREON_TEST_SIGNIN_ENABLED==='true'} as never):service.rpc('auth_code_request_check',{p_request:current.requestId,p_nonce_hmac:nonceHmac,p_code_digest:digest}));
 const check=checked.safeParse(c.data);
 if(c.error||!check.success)return {ok:false,reason:'unavailable'};
 if(!check.data.ok)return {ok:false,reason:check.data.code==='wrong_code'?'invalid':'resend'};
 if(check.data.phone!==phone)return {ok:false,reason:'resend'};
 // The admin-set test credential never leaves this server as a real Auth OTP.
 // After the one-use exchange, check and verify the actual sealed Supabase code.
 if(check.data.sealed){
  const otp=unsealCode(keys,current.requestId,check.data.sealed);
  if(!otp)return {ok:false,reason:'resend'};
  code=otp;digest=codeDigest(keys,current.requestId,phone,otp);
  const actual=await service.rpc('auth_code_request_check',{p_request:current.requestId,p_nonce_hmac:nonceHmac,p_code_digest:digest});
  const parsed=checked.safeParse(actual.data);
  if(actual.error||!parsed.success||!parsed.data.ok||parsed.data.phone!==phone)return {ok:false,reason:'resend'};
 }
 const client=await createClient();
 const result=await client.auth.verifyOtp({phone,token:code,type:'sms'});
 if(result.error||!result.data.session)return {ok:false,reason:'invalid'};
 // The session must be recorded on the request (binding finalised, cleanup exemption);
 // if that cannot be confirmed the member is signed out here and asked for a new code.
 let done:z.infer<typeof verified>|null=null,userId:string|null=null;
 try{
  const session=claims.parse(JSON.parse(Buffer.from(result.data.session.access_token.split('.')[1]??'','base64url').toString('utf8')));
  userId=session.sub;
  for(let i=0;i<3&&!done;i++){
   const v=await (phone.startsWith('+999')?service.rpc('test_signin_verified' as never,{p_request:current.requestId,p_nonce_hmac:nonceHmac,p_code_digest:digest,p_user:session.sub,p_session:session.session_id,p_env_enabled:process.env.NOREON_TEST_SIGNIN_ENABLED==='true'} as never):service.rpc('auth_code_request_verified',{p_request:current.requestId,p_nonce_hmac:nonceHmac,p_code_digest:digest,p_user:session.sub,p_session:session.session_id}));
   const parsed=verified.safeParse(v.data);if(!v.error&&parsed.success)done=parsed.data;
  }
 }catch{done=null;}
 await clearState();
 if(!done||!done.ok){await client.auth.signOut({scope:'local'}).catch(()=>null);return {ok:false,reason:'resend'};}
 // Replacing a Telegram account ends every session, this one included (C4).
 if(done.result==='sign_in_again'){await client.auth.signOut({scope:'local'}).catch(()=>null);return {ok:false,reason:'sign_in_again'};}
 // Consent came with enrolment: this Telegram chat also carries replies once eligible. Best effort;
 // the Telegram page and enrolment retry it.
 if(userId)await service.rpc('telegram_replies_auto_link_for',{p_user:userId}).then(()=>null,()=>null);
 return {ok:true};
}
