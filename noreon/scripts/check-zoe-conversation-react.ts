/** Exercise committed draft/receipt handoff through the production React conversation hook. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as copy from '@/lib/patient/copy';
import {URGENT_TEXT} from '@/lib/zoe/symptoms/intake';
import * as controller from '@/components/chat-v2/conversation-controller';
const require=createRequire(import.meta.url);
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const windowEvents=new EventTarget(),documentEvents=Object.assign(new EventTarget(),{hidden:false});
let playback:'pending'|'fail'|'complete'='pending';
let capture!:controller.CaptureCallbacks,stopped=0;const sent:Array<{text:string;receipt?:string}>=[],spoken:string[]=[];
const exports:Record<string,unknown>={};
const deps:Record<string,unknown>={'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'lucide-react':require('lucide-react'),'@/lib/patient/copy':copy,'@/lib/zoe/symptoms/intake':{URGENT_TEXT},
 '@/lib/staff-zoe/typed-boundary':await import('@/lib/staff-zoe/typed-boundary'),
 '@/components/patient/use-hydrated':{useHydrated:()=>true},'./conversation-controller':controller,
 './conversation-browser':{conversationSupported:()=>true,captureConversation:async(callbacks:controller.CaptureCallbacks)=>{capture=callbacks;return ()=>stopped++;},
 transcribeConversation:async()=>({status:'ok',text:'urgent transcript',receipt:'bound-receipt',urgent:true}),
 playConversation:async(text:string,signal:AbortSignal)=>{spoken.push(text);if(playback==='fail')throw Error('Synthetic speech outage');if(playback==='complete')return;await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));}},
};
const code=ts.transpileModule(readFileSync('components/chat-v2/conversation.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports,window:windowEvents,document:documentEvents,Event,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});
const {useConversation}=exports as typeof import('../components/chat-v2/conversation');
let conversation!:ReturnType<typeof useConversation>;
function Harness({failureKey}:{failureKey?:string}){const [draft,setDraft]=React.useState<{text:string;receipt?:string}>({text:''});const next=useConversation({enabled:true,disabled:false,locale:'en',reply:null,urgentKey:null,failureKey,onTranscript:result=>setDraft({text:result.text,receipt:result.receipt}),onSend:()=>sent.push(draft)});React.useEffect(()=>{conversation=next;});return null;}
let ui!:ReactTestRenderer;
await act(async()=>{ui=create(React.createElement(Harness,{}));});
await act(async()=>{conversation.toggle();});assert.equal(conversation.phase,'listening');
await act(async()=>{capture.onTurn(new Blob(['synthetic']),1200);});
assert.deepEqual(sent,[{text:'urgent transcript',receipt:'bound-receipt'}],'Immediate urgent send sees committed text and receipt');
assert.equal(spoken[0],URGENT_TEXT.en,'Urgent transcript speaks the complete shared fixed emergency template');
await act(async()=>{documentEvents.hidden=true;documentEvents.dispatchEvent(new Event('visibilitychange'));});assert.equal(conversation.phase,'off');assert.ok(stopped>0);
await act(async()=>{conversation.toggle();});assert.equal(conversation.phase,'listening');
await act(async()=>{ui.update(React.createElement(Harness,{failureKey:'failed-request'}));});assert.equal(conversation.phase,'error','A fresh send error immediately stops the active conversation');
await act(async()=>{ui.unmount();});
console.log('Conversation React hook: urgent immediate send uses committed receipt draft; emergency and hidden cleanup passed');

const {ConversationToggle}=exports as typeof import('../components/chat-v2/conversation');
for(const [locale,start,stop,listening] of [
 ['hy','Սկսել ձայնային զրույցը','Ավարտել ձայնային զրույցը','Լսում եմ'],
 ['ru','Начать голосовой разговор','Завершить голосовой разговор','Слушаю'],
 ['en','Start voice conversation','End voice conversation','Listening'],
] as const){
 for(const phase of ['off','listening','transcribing','review','speaking','error'] as const){
  const active=phase!=='off'&&phase!=='error';
  await act(async()=>{ui=create(React.createElement(ConversationToggle,{locale,disabled:false,conversation:{phase,seconds:3,active,toggle(){},edit(){},sent(){}}}));});
  assert.equal(ui.root.findByType('button').props['aria-label'],active?stop:start);
  if(phase!=='off'){
   const status=ui.root.findByType('p').props.children as string;
   assert.ok(status.length>5);if(phase==='listening')assert.ok(status.includes(listening));
   if(locale!=='en')assert.ok(!/Turning|Sending|speaking|stopped/.test(status),'Status stays in the chosen language');
  }
  await act(async()=>{ui.unmount();});
 }
}
console.log('Conversation controls: hy/ru/en labels and listening/thinking/countdown/speaking/error strings present');

for(const mode of ['fail','complete'] as const){
 playback=mode;documentEvents.hidden=false;
 await act(async()=>{ui=create(React.createElement(Harness));});
 await act(async()=>{conversation.toggle();});
 const before:number=sent.length;
 await act(async()=>{capture.onTurn(new Blob(['urgent']),1200);});
 assert.equal(sent.length,before+1,`Urgent handoff survives immediate speech ${mode}`);
 assert.deepEqual(sent.at(-1),{text:'urgent transcript',receipt:'bound-receipt'});
 assert.equal(spoken.at(-1),URGENT_TEXT.en);
 await act(async()=>{ui.unmount();});
}
console.log('Urgent send is independent of immediate TTS rejection or completion');
