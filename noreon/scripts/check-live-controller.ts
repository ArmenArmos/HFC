/**
 * WP V: the Live conversation controller and its browser session, without a browser. Live is transcription and turn
 * detection only: partial transcripts show while the person speaks; a finished turn takes the recorded path (urgent text
 * sends at once and the urgent text is spoken; otherwise the review countdown and the auto-send rule); speaking over Zoe
 * stops playback at once; Zoe's own voice heard through the speaker is never a turn; any failure falls back to the
 * recorded controller once, silently; idle, stop and page-hide close the session.
 * Run: node --no-warnings --conditions=noreon-server-test --import ./scripts/register-alias.mjs scripts/check-live-controller.ts
 */
import assert from 'node:assert/strict';
import {LiveController,LIVE_IDLE_MS,type LiveDependencies,type LiveSessionCallbacks,type LivePhase} from '@/components/chat-v2/live-controller';

globalThis.fetch=(()=>{throw Error('No network in this check');}) as typeof fetch;
function scenario(name:string,fn:()=>Promise<void>|void){return Promise.resolve(fn()).then(()=>console.log(`ok   ${name}`));}
const tick=()=>new Promise(resolve=>setImmediate(resolve));

function harness(over:Partial<LiveDependencies>={}){
 const timers=new Map<number,{fn:()=>void;at:number}>();let clock=0,ids=0;
 const log={states:[] as [LivePhase,number][],partials:[] as string[],transcripts:[] as {text:string;urgent?:boolean;origin:string}[],sends:[] as (boolean|undefined)[],plays:[] as string[],fallbacks:0,closes:0,aborted:0};
 let session:LiveSessionCallbacks|null=null;let play:{resolve:()=>void;signal:AbortSignal}|null=null;
 const deps:LiveDependencies={
  connect:async callbacks=>{session=callbacks;return {close:()=>{log.closes++;}};},
  screen:async text=>({urgent:/chest pain|103/.test(text)}),
  play:(text,signal)=>{log.plays.push(text);return new Promise<void>(resolve=>{play={resolve,signal};signal.addEventListener('abort',()=>{log.aborted++;resolve();},{once:true});});},
  onPartial:text=>log.partials.push(text),
  onTranscript:result=>log.transcripts.push(result),onSend:urgent=>log.sends.push(urgent),
  onState:(phase,seconds)=>log.states.push([phase,seconds]),emergencyText:()=>'Call 103 now.',
  fallback:()=>{log.fallbacks++;},
  setTimer:(fn,ms)=>{const id=++ids;timers.set(id,{fn,at:clock+ms});return id;},clearTimer:id=>{timers.delete(id as number);},
  ...over,
 };
 const advance=async(ms:number)=>{const target=clock+ms;for(;;){const due=[...timers.entries()].filter(([,t])=>t.at<=target).sort((a,b)=>a[1].at-b[1].at)[0];if(!due)break;timers.delete(due[0]);clock=due[1].at;due[1].fn();await tick();}clock=target;};
 const controller=new LiveController(deps);
 return {controller,log,advance,session:()=>session!,finishPlay:()=>{play?.resolve();play=null;},playing:()=>play};
}

await scenario('connects, shows partial transcripts, and a finished turn takes the review countdown then sends',async()=>{
 const h=harness();await h.controller.start();
 assert.deepEqual(h.log.states.map(s=>s[0]).filter(s=>s!=='off'),['connecting','listening']);
 h.session().onSpeechStart();h.session().onPartial('my blood');h.session().onPartial('my blood pressure is');
 assert.deepEqual(h.log.partials,['my blood','my blood pressure is']);
 h.session().onTurnEnd('my blood pressure is 145 over 92');await tick();
 assert.deepEqual(h.log.transcripts,[{status:'ok',text:'my blood pressure is 145 over 92',urgent:false,origin:'live'}]);
 assert.equal(h.controller.phase,'review');await h.advance(3000);
 assert.equal(h.controller.phase,'waiting');assert.deepEqual(h.log.sends,[undefined]);
 h.controller.reply('Your reading is on the card.');await tick();assert.equal(h.controller.phase,'speaking');assert.deepEqual(h.log.plays,['Your reading is on the card.']);
 h.finishPlay();await tick();assert.equal(h.controller.phase,'listening');
});
await scenario('an urgent turn sends at once and the urgent text is spoken; barge-in cannot stop it',async()=>{
 const h=harness();await h.controller.start();
 h.session().onTurnEnd('I have chest pain');await tick();
 assert.deepEqual(h.log.sends,[true]);assert.equal(h.controller.phase,'emergency');assert.deepEqual(h.log.plays,['Call 103 now.']);
 h.session().onSpeechStart();assert.equal(h.log.aborted,0,'speech does not cut the urgent text');
 h.finishPlay();await tick();assert.equal(h.controller.phase,'off');assert.equal(h.log.closes,1);
});
await scenario('barge-in: speaking over Zoe stops playback immediately and listens',async()=>{
 const h=harness();await h.controller.start();
 h.session().onTurnEnd('hello');await tick();await h.advance(3000);h.controller.reply('A long answer to read aloud.');await tick();
 assert.equal(h.controller.phase,'speaking');
 h.session().onSpeechStart();
 assert.equal(h.log.aborted,1,'playback aborted at once');assert.equal(h.controller.phase,'listening');
 h.session().onTurnEnd('stop, I have a question');await tick();assert.equal(h.log.transcripts.at(-1)!.text,'stop, I have a question');
});
await scenario('Zoe\'s own voice through the speaker is never a member turn',async()=>{
 const h=harness();await h.controller.start();
 h.session().onTurnEnd('hello');await tick();await h.advance(3000);h.controller.reply('Your plan says one tablet in the morning.');await tick();
 h.session().onPartial('your plan says');h.session().onTurnEnd('your plan says one tablet in the morning');await tick();
 assert.equal(h.log.transcripts.length,1);assert.deepEqual(h.log.partials,[]);assert.equal(h.log.aborted,0);
});
await scenario('staff: no member emergency flow, and a clinical command waits for review',async()=>{
 const h=harness({memberEmergency:false,screen:async()=>({urgent:false}),autoSend:r=>!/dose/.test(r.text)});await h.controller.start();
 h.session().onTurnEnd('double his dose');await tick();assert.equal(h.controller.phase,'paused');assert.deepEqual(h.log.sends,[]);
});
await scenario('screening that cannot answer never auto-sends: the text waits for an explicit send',async()=>{
 const h=harness({screen:async()=>{throw Error('offline');}});await h.controller.start();
 h.session().onTurnEnd('my pressure is 150 over 95');await tick();
 assert.equal(h.controller.phase,'paused');assert.deepEqual(h.log.sends,[]);assert.equal(h.log.transcripts.length,1);
});
await scenario('editing cancels the countdown; a turn heard while paused or waiting is ignored',async()=>{
 const h=harness();await h.controller.start();
 h.session().onTurnEnd('first');await tick();h.controller.edit();await h.advance(5000);
 assert.equal(h.controller.phase,'paused');assert.deepEqual(h.log.sends,[]);
 h.session().onTurnEnd('second');await tick();assert.equal(h.log.transcripts.length,1);
});
await scenario('failure falls back to the recorded controller once, silently',async()=>{
 const refused=harness({connect:async()=>{throw Error('token refused');}});await refused.controller.start();
 assert.equal(refused.log.fallbacks,1);assert.equal(refused.controller.phase,'off');assert.ok(!refused.log.states.some(s=>s[0]==='error'),'no error shown');
 const dropped=harness();await dropped.controller.start();dropped.session().onError();dropped.session().onClose();
 assert.equal(dropped.log.fallbacks,1);assert.equal(dropped.controller.active,false);
 const closed=harness();await closed.controller.start();closed.session().onClose();assert.equal(closed.log.fallbacks,1);
});
await scenario('stop, page hide and a late connection: the session closes and nothing late is used',async()=>{
 let resolveConnect:(c:{close:()=>void})=>void=()=>{};let closes=0;
 const late=harness({connect:()=>new Promise(resolve=>{resolveConnect=resolve;})});
 const starting=late.controller.start();late.controller.hidden();resolveConnect({close:()=>{closes++;}});await starting;
 assert.equal(closes,1,'a connection that arrives after stop is closed');assert.equal(late.controller.phase,'off');
 const h=harness();await h.controller.start();h.controller.stop();assert.equal(h.log.closes,1);
 h.session().onTurnEnd('after stop');await tick();assert.equal(h.log.transcripts.length,0);
});
await scenario('sixty seconds without speech stops the session',async()=>{
 const h=harness();await h.controller.start();await h.advance(LIVE_IDLE_MS-1);assert.equal(h.controller.active,true);
 h.session().onPartial('still here');await h.advance(LIVE_IDLE_MS-1);assert.equal(h.controller.active,true,'speech resets the idle timer');
 await h.advance(LIVE_IDLE_MS);assert.equal(h.controller.active,false);assert.equal(h.log.closes,1);
});

// The browser session: token, turns, local barge guard, close.
(globalThis as {window?:unknown}).window=globalThis;
const audio=await import('@/components/chat-v2/live-audio');
await scenario('the session joins transcript chunks into one turn, guards barge-in by the local level, and closes everything',async()=>{
 let fetched:{url:string;body:string}|null=null;
 globalThis.fetch=(async(url:string,init:RequestInit)=>{fetched={url,body:String(init.body)};return new Response(JSON.stringify({token:'auth_tokens/e',model:'gemini-live-2.5-flash-preview',expiresAt:'2026-11-08T08:01:00Z'}),{status:200});}) as unknown as typeof fetch;
 let handlers:{onmessage:(m:unknown)=>void;onclose:()=>void}|null=null;const sent:string[]=[];let sessionClosed=0,captureStopped=0;let level:(l:number)=>void=()=>{};let pcm:(d:string)=>void=()=>{};
 const capture={start:async(onPcm:(d:string)=>void,onLevel:(l:number)=>void)=>{pcm=onPcm;level=onLevel;},stop:()=>{captureStopped++;}} as unknown as InstanceType<typeof audio.LiveAudioCapture>;
 const events:string[]=[];let clock=1000;
 const connection=await audio.connectLive({endpoint:'/api/patient/zoe/live-token',locale:'hy',signal:new AbortController().signal,capture,now:()=>clock,
  connect:async({token,callbacks})=>{assert.equal(token.token,'auth_tokens/e');handlers=callbacks as never;return {sendRealtimeInput:(i:{audio:{data:string;mimeType:string}})=>{sent.push(i.audio.mimeType);},close:()=>{sessionClosed++;}};},
  callbacks:{onSpeechStart:()=>events.push('speech'),onPartial:t=>events.push(`partial:${t}`),onTurnEnd:t=>events.push(`turn:${t}`),onError:()=>events.push('error'),onClose:()=>events.push('close')}});
 assert.deepEqual(fetched,{url:'/api/patient/zoe/live-token',body:'{"locale":"hy"}'});
 pcm('AAAA');assert.deepEqual(sent,['audio/pcm;rate=16000']);
 handlers!.onmessage({voiceActivity:{voiceActivityType:'ACTIVITY_START'}});assert.deepEqual(events,[],'quiet microphone: a server signal alone is not a barge-in');
 level(0.2);handlers!.onmessage({serverContent:{inputTranscription:{text:'Ճնշումս '}}});
 handlers!.onmessage({serverContent:{inputTranscription:{text:'145/92 է'}}});
 handlers!.onmessage({serverContent:{modelTurn:{parts:[{text:'.'}]},turnComplete:true}});
 await new Promise(resolve=>setTimeout(resolve,650));
 assert.deepEqual(events,['speech','partial:Ճնշումս','partial:Ճնշումս 145/92 է','turn:Ճնշումս 145/92 է'],'the model\'s own text is ignored');
 clock+=5000;handlers!.onmessage({serverContent:{interrupted:true}});assert.equal(events.filter(e=>e==='speech').length,1,'an old loud moment does not count');
 handlers!.onmessage({goAway:{timeLeft:'5s'}});assert.equal(events.at(-1),'close');assert.equal(sessionClosed,1);assert.equal(captureStopped,1);
 connection.close();
 globalThis.fetch=(()=>{throw Error('No network in this check');}) as typeof fetch;
});
await scenario('no token, no session: the route refusing Live is an error the controller turns into a fallback',async()=>{
 globalThis.fetch=(async()=>new Response(JSON.stringify({status:'unavailable'}),{status:503})) as unknown as typeof fetch;
 await assert.rejects(audio.fetchLiveToken('/api/patient/zoe/live-token','en',new AbortController().signal));
 globalThis.fetch=(()=>{throw Error('No network in this check');}) as typeof fetch;
});
await scenario('PCM is little-endian Int16 at full scale, clipped',()=>{
 const b64=audio.pcm16Base64(new Float32Array([0,1,-1,2]));
 const bytes=Buffer.from(b64,'base64');const pcm=new Int16Array(bytes.buffer,bytes.byteOffset,4);
 assert.deepEqual([...pcm],[0,32767,-32768,32767]);
 assert.ok(Math.abs(audio.rmsLevel(new Float32Array([0.5,-0.5]))-0.5)<1e-9);
});
await scenario('the chat hook continues with the recorded controller when Live falls back, and loads Live only when offered',async()=>{
 const {readFileSync}=await import('node:fs');
 const hook=readFileSync('components/chat-v2/conversation.tsx','utf8');
 assert.match(hook,/fallback:\(\)=>\{liveFailed\.current=true;[^}]*controller\.current!\.start\(\)/,'fallback starts the batch controller');
 assert.match(hook,/if\(!options\.live\)return;/,'no Live client without the server capability');
 assert.match(hook,/import\('\.\/live-controller'\),import\('\.\/live-audio'\)/,'the Live client is loaded lazily');
});
console.log('Live controller: partial transcripts, review and auto-send, urgent send and speech, barge-in, echo rejection, staff review, fail-safe screening, silent fallback, late connections, idle stop, session turn assembly and PCM passed (no browser, no network).');
