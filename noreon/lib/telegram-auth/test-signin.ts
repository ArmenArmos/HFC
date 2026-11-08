import 'server-only';
import {createHash,createHmac,randomBytes} from 'node:crypto';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {captchaRequired} from '@/lib/captcha';
import {messagingServiceRoleKey} from '@/lib/messaging/auth-sms-hook-runtime';
import {telegramAuthService} from './runtime';

const COOKIE='noreon_test_signin';
type Env=Record<string,string|undefined>;
export const isTestSigninPhone=(phone:string)=>/^\+999[0-9]{5,11}$/.test(phone);
// This only opens the form when ordinary delivery is unavailable. Admission is always an RPC decision.
export const testSigninEntryEnabled=(env:Env)=>env.NOREON_TEST_SIGNIN_ENABLED==='true';
const held=z.object({nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/),requestId:z.uuid()});
const refused=z.object({ok:z.literal(false),code:z.string()});
const begun=z.union([z.object({ok:z.literal(true),requestId:z.uuid()}),refused]);
const checked=z.union([z.object({ok:z.literal(true),phone:z.string(),userId:z.uuid().nullable(),codeDigest:z.string().regex(/^[a-f0-9]{64}$/)}),refused]);
const claims=z.object({sub:z.uuid(),session_id:z.uuid(),role:z.literal('authenticated')});
const testAccount=z.object({id:z.uuid(),phone:z.string(),role:z.literal('authenticated'),email:z.string().nullish(),
 app_metadata:z.object({test_signin:z.literal(true),test_signin_phone:z.string(),test_signin_nonce:z.string().regex(/^[A-Za-z0-9_-]{43}$/)})});
const nonceHash=(nonce:string)=>createHash('sha256').update(nonce).digest('hex');
type RpcName='test_signin_direct_begin'|'test_signin_direct_check'|'test_signin_direct_verified'|'test_signin_direct_abandon';
// Temporary typed boundary until the integrator regenerates Database from the renamed migration.
async function rpc(db:ReturnType<typeof telegramAuthService>,name:RpcName,args:Record<string,unknown>){
 const r=await db.rpc(name as never,args as never);if(r.error)throw Error('Test sign-in unavailable');return r.data;
}

/** No Auth OTP request, Send-SMS hook, bot configuration or delivery provider is involved. */
export async function requestTestSigninCode(phone:string,captchaToken?:string){
 if(!isTestSigninPhone(phone))return {ok:false as const,reason:'invalid' as const};
 // Ordinary OTP issuance lets Auth validate CAPTCHA. This route never asks Auth to
 // issue an OTP, so validate it here before a challenge or phone quota is spent.
 if(captchaRequired(process.env)){
  const secret=process.env.HCAPTCHA_SECRET_KEY;
  if(!secret||!captchaToken)return {ok:false as const,reason:'unavailable' as const};
  try{
   const response=await fetch('https://api.hcaptcha.com/siteverify',{method:'POST',
    body:new URLSearchParams({secret,response:captchaToken,sitekey:process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY!}),
    signal:AbortSignal.timeout(4500),redirect:'error',cache:'no-store'});
   if(!response.ok||!z.object({success:z.literal(true)}).safeParse(await response.json()).success)return {ok:false as const,reason:'unavailable' as const};
  }catch{return {ok:false as const,reason:'unavailable' as const};}
 }
 const jar=await cookies();
 let current:z.infer<typeof held>|undefined;
 try{current=held.parse(JSON.parse(jar.get(COOKIE)?.value??''));}catch{/* New browser. */}
 const nonce=current?.nonce??randomBytes(32).toString('base64url');
 const b=begun.parse(await rpc(telegramAuthService(),'test_signin_direct_begin',{
  p_phone:phone,p_nonce_hmac:nonceHash(nonce),p_env_enabled:testSigninEntryEnabled(process.env),
 }));
 if(!b.ok)return {ok:false as const,reason:b.code==='rate_limited'?'busy' as const:'unavailable' as const};
 jar.set(COOKIE,JSON.stringify({nonce,requestId:b.requestId}),{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:900});
 return {ok:true as const};
}

/** Spend the issued code and browser-bound challenge before any Auth account mutation. */
export async function verifyTestSigninCode(phone:string,code:string){
 if(!isTestSigninPhone(phone)||!/^\d{6}$/.test(code))return {ok:false as const,reason:'invalid' as const};
 const jar=await cookies();
 let current:z.infer<typeof held>;
 try{current=held.parse(JSON.parse(jar.get(COOKIE)?.value??''));}catch{
  // A validly-shaped verification without this browser's challenge is still an audited refusal.
  await rpc(telegramAuthService(),'test_signin_direct_check',{p_request:null,p_nonce_hmac:null,p_phone:phone,p_test_code:code,p_env_enabled:testSigninEntryEnabled(process.env)});
  return {ok:false as const,reason:'resend' as const};
 }
 const db=telegramAuthService(),args={p_request:current.requestId,p_nonce_hmac:nonceHash(current.nonce),p_phone:phone,p_env_enabled:testSigninEntryEnabled(process.env)};
 const c=checked.parse(await rpc(db,'test_signin_direct_check',{...args,p_test_code:code}));
 if(!c.ok)return {ok:false as const,reason:c.code==='wrong_code'?'invalid' as const:'resend' as const};
 if(c.phone!==phone)return {ok:false as const,reason:'resend' as const};
 // Auth JS supports generated email links, but no equivalent phone login token.
 // Set a private credential only at creation. Reconstruct it from a random account
 // nonce and the server key, never from the admin code or public metadata alone.
 // Key rotation fails closed; never repair/adopt an existing account by changing it.
 // This avoids the read/update race entirely: existing credentials are never mutated.
 // Do not sign in on `db`: doing so would replace its service-role authorization.
 const exchange=telegramAuthService();
 try{
  const credential=(nonce:string)=>createHmac('sha256',messagingServiceRoleKey(process.env))
   .update(['noreon-test-signin-password-v1',phone,nonce].join('\0')).digest('base64url');
  const nonce=randomBytes(32).toString('base64url');
  const account=c.userId
   ?await db.auth.admin.getUserById(c.userId)
   :await db.auth.admin.createUser({phone,password:credential(nonce),phone_confirm:true,
    app_metadata:{test_signin:true,test_signin_phone:phone,test_signin_nonce:nonce}});
  const user=testAccount.parse(account.data.user);
  if(account.error||user.phone!==phone.slice(1)||user.email||user.app_metadata.test_signin_phone!==phone||(c.userId&&user.id!==c.userId))throw Error('Test account unavailable');
  const password=credential(user.app_metadata.test_signin_nonce);
  const opened=await exchange.auth.signInWithPassword({phone,password});
  const session=opened.data.session;
  if(opened.error||!session||opened.data.user?.id!==user.id||opened.data.user.phone!==phone.slice(1))throw Error('Test session unavailable');
  const identity=claims.parse(JSON.parse(Buffer.from(session.access_token.split('.')[1]??'','base64url').toString('utf8')));
  if(identity.sub!==user.id)throw Error('Test session unavailable');
  const refreshed=await db.auth.admin.getUserById(user.id);
  const latest=testAccount.parse(refreshed.data.user);
  if(refreshed.error||latest.id!==user.id||latest.phone!==user.phone||latest.email||latest.app_metadata.test_signin_phone!==phone
   ||latest.app_metadata.test_signin_nonce!==user.app_metadata.test_signin_nonce)throw Error('Test account unavailable');
  const done=await rpc(db,'test_signin_direct_verified',{...args,p_code_digest:c.codeDigest,p_user:user.id,p_session:identity.session_id});
  if(!z.object({ok:z.literal(true),result:z.literal('signed_in')}).safeParse(done).success)throw Error('Test session refused');
  // Only a finalized session reaches the member's cookies; no privileged claims are minted here.
  const installed=await (await createClient()).auth.setSession({access_token:session.access_token,refresh_token:session.refresh_token});
  if(installed.error)throw Error('Test session unavailable');
  jar.delete(COOKIE);
  return {ok:true as const};
 }catch{
  // Provisioned marked accounts persist for later challenges, even if this first
  // exchange fails. Only this exchange's session is revoked. A read-then-delete
  // of the account could delete an identity promoted to a real/staff/clinic account.
  await exchange.auth.signOut({scope:'local'}).catch(()=>null);
  await rpc(db,'test_signin_direct_abandon',args).catch(()=>null);
  jar.delete(COOKIE);
  return {ok:false as const,reason:'resend' as const};
 }
}
