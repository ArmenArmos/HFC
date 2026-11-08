import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
assert.ok(existsSync('lib/messaging/auth-sms-hook.ts'),'Signed auth SMS hook must exist');
const {Webhook}=await import('standardwebhooks');
const {handleAuthSmsHook,parseAuthSmsHookConfig}=await import('@/lib/messaging/auth-sms-hook');
const secret='whsec_'+Buffer.alloc(32,7).toString('base64');
const config=parseAuthSmsHookConfig({hookSecret:secret,brevo:{apiKey:'fictional-brevo-api-key',sender:'Noreon'}});
const raw=JSON.stringify({user:{id:'11111111-1111-4111-8111-111111111111',phone:'37499000101'},sms:{otp:'123456'}});
function request(body=raw,id='msg_test',timestamp=new Date(),signature?:string){return new Request('https://app.noreon.health/api/auth/send-sms',{method:'POST',headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':String(Math.floor(timestamp.getTime()/1000)),'webhook-signature':signature??new Webhook(secret).sign(id,timestamp,body)},body});}
let reserved=0,sent=0,finished=0,created=0;
let claimState:'send'|'accepted'|'failed'|'unknown'|'submitting'='send';
let outcome:{status:'accepted';reference:string}|{status:'failed'|'unknown'}={status:'accepted',reference:'12345'};
const persisted:unknown[]=[];
const store=()=>{created++;return {async claim(id:string,digest:string){reserved++;persisted.push({id,digest});return claimState==='send'?{status:'send' as const,claimToken:'11111111-1111-4111-8111-111111111112'}:{status:claimState};},async finish(id:string,token:string,value:unknown){finished++;persisted.push({id,token,value});return true;}};};
const submit=async(_config:unknown,input:unknown)=>{sent++;assert.deepEqual(input,{destination:'+37499000101',code:'123456'});return outcome;};
assert.equal((await handleAuthSmsHook(request(),config,store,submit)).status,200);
assert.equal(sent,1);assert.equal(reserved,1);assert.equal(finished,1);
assert.ok(!JSON.stringify(persisted).includes('123456'));assert.ok(!JSON.stringify(persisted).includes('37499000101'));
// Stay well outside the 300-second tolerance: a 301-second future fixture
// can enter the valid window while the earlier async assertions run.
for(const req of [request(raw,'msg_bad',new Date(),'v1,bad'),request(raw,'msg_old',new Date(Date.now()-600000)),request(raw,'msg_future',new Date(Date.now()+600000)),request(raw+' ','msg_modified',new Date(),new Webhook(secret).sign('msg_modified',new Date(),raw))])assert.equal((await handleAuthSmsHook(req,config,store,submit)).status,403);
assert.equal(created,1,'invalid signatures must never create a privileged store');
for(const body of [JSON.stringify({user:{phone:'+447700900123'},sms:{otp:'123456'}}),JSON.stringify({user:{phone:'+37499000101'},sms:{otp:'12345'}}),JSON.stringify({user:{phone:'+37499000101'},sms:{otp:123456}})])assert.equal((await handleAuthSmsHook(request(body),config,store,submit)).status,400);
assert.equal(sent,1);
for(const state of ['accepted','failed','unknown','submitting'] as const){claimState=state;const r=await handleAuthSmsHook(request(),config,store,submit);assert.equal(r.status,state==='accepted'?200:503);assert.equal(sent,1,'duplicate hook must never send again');}
claimState='send';outcome={status:'failed'};assert.equal((await handleAuthSmsHook(request(),config,store,submit)).status,502);
outcome={status:'unknown'};assert.equal((await handleAuthSmsHook(request(),config,store,submit)).status,503);
assert.equal((await handleAuthSmsHook(request('x'.repeat(32769)),config,store,submit)).status,413);
const unavailable=()=>({claim:async()=>{throw Error('storage with sensitive input');},finish:async()=>true});
assert.equal((await handleAuthSmsHook(request(),config,unavailable,submit)).status,503);
const unknownFinish=()=>({claim:async()=>({status:'send' as const,claimToken:'11111111-1111-4111-8111-111111111112'}),finish:async()=>false});
outcome={status:'accepted',reference:'12345'};const failedFinish=await handleAuthSmsHook(request(),config,unknownFinish,submit);assert.equal(failedFinish.status,503);assert.ok(!(await failedFinish.text()).includes('sensitive'));
const slowRequest=new Request('https://app.noreon.health/api/auth/send-sms',{method:'POST',headers:{'content-type':'application/json','webhook-id':'msg_slow','webhook-timestamp':String(Math.floor(Date.now()/1000)),'webhook-signature':'v1,unused'},body:new ReadableStream(),duplex:'half'} as RequestInit);
let started=Date.now();assert.equal((await handleAuthSmsHook(slowRequest,config,store,submit)).status,400);assert.ok(Date.now()-started<1500,'slow body must time out before provider work');
let timedOutcome:unknown;
const timedStore=()=>({claim:async()=>({status:'send' as const,claimToken:'11111111-1111-4111-8111-111111111112'}),finish:async(_id:string,_token:string,value:unknown)=>{timedOutcome=value;return true;}});
started=Date.now();assert.equal((await handleAuthSmsHook(request(),config,timedStore,async()=>await new Promise<never>(()=>{}))).status,503);assert.ok(Date.now()-started<3500,'provider must not consume the Supabase hook deadline');assert.deepEqual(timedOutcome,{status:'unknown'});
console.log('Signed hook verification, privacy, duplicate and provider outcome checks pass.');
