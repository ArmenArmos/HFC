import assert from 'node:assert/strict';
import {Webhook} from 'standardwebhooks';
import {POST} from '@/app/api/auth/send-sms/route';
import {authSmsHookEnabled} from '@/lib/messaging/auth-sms-hook-runtime';
const secret='whsec_'+Buffer.alloc(32,9).toString('base64');
const env={NOREON_DEPLOYMENT_TARGET:'app',NOREON_SHARED_DEMO:'false',NOREON_REGISTRATION_ENABLED:'true',NOREON_PHONE_OTP_PROVIDER:'brevo-sms-hook',NOREON_PHONE_OTP_HOOK_READY:'true',NOREON_BREVO_SMS_READY:'true',NOREON_REGISTRATION_ALLOWED_PREFIXES:'+374',NOREON_SUPABASE_SMS_HOOK_SECRET:'v1,'+secret,NOREON_BREVO_API_KEY:'fictional-brevo-api-key',NOREON_BREVO_SMS_SENDER:'Noreon',NOREON_MESSAGING_SERVICE_ROLE_KEY:'fictional-service-role-key-with-32-characters',NEXT_PUBLIC_SUPABASE_URL:'https://local-test.invalid'};
const previous=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));const originalFetch=globalThis.fetch;
let calls:string[]=[],outcome:'accepted'|'failed'|'unknown'='accepted';const databaseBodies:unknown[]=[];
const raw=JSON.stringify({user:{phone:'+37499000101'},sms:{otp:'654321'}});
function request(signature?:string){const date=new Date();return new Request('https://app.noreon.health/api/auth/send-sms',{method:'POST',headers:{'content-type':'application/json','webhook-id':'msg_route','webhook-timestamp':String(Math.floor(date.getTime()/1000)),'webhook-signature':signature??new Webhook(secret).sign('msg_route',date,raw)},body:raw});}
try{
 Object.assign(process.env,env);
 assert.equal(authSmsHookEnabled(env),true);
 for(const key of ['NOREON_REGISTRATION_ENABLED','NOREON_PHONE_OTP_HOOK_READY','NOREON_BREVO_SMS_READY'])assert.equal(authSmsHookEnabled({...env,[key]:'false'}),false);
 assert.equal(authSmsHookEnabled({...env,NOREON_REGISTRATION_ALLOWED_PREFIXES:'+374,+44'}),false);
 globalThis.fetch=async(input,init)=>{
  const url=String(input);calls.push(url);
  if(url.endsWith('/rest/v1/rpc/claim_auth_sms_hook')){databaseBodies.push(JSON.parse(String(init?.body)));return Response.json({status:'send',claimToken:'11111111-1111-4111-8111-111111111111'});}
  if(url==='https://api.brevo.com/v3/transactionalSMS/send'){return outcome==='accepted'?Response.json({messageId:54321},{status:201}):new Response(null,{status:outcome==='failed'?400:500});}
  if(url.endsWith('/rest/v1/rpc/finish_auth_sms_hook')){const body=JSON.parse(String(init?.body));databaseBodies.push(body);assert.equal(body.p_status,outcome);return Response.json(true);}
  throw Error('Unexpected external request in local test');
 };
 assert.equal((await POST(request('v1,invalid'))).status,403);assert.equal(calls.length,0);
 for(const expected of ['accepted','failed','unknown'] as const){outcome=expected;calls=[];const result=await POST(request());assert.equal(result.status,expected==='accepted'?200:expected==='failed'?502:503);assert.equal(calls.length,3);assert.ok(calls[0].includes('claim_auth_sms_hook'));assert.ok(calls[1].includes('brevo'));assert.ok(calls[2].includes('finish_auth_sms_hook'));if(expected==='accepted')assert.deepEqual(await result.json(),{});}
 assert.ok(!JSON.stringify(databaseBodies).includes('654321'));assert.ok(!JSON.stringify(databaseBodies).includes('37499000101'));
 process.env.NOREON_BREVO_SMS_READY='false';calls=[];assert.equal((await POST(request())).status,404);assert.equal(calls.length,0);
 console.log('Actual hook route tested with mocked RPC/provider transport: signatures, gates, reserve-before-send, outcomes and privacy pass.');
}finally{globalThis.fetch=originalFetch;for(const [key,value]of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
