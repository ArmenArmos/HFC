import assert from 'node:assert/strict';
import {Webhook} from 'standardwebhooks';
import {POST} from '@/app/api/auth/send-sms/route';
import * as messagingRuntime from '@/lib/messaging/runtime';
import {phoneCodePolicy} from '@/lib/patient/phone-code-policy';
import {parseTwilioConfig,buildPlanMessage,createTwilioTransport,verifyTwilioCallback} from '@/lib/messaging/twilio';
const secret='whsec_'+Buffer.alloc(32,9).toString('base64');
const env={NOREON_DEPLOYMENT_TARGET:'app',NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_SHARED_DEMO:'false',NOREON_REGISTRATION_ENABLED:'true',NOREON_PHONE_OTP_PROVIDER:'twilio-sms-hook',NOREON_PHONE_OTP_HOOK_READY:'true',NOREON_TWILIO_SMS_READY:'true',NOREON_REGISTRATION_ALLOWED_PREFIXES:'+374',NOREON_SUPABASE_SMS_HOOK_SECRET:secret,NOREON_TWILIO_ACCOUNT_SID:'AC'+'1'.repeat(32),NOREON_TWILIO_API_KEY_SID:'SK'+'2'.repeat(32),NOREON_TWILIO_API_KEY_SECRET:'fictional-twilio-secret',NOREON_TWILIO_SMS_FROM:'Noreon',NOREON_MESSAGING_SERVICE_ROLE_KEY:'fictional-service-role-key-with-32-characters',NEXT_PUBLIC_SUPABASE_URL:'https://local-test.invalid'};
const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]])),originalFetch=globalThis.fetch;
const raw=JSON.stringify({user:{phone:'+37499000101'},sms:{otp:'654321'}}),sid='SM'+'a'.repeat(32);
let calls:string[]=[],providerStatus=201,malformed=false,slow=false,finishOK=true,claimStatus='send',expectedOutcome='accepted';
const stored:unknown[]=[];
function request(body=raw,signature?:string){const date=new Date();return new Request('https://app.noreon.health/api/auth/send-sms',{method:'POST',headers:{'content-type':'application/json','webhook-id':'msg_twilio','webhook-timestamp':String(Math.floor(date.getTime()/1000)),'webhook-signature':signature??new Webhook(secret).sign('msg_twilio',date,body)},body});}
try {
 Object.assign(process.env,env);
 assert.equal(typeof messagingRuntime.messageDispatchRuntime,'function','SMS dispatch runtime must be independent of callback activation');
 const runtimeEnv={...env,NOREON_MESSAGE_DELIVERY_ENABLED:'true',NOREON_MESSAGE_RECOVERY_READY:'true',NOREON_TWILIO_CALLBACKS_ENABLED:'false',NOREON_MESSAGE_APP_URL:'https://app.example.com',NOREON_TWILIO_CALLBACK_URL:'https://app.example.com/callback'};
 assert.ok(messagingRuntime.messageDispatchRuntime(runtimeEnv));assert.equal(messagingRuntime.messageDispatchRuntime({...runtimeEnv,NOREON_MESSAGE_DELIVERY_ENABLED:'false'}),null);
 assert.equal(phoneCodePolicy(env)?.authChannel,'sms');assert.equal(phoneCodePolicy(env)?.delivery,'sms');
 globalThis.fetch=async(input,init)=>{
  const url=String(input);calls.push(url);
  if(url.endsWith('/rpc/claim_auth_sms_hook')){const body=JSON.parse(String(init?.body));stored.push(body);assert.equal(body.p_provider,'twilio');assert.equal(body.p_channel,'sms');return Response.json(claimStatus==='send'?{status:'send',claimToken:'11111111-1111-4111-8111-111111111111'}:{status:claimStatus});}
  if(url.includes('api.twilio.com/')){assert.equal(init?.headers && (init.headers as Record<string,string>).Authorization,'Basic '+Buffer.from(env.NOREON_TWILIO_API_KEY_SID+':'+env.NOREON_TWILIO_API_KEY_SECRET).toString('base64'));assert.ok(calls[0].endsWith('/rpc/claim_auth_sms_hook'));const body=new URLSearchParams(String(init?.body));assert.equal(body.get('To'),'+37499000101');assert.equal(body.get('From'),'Noreon');assert.equal(body.get('Body'),'Noreon code: 654321. Do not share this code.');assert.equal(body.get('StatusCallback'),null);if(slow)return await new Promise<Response>(()=>{});return Response.json({sid:malformed?'invalid':sid},{status:providerStatus});}
  if(url.endsWith('/rpc/finish_auth_sms_hook')){const body=JSON.parse(String(init?.body));stored.push(body);assert.equal(body.p_status,expectedOutcome);if(expectedOutcome==='accepted')assert.equal(body.p_reference,sid);return Response.json(finishOK);}
  throw Error('Unexpected network request');
 };
 assert.equal((await POST(request(raw,'v1,invalid'))).status,403);assert.equal(calls.length,0);
 for(const status of [201,401,403,429,500]){calls=[];providerStatus=status;expectedOutcome=status===201?'accepted':status===500?'unknown':'failed';assert.equal((await POST(request())).status,status===201?200:status===500?503:502);assert.equal(calls.length,3);}
 providerStatus=201;malformed=true;expectedOutcome='unknown';calls=[];assert.equal((await POST(request())).status,503);assert.equal(calls.length,3);malformed=false;
 slow=true;calls=[];const start=Date.now();assert.equal((await POST(request())).status,503);assert.ok(Date.now()-start<3500);assert.equal(calls.length,3);slow=false;
 expectedOutcome='accepted';finishOK=false;assert.equal((await POST(request())).status,503);finishOK=true;
 for(const state of ['accepted','submitting','unknown','failed']){claimStatus=state;calls=[];assert.equal((await POST(request())).status,state==='accepted'?200:503);assert.equal(calls.length,1);}
 assert.ok(!JSON.stringify(stored).includes('654321'));assert.ok(!JSON.stringify(stored).includes('37499000101'));
 calls=[];process.env.NOREON_TWILIO_SMS_READY='false';assert.equal((await POST(request())).status,404);assert.equal(calls.length,0);
 const config=parseTwilioConfig({accountSid:env.NOREON_TWILIO_ACCOUNT_SID,authToken:'fictional-notice-auth-token',smsFrom:env.NOREON_TWILIO_SMS_FROM,appUrl:'https://app.example.com',callbackUrl:'https://app.example.com/callback'});
 for(const sender of ['12345','Noreon🙂','Noreon sender too long','Noreon!'])assert.throws(()=>parseTwilioConfig({...config,smsFrom:sender}));
 assert.equal(buildPlanMessage(config,{attemptId:'11111111-1111-4111-8111-111111111111',destination:'+37499000101',channel:'sms',locale:'en'}).from,env.NOREON_TWILIO_SMS_FROM);
 assert.throws(()=>buildPlanMessage(config,{attemptId:'11111111-1111-4111-8111-111111111111',destination:'+37499000101',channel:'whatsapp',locale:'en'}));
 const keyConfig=parseTwilioConfig({accountSid:env.NOREON_TWILIO_ACCOUNT_SID,apiKeySid:env.NOREON_TWILIO_API_KEY_SID,apiKeySecret:env.NOREON_TWILIO_API_KEY_SECRET,smsFrom:env.NOREON_TWILIO_SMS_FROM,appUrl:'https://app.example.com',callbackUrl:'https://app.example.com/callback'});
 assert.throws(()=>parseTwilioConfig({...keyConfig,apiKeySecret:undefined,authToken:'fictional-full-auth-token'}));
 assert.equal(createTwilioTransport(keyConfig).username,env.NOREON_TWILIO_API_KEY_SID);assert.equal(createTwilioTransport(keyConfig).accountSid,env.NOREON_TWILIO_ACCOUNT_SID);assert.equal(verifyTwilioCallback(keyConfig,'11111111-1111-4111-8111-111111111111','unused',''),null);
 console.log('Twilio SMS hook API: signed requests, reserve-before-send, failures, timeout, replay, privacy and SMS-only config pass (mocked transport).');
}finally{globalThis.fetch=originalFetch;for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
