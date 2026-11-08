/** Actual orchestration with synthetic provider/context and a controlled production deadline. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as routing from '@/lib/zoe/member-screen';
import * as gateway from '@/lib/zoe/gateway';
import * as contract from '@/lib/zoe-chat-actions/voice-contract';
import {DEFAULT_VOICE_SETTINGS} from '@/lib/zoe-chat-actions/voice-settings';
const env={NOREON_ZOE_APP_V3:'true',NOREON_MEMBER_CHAT_V2:'true',NOREON_ZOE_VOICE_PROVIDER:'gateway',NOREON_ZOE_MODEL_CALLS_ENABLED:'true',VERCEL:'1',NOREON_ZOE_TEST_LEXICON:'true'};
let deadline:(()=>void)|undefined,intakeReads=0,primaryTimeout=false;
let context:'timeout'|'failure'|'missing'='timeout';
let transcripts={primary:'chest pain' as string|null,urgent:null as string|null};
const deps:Record<string,unknown>={
 'server-only':{},'@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:(e:typeof env)=>e.NOREON_ZOE_APP_V3==='true'},
 '@/lib/zoe/gateway':gateway,'@/lib/zoe/member-screen':routing,'./voice-contract':contract,
 './voice-settings':{readVoiceSettings:async()=>({...DEFAULT_VOICE_SETTINGS,enabled:true})},
 './voice-providers/gateway':{gatewaySpeechProvider:()=>({transcribe:async(_audio:unknown,_locale:unknown,signal:AbortSignal)=>primaryTimeout?new Promise(resolve=>signal.addEventListener('abort',()=>resolve({primary:null,urgent:'chest pain'}),{once:true})):transcripts})},
 '@/lib/zoe/app-chat':{readIntakeState:async()=>{intakeReads++;if(context==='failure')throw Error('Synthetic context failure');if(context==='missing')return null;return new Promise(()=>{});}},
};
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/zoe-chat-actions/voice.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,AbortController,setTimeout:(fn:()=>void,ms:number)=>{assert.equal(ms,15000);deadline=fn;return 1;},clearTimeout:()=>{},require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const transcribe=exports.transcribe as typeof import('../lib/zoe-chat-actions/voice').transcribe;
const audio={bytes:new Uint8Array([1]),mimeType:'audio/mp4',durationMs:1000};
async function flush(){for(let i=0;i<30;i++)await Promise.resolve();}
for(const pair of [{primary:'chest pain',urgent:null},{primary:'hello',urgent:'chest pain'}]){
 transcripts=pair;let result:Awaited<ReturnType<typeof transcribe>>|undefined;
 const pending=transcribe(audio,'hy',env).then(r=>{result=r;});await flush();
 assert.ok(result?.status==='ok'&&result.urgent,'Lexical emergencies from either engine return before the deadline');
 assert.equal(intakeReads,0,'Lexical screening runs before context acquisition');
 deadline!();await flush();
 assert.ok(result,'Stalled context cannot withhold a known emergency past the turn deadline');
 assert.equal(result.status,'ok');if(result.status==='ok'){assert.equal(result.urgent,true);assert.equal(result.text,'chest pain');}
 await pending;
}
for(const mode of ['failure','missing','timeout'] as const){
 context=mode;
 for(const pair of [{primary:'hello',urgent:'my face is swollen'},{primary:'my face is swollen',urgent:'hello'}]){
  transcripts=pair;let result:Awaited<ReturnType<typeof transcribe>>|undefined;
  const pending=transcribe(audio,'hy',env).then(r=>{result=r;});await flush();
  if(mode==='timeout'){assert.equal(result,undefined);deadline!();await flush();}
  assert.ok(result?.status==='ok'&&result.urgent&&result.text==='my face is swollen',`${mode} context preserves a symptom emergency from either engine for immediate 103`);
  await pending;
 }
}
context='timeout';
transcripts={primary:'hello',urgent:null};let settled=false;
const nonurgent=transcribe(audio,'hy',env).then(r=>{settled=true;return r;});await flush();assert.equal(settled,false);deadline!();await flush();assert.equal(settled,true,'Nonurgent context acquisition also respects the total budget');await nonurgent;
primaryTimeout=true;let result:Awaited<ReturnType<typeof transcribe>>|undefined;
const timed=transcribe(audio,'hy',env).then(r=>{result=r;});await flush();deadline!();await flush();
assert.ok(result?.status==='ok'&&result.urgent&&result.text==='chest pain','Primary deadline preserves secondary urgent evidence');await timed;
assert.ok(intakeReads>=1);
console.log('Voice deadline: stalled context cannot silence either urgent engine; total deadline preserves secondary hit');
