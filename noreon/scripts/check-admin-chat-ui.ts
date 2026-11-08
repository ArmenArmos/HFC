import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import * as contracts from '@/lib/admin-chat/contracts';
import type {AdminChatResult,AdminIntent,OperationsView} from '@/lib/admin-chat/contracts';
import * as localeCopy from '@/lib/locale';
import * as staffLocaleCopy from '@/lib/staff/staff-locale-copy';
import {realtimeStubs} from './realtime-test-stubs';

const require=createRequire(import.meta.url);
const fixture:OperationsView={intent:'overdue',asOf:'2026-10-31T12:00:00Z',summary:null,unavailable:[],partial:[],disabled:[],notices:[],items:[
 {id:'task:one',kind:'task',memberName:'Example member',owner:'nurse',ownerName:'Example nurse',since:'2026-10-17T12:00:00Z',dueAt:'2026-10-30T12:00:00Z',href:'/staff/real/tasks'},
]};
const load=(path:string,dependencies:Record<string,unknown>)=>{
 const exports:Record<string,unknown>={};
 new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText).runInNewContext({exports,require:(name:string)=>{assert.ok(name in dependencies,`Unexpected import ${name}`);return dependencies[name];}});
 return exports;
};
const link={default:(p:React.ComponentProps<'a'>)=>React.createElement('a',p)};
const components=load('components/staff/admin-chat.tsx',{...await realtimeStubs(),'./admin-action-cards':{AdminActionCards:()=>null},'react':React,'react/jsx-runtime':require('react/jsx-runtime'),'next/link':link,'@/lib/admin-chat/contracts':contracts,'@/lib/staff/staff-locale-copy':staffLocaleCopy}) as typeof import('../components/staff/admin-chat');
const ready:AdminChatResult={kind:'ready',view:fixture};
for(const locale of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(React.createElement(components.AdminChat,{initial:ready,locale,readAction:async()=>ready}));
 assert.ok(html.includes('Example nurse'));
 assert.ok(html.includes('14+'));
 assert.ok(html.includes(localeCopy.pick(locale,{en:'Saved due date passed',hy:'Պահպանված վերջնաժամկետն անցել է',ru:'Сохранённый срок истёк'})));
 if(locale==='ru'){
  assert.ok(html.includes('Ваши дела с Зои'));
  assert.ok(html.includes('Какие дела ждут решения?'));
  assert.ok(!/[Ա-և]/.test(html),'Russian renders without Armenian fallback');
 }
 assert.ok(!/undefined|NaN|48 h|Nudge|Send notice|Offer slots/.test(html));
 assert.ok(!html.includes('dw-metric'),'Landing has no dashboard stat grid');
 assert.ok(!html.includes('<details open'),'Fallback links are in a closed Menu');
 assert.ok(!html.includes('lg:grid-cols-[14rem'),'Landing has no backoffice sidebar');
}
for(const warning of ['partial','unavailable','disabled'] as const){
 const html=renderToStaticMarkup(React.createElement(components.AdminOperationsCard,{view:{...fixture,items:[],[warning]:['callbacks']},locale:'en'}));
 assert.ok(!html.includes('Nothing waiting'),'Partial or unavailable data never claims an empty queue');
}
const empty=renderToStaticMarkup(React.createElement(components.AdminOperationsCard,{view:{...fixture,items:[]},locale:'en'}));
assert.ok(empty.includes('Nothing waiting in this queue.'));
const noDue=renderToStaticMarkup(React.createElement(components.AdminOperationsCard,{view:{...fixture,items:[{...fixture.items[0],dueAt:null}]},locale:'en'}));
assert.ok(!noDue.includes('Saved due date passed'),'Fourteen days alone does not mark work overdue');
for(const [state,expected] of [['clinic-response','Clinic response pending'],['start-scheduling','Scheduling notice not sent'],['check-scheduling','Check scheduling delivery'],['member-proposal','Clinic proposal awaiting member']] as const){
 const html=renderToStaticMarkup(React.createElement(components.AdminOperationsCard,{view:{...fixture,items:[{...fixture.items[0],kind:'booking',bookingState:state}]},locale:'en'}));
 assert.ok(html.includes(expected),'Booking wording reflects its recorded delivery channel/state');
}

const Navigation=load('components/staff/navigation.tsx',{
 'react/jsx-runtime':require('react/jsx-runtime'),'@/lib/locale':localeCopy,'lucide-react':require('lucide-react'),
 'next/navigation':{usePathname:()=>'/staff/real/admin-chat'},
 '@/components/app-shell/sidebar-nav':{SidebarNav:({links}:{links:{href:string;label:string}[]})=>React.createElement('nav',{},links.map(l=>React.createElement('a',{href:l.href,key:l.href},l.label)))},
}).StaffNavigation as typeof import('../components/staff/navigation').StaffNavigation;
for(const [admin,nurse,flag,expected] of [[true,false,false,false],[true,false,true,true],[false,false,true,false],[false,true,true,false]] as const){
 const html=renderToStaticMarkup(React.createElement(Navigation,{real:true,admin,nurse,adminChat:flag}));
 assert.equal(html.includes('/staff/real/admin-chat'),expected,'Only a flagged admin navigation exposes the chat');
}

Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const summary:NonNullable<OperationsView['summary']>={asOf:fixture.asOf,cases:{total:3,doctorAssigned:2,doctorUnassigned:1,nurseAssigned:1,nurseUnassigned:2},bookings:{total:5,requested:1,providerProposed:1,confirmed:2,changePending:1,cancelled:0},coordination:{total:4,open:1,awaitingMember:1,awaitingDoctor:1,completed:1,cancelled:0,needsReassignment:0}};
const countLabels=['Waiting for a doctor','Waiting for a nurse','Test requests waiting','Active coordination tasks'];
for(const locale of ['en','hy','ru'] as const){
 const html=renderToStaticMarkup(React.createElement(components.AdminChat,{locale,initial:{kind:'ready',view:{...fixture,intent:'operations',summary,items:[]}},readAction:async():Promise<AdminChatResult>=>({kind:'ready',view:fixture})}));
 assert.ok(!/undefined|NaN/.test(html));
 if(locale==='ru')assert.ok(!/[Ա-և]/.test(html),'All four counts have Russian copy');
}
for(const [index,intent] of ['doctor-waiting','nurse-waiting','test-requests','tasks'].entries()){
 let selected='';
 let countTree!:TestRenderer.ReactTestRenderer;
 await act(async()=>{countTree=TestRenderer.create(React.createElement(components.AdminChat,{locale:'en',initial:{kind:'ready',view:{...fixture,intent:'operations',summary,items:[]}},readAction:async value=>{selected=value;return {kind:'ready',view:{...fixture,intent:value}};}}));});
 const label=countLabels[index];
 const countButton=countTree.root.findAllByType('button').find(node=>node.children.filter(child=>typeof child==='string').join('').includes(label));
 assert.ok(countButton,`${label} must be a tappable count`);
 await act(async()=>countButton.props.onClick());
 assert.equal(selected,intent);
 assert.ok(JSON.stringify(countTree.toJSON()).includes('Example member'),'The matching list is rendered within chat');
 await act(async()=>countTree.unmount());
}
let next:AdminChatResult=ready;
const calls:AdminIntent[]=[];
let renderer!:TestRenderer.ReactTestRenderer;
await act(async()=>{renderer=TestRenderer.create(React.createElement(components.AdminChat,{initial:ready,locale:'en',readAction:async intent=>{calls.push(intent);return next;}}));});
const button=(label:string)=>renderer.root.findAllByType('button').find(b=>b.children.join('')===label)!;
next={kind:'denied'};
await act(async()=>{await button('Who asked for a callback?').props.onClick();});
assert.deepEqual(calls,['callbacks']);
assert.ok(!JSON.stringify(renderer.toJSON()).includes('Example member'),'Denied follow-up clears previously rendered records');
assert.ok(JSON.stringify(renderer.toJSON()).includes('unavailable for your account'));
next={kind:'ready',view:{...fixture,intent:'callbacks',items:[]}};
await act(async()=>{await button('Who asked for a callback?').props.onClick();});
assert.ok(JSON.stringify(renderer.toJSON()).includes('Nothing waiting'));
await act(async()=>{renderer.unmount();});

let enabled=false,role='admin',pageReads=0,authCalls=0;
const Page=load('app/staff/real/(review)/admin-chat/page.tsx',{
 'react/jsx-runtime':require('react/jsx-runtime'),'next/link':link,
 '@/lib/locale':localeCopy,
 'next/navigation':{notFound:()=>{throw Error('not-found');}},
 '@/lib/admin-chat/config':{adminChatEnabled:()=>enabled},
 '@/lib/staff/real-admin':{requireRealAdmin:async()=>{authCalls++;if(role!=='admin')throw Error('denied');return {identity:{id:'admin'}};}},
 '@/lib/admin-chat/actions':{readAdminChat:async()=>{pageReads++;return ready;}},
 '@/lib/staff-zoe/voice':{staffVoiceAvailable:async()=>false,staffLiveAvailable:async()=>false},
 '@/components/staff/admin-chat':components,'../doctor-workspace/workspace.css':{},
}).default as (props:{searchParams:Promise<{lang?:string}>})=>Promise<React.ReactNode>;
await assert.rejects(()=>Page({searchParams:Promise.resolve({})}),/not-found/);
assert.equal(authCalls,0);assert.equal(pageReads,0,'Flag-off page performs no read');
enabled=true;
for(role of ['doctor','nurse','clinic'])await assert.rejects(()=>Page({searchParams:Promise.resolve({})}),/denied/);
assert.equal(pageReads,0);
role='admin';const page=await Page({searchParams:Promise.resolve({lang:'hy'})});
assert.ok(renderToStaticMarkup(page).includes('Ձեր գործերը Զոյայի հետ'));assert.equal(pageReads,1);
const russianPage=renderToStaticMarkup(await Page({searchParams:Promise.resolve({lang:'ru'})}));
assert.ok(russianPage.includes('Ваши дела с Зои'));
assert.ok(russianPage.includes('href="/staff/real/admin-chat?lang=ru" aria-current="page"'));
console.log('Admin chat UI: EN/HY/RU, age versus due date, empty/partial/unavailable states, denied follow-up, fixed question reads, page off and role guards passed (offline fixture).');
