/** Production conversation controller with fake capture, playback and deterministic time. No provider IO. */
import assert from 'node:assert/strict';
import {ConversationController,type ConversationDependencies,type CaptureCallbacks} from '@/components/chat-v2/conversation-controller';
let now=0,id=0;const timers=new Map<number,{at:number;fn:()=>void}>();
const clock={setTimer:(fn:()=>void,ms:number)=>{const key=++id;timers.set(key,{at:now+ms,fn});return key;},clearTimer:(key:unknown)=>timers.delete(key as number)};
async function tick(ms:number){const end=now+ms;while(true){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;now=next[1].at;timers.delete(next[0]);next[1].fn();await flush();}now=end;await flush();}
async function flush(){for(let i=0;i<8;i++)await Promise.resolve();}
let capture!:CaptureCallbacks,stops=0,sends=0,aborts=0;const transcripts:string[]=[],speech:string[]=[];let urgent=false;
const deps:ConversationDependencies={...clock,onState:()=>{},onTranscript:r=>transcripts.push(r.receipt??''),onSend:()=>{sends++;},
 capture:async callbacks=>{capture=callbacks;return ()=>{stops++;};},transcribe:async()=>({status:'ok',text:'hello',receipt:'receipt',urgent}),
 play:async(text,signal)=>{speech.push(text);return new Promise<void>((resolve)=>{signal.addEventListener('abort',()=>{aborts++;resolve();},{once:true});});},emergencyText:()=> 'Call 103 now.'};
const c=new ConversationController(deps);
await c.start();assert.equal(c.phase,'listening');capture.onTurn(new Blob(['audio']),1400);await flush();assert.equal(c.phase,'review');assert.deepEqual(transcripts,['receipt']);assert.equal(sends,0);
await tick(2000);c.edit();await tick(2000);assert.equal(sends,0,'Typing or tapping review cancels auto-send');assert.equal(c.phase,'paused');
c.sent();c.reply('Zoe reply');await flush();assert.equal(c.phase,'speaking');capture.onSpeech();await flush();assert.equal(c.phase,'listening');assert.equal(aborts,1,'Barge-in interrupts playback immediately');
c.stop();assert.ok(stops>0);await tick(60000);assert.equal(c.phase,'off');
await c.start();capture.onTurn(new Blob(['audio']),1400);await flush();await tick(3000);assert.equal(sends,1,'Countdown sends through normal action');assert.equal(c.phase,'waiting');
c.stop();urgent=true;await c.start();capture.onTurn(new Blob(['urgent']),1400);await flush();assert.equal(sends,2,'Urgent transcript skips countdown');assert.equal(speech.at(-1),'Call 103 now.');assert.equal(c.phase,'emergency');
c.stop();urgent=false;await c.start();c.sent();c.reply('Regular');await flush();const before=aborts;c.emergency();await flush();assert.ok(aborts>before,'An urgent card preempts ordinary speech');assert.equal(speech.at(-1),'Call 103 now.');
c.stop();await c.start();capture.onTurn(new Blob(['audio']),1400);await flush();assert.equal(c.phase,'review');c.hidden();assert.equal(c.phase,'off','Hidden/pagehide ends conversation');await tick(5000);assert.equal(sends,2,'Hidden cancels outstanding countdown send');
await c.start();await tick(60000);assert.equal(c.phase,'off','Idle stops at 60 seconds');
await c.start();capture.onError();assert.equal(c.phase,'error');assert.equal(c.active,false,'Capture error releases mode for text fallback');
let finishTranscript!:(value:controllerResult)=>void;type controllerResult=Awaited<ReturnType<ConversationDependencies['transcribe']>>;
const late=new ConversationController({...deps,transcribe:()=>new Promise(resolve=>finishTranscript=resolve)});await late.start();capture.onTurn(new Blob(['late']),1000);await flush();late.hidden();const count=transcripts.length;finishTranscript({status:'ok',text:'late',receipt:'late'});await flush();assert.equal(transcripts.length,count,'Late transcription cannot change a hidden draft');
console.log('Conversation controller: editable countdown, receipt, urgent preemption, barge-in, hidden and idle passed');
