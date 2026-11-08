import assert from 'node:assert/strict';
// @ts-expect-error Runtime supports registerHooks; declarations target Node20.
import {registerHooks} from 'node:module';
const fixture={calls:0,verifyCalls:0,last:{} as {phone?:string;options?:{channel?:string;captchaToken?:string}},lastVerify:{} as {type?:string},failure:false,limited:false,testRequests:0,testVerifies:0,testFailure:false,testCaptcha:undefined as string|undefined,telegramRequests:0,telegramVerifies:0,limits:[] as string[]};
Object.assign(globalThis,{__phoneOtp:fixture});
const hook=registerHooks({resolve(name:string,context:object,next:(name:string,context:object)=>object){
 const prefix='const f=globalThis.__phoneOtp;';
 const modules:Record<string,string>={
  '@/lib/telegram-auth/test-signin':prefix+`export const isTestSigninPhone=p=>/^\\+999[0-9]{5,11}$/.test(p);export const testSigninEntryEnabled=(e)=>e.NOREON_TEST_SIGNIN_ENABLED==='true';export const requestTestSigninCode=async(phone,token)=>{f.testRequests++;f.testCaptcha=token;return f.testFailure?{ok:false,reason:'unavailable'}:{ok:true}};export const verifyTestSigninCode=async()=>{f.testVerifies++;return {ok:true}};`,
  '@/lib/telegram-auth/member-signin':prefix+`export const requestTelegramCode=async()=>{f.telegramRequests++;return {ok:true}};export const verifyTelegramCode=async()=>{f.telegramVerifies++;return {ok:true}};export const startTelegramProof=async()=>({ok:false});`,
  '@/lib/supabase/server':prefix+`export const createClient=async()=>({auth:{signInWithOtp:async(value)=>{f.calls++;f.last=value;return {error:f.failure?{message:'provider unavailable'}:null}},verifyOtp:async(value)=>{f.verifyCalls++;f.lastVerify=value;return {error:null,data:{user:{phone:value.phone}}}}}});`,
  '@/lib/security/rate-limit':prefix+`export async function rateLimit(op,b){f.limits.push('take:'+op+':'+b.map(x=>x.kind+'/'+(x.mode??'take')).join(','));return f.limited?{ok:false,retryAfter:60}:{ok:true};}export async function recordRateLimit(op,b){f.limits.push('record:'+op+':'+b.map(x=>x.kind+'/'+x.value).join(','));}`,
  '@/lib/patient/auth':`export const patientIdentity=async()=>null;`,
  '@/lib/patient/repository':`export const patientStore=()=>{throw Error('unexpected store use')};`,
  '@/lib/patient/service':`export const createPatientService=()=>({});`,
  'next/cache':`export const revalidatePath=()=>{};`,
 };
 if(modules[name])return {url:'data:text/javascript,'+encodeURIComponent(modules[name]),shortCircuit:true};
 return next(name,context);
}});
const keys=['NOREON_DEPLOYMENT_TARGET','NOREON_REGISTRATION_ENABLED','NOREON_PHONE_OTP_PROVIDER','NOREON_PHONE_OTP_HOOK_READY','NEXT_PUBLIC_HCAPTCHA_SITE_KEY','NOREON_CAPTCHA_ENABLED','NOREON_REGISTRATION_ALLOWED_PREFIXES','NOREON_TEST_SIGNIN_ENABLED','NOREON_TELEGRAM_ENABLED','NOREON_TELEGRAM_AUTH_ENABLED'];
const before=Object.fromEntries(keys.map(key=>[key,process.env[key]]));
try{
 Object.assign(process.env,{NOREON_DEPLOYMENT_TARGET:'app',NOREON_REGISTRATION_ENABLED:'true',NOREON_PHONE_OTP_PROVIDER:'twilio-whatsapp',NEXT_PUBLIC_HCAPTCHA_SITE_KEY:'fictional-site-key',NOREON_CAPTCHA_ENABLED:'true',NOREON_REGISTRATION_ALLOWED_PREFIXES:'+374'});
 const {requestPhoneCode,verifyPhoneCode}=await import('@/app/patient/actions');
 assert.deepEqual(await requestPhoneCode('+37499000001','fictional-captcha'),{ok:true});
 assert.equal(fixture.last.options?.channel,'whatsapp','Configured WhatsApp registration must request that provider channel explicitly');
 assert.equal(fixture.last.options?.captchaToken,'fictional-captcha');
 assert.equal(fixture.last.phone,'+37499000001');
 assert.deepEqual(fixture.limits,['take:member_code:source/take,phone/peek','record:member_code:phone/+37499000001'],'Network counted first; the number counted only after a confirmed send');
 fixture.limited=true;fixture.limits=[];
 const before=fixture.calls;
 assert.deepEqual(await requestPhoneCode('+37499000001','fictional-captcha'),{ok:false,reason:'rate_limited'});
 assert.equal(fixture.calls,before,'A limited request never reaches the provider');
 assert.deepEqual(await verifyPhoneCode('+37499000001','123456'),{ok:false,reason:'rate_limited'});
 fixture.limited=false;fixture.failure=true;fixture.limits=[];
 assert.equal((await requestPhoneCode('+37499000001','fictional-captcha')).ok,false);
 assert.ok(!fixture.limits.some(l=>l.startsWith('record:')),'A failed send (bad CAPTCHA, provider down) does not spend the number');
 fixture.failure=false;
 const calls=fixture.calls;
 assert.equal((await requestPhoneCode('+15555550001','fictional-captcha')).ok,false,'Out-of-scope country cannot reach provider');
 assert.equal((await requestPhoneCode('+37499000001')).ok,false,'Missing CAPTCHA cannot reach provider');
 assert.equal((await requestPhoneCode('invalid','fictional-captcha')).ok,false);
 assert.equal(fixture.calls,calls);
 process.env.NOREON_REGISTRATION_ENABLED='false';
 assert.equal((await requestPhoneCode('+37499000001','fictional-captcha')).ok,false);
 assert.equal((await verifyPhoneCode('+37499000001','123456')).ok,false);
 assert.equal(fixture.calls,calls);
 process.env.NOREON_REGISTRATION_ENABLED='true';process.env.NOREON_PHONE_OTP_PROVIDER='invalid';
 assert.equal((await requestPhoneCode('+37499000001','fictional-captcha')).ok,false,'Unknown transport fails closed');
 assert.equal(fixture.calls,calls);
 process.env.NOREON_PHONE_OTP_PROVIDER='meta-whatsapp-hook';
 assert.equal((await requestPhoneCode('+37499000001','fictional-captcha')).ok,false,'An unconfigured delivery hook stays closed');
 process.env.NOREON_PHONE_OTP_HOOK_READY='true';
 assert.equal((await requestPhoneCode('+37499000001','fictional-captcha')).ok,true);
 assert.equal(fixture.last.options?.channel,'sms','Meta hook uses Supabase Send SMS hook; delivery copy still identifies WhatsApp');
 process.env.NOREON_PHONE_OTP_PROVIDER='brevo-sms-hook';delete process.env.NOREON_PHONE_OTP_HOOK_READY;
 assert.equal((await requestPhoneCode('+37499000001','fictional-captcha')).ok,false,'Unready Brevo hook stays closed');
 process.env.NOREON_PHONE_OTP_HOOK_READY='true';
 assert.equal((await requestPhoneCode('+37499000001','fictional-captcha')).ok,true,'Ready Brevo hook uses the existing phone identity');
 assert.equal(fixture.last.options?.channel,'sms');
 process.env.NOREON_PHONE_OTP_PROVIDER='twilio-verify-hook';
 assert.equal((await requestPhoneCode('+37499000001','fictional-captcha')).ok,true);
 assert.equal(fixture.last.options?.channel,'sms');
 assert.equal((await verifyPhoneCode('+37499000001','123456')).ok,true,'Verify confirmation accepts the direct matching Supabase response');
 process.env.NOREON_PHONE_OTP_PROVIDER='sms';
 assert.equal((await requestPhoneCode('+37499000001','fictional-captcha')).ok,true);
 assert.equal(fixture.last.options?.channel,'sms');
 assert.equal((await verifyPhoneCode('+37499000001','123456')).ok,true);
 assert.equal(fixture.lastVerify.type,'sms','Supabase phone OTP verification type remains sms for both delivery channels');
 assert.equal((await verifyPhoneCode('+37499000001','12')).ok,false);
 fixture.failure=true;
 assert.deepEqual(await requestPhoneCode('+37499000001','fictional-captcha'),{ok:false,reason:'unavailable'});
 // Reserved phones take only the server test route, even when normal registration has no provider.
 process.env.NOREON_TEST_SIGNIN_ENABLED='true';process.env.NOREON_CAPTCHA_ENABLED='false';fixture.failure=false;
 for(const provider of ['sms','twilio-whatsapp','meta-whatsapp-hook','brevo-sms-hook','twilio-sms-hook','twilio-verify-hook','telegram-hook',undefined,'off']){
  if(provider===undefined)delete process.env.NOREON_PHONE_OTP_PROVIDER;else process.env.NOREON_PHONE_OTP_PROVIDER=provider;
  const before=[fixture.calls,fixture.verifyCalls,fixture.telegramRequests,fixture.telegramVerifies];
  const tests=[fixture.testRequests,fixture.testVerifies];
  assert.deepEqual(await requestPhoneCode('+99900000001'),{ok:true},`test request: ${provider}`);
  assert.deepEqual(await verifyPhoneCode('+99900000001','246810'),{ok:true},`test verify: ${provider}`);
  assert.deepEqual([fixture.testRequests,fixture.testVerifies],tests.map(n=>n+1));
  assert.deepEqual([fixture.calls,fixture.verifyCalls,fixture.telegramRequests,fixture.telegramVerifies],before,'Test path cannot send any provider OTP');
  // Same normal +374 calls, channel and readiness as the pre-change policy.
  process.env.NOREON_PHONE_OTP_HOOK_READY='true';process.env.NOREON_TELEGRAM_ENABLED='true';process.env.NOREON_TELEGRAM_AUTH_ENABLED='true';
  const normal=[fixture.calls,fixture.verifyCalls,fixture.telegramRequests,fixture.telegramVerifies];
  const available=provider!==undefined&&provider!=='off';
  assert.equal((await requestPhoneCode('+37499000001')).ok,available);
  assert.equal((await verifyPhoneCode('+37499000001','123456')).ok,available);
  assert.deepEqual([fixture.calls,fixture.verifyCalls,fixture.telegramRequests,fixture.telegramVerifies],normal.map((n,i)=>n+(available&&((provider==='telegram-hook')===(i>=2))?1:0)));
  if(available&&provider!=='telegram-hook')assert.equal(fixture.last.options?.channel,provider==='twilio-whatsapp'?'whatsapp':'sms');
 }
 process.env.NOREON_PHONE_OTP_PROVIDER='sms';process.env.NOREON_CAPTCHA_ENABLED='true';
 fixture.testFailure=true;fixture.limits=[];
 assert.deepEqual(await requestPhoneCode('+99900000001','invalid-fixture'),{ok:false,reason:'unavailable'});
 assert.equal(fixture.testCaptcha,'invalid-fixture','Test request forwards CAPTCHA for real server validation');
 assert.ok(!fixture.limits.some(l=>l.startsWith('record:')),'Refused test CAPTCHA/challenge does not spend phone quota');
 const beforeTest=fixture.testRequests;
 assert.deepEqual(await requestPhoneCode('+99900000001'),{ok:false,reason:'invalid'});
 assert.equal(fixture.testRequests,beforeTest,'Missing CAPTCHA never reaches the test path');
 fixture.testFailure=false;process.env.NOREON_CAPTCHA_ENABLED='false';fixture.limited=true;
 assert.deepEqual(await requestPhoneCode('+99900000001'),{ok:false,reason:'rate_limited'});
 assert.equal(fixture.testRequests,beforeTest,'Source rate limit also protects test requests');fixture.limited=false;
 console.log('Actual OTP action preserves gates/CAPTCHA/Armenia scope, selects explicit provider channel and keeps phone OTP verification semantics. Provider calls mocked; no receipt claimed.');
}finally{
 hook.deregister();Reflect.deleteProperty(globalThis,'__phoneOtp');
 for(const key of keys){if(before[key]===undefined)delete process.env[key];else process.env[key]=before[key];}
}
