// T-auth PR A: the Supabase Send-SMS hook's Telegram provider, the contact port at the
// Telegram webhook, and the off-by-default switches. Fictional values only; no network.
import assert from 'node:assert/strict';
const {Webhook}=await import('standardwebhooks');
const {codeDigest,handleTelegramAuthHook:runHook,nonceDigest,telegramAuthKeys,telegramCodeText}=await import('@/lib/telegram-auth/hook');
const {telegramAuthEnabled}=await import('@/lib/telegram-auth/runtime');
const {phoneCodePolicy}=await import('@/lib/patient/phone-code-policy');
const {createTelegramWebhook}=await import('@/lib/telegram-channel/ingress');

const logs:{level:string;msg:string;fields?:Record<string,unknown>}[]=[];
const logger={
 info(msg:string,fields?:Record<string,unknown>){logs.push({level:'info',msg,fields});},
 warn(msg:string,fields?:Record<string,unknown>){logs.push({level:'warn',msg,fields});},
};
const handleTelegramAuthHook:typeof runHook=async(request,keys,store,send)=>{
 const n=logs.length;
 const response=await runHook(request,keys,store,send,logger);
 assert.equal(logs.length,n+1,'Every hook call logs exactly once');
 const event=logs[n];
 assert.equal(event.msg,'telegram_auth_hook');
 assert.equal(event.level,response.status===200?'info':'warn');
 assert.equal(event.fields?.status,response.status);
 assert.deepEqual(Object.keys(event.fields??{}).sort(),['duration_ms','error_code','status']);
 assert.ok(Number(event.fields?.duration_ms)>=0);
 for(const privateValue of ['37499000201','654321','7201','msg_tg',REQ])assert.ok(!JSON.stringify(event).includes(privateValue),'Logs contain no member data or request id');
 return response;
};

const secret='whsec_'+Buffer.alloc(32,9).toString('base64');
const keys=telegramAuthKeys(secret);
assert.throws(()=>telegramAuthKeys('whsec_short'),'Short hook secrets are refused');
assert.throws(()=>telegramAuthKeys(undefined));
const raw=JSON.stringify({user:{id:'11111111-1111-4111-8111-111111111111',phone:'37499000201'},sms:{otp:'654321'}});
const request=(body=raw,id='msg_tg',signature?:string,at=new Date())=>new Request('https://app.noreon.health/api/auth/send-sms',{method:'POST',headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':String(Math.floor(at.getTime()/1000)),'webhook-signature':signature??new Webhook(secret).sign(id,at,body)},body});
const REQ='22222222-2222-4222-8222-222222222222';

type Claim=Record<string,unknown>;
let claim:Claim={ok:true,replay:false,requestId:REQ,address:'7201',route:'binding'};
let finishAnswer:unknown={ok:true,updated:true};
const calls:{claim:unknown[][];finish:unknown[][];send:unknown[][]}={claim:[],finish:[],send:[]};
let created=0;
const store=()=>{created++;return {
 async claim(...args:unknown[]){calls.claim.push(args);return claim;},
 async finish(...args:unknown[]){calls.finish.push(args);return finishAnswer;},
};};
let sendResult:unknown={kind:'accepted',providerRef:'tg-1'};
const send=async(...args:unknown[])=>{calls.send.push(args);return sendResult as never;};

// Accepted: one claim, one send to the pinned address, finish with the keyed digest; no code persisted.
assert.equal((await handleTelegramAuthHook(request(),keys,store,send)).status,200);
assert.deepEqual(calls.claim[0].slice(0,2),['+37499000201','msg_tg']);
assert.match(String(calls.claim[0][2]),/^[a-f0-9]{64}$/);
assert.deepEqual(calls.send[0].slice(0,2),['7201',telegramCodeText('654321')]);
assert.deepEqual(calls.finish[0].slice(0,4),[REQ,'msg_tg','accepted',codeDigest(keys,REQ,'+37499000201','654321')]);
assert.ok(!JSON.stringify([calls.claim,calls.finish]).includes('654321'),'The code is never handed to storage');
assert.notEqual(codeDigest(keys,REQ,'+37499000201','654321'),codeDigest(keys,'33333333-3333-4333-8333-333333333333','+37499000201','654321'),'Digest is bound to the request');
assert.notEqual(nonceDigest(keys,'a'),nonceDigest(telegramAuthKeys('whsec_'+Buffer.alloc(32,8).toString('base64')),'a'),'Digest is keyed');
assert.ok(!telegramCodeText('654321').includes('—'),'No em dash in member copy');

// Bad signatures never create a privileged store or send.
const before=created;
for(const r of [request(raw,'msg_bad','v1,bad'),request(raw,'msg_old',undefined,new Date(Date.now()-600000)),request(raw+' ','msg_mod',new Webhook(secret).sign('msg_mod',new Date(),raw))])assert.equal((await handleTelegramAuthHook(r,keys,store,send)).status,403);
assert.equal(created,before);assert.equal(calls.send.length,1);
for(const body of [JSON.stringify({user:{phone:'37499000201'},sms:{otp:'12345'}}),JSON.stringify({user:{phone:'abc'},sms:{otp:'123456'}})])assert.equal((await handleTelegramAuthHook(request(body),keys,store,send)).status,400);

// Refusals and replays: nothing is sent.
for(const c of ['no_request','no_destination','reproof_required','link_unavailable','invalid','conflict'].map(code=>({ok:false,code}))){claim=c;assert.equal((await handleTelegramAuthHook(request(),keys,store,send)).status,503);assert.equal(logs.at(-1)?.fields?.error_code,c.code);}
claim={ok:true,replay:true,requestId:REQ,state:'sent',address:'7201'};assert.equal((await handleTelegramAuthHook(request(),keys,store,send)).status,200,'A retried webhook after a send answers 200');
claim={ok:true,replay:true,requestId:REQ,state:'failed',address:'7201'};assert.equal((await handleTelegramAuthHook(request(),keys,store,send)).status,503);
claim={ok:true,replay:false,requestId:REQ,address:'not-a-chat',route:'binding'};assert.equal((await handleTelegramAuthHook(request(),keys,store,send)).status,503,'Malformed claim refused');
assert.equal(calls.send.length,1,'No refusal or replay ever sends');

// Telegram failure or uncertainty: 503 (Supabase then rejects the generated code) and no digest.
claim={ok:true,replay:false,requestId:REQ,address:'7201',route:'proof'};
for(const [result,outcome] of [[{kind:'definitely_failed',evidence:'blocked'},'failed'],[{kind:'unknown',reason:'timeout'},'unknown']] as const){
 sendResult=result;const n=calls.finish.length;
 assert.equal((await handleTelegramAuthHook(request(),keys,store,send)).status,503);
 assert.deepEqual(calls.finish[n].slice(2,4),[outcome,null]);
}
sendResult={kind:'accepted',providerRef:'tg-2'};finishAnswer={ok:true,updated:false};
assert.equal((await handleTelegramAuthHook(request(),keys,store,send)).status,503,'An unrecorded send is not reported as sent');
finishAnswer={ok:true,updated:true};
const started=Date.now();
assert.equal((await handleTelegramAuthHook(request(),keys,store,async()=>await new Promise<never>(()=>{}))).status,503);
assert.ok(Date.now()-started<4000,'A hanging Telegram call stays inside the hook deadline');
const broken=()=>({claim:async()=>{throw Error('storage with +37499000201');},finish:async()=>({ok:true,updated:true})});
const refused=await handleTelegramAuthHook(request(),keys,broken,send);assert.equal(refused.status,503);assert.ok(!(await refused.text()).includes('37499'));

// Switches: everything off unless all agree.
const on={NOREON_TELEGRAM_ENABLED:'true',NOREON_TELEGRAM_AUTH_ENABLED:'true',NOREON_PHONE_OTP_PROVIDER:'telegram-hook',NOREON_PHONE_OTP_HOOK_READY:'true',NOREON_TELEGRAM_ACCOUNT:'noreon_test',NOREON_TELEGRAM_BOT_ID:'9001',NOREON_TELEGRAM_BOT_TOKEN:'9001:fictional'};
assert.equal(telegramAuthEnabled(on),true);
for(const key of Object.keys(on))assert.equal(telegramAuthEnabled({...on,[key]:undefined}),false,`${key} missing keeps Telegram codes off`);
assert.equal(phoneCodePolicy({...on})?.delivery,'telegram');
assert.equal(phoneCodePolicy({...on,NOREON_TELEGRAM_AUTH_ENABLED:'false'}),null,'Provider without the T-auth flag is unavailable, never SMS');
assert.equal(phoneCodePolicy({...on,NOREON_PHONE_OTP_HOOK_READY:undefined}),null);

// Webhook: an own-contact share goes to the contact port with the phone and time only.
const bot={account:'noreon_test',botId:9001};
const contacts:unknown[]=[];
const hook=createTelegramWebhook({config:{...bot,enabled:true,webhookSecret:'s'.repeat(40),maxBodyBytes:262144,readTimeoutMs:2000,commitTimeoutMs:2000},
 inbox:async()=>({status:'failed'}),
 media:async()=>{throw Error('contact must not reach media');},
 contact:async event=>{contacts.push(event);return {status:'committed',eventId:event.eventId,fingerprint:event.fingerprint};}});
const update=(message:Record<string,unknown>)=>new Request('https://app.noreon.health/api/telegram/webhook',{method:'POST',headers:{'content-type':'application/json','X-Telegram-Bot-Api-Secret-Token':'s'.repeat(40)},body:JSON.stringify({update_id:900,message:{message_id:5,date:1_790_000_000,from:{id:7201,is_bot:false,first_name:'Synthetic'},chat:{id:7201,type:'private'},...message}})});
assert.equal((await hook(update({contact:{phone_number:'+374 99 000 201',user_id:7201,first_name:'Synthetic',vcard:'x'}}))).status,200);
assert.equal(contacts.length,1);
const shared=contacts[0] as Record<string,unknown>;
assert.equal(shared.phone,'+37499000201');assert.equal(shared.sentAt,1_790_000_000);
assert.ok(!JSON.stringify(shared).includes('Synthetic')&&!JSON.stringify(shared).includes('vcard'),'Name and vCard never leave the parser');
assert.equal((await hook(update({contact:{phone_number:'+37499000999',user_id:7999}}))).status,200);
assert.equal(contacts.length,2);
assert.equal((contacts[1] as Record<string,unknown>).phone,null,'Someone else\'s card reaches the contact port only as a refusal, without its number');
assert.ok(!JSON.stringify(contacts[1]).includes('37499000999'));

console.log('PASS Telegram code hook: signature first, one send to the claimed account, keyed code digest, refusals and replays never send, failures answer 503; switches off by default; own-contact shares only.');
