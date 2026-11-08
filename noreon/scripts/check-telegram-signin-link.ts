// One-tap sign-in links from the bot: the hook seals (never sends) a link request's code, the
// sender puts a fresh token on the inline button only when the link arms, and the switch stays dark. No network.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const {Webhook}=await import('standardwebhooks');
const {codeDigest,handleTelegramAuthHook,sealCode,telegramAuthKeys,unsealCode}=await import('@/lib/telegram-auth/hook');
const {signinLinkOrigin}=await import('@/lib/telegram-auth/signin-link-config');
const {dispatchAuthMessage}=await import('@/lib/telegram-runtime/dispatch');
const {redeemSigninLink,maskPhone}=await import('@/lib/telegram-auth/signin-link');

const secret='whsec_'+Buffer.alloc(32,9).toString('base64');
const keys=telegramAuthKeys(secret);
const REQ='22222222-2222-4222-8222-222222222222',OTHER='33333333-3333-4333-8333-333333333333';

// Sealing: bound to the request and the key; tampering fails closed.
const s=sealCode(keys,REQ,'654321');
assert.equal(unsealCode(keys,REQ,s),'654321');
assert.equal(unsealCode(keys,OTHER,s),null,'Bound to its request');
assert.equal(unsealCode(telegramAuthKeys('whsec_'+Buffer.alloc(32,8).toString('base64')),REQ,s),null,'Keyed');
for(let i=0;i<20;i++){const t=sealCode(keys,REQ,'654321'),c=t.at(-2)==='A'?'B':'A';assert.equal(unsealCode(keys,REQ,t.slice(0,-2)+c+t.slice(-1)),null,'Tampering refused');}
assert.ok(!s.includes('654321'));assert.notEqual(sealCode(keys,REQ,'654321'),s,'Fresh IV each time');

// Hook, route link: no send, the sealed code goes to storage, finish carries the digest.
const raw=JSON.stringify({user:{id:'11111111-1111-4111-8111-111111111111',phone:'37499000201'},sms:{otp:'654321'}});
const request=(id:string)=>{const at=new Date();return new Request('https://app.noreon.health/api/auth/send-sms',{method:'POST',headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':String(Math.floor(at.getTime()/1000)),'webhook-signature':new Webhook(secret).sign(id,at,raw)},body:raw});};
const calls:{seal:unknown[][];finish:unknown[][];send:unknown[][]}={seal:[],finish:[],send:[]};
let sealAnswer:unknown={ok:true,updated:true};
const store=(withSeal=true)=>()=>({
 async claim(){return {ok:true,replay:false,requestId:REQ,route:'link'};},
 async finish(...a:unknown[]){calls.finish.push(a);return {ok:true,updated:true};},
 ...(withSeal?{async seal(...a:unknown[]){calls.seal.push(a);return sealAnswer;}}:{}),
});
const send=async(...a:unknown[])=>{calls.send.push(a);return {kind:'accepted',providerRef:'tg'} as never;};
assert.equal((await handleTelegramAuthHook(request('msg_l1'),keys,store(),send)).status,200);
assert.equal(calls.send.length,0,'A link request is never sent anywhere');
assert.deepEqual(calls.seal[0].slice(0,2),[REQ,'msg_l1']);
assert.equal(unsealCode(keys,REQ,String(calls.seal[0][2])),'654321','Server can open what the hook sealed');
assert.deepEqual(calls.finish[0].slice(0,4),[REQ,'msg_l1','accepted',codeDigest(keys,REQ,'+37499000201','654321')]);
for(const [answer,label] of [[{ok:true,updated:false},'Seal not stored'],[{ok:false,code:'x'},'Seal refused']] as const){
 sealAnswer=answer;const n=calls.finish.length;
 assert.equal((await handleTelegramAuthHook(request('msg_l2'),keys,store(),send)).status,503,label);
 assert.deepEqual(calls.finish[n].slice(2,4),['unknown',null],`${label}: no digest`);
}
sealAnswer={ok:true,updated:true};
assert.equal((await handleTelegramAuthHook(request('msg_l3'),keys,store(false),send)).status,503,'A store without sealing refuses');
assert.equal(calls.send.length,0);

// Sender: a fresh token per send, only its hash stored; the link rides on the inline button, never in the text.
const envelope={messageId:'44444444-4444-4444-8444-444444444444',attemptId:'55555555-5555-4555-8555-555555555555',address:'7201',text:'Your next step.'};
type Sent={text:string;keyboard?:{kind:string;label?:string;url?:string}};
const sent:Sent[]=[];const armedWith:string[]=[];
const adapter={deliverText:async(m:Sent)=>{sent.push(m);return {kind:'accepted',providerRef:'tg'} as never;}};
const rpc=(arm:unknown,env:object=envelope)=>async(name:string,args:Record<string,unknown>)=>{
 if(name==='telegram_auth_message_claim')return {ok:true,fresh:true,envelope:env};
 if(name==='telegram_signin_link_arm'){armedWith.push(String(args.p_token_hash));if(arm instanceof Error)throw arm;return arm;}
 return {ok:true};
};
const ORIGIN={signinLinkOrigin:'https://app.noreon.health',backoffMs:0};
// A next-step reply has no button: it gets the approved label from the arm, carrying the link.
await dispatchAuthMessage(rpc({ok:true,step:'next_review',label:'Բացել Noreon-ը'}) as never,adapter,envelope.messageId,envelope.attemptId,ORIGIN);
const b0=sent[0].keyboard!;
assert.equal(b0.kind,'open_url');assert.equal(b0.label,'Բացել Noreon-ը','Approved label from the arm');
const m=/^https:\/\/app\.noreon\.health\/patient\/telegram-link#t=([A-Za-z0-9_-]{32})$/.exec(b0.url!);
assert.ok(m,'Button carries the link, token only in the fragment');
assert.equal(createHash('sha256').update(m[1],'utf8').digest('hex'),armedWith[0],'Only the hash is armed');
assert.equal(sent[0].text,'Your next step.','Text unchanged: no URL in the message');
for(const arm of [{ok:false,code:'none'},new Error('db down'),{ok:true,step:'next_review'}]){
 await dispatchAuthMessage(rpc(arm) as never,adapter,envelope.messageId,envelope.attemptId,ORIGIN);
 assert.deepEqual(sent.at(-1),{address:'7201',text:'Your next step.'},'No link (and no button) when it did not arm or has no label');
}
// A member notice's own "Open Noreon" button keeps its label and now opens the one-tap link.
const withButton={...envelope,text:'Your clinic proposed a new visit time. Open Noreon to accept or decline.',keyboard:{kind:'open_url',label:'Open Noreon',url:'https://app.noreon.health/patient/care'}};
await dispatchAuthMessage(rpc({ok:true,step:'open_care'},withButton) as never,adapter,envelope.messageId,envelope.attemptId,ORIGIN);
assert.equal(sent.at(-1)!.text,withButton.text,'Notice text unchanged');assert.doesNotMatch(sent.at(-1)!.text,/https?:|telegram-link/,'No URL in the text');
assert.equal(sent.at(-1)!.keyboard!.label,'Open Noreon');assert.match(sent.at(-1)!.keyboard!.url!,/^https:\/\/app\.noreon\.health\/patient\/telegram-link#t=[A-Za-z0-9_-]{32}$/,'Button opens the sign-in link');
await dispatchAuthMessage(rpc({ok:false,code:'none'},withButton) as never,adapter,envelope.messageId,envelope.attemptId,ORIGIN);
assert.deepEqual(sent.at(-1)!.keyboard,withButton.keyboard,'Not armed: the plain page button stays');
// Another keyboard (share contact) never carries a link and is never armed; nor a non-member-app origin.
let n=armedWith.length;
await dispatchAuthMessage(rpc({ok:true,label:'x'},{...envelope,keyboard:{kind:'request_contact',label:'Share'}}) as never,adapter,envelope.messageId,envelope.attemptId,ORIGIN);
assert.equal(armedWith.length,n,'Share-contact keyboard: not armed');assert.deepEqual(sent.at(-1)!.keyboard,{kind:'request_contact',label:'Share'});
await dispatchAuthMessage(rpc({ok:true,label:'x'}) as never,adapter,envelope.messageId,envelope.attemptId,{signinLinkOrigin:'http://localhost:3000'});
assert.equal(armedWith.length,n,'An origin the adapter would refuse is never armed');
n=armedWith.length;
await dispatchAuthMessage(rpc({ok:true}) as never,adapter,envelope.messageId,envelope.attemptId);
assert.equal(armedWith.length,n,'Switch off: nothing armed');assert.deepEqual(sent.at(-1),{address:'7201',text:'Your next step.'});


// Review F-1/F-3: the signed-in member on the opening browser decides. Same member: no second sign-in.
// Another member: never swapped silently (other_account, with that member's masked phone) unless confirmed.
assert.equal(maskPhone('+37499030001'),'+374 •••••• 01');assert.equal(maskPhone('37499030001'),'+374 •••••• 01');
const P={userId:'66666666-6666-4666-8666-666666666666',phone:'37499030001'},Q={userId:'77777777-7777-4777-8777-777777777777',phone:'37491000077'};
const TOKEN='B'.repeat(32);
function redeemDeps(current:typeof P|null,beginAnswer:unknown){
 const calls={begin:[] as Record<string,unknown>[],otp:0,rpc:[] as string[]};const cookies=new Map<string,string>();
 return {calls,deps:{enabled:()=>true,identity:async()=>current,secret,
  rpc:async(name:string,args:Record<string,unknown>)=>{calls.rpc.push(name);if(name==='telegram_signin_link_begin'){calls.begin.push(args);return {data:beginAnswer};}return {data:{ok:true}};},
  client:async()=>({auth:{signInWithOtp:async()=>{calls.otp++;return {error:{message:'synthetic refusal'}};},verifyOtp:async()=>{throw Error('not reached');},signOut:async()=>null}}),
  jar:async()=>({get:(n:string)=>cookies.has(n)?{value:cookies.get(n)!}:undefined,set:(n:string,v:string)=>void cookies.set(n,v),delete:({name}:{name:string})=>void cookies.delete(name)})} as never};
}
{const {calls,deps}=redeemDeps(P,{ok:true,signedIn:true,step:'open_care'});
 assert.deepEqual(await redeemSigninLink(TOKEN,'',{},deps),{ok:true,path:'/patient/care',maskedPhone:'+374 •••••• 01'},'Same member: straight to the page');
 assert.equal(calls.begin[0].p_current_user,P.userId);assert.equal(calls.begin[0].p_switch,false);assert.equal(calls.otp,0,'Same member: no new code');}
{const {calls,deps}=redeemDeps(Q,{ok:false,code:'other_account',step:'open_care'});
 assert.deepEqual(await redeemSigninLink(TOKEN,'',{},deps),{ok:false,reason:'other_account',maskedPhone:'+374 •••••• 77'},'Other member: asked, not swapped');
 assert.equal(calls.otp,0,'Other member: no sign-in started');}
{const {calls,deps}=redeemDeps(Q,{ok:true,requestId:REQ,phone:'+37499030001',step:'open_care'});
 assert.equal((await redeemSigninLink(TOKEN,'',{switchAccount:true},deps)).ok,false);
 assert.equal(calls.begin[0].p_switch,true,'Confirmed switch is passed on');assert.equal(calls.otp,1,'Confirmed switch: the sign-in starts');
 assert.ok(calls.rpc.includes('auth_code_request_abandon'),'Refused by Auth: lease released');}
{const {calls,deps}=redeemDeps(null,{ok:false,code:'expired',step:'open_results'});
 assert.deepEqual(await redeemSigninLink(TOKEN,'',{},deps),{ok:false,reason:'expired',path:'/patient/results'});
 assert.equal(calls.begin[0].p_current_user,null,'Nobody signed in');}
{const {calls,deps}=redeemDeps(P,{ok:true,signedIn:true,step:'open_care'});
 assert.deepEqual(await redeemSigninLink('short','',{},deps),{ok:false,reason:'expired'});assert.equal(calls.begin.length,0,'Malformed token: no database call');}

// Switch: dark unless Telegram sign-in is on and the link flag is set; https origin only in production.
const on={NOREON_TELEGRAM_ENABLED:'true',NOREON_TELEGRAM_AUTH_ENABLED:'true',NOREON_PHONE_OTP_PROVIDER:'telegram-hook',NOREON_PHONE_OTP_HOOK_READY:'true',NOREON_TELEGRAM_ACCOUNT:'noreon_test',NOREON_TELEGRAM_BOT_ID:'9001',NOREON_TELEGRAM_BOT_TOKEN:'9001:fictional',NOREON_TELEGRAM_SIGNIN_LINKS_ENABLED:'true',NOREON_MEMBER_APP_ORIGIN:'https://app.noreon.health'};
assert.equal(signinLinkOrigin(on),'https://app.noreon.health');
assert.equal(signinLinkOrigin({...on,NOREON_TELEGRAM_SIGNIN_LINKS_ENABLED:undefined}),null);
assert.equal(signinLinkOrigin({...on,NOREON_MEMBER_APP_ORIGIN:undefined}),null,'No default origin');
assert.equal(signinLinkOrigin({...on,NOREON_TELEGRAM_AUTH_ENABLED:undefined}),null);
assert.equal(signinLinkOrigin({...on,NOREON_MEMBER_APP_ORIGIN:'http://localhost:3000',NODE_ENV:'production'}),null);
assert.equal(signinLinkOrigin({...on,NOREON_MEMBER_APP_ORIGIN:'http://localhost:3000',NODE_ENV:'development'}),'http://localhost:3000');
assert.equal(signinLinkOrigin({...on,NOREON_MEMBER_APP_ORIGIN:'https://app.noreon.health/x'}),null);
console.log('check-telegram-signin-link: ok');
