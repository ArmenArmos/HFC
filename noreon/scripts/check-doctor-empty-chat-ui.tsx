import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import * as contracts from '@/lib/staff-zoe/contracts';
import * as kitThread from '@/components/patient/zoe-kit/thread';
import {st} from '@/lib/staff/staff-locale-copy';
import {submitChatOnEnter} from '@/components/staff/chat-enter';

// Exercise the actual composer/menu handler with controlled transport. No provider or network.
const require=createRequire(import.meta.url),requests:Record<string,unknown>[]=[],commands:string[]=[];
const exports:Record<string,unknown>={};
const code=ts.transpileModule(readFileSync('components/staff/zoe/staff-zoe-pane.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new vm.Script(code).runInNewContext({exports,crypto,TextDecoderStream,fetch:async(_url:string,options:{body:string})=>{
 requests.push(JSON.parse(options.body));
 return new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(JSON.stringify({type:'refused',code:'busy'})+'\n'));controller.close();}}));
},require(name:string){
 if(name==='next/link')return {default:(p:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',p)};
 if(name==='next/navigation')return {useRouter:()=>({push:()=>{throw Error('Unexpected navigation');}})};
 if(name==='@/components/staff/chat-enter')return {submitChatOnEnter};
 if(name==='@/lib/staff/staff-locale-copy')return {st};
 if(name==='@/lib/staff-zoe/contracts')return contracts;
 if(name==='@/lib/staff-zoe/actions')return {};
 if(name==='@/components/patient/zoe-kit/thread')return kitThread;
 if(name==='@/components/staff/chat-menu-items')return {ChatMenuItems:({children}:{children:React.ReactNode})=><nav>{children}</nav>};
 if(name==='./cards')return {RecordCard:()=>null,ZoeAnswer:()=>null};
 return require(name);
}});
const Chat=exports.StaffZoeChat as React.ComponentType<{conversation:contracts.ConversationRead;role:'doctor';locale:'en'|'hy'|'ru';workspace:boolean;home:boolean;decisions:React.ReactNode;onWorkspaceAsk:(q:string)=>Promise<boolean>}>;
const conversation:contracts.ConversationRead={enabled:true,id:'11111111-1111-4111-8111-111111111111',member:{id:'22222222-2222-4222-8222-222222222222',name:'Fictional member',birthYear:1980,sex:null},messages:[]};
let desktop=true;
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true,window:{matchMedia:()=>({matches:desktop})}});
for(const [locale,label] of [['en','Open items'],['hy','Բաց հարցեր'],['ru','Открытые вопросы']] as const){
 let tree!:TestRenderer.ReactTestRenderer;
 await act(async()=>{tree=TestRenderer.create(<Chat conversation={conversation} role="doctor" locale={locale} workspace home decisions={<aside data-decision-sentinel/>} onWorkspaceAsk={async q=>{commands.push(q);return q==='Open conversation';}}/>);});
 const input=()=>tree.root.findByType('textarea');
 await act(async()=>input().props.onChange({target:{value:label}}));
 let prevented=false;
 const enter={key:'Enter',shiftKey:false,nativeEvent:{isComposing:false},currentTarget:{form:{requestSubmit:()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}})}},preventDefault(){prevented=true;}};
 const beforeEnter=requests.length;
 for(const extra of [{shiftKey:true},{nativeEvent:{isComposing:true}},{keyCode:229}]){
  await act(async()=>input().props.onKeyDown({...enter,...extra}));
  assert.equal(requests.length,beforeEnter,'Shift+Enter and IME composition never send');
 }
 desktop=false;
 await act(async()=>input().props.onKeyDown(enter));
 assert.equal(requests.length,beforeEnter,'A phone keyboard keeps Enter for editing');
 assert.equal(prevented,false);
 desktop=true;
 await act(async()=>input().props.onKeyDown(enter));
 assert.equal(prevented,true);assert.equal(requests.length,beforeEnter+1,'Desktop Enter sends through the actual member form');
 assert.equal(commands.length,0,'An exact former chip label must not become a member search');
 assert.equal(requests.at(-1)?.intent,'open_items');
 const menu=tree.root.findByType('nav');
 await act(async()=>menu.findAllByType('button').find(b=>b.children.join('')===label)!.props.onClick());
 assert.equal(requests.at(-1)?.intent,'open_items','Menu and typed requests use the same bounded intent');
 const thread=tree.root.findByProps({'data-testid':'zoe-thread'});
 const children=thread.children.filter(n=>typeof n!=='string');
 assert.equal(children.at(-2)?.props['data-decision-sentinel'],true,'The decision follows the newest conversation turn');
 assert.equal(tree.root.findAll(n=>String(n.props.className??'').includes('sz-query-strip')).length,0,'Former chips are absent from the conversation/composer');
 const before=requests.length;
 await act(async()=>input().props.onChange({target:{value:'Open conversation'}}));
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(commands.at(-1),'Open conversation');assert.equal(requests.length,before,'Workspace actions retain their existing routing');
 commands.length=0;
 const beforeQuestion=requests.length;
 await act(async()=>input().props.onChange({target:{value:'How is her blood pressure changing?'}}));
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(requests.length,beforeQuestion+1,'Free questions use the existing Doctor Zoe endpoint');
 assert.equal(requests.at(-1)?.conversationId,conversation.id);
 assert.equal(requests.at(-1)?.text,'How is her blood pressure changing?');
 assert.equal(requests.at(-1)?.intent,null);
 commands.length=0;
 await act(async()=>tree.unmount());
}
console.log('Empty doctor chat: typed/Menu read equivalence in en/hy/ru, no chip rows, latest decision position, workspace routing passed (controlled IO).');
