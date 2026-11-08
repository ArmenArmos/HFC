import assert from 'node:assert/strict';
import {createNativeVerifyPhoneHandler} from '@/lib/patient/native-verify-phone';
let calls=0,feedback=0,fail=false,mismatch=false,ready=true;
const phone='+37499000101';
const handler=createNativeVerifyPhoneHandler({enabled:()=>ready,verify:async(p,c)=>{calls++;assert.equal(p,phone);assert.equal(c,'123456');return {error:fail?{}:null,data:{user:{phone:mismatch?'37499000102':phone},session:{access_token:'fictional-token',refresh_token:'fictional-refresh',expires_in:3600,token_type:'bearer'}}};},feedback:async()=>{feedback++;}});
function req(value:unknown={phone,token:'123456',type:'sms'}){return new Request('https://app.noreon.health/api/native/verify-phone',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(value)});}
assert.equal((await handler(req())).status,200);assert.equal(calls,1);assert.equal(feedback,1);
for(const value of [{phone,token:'12345',type:'sms'},{phone:'+15555550101',token:'123456',type:'sms'},{phone:'+99900000001',token:'246810',type:'sms'},{phone,token:'123456',type:'email'},{phone,token:'123456',type:'sms',reference:'VE'+'1'.repeat(32)}])assert.equal((await handler(req(value))).status,400);
assert.equal(calls,1);fail=true;assert.equal((await handler(req())).status,400);assert.equal(feedback,1);fail=false;mismatch=true;assert.equal((await handler(req())).status,400);assert.equal(feedback,1);ready=false;assert.equal((await handler(req())).status,404);
console.log('Native verification endpoint: exact Supabase verification, identity binding, strict payload/country, gates and success-only feedback pass.');
const {POST}=await import('@/app/api/native/verify-phone/route');
const env={NOREON_NATIVE_JOURNEY_ENABLED:'true',NOREON_DEPLOYMENT_TARGET:'app',NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_REGISTRATION_ENABLED:'false',NOREON_PHONE_OTP_PROVIDER:'sms',NOREON_REGISTRATION_ALLOWED_PREFIXES:'+374',NEXT_PUBLIC_SUPABASE_URL:'https://fictional.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fictional-anon-key'};
const before=Object.fromEntries(Object.keys(env).map(k=>[k,process.env[k]])),fetcher=globalThis.fetch;
let requests=0,upstreamStatus=200;
try{
 Object.assign(process.env,env);
 globalThis.fetch=async(url,init)=>{requests++;assert.equal(String(url),'https://fictional.invalid/auth/v1/verify');assert.equal((init?.headers as Record<string,string>).apikey,'fictional-anon-key');const body=JSON.parse(String(init?.body));assert.equal(body.phone,phone);assert.equal(body.token,'123456');assert.equal(body.type,'sms');return Response.json(upstreamStatus===200?{access_token:'fictional',refresh_token:'fictional-refresh',expires_in:3600,token_type:'bearer',user:{id:'11111111-1111-4111-8111-111111111111',phone:phone.slice(1)}}:{msg:'Rate limit exceeded'},{status:upstreamStatus});};
 let result=await POST(req());assert.equal(result.status,200);assert.equal(result.headers.get('cache-control'),'no-store');assert.equal((await result.json()).access_token,'fictional');assert.equal(requests,1);
 upstreamStatus=429;result=await POST(req());assert.equal(result.status,400);assert.equal(requests,2,'Rate limit must not retry or bypass Supabase');
 process.env.NOREON_PHONE_OTP_PROVIDER='twilio-verify-hook';result=await POST(req());assert.equal(result.status,404);assert.equal(requests,2,'Unready Verify endpoint stays closed');
 console.log('Actual native route: anon Supabase verification/session response, upstream throttle without retry, no-store and Verify readiness gates pass (mocked transport).');
}finally{globalThis.fetch=fetcher;for(const[k,v]of Object.entries(before)){if(v===undefined)delete process.env[k];else process.env[k]=v;}}
// Short deterministic equivalent of an 8.5-second verification followed by stalled feedback.
const slow=createNativeVerifyPhoneHandler({enabled:()=>true,deadlineMs:80,verify:async()=>{await new Promise(r=>setTimeout(r,45));return {error:null,data:{user:{phone},session:{access_token:'confirmed',refresh_token:'confirmed-refresh'}}};},feedback:async()=>new Promise(()=>{})});
const slowStart=Date.now(),slowResponse=await slow(req());assert.equal(slowResponse.status,200);assert.equal((await slowResponse.json()).access_token,'confirmed');assert.ok(Date.now()-slowStart<250);
const throwFeedback=createNativeVerifyPhoneHandler({enabled:()=>true,verify:async()=>({error:null,data:{user:{phone},session:{access_token:'confirmed',refresh_token:'confirmed-refresh'}}}),feedback:async()=>{throw Error('feedback failure');}});
assert.equal((await throwFeedback(req())).status,200);
console.log('Native confirmed session survives stalled/throwing feedback near the response deadline.');
const disconnected=new AbortController();let disconnectedCalls=0;
const abortHandler=createNativeVerifyPhoneHandler({enabled:()=>true,verify:async()=>{disconnectedCalls++;throw Error('must not verify disconnected caller');}});
disconnected.abort();const canceledRequest=new Request('https://app.noreon.health/api/native/verify-phone',{method:'POST',signal:disconnected.signal,headers:{'content-type':'application/json'},body:JSON.stringify({phone,token:'123456',type:'sms'})});
assert.equal((await abortHandler(canceledRequest)).status,503);assert.equal(disconnectedCalls,0);
