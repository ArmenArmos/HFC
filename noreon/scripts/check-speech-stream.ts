/**
 * WP V: streaming speech. The route answers like the speech routes (403/401/503/400/429, private no-store), cuts the reply
 * with the shared chunker, sends each chunk as a server-sent event as soon as it is synthesized (at most the current and
 * the next chunk in flight, one limiter claim per chunk), ends with `end` or `failed`, and stops when the request is
 * aborted. The browser player plays chunks strictly in order, stops at once on abort (barge-in), and falls back to the
 * per-chunk route when the stream route is unavailable.
 * Run: node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-speech-stream.ts
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {splitConversationSpeech} from '@/lib/voice-core/chunk';

globalThis.fetch=(()=>{throw Error('No network in this check');}) as typeof fetch;
const {createSpeechStreamHandler}=await import('@/lib/zoe-chat-actions/speech-stream');
function scenario(name:string,fn:()=>Promise<void>|void){return Promise.resolve(fn()).then(()=>console.log(`ok   ${name}`));}
const reply='Your reading is saved. '+'The plan says to measure twice a day, in the morning and in the evening, and to rest five minutes before. '.repeat(3)+'That is all for now.';
const chunks=splitConversationSpeech(reply);
assert.ok(chunks.length>=3,'a long reply has several chunks');

type Actor={id:string};
function server(over:Partial<Parameters<typeof createSpeechStreamHandler<Actor>>[0]>={}){
 const log={limits:0,started:[] as number[],inFlight:0,maxInFlight:0,events:[] as string[]};
 const handler=createSpeechStreamHandler<Actor>({actor:async()=>({id:'member-1'}),available:async()=>true,
  limit:async()=>{log.limits++;return {ok:true};},
  synthesize:async(_a,text,_l,signal)=>{const i=chunks.indexOf(text);log.started.push(i);log.inFlight++;log.maxInFlight=Math.max(log.maxInFlight,log.inFlight);
   await new Promise(resolve=>setTimeout(resolve,5));log.inFlight--;if(signal.aborted)return {status:'unavailable'};return {status:'ok',audioBase64:Buffer.from(`chunk-${i}`).toString('base64'),mime:'audio/wav'};},
  ...over});
 return {handler,log};
}
const request=(body:unknown={text:reply,locale:'hy'},init:RequestInit={})=>new Request('http://localhost/api/patient/zoe/speech-stream',{method:'POST',headers:{origin:'http://localhost'},body:JSON.stringify(body),...init});
const read=async(response:Response)=>(await response.text()).split('\n\n').filter(Boolean).map(block=>{const [e,d]=block.split('\n');return {event:e!.slice(7),data:JSON.parse(d!.slice(6))};});

await scenario('gates and codes, before any synthesis',async()=>{
 const synth:string[]=[];
 const base={actor:async()=>({id:'m'}),available:async()=>true,limit:async()=>({ok:true as const}),synthesize:async(_a:Actor,t:string)=>{synth.push(t);return {status:'unavailable' as const};}};
 assert.equal((await createSpeechStreamHandler<Actor>(base)(request(undefined,{headers:{origin:'https://elsewhere.invalid'}}))).status,403);
 assert.equal((await createSpeechStreamHandler<Actor>({...base,actor:async()=>null})(request())).status,401);
 assert.equal((await createSpeechStreamHandler<Actor>({...base,available:async()=>false})(request())).status,503);
 for(const body of [{text:'',locale:'hy'},{text:'x'.repeat(1201),locale:'hy'},{text:'hi',locale:'fr'}])assert.equal((await createSpeechStreamHandler<Actor>(base)(request(body))).status,400);
 const limited=await createSpeechStreamHandler<Actor>({...base,limit:async()=>({ok:false,retryAfter:9})})(request());
 assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'9');assert.equal(limited.headers.get('cache-control'),'private, no-store');
 assert.deepEqual(synth,[],'nothing synthesized for a refused request');
});
await scenario('chunks stream in order as server-sent events, two in flight at most, one claim each',async()=>{
 const {handler,log}=server();
 const response=await handler(request());
 assert.equal(response.status,200);assert.match(response.headers.get('content-type')??'',/^text\/event-stream/);assert.equal(response.headers.get('cache-control'),'private, no-store');
 const events=await read(response);
 assert.deepEqual(events.map(e=>e.event),[...chunks.map(()=>'chunk'),'end']);
 assert.deepEqual(events.slice(0,-1).map(e=>e.data.index),chunks.map((_,i)=>i));
 assert.deepEqual(events.slice(0,-1).map(e=>Buffer.from(e.data.audioBase64,'base64').toString()),chunks.map((_,i)=>`chunk-${i}`));
 assert.equal(log.limits,chunks.length);assert.ok(log.maxInFlight<=2,`in flight ${log.maxInFlight}`);
});
await scenario('a chunk that cannot be synthesized, or a refused later claim, ends the stream with failed',async()=>{
 const broken=server({synthesize:async(_a,text)=>chunks.indexOf(text)===1?{status:'unavailable'}:{status:'ok',audioBase64:'AAAA',mime:'audio/wav'}});
 assert.deepEqual((await read(await broken.handler(request()))).map(e=>e.event),['chunk','failed']);
 let claims=0;
 const refused=server({limit:async()=>++claims===1?{ok:true}:{ok:false,retryAfter:1}});
 assert.deepEqual((await read(await refused.handler(request()))).map(e=>e.event),['chunk','failed']);
});
await scenario('an aborted request (barge-in) stops the remaining synthesis',async()=>{
 const long=Array.from({length:7},(_,i)=>`Sentence number ${i+1} is long enough to make one spoken chunk of the reply on its own, about one hundred and fifty characters in all.`).join(' ');
 const longChunks=splitConversationSpeech(long);assert.ok(long.length<=1200&&longChunks.length>=6);
 const controller=new AbortController(),log={started:0};
 const handler=createSpeechStreamHandler<Actor>({actor:async()=>({id:'m'}),available:async()=>true,limit:async()=>({ok:true}),
  synthesize:async(_a,_t,_l,signal)=>{log.started++;await new Promise(resolve=>setTimeout(resolve,10));return signal.aborted?{status:'unavailable'}:{status:'ok',audioBase64:'AAAA',mime:'audio/wav'};}});
 const chunks=longChunks;
 const response=await handler(request({text:long,locale:'en'},{signal:controller.signal}));
 const reader=response.body!.getReader();await reader.read();controller.abort();
 await new Promise(resolve=>setTimeout(resolve,50));
 assert.ok(log.started<chunks.length,`only ${log.started} of ${chunks.length} chunks were started`);
 await reader.cancel().catch(()=>{});
});

// The browser player.
const window=new EventTarget();(globalThis as {window?:unknown}).window=window;
const played:number[]=[];
(globalThis as {Audio?:unknown}).Audio=class{onended:(()=>void)|null=null;onerror:(()=>void)|null=null;src:string;constructor(src:string){this.src=src;}
 play(){played.push(Number(this.src.split('#')[1]));setTimeout(()=>this.onended?.(),2);return Promise.resolve();}pause(){}removeAttribute(){}load(){}};
let urls=0;URL.createObjectURL=(blob:Blob)=>`blob:fixture#${blob.size}`;URL.revokeObjectURL=()=>{urls++;};
const browser=await import('@/components/chat-v2/conversation-browser');
const sse=(n:number,end=true)=>new ReadableStream({start(c){const enc=new TextEncoder();for(let i=0;i<n;i++)c.enqueue(enc.encode(`event: chunk\ndata: ${JSON.stringify({index:i,audioBase64:Buffer.alloc(i+1).toString('base64'),mime:'audio/wav'})}\n\n`));if(end)c.enqueue(enc.encode('event: end\ndata: {"count":3}\n\n'));c.close();}});
await scenario('the player plays streamed chunks strictly in order',async()=>{
 played.length=0;const calls:string[]=[];
 globalThis.fetch=(async(url:string)=>{calls.push(url);return new Response(sse(3),{status:200,headers:{'content-type':'text/event-stream; charset=utf-8'}});}) as unknown as typeof fetch;
 await browser.playConversationStream('One. Two. Three.','en',new AbortController().signal);
 assert.deepEqual(calls,['/api/patient/zoe/speech-stream']);assert.deepEqual(played,[1,2,3]);assert.ok(urls>=3,'object URLs released');
});
await scenario('abort stops the current chunk at once and plays nothing more (barge-in)',async()=>{
 played.length=0;const controller=new AbortController();
 globalThis.fetch=(async()=>new Response(sse(3),{status:200,headers:{'content-type':'text/event-stream'}})) as unknown as typeof fetch;
 const done=browser.playConversationStream('One. Two. Three.','en',controller.signal);
 await new Promise(resolve=>setTimeout(resolve,1));controller.abort();await done;
 assert.ok(played.length<=1,`played ${played.length}`);
});
await scenario('when the stream route is unavailable, the per-chunk route speaks the reply',async()=>{
 const calls:string[]=[];
 globalThis.fetch=(async(url:string)=>{calls.push(url);return Response.json({status:'unavailable'},{status:503});}) as unknown as typeof fetch;
 await assert.rejects(browser.playConversationStream('Hello.','en',new AbortController().signal,'/api/staff/zoe/speech-stream','/api/staff/zoe/speech'));
 assert.deepEqual(calls,['/api/staff/zoe/speech-stream','/api/staff/zoe/speech']);
 globalThis.fetch=(()=>{throw Error('No network in this check');}) as typeof fetch;
});
await scenario('event parsing accepts only well-formed audio chunks',()=>{
 assert.deepEqual(browser.parseSpeechEvent('event: chunk\ndata: {"index":0,"audioBase64":"AA","mime":"audio/wav"}'),{event:'chunk',index:0,audioBase64:'AA',mime:'audio/wav'});
 assert.equal(browser.parseSpeechEvent('event: chunk\ndata: {"index":0,"audioBase64":"AA","mime":"text/html"}'),null);
 assert.equal(browser.parseSpeechEvent('event: other\ndata: {}'),null);
 assert.deepEqual(browser.parseSpeechEvent('event: failed\ndata: {"index":2}'),{event:'failed'});
});
await scenario('both routes exist, the non-streaming routes stay',()=>{
 for(const [path,ports] of [['app/api/patient/zoe/speech-stream/route.ts','memberSpeechStreamPorts'],['app/api/staff/zoe/speech-stream/route.ts','staffSpeechStreamPorts']]){
  const source=readFileSync(path,'utf8');assert.match(source,/export const runtime='nodejs'/);assert.match(source,new RegExp(`withRouteLogging\\(createSpeechStreamHandler\\(${ports}\\)\\)`));
 }
 readFileSync('app/api/patient/zoe/speech/route.ts','utf8');readFileSync('app/api/staff/zoe/speech/route.ts','utf8');
});
console.log('Speech stream: gates, in-order SSE chunks with bounded synthesis and per-chunk claims, failure and abort, in-order playback, instant stop and route fallback passed (no network).');
