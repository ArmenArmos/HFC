/** Actual speech HTTP boundary with injected identity/limiter/provider. No network or secrets. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {readClinicUploadBody} from '@/lib/clinic-portal/upload-server';
let available=true,identity:{memberId:string}|null={memberId:'synthetic-member'},admitted=true,failLimit=false,speeches=0,claims=0;
const deps:Record<string,unknown>={
 '@/lib/zoe-chat-actions/actor':{sessionActor:async()=>identity},
 '@/lib/zoe-chat-actions/voice':{voiceAvailable:async()=>available},
 '@/lib/zoe-chat-actions/speech':{synthesize:async(text:string,locale:string)=>{speeches++;assert.equal(text,'Hello');assert.ok(['hy','ru','en'].includes(locale));return {status:'ok',audioBase64:'UklGRg==',mime:'audio/wav'};}},
 '@/lib/security/rate-limit':{rateLimit:async(key:string,buckets:unknown[],_headers:unknown,options:unknown)=>{claims++;assert.equal(key,'member_speech');assert.deepEqual(JSON.parse(JSON.stringify(options)),{failClosed:true});assert.deepEqual(JSON.parse(JSON.stringify(buckets)),[{kind:'source'},{kind:'user',value:identity!.memberId}]);if(failLimit)throw Error('synthetic');return admitted?{ok:true}:{ok:false,retryAfter:30};}},
 '@/lib/staff/request':{sameWorkspaceOrigin:(r:Request)=>r.headers.get('origin')===new URL(r.url).origin},
 '@/lib/observability/with-logging':{withRouteLogging:<T,>(fn:T)=>fn},
 '@/lib/clinic-portal/upload-server':{readClinicUploadBody},
};
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('app/api/patient/zoe/speech/route.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,AbortController,TransformStream,setTimeout,clearTimeout,JSON,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const post=exports.POST as (r:Request)=>Promise<Response>;
const request=(body:unknown={text:'Hello',locale:'en'},origin='http://localhost')=>new Request('http://localhost/api/patient/zoe/speech',{method:'POST',headers:{origin,'content-type':'application/json'},body:JSON.stringify(body)});
const success=await post(request());assert.equal(success.status,200);assert.equal(success.headers.get('cache-control'),'private, no-store');assert.deepEqual(await success.json(),{status:'ok',audioBase64:'UklGRg==',mime:'audio/wav'});
const count=speeches;
identity=null;assert.equal((await post(request())).status,401);identity={memberId:'synthetic-member'};
assert.equal((await post(request(undefined,'https://other.example'))).status,403);
available=false;assert.equal((await post(request())).status,503);available=true;
admitted=false;const limited=await post(request());assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'30');admitted=true;
failLimit=true;assert.equal((await post(request())).status,503);failLimit=false;
for(const body of [{text:'',locale:'en'},{text:'x'.repeat(1201),locale:'en'},{text:'Hello',locale:'fr'},{text:1,locale:'hy'},null])assert.equal((await post(request(body))).status,400);
assert.equal((await post(request({text:'x'.repeat(17000),locale:'en'}))).status,400);
assert.equal(speeches,count,'Every denied or invalid request avoids provider IO');assert.ok(claims>0);
for(const locale of ['hy','ru','en']){
 const r=await post(request({text:'Hello',locale}));assert.equal(r.status,200);
}
assert.ok(!/console\.|log\.(?:info|warn|error)/.test(readFileSync('app/api/patient/zoe/speech/route.ts','utf8')),'Route never logs text or audio');
console.log('Speech HTTP origin/auth/posture, fail-closed member limiter, streamed size/text/locale and no-store response passed');
