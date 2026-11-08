// Real requestTelegramCode with isolated cookies, Auth and service RPCs. No secrets or network.
// Catches a wasted OTP request while a browser's own contact is still queued.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {createHash} from 'node:crypto';
import {nonceDigest,telegramAuthKeys} from '@/lib/telegram-auth/hook';

const phone='+37499000201',nonce='a'.repeat(43),requestId='22222222-2222-4222-8222-222222222222';
const secret='whsec_'+Buffer.alloc(32,9).toString('base64');
const nonceHmac=nonceDigest(telegramAuthKeys(secret),nonce);
let now=0,hasCookie=true,dispatches=0,authCalls=0,writes=0;
let states:unknown[]=[];
let begin:unknown={ok:true,requestId},resultStatus:unknown={ok:true,state:'sent',refusal:null};
let linkOpen:unknown={ok:true,open:false};
let authError=false,rpcError=false,throws=false,enabled=true,hang:false|'first'|'later'=false,reads=0,hanging=false;
const calls:{name:string;args:Record<string,unknown>}[]=[],logs:{msg:string;fields:Record<string,unknown>}[]=[];
const service={async rpc(name:string,args:Record<string,unknown>){
 calls.push({name,args});
 if(name==='auth_code_request_link_open')return linkOpen===null?{data:null,error:{}}:{data:linkOpen,error:null};
 if(name==='auth_code_request_proof_state'){
  reads++;
  if(hang==='first'||(hang==='later'&&reads>1)){hanging=true;return new Promise(()=>{});}
  if(throws)throw Error('Synthetic RPC failure');
  return {data:states.length>1?states.shift():states[0],error:rpcError?{}:null};
 }
 return {data:name==='auth_code_request_begin'?begin:name==='auth_code_request_status'?resultStatus:
  name==='telegram_auth_challenge_create'?{ok:true,token:'t'.repeat(32),expiresAt:'2026-11-05T00:00:00Z'}:{ok:true},error:null};
}};
const modules:Record<string,unknown>={
 'server-only':{},'node:crypto':await import('node:crypto'),'zod':{z},
 'next/headers':{cookies:async()=>({get:()=>hasCookie?{value:JSON.stringify({nonce})}:undefined,set:()=>{writes++;}})},
 '@/lib/supabase/server':{createClient:async()=>({auth:{signInWithOtp:async()=>{authCalls++;return {error:authError?{}:null};}}})},
 '@/lib/telegram-runtime/config':{telegramBotUsername:()=> 'synthetic_bot'},
 '@/lib/telegram-runtime/dispatch-trigger':{requestTelegramDispatch:async()=>{dispatches++;throw Error('Ignored');}},
 '@/lib/observability/logger':{log:{info:(msg:string,fields:Record<string,unknown>)=>logs.push({msg,fields})}},
 './hook':{nonceDigest,telegramAuthKeys},
 './runtime':{telegramAuthEnabled:()=>enabled,telegramAuthService:()=>service},
};
const exports:{requestTelegramCode?:(phone:string,captcha?:string,shownLink?:string)=>Promise<unknown>}={};
const source=ts.transpileModule(readFileSync('lib/telegram-auth/member-signin.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new vm.Script(source).runInNewContext({exports,Buffer,process:{env:{NOREON_SUPABASE_SMS_HOOK_SECRET:secret}},Date:{now:()=>now},
 // 500 ms is the wait between reads; any other timer bounds a read and fires only when that read hangs.
 setTimeout:(fn:()=>void,ms:number)=>{if(ms===500){now+=ms;fn();return 0;}if(hanging){hanging=false;queueMicrotask(()=>{now+=ms;fn();});}return 0;},clearTimeout:()=>{},
 require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
async function run(expected:unknown,outcome:string,shownLink?:string){
 logs.length=0;
 const result=await exports.requestTelegramCode!(phone,undefined,shownLink);
 assert.deepEqual(JSON.parse(JSON.stringify(result)),expected);
 assert.equal(logs.length,1,'One result log per call');
 assert.equal(logs[0].msg,'telegram_signin_code');
 assert.deepEqual(Object.keys(logs[0].fields).sort(),['duration_ms','error_code']);
 assert.equal(logs[0].fields.error_code,outcome);
 assert.ok(Number(logs[0].fields.duration_ms)>=0);
 for(const value of [phone,nonce,nonceHmac,requestId])assert.ok(!JSON.stringify(logs).includes(value));
}
function reset(){reads=0;hang=false;now=0;hasCookie=true;dispatches=0;authCalls=0;writes=0;calls.length=0;rpcError=false;throws=false;}
states=[{ok:true,state:'pending'},{ok:true,state:'ready'}];
await run({ok:true},'sent');
assert.equal(now,500);assert.equal(dispatches,1);assert.equal(authCalls,1);
assert.deepEqual(calls.map(c=>c.name),['auth_code_request_proof_state','auth_code_request_proof_state','auth_code_request_begin','auth_code_request_status']);
assert.equal(calls[0].args.p_nonce_hmac,nonceHmac);
reset();states=[{ok:true,state:'pending'}];
await run({ok:false,reason:'pending'},'pending');
assert.equal(now,4000);assert.equal(dispatches,1);assert.equal(authCalls,0);assert.equal(writes,0);
assert.ok(calls.every(c=>c.name==='auth_code_request_proof_state'),'No begin, Auth or abandon while contact remains pending');
for(const mode of ['none','error','throw','malformed','no_cookie']){
 reset();states=[{ok:true,state:mode==='malformed'?'other':'none'}];
 rpcError=mode==='error';throws=mode==='throw';hasCookie=mode!=='no_cookie';
 await run({ok:true},'sent');assert.equal(authCalls,1);assert.equal(dispatches,0);assert.equal(now,0);
 assert.equal(calls.filter(c=>c.name==='auth_code_request_proof_state').length,hasCookie?1:0);
}
reset();states=[{ok:true,state:'none'}];
for(const code of ['busy','invalid','other']){begin={ok:false,code};await run({ok:false,reason:code==='other'?'unavailable':code},`begin_${code}`);}
begin={ok:true,requestId};authError=true;
for(const refusal of ['no_destination','reproof_required']){
 resultStatus={ok:true,state:'refused',refusal};
 await run({ok:false,reason:'prove',url:'https://t.me/synthetic_bot?start='+'t'.repeat(32)},`prove_${refusal}`);
}
// Khikar, 4 Nov: a return from the bot keeps the exact link the page shows while that link is open, instead of using
// up one of the browser's 10 links per hour (review R1: one browser can hold several links in several tabs).
const made=()=>calls.filter(c=>c.name==='telegram_auth_challenge_create').length;
const checks=()=>calls.filter(c=>c.name==='auth_code_request_link_open');
const shown='s'.repeat(32),fresh={ok:false,reason:'prove',url:'https://t.me/synthetic_bot?start='+'t'.repeat(32)};
resultStatus={ok:true,state:'refused',refusal:'no_destination'};states=[{ok:true,state:'none'}];
reset();linkOpen={ok:true,open:true};
await run({ok:false,reason:'prove',url:null},'prove_kept_no_destination',shown);assert.equal(made(),0,'The shown link is open: kept');
assert.deepEqual(JSON.parse(JSON.stringify(checks().map(c=>c.args))),[{p_phone:phone,p_nonce_hmac:nonceHmac,p_token_hash:createHash('sha256').update(shown,'utf8').digest('hex')}],'The exact shown link is checked, by its hash');
reset();linkOpen={ok:true,open:false};
await run(fresh,'prove_no_destination',shown);assert.equal(made(),1,'The shown link is closed, used or expiring: replaced');
reset();linkOpen={ok:true,open:true};
await run(fresh,'prove_no_destination');assert.equal(made(),1,'No link on the page: a new one');assert.equal(checks().length,0);
reset();linkOpen={ok:true,open:true};
await run(fresh,'prove_no_destination','not a token');assert.equal(made(),1,'A malformed token is never checked or kept');assert.equal(checks().length,0);
reset();linkOpen=null;
await run(fresh,'prove_no_destination',shown);assert.equal(made(),1,'An unreadable answer never keeps a link');
reset();linkOpen={ok:true,open:true};resultStatus={ok:true,state:'refused',refusal:'reproof_required'};
await run({ok:false,reason:'prove',url:null},'prove_kept_reproof_required',shown);
resultStatus={ok:true,state:'refused',refusal:'no_destination'};
// QA 284: fixed refusal codes survive replacement of the consumed link, never raw RPC fields.
for(const contactRefusal of ['phone_mismatch','not_own_contact','stale']){
 reset();linkOpen={ok:true,open:false,contactRefusal,phone:'+37499000999',address:'999999999'};
 await run({...fresh,contactRefusal},'prove_no_destination',shown);
 assert.equal(made(),1,'A refused challenge gets a fresh usable bot link');
}
reset();linkOpen={ok:true,open:false,contactRefusal:'+37499000999'};
await run(fresh,'prove_no_destination',shown);
reset();linkOpen=null;await run(fresh,'prove_no_destination',shown);
reset();
resultStatus={ok:true,state:'sent',refusal:null};await run({ok:false,reason:'unavailable'},'auth_failed');
authError=false;resultStatus={ok:true,state:'failed',refusal:null};await run({ok:false,reason:'unavailable'},'status_failed');
enabled=false;await run({ok:false,reason:'unavailable'},'disabled');
// A read that never answers is cut off by what is left of the 4 s: first read hanging carries on to a code
// request, a hang after a pending read ends as pending with no code request.
reset();states=[{ok:true,state:'none'}];begin={ok:true,requestId};authError=false;resultStatus={ok:true,state:'sent',refusal:null};enabled=true;
hang='first';await run({ok:true},'sent');assert.equal(now,4000);assert.equal(authCalls,1);
reset();states=[{ok:true,state:'pending'}];hang='later';
await run({ok:false,reason:'pending'},'pending');assert.equal(now,4000);assert.equal(authCalls,0);assert.equal(reads,2);
reset();states=[{ok:true,state:'pending'}];
const plainRpc=service.rpc;service.rpc=async(name:string,args:Record<string,unknown>)=>{if(name==='auth_code_request_proof_state'&&reads>=1){reads++;calls.push({name,args});return {data:null,error:{}};}return plainRpc(name,args);};
await run({ok:false,reason:'pending'},'pending');assert.equal(authCalls,0);
service.rpc=plainRpc;
console.log('PASS Telegram sign-in code: queued contact waits, one sweep, bounded pending avoids OTP, errors continue, private outcome logs; challenge refusal allowlist survives link replacement without raw fields.');
