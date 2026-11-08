/** Synthetic provider IO only. Never imports credentials or calls the network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {gatewaySpeechProvider,generateVoiceSpeech} from '@/lib/zoe-chat-actions/voice-providers/gateway';
import {DEFAULT_VOICE_SETTINGS,createVoiceSettingsReader} from '@/lib/zoe-chat-actions/voice-settings';
import {screenVoiceTranscripts,voiceAvailable} from '@/lib/zoe-chat-actions/voice';
import {signVoiceReceipt,verifyVoiceReceipt} from '@/lib/zoe-chat-actions/voice-receipt';
const settings=DEFAULT_VOICE_SETTINGS,audio={bytes:new Uint8Array([1,2]),mimeType:'audio/mp4',durationMs:1000};
const signal=new AbortController().signal;
let primary='145/92',secondary='nothing urgent',calls=0;
const io={generate:async(args:Record<string,unknown>)=>{calls++;assert.equal(args.model,settings.stt_model);assert.equal(args.maxRetries,0);assert.deepEqual(args.telemetry,{isEnabled:false,recordInputs:false,recordOutputs:false});return {text:primary};},transcribe:async(args:Record<string,unknown>)=>{calls++;assert.equal(args.model,settings.stt_urgent_model);return {text:secondary};}};
const provider=gatewaySpeechProvider(settings,io);
const env={NOREON_ZOE_TEST_LEXICON:'true'};
for(const [p,u,red,text] of [['chest pain','hello',true,'chest pain'],['hello','chest pain',true,'chest pain'],['hello','nothing urgent',false,'hello']] as const){
 primary=p;secondary=u;
 const transcripts=await provider.transcribe(audio,'hy',signal);
 assert.deepEqual(transcripts,{primary:p,urgent:u});
 assert.deepEqual(screenVoiceTranscripts(transcripts,null,env),{text,urgent:red});
}
const before=calls;await provider.transcribe(audio,'en',signal);assert.equal(calls-before,1,'Secondary engine is Armenian only');
const fail=gatewaySpeechProvider(settings,{...io,transcribe:async()=>{throw Error('Synthetic provider error with private data');}});
primary='chest pain';assert.deepEqual(screenVoiceTranscripts(await fail.transcribe(audio,'hy',signal),null,env),{text:'chest pain',urgent:true});
const noPrimary=gatewaySpeechProvider(settings,{...io,generate:async()=>{throw Error('Synthetic outage');}});
secondary='chest pain';assert.deepEqual(screenVoiceTranscripts(await noPrimary.transcribe(audio,'hy',signal),null,env),{text:'chest pain',urgent:true},'A primary failure cannot silence a secondary urgent hit');
// Hard deadline even when an injected provider ignores abort.
let aborted=false;
const timeout=gatewaySpeechProvider(settings,{...io,transcribe:async(args:Record<string,unknown>)=>{(args.abortSignal as AbortSignal).addEventListener('abort',()=>{aborted=true;});return new Promise<never>(()=>{});}});
const started=Date.now();primary='chest pain';
assert.deepEqual(await timeout.transcribe(audio,'hy',signal),{primary:'chest pain',urgent:null});
assert.ok(aborted);assert.ok(Date.now()-started<9000,'Secondary timeout does not consume the primary 15 second limit');
let now=0,reads=0;
const read=createVoiceSettingsReader(async()=>{reads++;return {...settings,enabled:false,version:2};},()=>now);
assert.equal((await read()).enabled,false);assert.equal((await read()).version,2);assert.equal(reads,1);now=30_001;await read();assert.equal(reads,2);
const gatewayEnv={NOREON_ZOE_APP_V3:'true',NOREON_MEMBER_CHAT_V2:'true',NOREON_ZOE_VOICE_PROVIDER:'gateway',NOREON_ZOE_MODEL_CALLS_ENABLED:'true',VERCEL:'1'};
for(const [name,load] of [
 ['exception',async()=>{throw Error('Synthetic read failure');}],
 ['missing row',async()=>null],
 ['invalid config',async()=>({...settings,enabled:true,tts_voice:''})],
 ['missing enabled',async()=>({...settings,enabled:undefined})],
 ['malformed enabled',async()=>({...settings,enabled:'true'})],
] as const){
 const fallback=await createVoiceSettingsReader(load)();
 assert.equal(fallback.enabled,false,`${name} must fail closed`);
 assert.equal(await voiceAvailable(gatewayEnv,fallback),false,`${name} cannot authorize voice`);
 assert.equal(fallback.stt_model,settings.stt_model,'Model defaults remain available');
}
assert.equal(await voiceAvailable(gatewayEnv,await createVoiceSettingsReader(async()=>({...settings,enabled:true}))()),true,'A valid enabled row authorizes voice');
let expiryNow=0,expiryReads=0;
const disabledThenFailed=createVoiceSettingsReader(async()=>{if(expiryReads++===0)return {...settings,enabled:false};throw Error('Synthetic read failure');},()=>expiryNow);
assert.equal(await voiceAvailable(gatewayEnv,await disabledThenFailed()),false);
expiryNow=30_001;
assert.equal(await voiceAvailable(gatewayEnv,await disabledThenFailed()),false,'Failed refresh cannot re-enable a disabled cached row');
assert.equal(expiryReads,2,'The failed read follows cache expiry');
assert.equal((await createVoiceSettingsReader(async()=>({...settings,enabled:false,tts_voice:''}))()).enabled,false,'An explicit off switch survives invalid model/voice configuration');
const secret='synthetic-test-key-that-is-at-least-32-characters',at=Date.now();
const proof=signVoiceReceipt('member','hello',secret,at,{primary:'hello',urgent:'nothing urgent'});
assert.ok(proof.length<=128,'Existing persisted receipt limit');
assert.equal(verifyVoiceReceipt(proof,'member','hello',at,secret),true);
assert.notEqual(proof,signVoiceReceipt('member','hello',secret,at,{primary:'hello',urgent:'other'}));
for(const changed of [proof.replace(/\.([^.]*)\./,(_all,h)=>`.${h[0]==='a'?'b':'a'}${h.slice(1)}.`),proof.slice(0,-1)+(proof.endsWith('a')?'b':'a')])assert.equal(verifyVoiceReceipt(changed,'member','hello',at,secret),false);
assert.equal(verifyVoiceReceipt(proof,'other','hello',at,secret),false);assert.equal(verifyVoiceReceipt(proof,'member','edited',at,secret),false);assert.equal(verifyVoiceReceipt(proof,'member','hello',at+600_001,secret),false);
const speech=await generateVoiceSpeech('Hello','en',settings,signal,async args=>{assert.equal(args.model,settings.tts_model);assert.equal(args.voice,'Kore');assert.equal(args.instructions,settings.tts_instructions);assert.equal(args.language,'auto');assert.equal(args.outputFormat,'wav');return {audio:{base64:'UklGRg==',mediaType:'audio/wav'}};});
assert.deepEqual(speech,{audioBase64:'UklGRg==',mime:'audio/wav'});
console.log('Gateway dual STT, urgent selection/failure/deadline, settings cache, signed dual hashes and configured TTS passed');

// Exercise real deadlines with a virtual clock, without waiting 25 seconds or calling a provider.
let clock=0,timerId=0;const timers=new Map<number,{at:number;fn:()=>void}>();
const deadlineExports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/zoe-chat-actions/voice-providers/gateway.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
 exports:deadlineExports,require:(name:string)=>{assert.equal(name,'server-only');return {};},AbortController,
 setTimeout:(fn:()=>void,ms:number)=>{timers.set(++timerId,{at:clock+ms,fn});return timerId;},clearTimeout:(id:number)=>timers.delete(id),
});
const advance=(ms:number)=>{clock+=ms;for(const [id,timer] of timers)if(timer.at<=clock){timers.delete(id);timer.fn();}};
const timed=deadlineExports as typeof import('../lib/zoe-chat-actions/voice-providers/gateway');
let finishSpeech!:(value:{audio:{base64:string;mediaType:string}})=>void,ttsSignal!:AbortSignal;
const delayed=timed.generateVoiceSpeech('Synthetic reply','en',settings,signal,async args=>{ttsSignal=args.abortSignal!;return new Promise(resolve=>{finishSpeech=resolve;});});
await Promise.resolve();advance(16_000);assert.equal(ttsSignal.aborted,false,'TTS remains available beyond the old 15-second deadline');
finishSpeech({audio:{base64:'UklGRg==',mediaType:'audio/wav'}});assert.ok(await delayed);
const hung=timed.generateVoiceSpeech('Synthetic reply','hy',settings,signal,async args=>{ttsSignal=args.abortSignal!;return new Promise(()=>{});});
await Promise.resolve();advance(24_999);assert.equal(ttsSignal.aborted,false);advance(1);assert.equal(await hung,null);assert.ok(ttsSignal.aborted);
let sttSignal!:AbortSignal,urgentSignal!:AbortSignal;
const hungSTT=timed.gatewaySpeechProvider(settings,{
 generate:async args=>{sttSignal=args.abortSignal!;return new Promise(()=>{});},
 transcribe:async args=>{urgentSignal=args.abortSignal!;return new Promise(()=>{});},
}).transcribe(audio,'hy',signal);
await Promise.resolve();advance(8000);assert.ok(urgentSignal.aborted);assert.equal(sttSignal.aborted,false);advance(7000);
const timedOut=await hungSTT;assert.equal(timedOut.primary,null);assert.equal(timedOut.urgent,null);assert.ok(sttSignal.aborted);
console.log('TTS survives 15 seconds and stops at 25; STT remains at 15/8 seconds');
