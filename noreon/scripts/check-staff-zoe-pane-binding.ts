import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';

(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const requests:{url:string;body:{conversationId:string;text:string};signal:AbortSignal;stream:ReadableStreamDefaultController<Uint8Array>}[]=[];
const modules:Record<string,unknown>={
 react:React,'react/jsx-runtime':jsx,'next/navigation':{useRouter:()=>({push:()=>{}})},'next/link':{default:({children,...props}:Record<string,unknown>)=>React.createElement('a',props,children as React.ReactNode)},
 '@/lib/staff/staff-locale-copy':{st:(_l:string,en:string)=>en},
 '@/lib/staff-zoe/contracts':{memberRef:(id:string)=>id,savedAnswer:(x:unknown)=>x},
 '@/lib/staff-zoe/actions':{findStaffZoeMembers:()=>{throw Error('Unexpected search');},openStaffZoe:()=>{throw Error('Unexpected open');}},
 '@/components/patient/zoe-kit/thread':{ZoeTurn:({children}:{children:React.ReactNode})=>children},
 'lucide-react':{ArrowUp:()=>null},'@/components/staff/chat-menu-items':{ChatMenuItems:({children}:{children:React.ReactNode})=>children},
 '@/components/staff/chat-enter':{submitChatOnEnter:()=>{}},
 './answer':{StaffZoeResponse:(p:{content:unknown;cards:unknown;error:unknown})=>React.createElement('div',{},JSON.stringify(p))},
 '@/lib/staff-zoe/response-copy':{staffZoeRefusal:()=> 'Unavailable'},
};
const exports:Record<string,unknown>={};let nextId=0;
vm.runInNewContext(ts.transpileModule(readFileSync('components/staff/zoe/staff-zoe-pane.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,
 {exports,AbortController,TextDecoderStream,Date,Intl,crypto:{randomUUID:()=>`submission-${++nextId}`},fetch:async(url:string,init:{body:string;signal:AbortSignal})=>{
  let stream!:ReadableStreamDefaultController<Uint8Array>;const body=new ReadableStream<Uint8Array>({start(c){stream=c;}});
  requests.push({url,body:JSON.parse(init.body),signal:init.signal,stream});return {ok:true,body};
 },require:(name:string)=>{assert.ok(name in modules,`Unmocked import ${name}`);return modules[name];}});
const Chat=exports.StaffZoeChat as React.ComponentType<Record<string,unknown>>;
const conversation=(id:string,name:string)=>({id:`conversation-${id}`,member:{id,name,birthYear:1980,sex:null},messages:[{role:'staff',seq:1,body:`Saved ${id}`,at:'2026-11-05T10:00:00Z'}]});
const props=(id:string)=>({conversation:conversation(id,`Member ${id}`),role:'doctor',locale:'en'});
let view!:ReactTestRenderer;
const text=()=>JSON.stringify(view.toJSON());
const summary=()=>view.root.findAllByType('button').find(b=>b.children.includes('Summarise the record'))!;
const emit=async(index:number,value:unknown)=>{await act(async()=>{try{requests[index]!.stream.enqueue(new TextEncoder().encode(JSON.stringify(value)+'\n'));requests[index]!.stream.close();}catch{/* A cancelled old reader has already detached. */}});};
await act(async()=>{view=create(React.createElement(Chat,props('A')));});
assert.match(text(),/Saved A/);
await act(async()=>{summary().props.onClick();});assert.equal(requests[0]!.body.conversationId,'conversation-A');assert.equal(requests[0]!.url,'/staff/real/zoe/member/A/ask','Doctor pane always uses a bound patient route');
await act(async()=>{view.update(React.createElement(Chat,props('B')));});
assert.match(text(),/Member B/);assert.match(text(),/Saved B/);assert.doesNotMatch(text(),/Saved A|Member A/,'A history disappears when B replaces the same mounted chat');
assert.equal(requests[0]!.signal?.aborted,true,'Switching aborts the previous request');
await emit(0,{type:'answer',content:{body:'Old A answer'}});assert.doesNotMatch(text(),/Old A answer/);
await act(async()=>{summary().props.onClick();});assert.equal(requests[1]!.body.conversationId,'conversation-B');assert.equal(requests[1]!.url,'/staff/real/zoe/member/B/ask');
await emit(1,{type:'answer',content:{body:'New B answer'}});assert.match(text(),/New B answer/);assert.doesNotMatch(text(),/Old A answer|Saved A/);
await act(async()=>{view.unmount();});

// A late workspace interception must not fall through and send a stale A request after switching.
let release!:(handled:boolean)=>void;const pending=new Promise<boolean>(resolve=>{release=resolve;});
await act(async()=>{view=create(React.createElement(Chat,{...props('A'),onWorkspaceAsk:()=>pending}));});
await act(async()=>{view.root.findByType('textarea').props.onChange({target:{value:'A workspace question'}});});
await act(async()=>{view.root.findByType('form').props.onSubmit({preventDefault(){}});});
const before=requests.length;
await act(async()=>{view.update(React.createElement(Chat,props('B')));});
await act(async()=>{release(false);await pending;});
assert.equal(requests.length,before,'Late workspace callback cannot start an A turn under B');assert.match(text(),/Member B/);assert.doesNotMatch(text(),/Saved A|A workspace question/);
await act(async()=>{view.unmount();});
await act(async()=>{view=create(React.createElement(Chat,{...props('A'),role:'nurse'}));});
await act(async()=>{summary().props.onClick();});assert.equal(requests.at(-1)!.url,'/staff/real/zoe/ask','Nurse route remains unchanged');
await emit(requests.length-1,{type:'refused',code:'off'});await act(async()=>view.unmount());
console.log('Staff Zoe pane binding: mounted A-to-B history reset, old stream abort/suppression, new B request, and late workspace continuation passed (all imports mocked, no network).');
