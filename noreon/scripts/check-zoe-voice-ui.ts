/** Production voice components with synthetic browser IO. This does not replace WebKit visual acceptance. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as copy from '@/lib/patient/copy';
import * as contract from '@/lib/zoe-chat-actions/voice-contract';
import {screenVoiceTranscripts} from '@/lib/zoe-chat-actions/voice';
const require=createRequire(import.meta.url);
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const windowEvents=new EventTarget(),documentEvents=new EventTarget();
let requests=0,stops=0,uploads=0,resolvePermission:((value:unknown)=>void)|null=null,permissionPending=false,oversized=false;
let cancelled=0;const spoken:string[]=[];const voices=[{lang:'en-GB',localService:true},{lang:'ru-RU',localService:false}];
const stream={getTracks:()=>[{stop:()=>stops++}]};
const navigator={mediaDevices:{getUserMedia:()=>{requests++;return permissionPending?new Promise(resolve=>{resolvePermission=resolve;}):Promise.resolve(stream);}}};
class Recorder {
  static isTypeSupported(type:string){return type==='audio/mp4';}
  state='inactive';mimeType='audio/mp4';ondataavailable:((e:{data:Blob})=>void)|null=null;onstop:(()=>void)|null=null;
  constructor(_stream:unknown,options:{mimeType:string}){assert.equal(options.mimeType,'audio/mp4');}
  start(){this.state='recording';}
  stop(){this.state='inactive';queueMicrotask(()=>{this.ondataavailable?.({data:new Blob([oversized?new Uint8Array(contract.VOICE_MAX_BYTES+1):'fake audio'])});this.onstop?.();});}
}
const win=Object.assign(windowEvents,{speechSynthesis:{getVoices:()=>voices,cancel:()=>cancelled++,speak:(u:{text:string})=>spoken.push(u.text),addEventListener:()=>{},removeEventListener:()=>{}}});
const doc=Object.assign(documentEvents,{hidden:false});
const globals={Event,crypto,window:win,document:doc,navigator,MediaRecorder:Recorder,AbortController,Blob,performance,setTimeout,clearTimeout,queueMicrotask,
  requestAnimationFrame:()=>1,cancelAnimationFrame:()=>{},AudioContext:class{constructor(){throw Error('No audio graph in fixture');}},SpeechSynthesisUtterance:class{text:string;constructor(text:string){this.text=text;}},
  fetch:async()=>{uploads++;return {json:async()=>({status:'ok',text:'145/92',receipt:'synthetic-receipt'})};},
};
function load(file:string,deps:Record<string,unknown>){
  const exports:Record<string,unknown>={};
  const code=ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(code,{...globals,exports,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});return exports;
}
const deps={'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'lucide-react':require('lucide-react'),'@/lib/patient/copy':copy,'@/lib/zoe-chat-actions/voice-contract':contract,'@/components/patient/use-hydrated':{useHydrated:()=>true}};
const {Microphone}=load('components/chat-v2/microphone.tsx',deps) as typeof import('../components/chat-v2/microphone');
const {VoicePlayback,Speaker}=load('components/chat-v2/speaker.tsx',deps) as typeof import('../components/chat-v2/speaker');
let ui!:ReactTestRenderer;
let transcripts:string[]=[],busy=false;const receivedReceipts:(string|undefined)[]=[];
const renderMic=async()=>{await act(async()=>{ui=create(React.createElement(Microphone,{locale:'en',disabled:false,onTranscript:(text,receipt)=>{transcripts.push(text);receivedReceipts.push(receipt);},onBusy:value=>{busy=value;}}));});};
const down=()=>ui.root.findByType('button').props.onPointerDown({button:0,preventDefault(){},pointerId:1,clientX:100,clientY:100,currentTarget:{setPointerCapture(){}}});
const up=()=>ui.root.findByType('button').props.onPointerUp();
await renderMic();assert.equal(requests,0,'Mount never requests permission');
await act(async()=>{await down();});assert.equal(requests,1);assert.equal(busy,true);
await act(async()=>{up();});assert.deepEqual(transcripts,['145/92']);assert.equal(uploads,1);assert.equal(busy,false);assert.ok(stops>0);assert.equal(receivedReceipts[0],'synthetic-receipt');
await act(async()=>{ui.unmount();});
transcripts=[];await renderMic();await act(async()=>{await down();});
await act(async()=>{ui.root.findByType('button').props.onPointerMove({clientX:0,clientY:100});up();});
assert.deepEqual(transcripts,[]);assert.equal(uploads,1,'Slide cancellation never uploads');assert.equal(busy,false);
await act(async()=>{ui.unmount();});
permissionPending=true;await renderMic();await act(async()=>{down();up();});
const stopped=stops;await act(async()=>{resolvePermission!(stream);});
assert.ok(stops>stopped,'Release during permission promptly stops the late stream');assert.equal(busy,false);assert.equal(uploads,1);
await act(async()=>{ui.unmount();});permissionPending=false;
// MediaRecorder emits its final chunk asynchronously, after release set the released marker.
oversized=true;await renderMic();await act(async()=>{await down();});await act(async()=>{up();});
assert.equal(busy,false,'Oversized final chunk must unlock the composer');
assert.equal(uploads,1,'Oversized final chunk never uploads');
await act(async()=>{ui.unmount();});oversized=false;
const speakers=(enabled=true)=>React.createElement(VoicePlayback,{enabled},[React.createElement(Speaker,{key:'en',text:'Hello',locale:'en'}),React.createElement(Speaker,{key:'other',text:'Another message',locale:'en'}),React.createElement(Speaker,{key:'hy',text:'Բարև',locale:'hy'}),React.createElement(Speaker,{key:'ru',text:'Привет',locale:'ru'})]);
await act(async()=>{ui=create(speakers(false));});assert.equal(ui.root.findAllByType('button').length,0);assert.equal(spoken.length,0);
await act(async()=>{ui.update(speakers());});assert.equal(ui.root.findAllByType('button').length,2,'No Armenian or remote Russian voice exposed');assert.equal(spoken.length,0);
await act(async()=>{ui.root.findAllByType('button')[0].props.onClick();});assert.deepEqual(spoken,['Hello']);
const firstCancelled=cancelled;await act(async()=>{ui.root.findAllByType('button')[1].props.onClick();});
assert.ok(cancelled>firstCancelled,'Starting another message cancels playback');assert.deepEqual(spoken,['Hello','Another message']);
const before=cancelled;await act(async()=>{windowEvents.dispatchEvent(new Event('pagehide'));});assert.ok(cancelled>before);
await act(async()=>{ui.unmount();});
console.log('Voice components: gesture-only permission, transcript, cancellation, late permission, final size limit, local language playback and leave cleanup passed');

// Exercise the production shared hook's editable draft and card-offer path, with IO isolated.
const threadContract=await import('@/lib/zoe/app-chat-contracts');
const cardThread=await import('@/lib/zoe-chat-actions/thread');
const registry=await import('@/lib/zoe-chat-actions/registry');
const drafts=new Map<string,string>();let sends=0;const opened:Array<{voiceConfirmed?:boolean}>=[];const sentReceipts:unknown[]=[];let failOpening=true;
let thread:import('../lib/zoe/app-chat-contracts').ZoeThread={ok:true,version:0,ack:null,zoeReplies:false,settledSeq:0,messages:[],replies:[],answers:[]};
let cards:import('../lib/zoe-chat-actions/registry').ZoeCards={enabled:true,cards:[],readingSeq:null,clearedSeq:null};
Object.assign(win,{setInterval:()=>0,clearInterval:()=>{}});
Object.assign(doc,{visibilityState:'visible'});
const hookModule=load('components/patient/use-zoe-thread.ts',{
  'react':React,'@/lib/chat/tasks':await import('@/lib/chat/tasks'),
  '@/lib/zoe-chat-actions/everyday-contract':await import('@/lib/zoe-chat-actions/everyday-contract'),
  '@/lib/zoe-chat-actions/everyday-actions':{openEverydayCard:()=>{throw Error('Unexpected card');}},
  '@/lib/zoe-chat-actions/thread-events':await import('@/lib/zoe-chat-actions/thread-events'),
  './tab-draft':{readDraft:(key:string)=>drafts.get(key)??null,keepDraft:(key:string,value:string)=>{if(value)drafts.set(key,value);else drafts.delete(key);}},
  '@/lib/zoe-chat-actions/registry':registry,
  '@/lib/zoe-chat-actions/thread':{...cardThread,fetchZoeCards:async()=>cards},
  '@/lib/zoe/member-screen':await import('@/lib/zoe/member-screen'),
  '@/lib/zoe/app-chat-contracts':{...threadContract,fetchZoeThread:async()=>thread},
  '@/lib/zoe-chat-actions/actions':{openZoeCard:async(input:{requestId:string;sourceSeq:number;voiceConfirmed?:boolean})=>{
    opened.push(input);if(failOpening)return {status:'failed'};
    return {status:'ok',card:registry.cardSchema.parse({id:crypto.randomUUID(),requestId:input.requestId,kind:'bp',source:'typed',sourceSeq:input.sourceSeq,state:'open',outcome:{},claims:{},at:new Date().toISOString(),snapshot:{v:1,week:null,typed:{systolic:146,diastolic:93,pulse:null,measuredAt:new Date().toISOString()}}})};
  }},
  '@/app/patient/zoe/chat-actions':{sendZoeChatMessage:async(requestId:string,text:string,_toDoctor:boolean,_inline:boolean,receipt:unknown)=>{
    sentReceipts.push(receipt);
    sends++;thread={...thread,version:1,messages:[{seq:1,requestId,text,channel:'app',at:new Date().toISOString()}]};cards={...cards,readingSeq:1};return {status:'sent',thread};
  }},
}) as typeof import('../components/patient/use-zoe-thread');
let hook!:ReturnType<typeof hookModule.useZoeThread>;
function Harness(){hook=hookModule.useZoeThread({initial:thread,cards,bpOnly:true});return null;}
await act(async()=>{ui=create(React.createElement(Harness));});
await act(async()=>{hook.setVoiceText('145/92','synthetic-receipt');});
assert.equal(hook.text,'145/92');assert.equal(sends,0);assert.equal(opened.length,0);
assert.ok(![...drafts.values()].join(' ').includes('145/92'),'Transcript never enters draft storage');
await act(async()=>{hook.setText('146/93');});
assert.ok(![...drafts.values()].join(' ').includes('146/93'),'Editing preserves ephemeral voice draft');
await act(async()=>{hook.submit();});
assert.equal(sends,1);assert.equal(opened.length,1);assert.equal(opened[0].voiceConfirmed,undefined);assert.equal(sentReceipts[0],'synthetic-receipt');
assert.equal(hook.opening?.state,'failed','A failed opening leaves the persisted message recoverable');
assert.equal(drafts.get('zoe-voice-sent'),undefined,'Provenance is never kept in tab storage');
await act(async()=>{ui.unmount();});
// Another device has no tab storage. The stored message still offers its card.
drafts.clear();failOpening=false;
await act(async()=>{ui=create(React.createElement(Harness));});
assert.equal(opened.at(-1)?.voiceConfirmed,undefined,'Recovery opens from the stored message without client provenance');assert.equal(hook.cards.cards.length,1);
await act(async()=>{ui.unmount();});
console.log('Voice draft: no auto-send/storage, editable text, receipt forwarding, no client provenance and card recovery without tab storage passed');

// Main's questionnaire consumes a spoken answer locally; its receipt must not attach to the next message.
function QuestionnaireHarness(){hook=hookModule.useZoeThread({initial:thread,cards,bpOnly:true,fillOpenQuestion:value=>value==='72'});return null;}
await act(async()=>{ui=create(React.createElement(QuestionnaireHarness));});
const beforeAnswer=sends;
await act(async()=>{hook.setVoiceText('72','answer-receipt');});
await act(async()=>{hook.submit();});
assert.equal(hook.text,'');assert.equal(sends,beforeAnswer,'A spoken questionnaire answer still uses the existing answer form');
await act(async()=>{hook.setText('150/95');});
assert.ok([...drafts.values()].some(value=>value.includes('150/95')),'The next ordinary typed draft retains main draft persistence');
await act(async()=>{hook.submit();});
assert.equal(sentReceipts.at(-1),undefined,'A consumed questionnaire receipt never follows the next message');
await act(async()=>{ui.unmount();});
console.log('Voice/questionnaire handoff: spoken answer uses the form, next typed draft persists without a stale receipt');

// The server can see newer safety context than this page. Its urgent result skips local card/form diversion.
await act(async()=>{ui=create(React.createElement(QuestionnaireHarness));});
const beforeUrgent=sends;
await act(async()=>{hook.setVoiceText('72','server-urgent-receipt',true);});
await act(async()=>{hook.submit();});
assert.equal(sends,beforeUrgent+1,'Server urgent result bypasses a stale questionnaire consumer');
assert.ok(Object.values(hook.localEmergencies).some(e=>e.text==='72'),'103 appears without client matcher context');
assert.ok(Object.values(hook.emergencies).some(e=>e.text==='72'),'Urgent card remains rendered even with absent client check');
assert.equal(sentReceipts.at(-1),'server-urgent-receipt');
await act(async()=>{ui.unmount();});
console.log('Server urgent transcript: immediate 103 and ordinary send despite stale/absent local safety context');

// A symptom found only by the secondary engine survives unknown context all the way to the 103 state.
const screened=screenVoiceTranscripts({primary:'hello',urgent:'my face is swollen'},null,{NOREON_ZOE_TEST_LEXICON:'true'});
assert.ok(screened?.urgent);
await act(async()=>{ui=create(React.createElement(QuestionnaireHarness));});
await act(async()=>{hook.setVoiceText(screened.text,'secondary-symptom-receipt',screened.urgent);});
await act(async()=>{hook.submit();});
assert.ok(Object.values(hook.localEmergencies).some(e=>e.text==='my face is swollen'),'Unknown intake and a secondary symptom hit immediately show 103');
assert.ok(Object.values(hook.emergencies).some(e=>e.text==='my face is swollen'),'The 103 card remains visible');
assert.equal(sentReceipts.at(-1),'secondary-symptom-receipt');
await act(async()=>{ui.unmount();});
