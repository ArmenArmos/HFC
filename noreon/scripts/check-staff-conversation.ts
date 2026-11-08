/** Shared production controller with injected IO: staff never gets member emergency behavior. */
import assert from 'node:assert/strict';
import {ConversationController,type CaptureCallbacks,type ConversationDependencies} from '@/components/chat-v2/conversation-controller';
let capture!:CaptureCallbacks,sends=0,aborts=0,stops=0,text='give 5 mg',now=0,next=0;
const timers=new Map<number,{at:number;fn:()=>void}>(),spoken:string[]=[],drafts:string[]=[];
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
async function tick(ms:number){const end=now+ms;while(true){const item=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;now=item[1].at;timers.delete(item[0]);item[1].fn();await flush();}now=end;await flush();}
const staffPolicy={memberEmergency:false,autoSend:(result:{text:string})=>!/[0-9]/u.test(result.text)};
const deps:ConversationDependencies={...staffPolicy,capture:async cb=>{capture=cb;return()=>{stops++;};},transcribe:async()=>({status:'ok',text,urgent:true,receipt:'signed'}),onTranscript:r=>drafts.push(r.text),onSend:()=>{sends++;},onState:()=>{},emergencyText:()=>{throw Error('Staff must not request member 103 text');},play:async(value,signal)=>{spoken.push(value);await new Promise<void>(resolve=>signal.addEventListener('abort',()=>{aborts++;resolve();},{once:true}));},setTimer:(fn,ms)=>{const id=++next;timers.set(id,{at:now+ms,fn});return id;},clearTimer:id=>{timers.delete(id as number);}};
const c=new ConversationController(deps);
await c.start();capture.onTurn(new Blob(['audio']),1000);await flush();
assert.equal(c.phase,'paused','Numbers require an explicit staff send, even if STT marks urgent');await tick(4000);assert.equal(sends,0);assert.deepEqual(drafts,[text]);assert.deepEqual(spoken,[]);
c.sent();c.reply('Your change needs confirmation on the card.');await flush();assert.equal(c.phase,'speaking');capture.onSpeech();await flush();assert.equal(c.phase,'listening');assert.equal(aborts,1,'Barge-in cancels staff speech');
c.stop();text='the member has chest pain';await c.start();capture.onTurn(new Blob(['audio']),1000);await flush();assert.equal(c.phase,'review');await tick(3000);assert.equal(sends,1,'Urgent staff text uses normal send, without a member emergency route');assert.equal(c.phase,'waiting');
c.stop();await c.start();capture.onTurn(new Blob(['audio']),1000);await flush();c.hidden();await tick(3000);assert.equal(sends,1);assert.equal(c.phase,'off');assert.ok(stops>0);
await c.start();await tick(60000);assert.equal(c.phase,'off','Idle stops staff voice');
await c.start();c.sent();c.reply('');await flush();assert.equal(c.phase,'listening','A control-only reply returns to listening without speaking hidden text');c.stop();
console.log('Staff conversation: manual dose review, ordinary urgent send, barge-in, hide and idle passed');
const {staffConversationReply}=await import('@/components/staff/voice-reply');
assert.equal(staffConversationReply([{id:'wrong-member',kind:'open-chat'}]),'wrong-member','Wrong-member guidance is a completed spoken reply');
const poll={id:'poll',kind:'reply',reply:{kind:'urgent'}};
assert.equal(staffConversationReply([{id:'turn',kind:'reply',reply:{kind:'loading-search'}},poll],'turn'),null,'A poll cannot replace a pending voice reply');
assert.equal(staffConversationReply([{id:'turn',kind:'reply',reply:{kind:'text'}},poll],'turn'),'turn','The accepted turn is spoken after a concurrent poll');
console.log('Staff reply selection: completed member guidance and concurrent poll isolation passed');

await c.start();c.sent();c.reply('A long visible reply');await flush();await tick(61000);assert.equal(c.phase,'speaking','Active speech is not idle, even after sixty seconds');assert.equal(c.active,true);c.hidden();assert.equal(c.phase,'off','Hide still cancels a long reply');
