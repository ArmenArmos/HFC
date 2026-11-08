/** Actual voice route, synthetic auth/rate-limit ports, real bounded body reader and transcription. No network or DB. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {readClinicUploadBody} from '@/lib/clinic-portal/upload-server';
import {transcribe,voiceAvailable} from '@/lib/zoe-chat-actions/voice';
import {signVoiceReceipt,verifyVoiceReceipt} from '@/lib/zoe-chat-actions/voice-receipt';
import * as rateCore from '@/lib/security/rate-limit-core';
import {VOICE_MAX_BYTES} from '@/lib/zoe-chat-actions/voice-contract';
let env:Record<string,string|undefined>={NODE_ENV:'test',NOREON_ZOE_APP_V3:'true',NOREON_MEMBER_CHAT_V2:'true',NOREON_ZOE_VOICE_PROVIDER:'fake'};
let identity:{memberId:string}|null={memberId:'synthetic-member'},admitted=true,limiterFailure=false,claims=0,reads=0,transcriptions=0;
let slowUpload=false;let uploadTimeout:(()=>void)|null=null;
let rpcError:string|null=null;
const limiterExports:Record<string,unknown>={};
const limiterDeps:Record<string,unknown>={
 'server-only':{},'next/headers':{headers:async()=>new Headers()},
 '@supabase/supabase-js':{createClient:()=>({rpc:()=>({abortSignal:async()=>({data:0,error:rpcError?{code:rpcError}:null})})})},
 '@/lib/observability/logger':{log:{warn:()=>{}}},'./rate-limit-core':rateCore,
};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/security/rate-limit.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:limiterExports,AbortSignal,process:{env:{SUPABASE_SERVICE_ROLE_KEY:'synthetic-test-key-that-is-at-least-32-characters',NEXT_PUBLIC_SUPABASE_URL:'http://synthetic.invalid'}},require:(name:string)=>{assert.ok(name in limiterDeps,name);return limiterDeps[name];}});
const realLimit=limiterExports.rateLimit as (...args:unknown[])=>Promise<unknown>;
const exports:Record<string,unknown>={};
const deps:Record<string,unknown>={
  '@/lib/zoe-chat-actions/actor':{sessionActor:async()=>identity},
  '@/lib/observability/with-logging':{withRouteLogging:<T,>(handler:T)=>handler},
  '@/lib/zoe-chat-actions/voice':{voiceAvailable:()=>voiceAvailable(env),transcribe:(audio:Parameters<typeof transcribe>[0],locale:Parameters<typeof transcribe>[1])=>{transcriptions++;return transcribe(audio,locale,env);}},
  '@/lib/zoe-chat-actions/voice-contract':{VOICE_MAX_BYTES},
  '@/lib/zoe-chat-actions/voice-receipt':{signVoiceReceipt:(member:string,text:string,_secret:unknown,_now:unknown,transcripts:Parameters<typeof signVoiceReceipt>[4])=>signVoiceReceipt(member,text,'synthetic-test-key-that-is-at-least-32-characters',Date.now(),transcripts)},
  '@/lib/security/rate-limit':{rateLimit:async(operation:string,buckets:unknown[],...options:unknown[])=>{claims++;assert.equal(operation,'member_upload');assert.deepEqual(JSON.parse(JSON.stringify(buckets)),[{kind:'source'},{kind:'user',value:identity!.memberId}]);if(limiterFailure)throw Error('Synthetic outage');if(rpcError)return realLimit(operation,buckets,...options);return admitted?{ok:true}:{ok:false,retryAfter:30};}},
  '@/lib/staff/request':{sameWorkspaceOrigin:(r:Request)=>r.headers.get('origin')===new URL(r.url).origin},
  '@/lib/clinic-portal/upload-server':{readClinicUploadBody:async(...args:Parameters<typeof readClinicUploadBody>)=>{reads++;return readClinicUploadBody(...args);}},
};
vm.runInNewContext(ts.transpileModule(readFileSync('app/api/patient/zoe/voice/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,TransformStream,AbortController,setTimeout:(callback:()=>void,ms:number)=>{if(slowUpload){uploadTimeout=callback;return 0;}return setTimeout(callback,ms);},clearTimeout,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const post=exports.POST as (r:Request)=>Promise<Response>;
const request=(headers:Record<string,string>={},body:BodyInit='fake audio')=>new Request('http://localhost/api/patient/zoe/voice',{method:'POST',headers:{origin:'http://localhost','content-type':'audio/mp4','x-voice-duration-ms':'1000','x-voice-locale':'en',...headers},body});
assert.equal((await post(request())).status,200);assert.equal(reads,1);assert.equal(claims,1);
for(const bad of [{NOREON_MEMBER_CHAT_V2:undefined},{NOREON_MEMBER_CHAT_V2:'false'},{NOREON_ZOE_APP_V3:undefined},{NOREON_ZOE_APP_V3:'false'},{NOREON_ZOE_VOICE_PROVIDER:undefined},{NOREON_ZOE_VOICE_PROVIDER:'unknown'},{NODE_ENV:'production'}]){
  const before=env;env={...env,...bad};assert.equal((await post(request())).status,503);env=before;
}
assert.equal(reads,1);assert.equal(claims,1,'Unavailable paths never reach auth limiter/body IO');
identity=null;assert.equal((await post(request())).status,401);assert.equal(reads,1);identity={memberId:'synthetic-member'};
assert.equal((await post(request({origin:'https://elsewhere.example'}))).status,403);assert.equal(reads,1);
admitted=false;const limited=await post(request());assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'30');assert.equal(reads,1);admitted=true;
limiterFailure=true;assert.equal((await post(request())).status,503);assert.equal(reads,1);limiterFailure=false;
rpcError='PGRST202';const beforeMissing=reads,beforeTranscribe=transcriptions;const missingRequest=request();assert.equal((await post(missingRequest)).status,503,'Missing RPC must fail closed through the real limiter');assert.equal(reads,beforeMissing);assert.equal(missingRequest.bodyUsed,false);assert.equal(transcriptions,beforeTranscribe);assert.equal((await realLimit('member_upload',[{kind:'user',value:identity!.memberId}]) as {ok:boolean}).ok,true,'Other routes retain missing-RPC compatibility');rpcError=null;
assert.equal((await post(request({'content-length':String(VOICE_MAX_BYTES+1)}))).status,413);assert.equal(reads,1);
assert.equal((await post(request({},new Uint8Array(VOICE_MAX_BYTES+1)))).status,400);
assert.equal((await post(request({'x-voice-duration-ms':'60001'}))).status,400);
assert.equal((await post(request({'content-type':'text/plain'}))).status,400);
const result=await post(request());assert.equal(result.headers.get('cache-control'),'private, no-store');const body=await result.json();assert.equal(body.status,'ok');assert.equal(body.text,'145/92');assert.equal(body.urgent,false);assert.equal(body.transcripts,undefined,'Raw secondary transcripts never cross the HTTP boundary');assert.equal(body.receipt.split('.').length,4,'Route issues a receipt signing both engine hashes');assert.equal(verifyVoiceReceipt(body.receipt,identity!.memberId,body.text,Date.now(),'synthetic-test-key-that-is-at-least-32-characters'),true,'HTTP route signs exact text and authenticated member');
slowUpload=true;let cancelled=false;
const slow={url:'http://localhost/api/patient/zoe/voice',headers:request().headers,body:new ReadableStream({cancel(){cancelled=true;}})} as Request;
const pending=post(slow);await new Promise(resolve=>setImmediate(resolve));
assert.ok(uploadTimeout,'Upload has a time bound');(uploadTimeout as unknown as () => void)();
assert.equal((await pending).status,400);assert.equal(cancelled,true,'Timed out upload cancels the body stream');
console.log('Voice HTTP: switch/provider, origin, auth, member limiter, fail-closed limiter, declared/streamed size and metadata limits passed');
