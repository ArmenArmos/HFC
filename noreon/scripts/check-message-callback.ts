import assert from 'node:assert/strict';
import twilio from 'twilio';
// @ts-expect-error Runtime Node supports registerHooks; declarations target Node20.
import {registerHooks} from 'node:module';
import {parseTwilioConfig} from '@/lib/messaging/twilio';
const {handleTwilioCallback}=await import('@/lib/messaging/callback');
const config=parseTwilioConfig({accountSid:'AC'+'1'.repeat(32),authToken:'fictional-token-not-a-secret',smsFrom:'+15005550006',whatsappFrom:'whatsapp:+15005550006',whatsappHyContentSid:'HX'+'2'.repeat(32),whatsappEnContentSid:'HX'+'3'.repeat(32),appUrl:'https://app.example.com/patient/dashboard',callbackUrl:'https://api.example.com/api/messaging/twilio/status'});
const attempt='b9800000-0000-4000-8000-000000000001',url=config.callbackUrl+'?attempt='+attempt;
const params={AccountSid:config.accountSid,MessageSid:'SM'+'4'.repeat(32),MessageStatus:'delivered'};
assert.ok(config.authToken);
const signature=twilio.getExpectedTwilioSignature(config.authToken,url,params),body=new URLSearchParams(params).toString();
let writes=0;const record=async()=>{writes++;return true;};
function request(content=body,sign=signature,target=url,contentType='application/x-www-form-urlencoded'){return new Request(target,{method:'POST',headers:{'content-type':contentType,'x-twilio-signature':sign},body:content});}
assert.equal((await handleTwilioCallback(request(),config,record)).status,204);assert.equal(writes,1);
assert.equal((await handleTwilioCallback(request(body,'forged'),config,record)).status,403);assert.equal(writes,1);
assert.equal((await handleTwilioCallback(request(body,signature,url+'&attempt='+attempt),config,record)).status,400);
assert.equal((await handleTwilioCallback(request(body,signature,url,'application/json'),config,record)).status,415);
assert.equal((await handleTwilioCallback(request('x'.repeat(17000)),config,record)).status,413);
assert.equal((await handleTwilioCallback(request(body,signature,'https://forged.example/api/messaging/twilio/status?attempt='+attempt),config,record)).status,204,'Signature is tied to configured public URL, never Host');
assert.equal((await handleTwilioCallback(request(),config,async()=>false)).status,409);
assert.equal((await handleTwilioCallback(request(),config,async()=>{throw Error('internal db detail');})).status,503);
const mockUrl='data:text/javascript,'+encodeURIComponent(`
 export const calls=[];
 export function createClient(url,key,options){
  calls.push({url,key,options});
  return {rpc(name,args){
   calls.push({name,args});
   return {abortSignal(){return Promise.resolve({data:true,error:null});}};
  }};
 }
`);
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){return s==='@supabase/supabase-js'?{url:mockUrl,shortCircuit:true}:next(s,c);}});
const env={NOREON_TWILIO_CALLBACKS_ENABLED:'true',NEXT_PUBLIC_SUPABASE_URL:'https://real-member-project.example.com',NOREON_MESSAGING_SERVICE_ROLE_KEY:'fictional-service-key',NOREON_TWILIO_ACCOUNT_SID:config.accountSid,NOREON_TWILIO_AUTH_TOKEN:config.authToken,NOREON_TWILIO_SMS_FROM:config.smsFrom,NOREON_TWILIO_WHATSAPP_FROM:config.whatsappFrom,NOREON_TWILIO_WHATSAPP_HY_CONTENT_SID:config.whatsappHyContentSid,NOREON_TWILIO_WHATSAPP_EN_CONTENT_SID:config.whatsappEnContentSid,NOREON_MESSAGE_APP_URL:config.appUrl,NOREON_TWILIO_CALLBACK_URL:config.callbackUrl};
const old=Object.fromEntries(Object.keys(env).map(key=>[key,process.env[key]]));
try{
 const {POST}=await import('@/app/api/messaging/twilio/status/route');
 const mock=await import(mockUrl);
 Object.assign(process.env,env);
 delete process.env.NOREON_TWILIO_CALLBACKS_ENABLED;
 assert.equal((await POST(request())).status,404,'Callbacks disabled without explicit configuration');assert.equal(mock.calls.length,0);
 process.env.NOREON_TWILIO_CALLBACKS_ENABLED='true';
 assert.equal((await POST(request(body,'forged'))).status,403);assert.equal(mock.calls.length,0,'No DB client before signature verification');
 assert.equal((await POST(request())).status,204);assert.equal(mock.calls[0].url,env.NEXT_PUBLIC_SUPABASE_URL);assert.equal(mock.calls[0].key,env.NOREON_MESSAGING_SERVICE_ROLE_KEY);
 assert.equal(mock.calls[1].name,'record_patient_message_delivery');assert.deepEqual(mock.calls[1].args,{p_attempt_id:attempt,p_reference:params.MessageSid,p_status:'delivered',p_error_code:undefined});
}finally{hook.deregister();for(const key of Object.keys(env)){if(old[key]===undefined)delete process.env[key];else process.env[key]=old[key];}}
console.log('Actual callback route enforces activation gates and signatures before a scoped real-project RPC; no live calls.');
