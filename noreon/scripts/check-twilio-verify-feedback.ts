import assert from 'node:assert/strict';
import {completeVerifiedPhone,reportVerifiedPhone} from '@/lib/messaging/twilio-verify-feedback';
let calls=0;
const feedback=async()=>{calls++;};
const phone='+37499000101',code='123456';
for(const result of [{error:{message:'invalid'},data:{user:null}},{error:null,data:{user:{phone:'37499000102'}}},{error:null,data:{user:null}}]){assert.equal(await completeVerifiedPhone(phone,code,result,feedback),false);assert.equal(calls,0);}
assert.equal(await completeVerifiedPhone(phone,code,{error:null,data:{user:{phone:'37499000101'}}},feedback),true);assert.equal(calls,1);
assert.equal(await completeVerifiedPhone(phone,code,{error:null,data:{user:{phone}}},async()=>{throw Error('storage unavailable');}),true);
console.log('Verify confirmation: invalid/mismatched Supabase identities never approve; feedback failure preserves authenticated success.');

const env={NOREON_DEPLOYMENT_TARGET:'app',NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_SHARED_DEMO:'false',NOREON_REGISTRATION_ENABLED:'true',NOREON_PHONE_OTP_PROVIDER:'twilio-verify-hook',NOREON_PHONE_OTP_HOOK_READY:'true',NOREON_TWILIO_VERIFY_READY:'true',NOREON_REGISTRATION_ALLOWED_PREFIXES:'+374',NOREON_SUPABASE_SMS_HOOK_SECRET:'whsec_'+Buffer.alloc(32,8).toString('base64'),NOREON_TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),NOREON_TWILIO_VERIFY_API_KEY_SID:'SK'+'2'.repeat(32),NOREON_TWILIO_VERIFY_API_KEY_SECRET:'fictional-secret-long',NOREON_TWILIO_VERIFY_SERVICE_SID:'VA'+'3'.repeat(32),NOREON_MESSAGING_SERVICE_ROLE_KEY:'fictional-service-role-key-with-32-characters',NEXT_PUBLIC_SUPABASE_URL:'https://local-test.invalid'};
const old=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),originalFetch=globalThis.fetch;
let order:string[]=[],match=true,malformed=false;
try{
 Object.assign(process.env,env);
 globalThis.fetch=async(url,init)=>{
  const path=String(url);order.push(path);
  if(path.endsWith('/rpc/claim_auth_verify_feedback')){const body=JSON.parse(String(init?.body));assert.match(body.p_verification_digest,/^[a-f0-9]{64}$/);assert.ok(!String(init?.body).includes(phone));assert.ok(!String(init?.body).includes(code));return Response.json(match?{webhookId:'verified',claimToken:'11111111-1111-4111-8111-111111111111',reference:'VE'+'4'.repeat(32)}:null);}
  if(path.includes('verify.twilio.com')){assert.equal(order.length,2);return Response.json({sid:(malformed?'SM':'VE')+'4'.repeat(32),service_sid:env.NOREON_TWILIO_VERIFY_SERVICE_SID,account_sid:env.NOREON_TWILIO_ACCOUNT_SID,to:phone,channel:'sms',status:'approved'});}
  if(path.endsWith('/rpc/finish_auth_verify_feedback')){const body=JSON.parse(String(init?.body));assert.equal(body.p_status,malformed?'unknown':'accepted');return Response.json(true);}
  throw Error('Unexpected request');
 };
 await reportVerifiedPhone(phone,code);assert.equal(order.length,3);
 order=[];match=false;await reportVerifiedPhone(phone,code);assert.equal(order.length,1);
 order=[];match=true;malformed=true;await reportVerifiedPhone(phone,code);assert.equal(order.length,3);
 console.log('Verify feedback runtime: digest-only lookup precedes exact VE approval, missing/replayed match sends nothing, malformed receipt records unknown (mocked transport).');
}finally{globalThis.fetch=originalFetch;for(const [k,v]of Object.entries(old)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
const {messagingServiceRoleKey}=await import('@/lib/messaging/auth-sms-hook-runtime');
assert.equal(messagingServiceRoleKey({SUPABASE_SERVICE_ROLE_KEY:'fallback-server-key-at-least-32-characters'}),'fallback-server-key-at-least-32-characters');
for(const invalid of ['', 'short'])assert.throws(()=>messagingServiceRoleKey({NOREON_MESSAGING_SERVICE_ROLE_KEY:invalid,SUPABASE_SERVICE_ROLE_KEY:'fallback-server-key-at-least-32-characters'}));
console.log('Service key fallback is undefined-only; explicit invalid overrides fail closed.');
