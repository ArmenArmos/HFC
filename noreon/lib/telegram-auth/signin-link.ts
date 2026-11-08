import 'server-only';
import {createHash,randomBytes} from 'node:crypto';
import {cookies} from 'next/headers';
import {z} from 'zod';
import {createClient} from '@/lib/supabase/server';
import {codeDigest,nonceDigest,telegramAuthKeys,unsealCode} from './hook';
import {telegramAuthService} from './runtime';
import {signinLinkOrigin} from './signin-link-config';
import {CONTINUE_PATHS,type ContinueStep} from '@/lib/patient/continue-path';
import {patientIdentity} from '@/lib/patient/auth';

/**
 * One-tap sign-in from a link the bot sent to the member's own chat (17 Oct 2026). The link's
 * token is single use, 24 hours (10 minutes until 18 Oct 2026), bound to the member and that chat's binding. Continue starts a
 * normal Supabase phone sign-in for that member; the hook seals the code instead of sending it,
 * and this server reads it once, checks it like a typed code and verifies it. Never for staff.
 */
const COOKIE='noreon_tlink';
// The next-step replies' pages, and the member notices' pages (care, results, Home).
const STEP_PATHS=CONTINUE_PATHS;
const STEPS=Object.keys(STEP_PATHS) as [ContinueStep,...ContinueStep[]];
const begun=z.union([z.object({ok:z.literal(true),signedIn:z.literal(true),step:z.enum(STEPS)}),z.object({ok:z.literal(true),requestId:z.uuid(),phone:z.string().regex(/^\+[1-9][0-9]{6,14}$/),step:z.enum(STEPS)}),
 z.object({ok:z.literal(false),code:z.string(),step:z.enum(STEPS).optional()})]);
const sealed=z.union([z.object({ok:z.literal(true),sealed:z.string(),phone:z.string()}),z.object({ok:z.literal(false),code:z.string()})]);
const claims=z.object({session_id:z.uuid(),sub:z.uuid()});

/** `path` on expired: the page the link was for, so normal sign-in can continue there. */
/** `path` on expired: the page the link was for, so normal sign-in can continue there. `maskedPhone`: who is (or stays) signed in. */
export type SigninLinkResult={ok:true;path:string;maskedPhone:string}|{ok:false;reason:'expired';path?:string}
 |{ok:false;reason:'other_account';maskedPhone:string}|{ok:false;reason:'busy'|'captcha'|'unavailable'};
type Rpc=(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error?:unknown}>;
type AuthClient={auth:{signInWithOtp(a:{phone:string;options:{captchaToken?:string;channel:'sms'}}):Promise<{error:{message:string}|null}>;
 verifyOtp(a:{phone:string;token:string;type:'sms'}):Promise<{error:unknown;data:{session:{access_token:string}|null}}>;signOut(a:{scope:'local'}):Promise<unknown>}};
type Jar={get(name:string):{value:string}|undefined;set(name:string,value:string,o:object):void;delete(o:{name:string;path:string}):void};
/** The outside world of a redeem; injected by the checks, real by default. */
export type SigninLinkDeps={enabled:()=>boolean;identity:()=>Promise<{userId:string;phone:string}|null>;rpc:Rpc;client:()=>Promise<AuthClient>;jar:()=>Promise<Jar>;secret:string|undefined};
// The service client is made on first use: a switched-off page never needs its key.
const realDeps=():SigninLinkDeps=>{let service:ReturnType<typeof telegramAuthService>|undefined;return {enabled:()=>!!signinLinkOrigin(),identity:patientIdentity,rpc:(n,a)=>(service??=telegramAuthService()).rpc(n as never,a as never) as never,
 client:async()=>(await createClient()) as unknown as AuthClient,jar:async()=>(await cookies()) as unknown as Jar,secret:process.env.NOREON_SUPABASE_SMS_HOOK_SECRET};};
/** "+374 •••••• 01": enough for a member to recognise their own number, nothing more. */
export const maskPhone=(phone:string)=>{const p=phone.startsWith('+')?phone:`+${phone}`;return `${p.slice(0,4)} •••••• ${p.slice(-2)}`;};
/**
 * `switchAccount`: the person confirmed they want this link's account although another member is signed
 * in on this browser (review F-1: a forwarded link never swaps an account silently).
 */
export async function redeemSigninLink(token:string,captchaToken?:string,options:{switchAccount?:boolean}={},deps:SigninLinkDeps=realDeps()):Promise<SigninLinkResult>{
 if(!deps.enabled()||!/^[A-Za-z0-9_-]{32}$/.test(token))return deps.enabled()?{ok:false,reason:'expired'}:{ok:false,reason:'unavailable'};
 const keys=telegramAuthKeys(deps.secret),service={rpc:deps.rpc},jar=await deps.jar();
 const current=await deps.identity();
 // One browser nonce per open link: a retry from this browser may continue; another browser may not.
 let nonce=jar.get(COOKIE)?.value;if(!nonce||!/^[A-Za-z0-9_-]{43}$/.test(nonce))nonce=randomBytes(32).toString('base64url');
 jar.set(COOKIE,nonce,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/patient/telegram-link',maxAge:600});
 const nonceHmac=nonceDigest(keys,nonce);
 const b=begun.safeParse((await service.rpc('telegram_signin_link_begin',{p_token_hash:createHash('sha256').update(token,'utf8').digest('hex'),p_nonce_hmac:nonceHmac,
  p_current_user:current?.userId??null,p_switch:options.switchAccount===true})).data);
 if(!b.success)return {ok:false,reason:'unavailable'};
 // Already signed in as this link's member: the link is used up, no second sign-in (review F-3).
 if(b.data.ok&&'signedIn'in b.data){jar.delete({name:COOKIE,path:'/patient/telegram-link'});return {ok:true,path:STEP_PATHS[b.data.step],maskedPhone:maskPhone(current?.phone??'')};}
 if(!b.data.ok){
  if(b.data.code==='other_account'&&current)return {ok:false,reason:'other_account',maskedPhone:maskPhone(current.phone)};
  return b.data.code==='busy'?{ok:false,reason:'busy'}:{ok:false,reason:'expired',...(b.data.step?{path:STEP_PATHS[b.data.step]}:{})};
 }
 const {requestId,phone,step}=b.data,client=await deps.client();
 const otp=await client.auth.signInWithOtp({phone,options:{captchaToken:captchaToken||undefined,channel:'sms'}}).catch(()=>null);
 // Auth did not confirm (CAPTCHA, rate limit): release the lease at once; the link stays armed for a retry.
 const abandon=()=>service.rpc('auth_code_request_abandon',{p_request:requestId,p_nonce_hmac:nonceHmac}).then(()=>null,()=>null);
 if(!otp||otp.error){await abandon();return {ok:false,reason:otp?.error&&/captcha/i.test(otp.error.message)?'captcha':'unavailable'};}
 const s=sealed.safeParse((await service.rpc('telegram_signin_link_code',{p_request:requestId,p_nonce_hmac:nonceHmac})).data);
 if(!s.success||!s.data.ok||s.data.phone!==phone){await abandon();return {ok:false,reason:'unavailable'};}
 const code=unsealCode(keys,requestId,s.data.sealed);
 if(!code){await abandon();return {ok:false,reason:'unavailable'};}
 const digest=codeDigest(keys,requestId,phone,code);
 const check=z.object({ok:z.literal(true),phone:z.literal(phone)}).safeParse((await service.rpc('auth_code_request_check',{p_request:requestId,p_nonce_hmac:nonceHmac,p_code_digest:digest})).data);
 if(!check.success){await abandon();return {ok:false,reason:'unavailable'};}
 const v=await client.auth.verifyOtp({phone,token:code,type:'sms'});
 if(v.error||!v.data.session)return {ok:false,reason:'expired'};
 let done=false;
 try{
  const c=claims.parse(JSON.parse(Buffer.from(v.data.session.access_token.split('.')[1]??'','base64url').toString('utf8')));
  // Same recording as a typed code (session on the request, cleanup exemption); only a plain sign-in counts.
  let recorded=false;
  for(let i=0;i<3&&!recorded;i++){const r=await service.rpc('auth_code_request_verified',{p_request:requestId,p_nonce_hmac:nonceHmac,p_code_digest:digest,p_user:c.sub,p_session:c.session_id});recorded=!r.error&&z.object({ok:z.literal(true),result:z.literal('signed_in')}).safeParse(r.data).success;}
  const f=recorded?await service.rpc('telegram_signin_link_finish',{p_request:requestId,p_nonce_hmac:nonceHmac}):null;
  done=recorded&&!!f&&!f.error&&z.object({ok:z.literal(true)}).safeParse(f.data).success;
 }catch{done=false;}
 if(!done){await client.auth.signOut({scope:'local'}).catch(()=>null);return {ok:false,reason:'unavailable'};}
 jar.delete({name:COOKIE,path:'/patient/telegram-link'});
 return {ok:true,path:STEP_PATHS[step],maskedPhone:maskPhone(phone)};
}

/** Sign-out and binding changes end every live link of the member (review F-2). Best effort: never blocks sign-out. */
export async function cancelSigninLinks(userId:string):Promise<boolean>{
 try{const r=await telegramAuthService().rpc('telegram_signin_links_cancel' as never,{p_user:userId} as never);return !r.error;}catch{return false;}
}
