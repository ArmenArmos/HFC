/** Browser audio adapter exercised with synthetic recorder, audio levels and player; no network. */
import assert from 'node:assert/strict';
import {captureConversation,playConversation,transcribeConversation} from '@/components/chat-v2/conversation-browser';
import * as browser from '@/components/chat-v2/conversation-browser';
import {URGENT_TEXT} from '@/lib/zoe/symptoms/intake';
let now=0,level=0,raf=0,trackStops=0,contextStops=0,recordings=0,paused=0,load=0;
const frames=new Map<number,FrameRequestCallback>();
const stream={getTracks:()=>[{stop:()=>trackStops++}]};let permission:Promise<unknown>=Promise.resolve(stream);
class Recorder{
 static isTypeSupported(type:string){return type==='audio/mp4';}
 state='inactive';mimeType='audio/mp4';ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;
 start(){recordings++;this.state='recording';}
 stop(){if(this.state!=='recording')return;this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob(['synthetic'])});this.onstop?.();});}
}
class Context{
 resume(){return Promise.resolve();}close(){contextStops++;return Promise.resolve();}
 createAnalyser(){return {fftSize:1024,getFloatTimeDomainData:(data:Float32Array)=>data.fill(level)};}
 createMediaStreamSource(){return {connect(){}};}
}
class Player{
 onended:(()=>void)|null=null;onerror:(()=>void)|null=null;
 play(){return Promise.resolve();}pause(){paused++;}removeAttribute(){}load(){load++;}
}
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{mediaDevices:{getUserMedia:()=>permission}}});
Object.defineProperty(globalThis,'performance',{configurable:true,value:{now:()=>now}});
let posted:{url:unknown;options:RequestInit}|null=null;
Object.assign(globalThis,{window:new EventTarget(),AudioContext:Context,MediaRecorder:Recorder,Audio:Player,requestAnimationFrame:(fn:FrameRequestCallback)=>{frames.set(++raf,fn);return raf;},cancelAnimationFrame:(id:number)=>frames.delete(id),fetch:async(url:unknown,options:RequestInit)=>{posted={url,options};return {ok:true,json:async()=>String(url).endsWith('/speech')?{status:'ok',audioBase64:'YXVkaW8=',mime:'audio/mp3'}:{status:'ok',text:'hello',urgent:false,receipt:'receipt'}};}});
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
async function meter(time:number,volume:number){now=time;level=volume;const pending=[...frames.values()];frames.clear();pending.forEach(fn=>fn(time));await flush();}
let turns=0,spoken=0;const captures:Blob[]=[];
let stop=await captureConversation({barge:false,onSpeech:()=>spoken++,onTurn:(blob)=>{turns++;captures.push(blob);},onError:()=>assert.fail('Unexpected capture error')});await flush();
assert.equal(recordings,1);await meter(100,.05);await meter(250,.05);assert.equal(spoken,1);await meter(1450,0);assert.equal(turns,1,'1.2 second silence closes a turn');assert.equal(captures[0].type,'audio/mp4');assert.ok(trackStops&&contextStops);stop();
stop=await captureConversation({barge:true,onSpeech:()=>spoken++,onTurn:()=>turns++,onError:()=>assert.fail('Unexpected monitor error')});await flush();assert.equal(recordings,1,'Playback monitoring never records Zoe output before barge-in');
await meter(1600,.04);await meter(2000,.04);assert.equal(recordings,1,'Playback threshold rejects quiet echo');await meter(2100,.12);await meter(2400,.12);assert.equal(spoken,2);assert.equal(recordings,2,'Sustained barge-in begins a fresh turn');stop();await flush();assert.equal(turns,1,'Cancelled capture never uploads');
let resolvePermission!:(s:unknown)=>void;permission=new Promise(resolve=>resolvePermission=resolve);
stop=await captureConversation({barge:false,onSpeech(){},onTurn:()=>assert.fail('Late permission uploaded'),onError:()=>assert.fail('Late permission error')});stop();const before=trackStops;resolvePermission(stream);await flush();assert.ok(trackStops>before,'Late permission stream is released');
const result=await transcribeConversation(new Blob(['a'],{type:'audio/mp4'}),1500,'hy',new AbortController().signal);assert.equal(result.receipt,'receipt');assert.equal(new Headers(posted!.options.headers).get('X-Voice-Locale'),'hy');
const controller=new AbortController();const playing=playConversation('Zoe response','ru',controller.signal);await flush();assert.ok(String(posted!.url).endsWith('/speech'));assert.deepEqual(JSON.parse(posted!.options.body as string),{text:'Zoe response',locale:'ru'});controller.abort();await playing;assert.equal(paused,1);assert.equal(load,1,'Abort releases the audio element');
console.log('Conversation browser adapter: recorder/VAD silence, echo threshold, barge-in, cancellation, late permission, headers and speech abort passed');

// Long replies must reach TTS in small, intact sentences, including Armenian punctuation.
assert.equal(typeof browser.splitConversationSpeech,'function','Speech needs a bounded sentence chunker');
const split=browser.splitConversationSpeech;
for(const sentence of ['Your reading is 138/86 and your value is 4.2.','Ваше давление 138/86, значение 4.2.','Ձեր ճնշումը 138/86 է, արժեքը՝ 4.2։']){
 const chunks=split(Array(10).fill(sentence).join(' '));
 assert.ok(chunks.length>1);assert.ok(chunks.every(chunk=>chunk.length<=160));
 assert.equal(chunks.join(' '),Array(10).fill(sentence).join(' '));
 assert.ok(chunks.every(chunk=>chunk.endsWith(sentence)),'Decimals and readings stay inside their sentence');
}
for(const ending of ['.','!','?','։',';',':','\n','։»']){
 const first='a'.repeat(100)+ending,second='b'.repeat(100)+'.';
 assert.deepEqual(split(first+' '+second),[first.trim(),second],`Sentence boundary ${JSON.stringify(ending)}`);
}
assert.deepEqual(split('a'.repeat(150)+' '+'b'.repeat(60)),['a'.repeat(150),'b'.repeat(60)],'Long sentence splits at the last space before 200');
assert.deepEqual(split('x'.repeat(450)),['x'.repeat(200),'x'.repeat(200),'x'.repeat(50)],'Unbroken text has a hard bound');
assert.deepEqual(split('  \n '),[]);

type SpeechRequest={text:string;signal:AbortSignal;resolve:(response:unknown)=>void;reject:(error:Error)=>void};
const requests:SpeechRequest[]=[],players:ChunkPlayer[]=[],played:string[]=[],revoked:string[]=[];
const urls=new Map<string,Blob>();
URL.createObjectURL=blob=>{assert.ok(blob instanceof Blob);const url=`blob:synthetic-${urls.size}`;urls.set(url,blob);return url;};
URL.revokeObjectURL=url=>{revoked.push(url);};
class ChunkPlayer{
 onended:(()=>void)|null=null;onerror:(()=>void)|null=null;released=false;
 url:string;constructor(url:string){this.url=url;players.push(this);}
 async play(){played.push(await urls.get(this.url)!.text());}
 pause(){this.released=true;}removeAttribute(){}load(){}
}
Object.assign(globalThis,{Audio:ChunkPlayer,fetch:(_url:unknown,options:RequestInit)=>new Promise((resolve,reject)=>{
 const {text}=JSON.parse(options.body as string);const signal=options.signal as AbortSignal;
 requests.push({text,signal,resolve,reject});
 signal.addEventListener('abort',()=>reject(new Error('Aborted')),{once:true});
})});
const reply=(i:number,ok=true)=>requests[i].resolve({ok,json:async()=>ok?{status:'ok',audioBase64:btoa(requests[i].text),mime:'audio/wav'}:{status:'unavailable'}});
const reset=()=>{requests.length=0;players.length=0;played.length=0;revoked.length=0;};
const longReply=['a'.repeat(100)+'.','b'.repeat(100)+'.','c'.repeat(100)+'.','d'.repeat(100)+'.'].join(' ');
reset();
const ordered=playConversation(longReply,'en',new AbortController().signal);
assert.equal(requests.length,2,'First chunk starts immediately with just one prefetched chunk');
reply(1);await flush();assert.deepEqual(played,[],'Chunk 2 cannot play before chunk 1');
reply(0);await flush();assert.deepEqual(played,['a'.repeat(100)+'.']);assert.equal(requests.length,2,'No further requests while first chunk plays');
players[0].onended!();await flush();assert.equal(requests.length,3);assert.deepEqual(played,['a'.repeat(100)+'.','b'.repeat(100)+'.']);
reply(2);players[1].onended!();await flush();assert.equal(requests.length,4);
reply(3);await flush();players[2].onended!();await flush();players[3].onended!();await ordered;
assert.deepEqual(played,longReply.split(' '));assert.equal(revoked.length,4,'Each played chunk releases its URL');

reset();const abort=new AbortController(),interrupted=playConversation(longReply,'ru',abort.signal);
reply(0);await flush();abort.abort();await interrupted;await flush();
assert.ok(players[0].released);assert.ok(requests.every(request=>request.signal.aborted));assert.equal(requests.length,2,'Stop cancels prefetch and never starts chunk 3');
reset();const beforeStart=new AbortController();beforeStart.abort();await playConversation(longReply,'en',beforeStart.signal);assert.equal(requests.length,0);
reset();const waitingAbort=new AbortController(),waiting=playConversation(longReply,'en',waitingAbort.signal);waitingAbort.abort();await waiting;assert.ok(requests.every(request=>request.signal.aborted));

reset();const laterFailure=playConversation(longReply,'en',new AbortController().signal);
requests[1].reject(new Error('Synthetic failure'));await flush();reply(0);await flush();players[0].onended!();await laterFailure;
assert.equal(played.length,1,'Chunk 2 failure resolves quietly after chunk 1');assert.equal(requests.length,2,'A failed chunk does not start further prefetches');assert.ok(requests.every(request=>request.signal.aborted));
reset();const firstFailure=playConversation(longReply,'en',new AbortController().signal);
const rejected=assert.rejects(firstFailure,/Voice playback unavailable/);reply(0,false);await rejected;assert.equal(played.length,0);assert.ok(requests.every(request=>request.signal.aborted));

reset();const emergencyAbort=new AbortController(),emergency=playConversation(URGENT_TEXT.en,'en',emergencyAbort.signal);
assert.ok(requests[0].text.startsWith('Urgent care needed. Call 103 now.'),'Emergency instructions are in the first requested chunk');
if(requests[1])reply(1);reply(0);await flush();assert.equal(played[0],requests[0].text,'Emergency text is spoken first even if prefetch wins');
emergencyAbort.abort();await emergency;
console.log('Speech chunks: en/ru/hy boundaries, readings/decimals, hard cap, ordered prefetch, cancellation, failures and emergency-first playback passed');
