import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import ts from 'typescript';
import {z} from 'zod';
import * as sent from '@/lib/nurse-chat/sent-handoffs';
import * as handoffCopy from '@/lib/nurse-chat/handoff-copy';
import * as identity from '@/lib/staff/member-identity';
import * as time from '@/lib/staff/yerevan-time';
import * as copy from '@/lib/staff/staff-locale-copy';
import * as handoffs from '@/lib/nurse-chat/handoffs';
import {readSentHandoffs} from '@/lib/nurse-chat/sent-handoffs-read';

const member={id:'a8130000-0000-4000-8000-000000000001',name:'Fictional member',birthDate:'1980-04-03',birthYear:1980,phoneLast4:'1234'};
const row={taskId:member.id,member,sentAt:'2026-11-07T13:00:00Z',topic:'member-request' as const,observation:'As typed\nSecond line',status:'awaiting-doctor' as const,resolution:null};
let data:unknown={items:[row],hasMore:false},error:unknown=null,reads=0;
const rpc={rpc:async(name:string)=>{reads++;assert.equal(name,'nurse_sent_handoffs');return {data,error};}};
assert.deepEqual(await readSentHandoffs(rpc),data,'Read maps the bounded narrow payload');
const resolution={note:'Fictional closing note\nAs typed',by:'Fictional doctor',at:'2026-11-07T14:00:00Z'};
for(const status of ['completed','cancelled'] as const){
 data={items:[{...row,status,resolution}],hasMore:true};
 assert.deepEqual(await readSentHandoffs(rpc),data);
}
for(const status of ['open','awaiting-member','awaiting-doctor'] as const){
 data={items:[{...row,status,resolution}],hasMore:false};
 assert.equal((await readSentHandoffs(rpc))?.items[0].resolution,null,'Unresolved tasks cannot expose a resolution');
}
for(const invalid of [{items:[{...row,events:['internal history']}],hasMore:false},{items:Array(51).fill(row),hasMore:true},{items:[{...row,status:'unknown'}],hasMore:false},{}]){
 data=invalid;assert.equal(await readSentHandoffs(rpc),null,'Invalid payload fails closed');
}
data={items:[],hasMore:false};assert.deepEqual(await readSentHandoffs(rpc),data);
error={code:'42501'};assert.equal(await readSentHandoffs(rpc),null);error=null;
assert.equal(await readSentHandoffs({rpc:async()=>{throw Error('Transport failure');}}),null);

let enabled=true,role='nurse',auth=0;
const modules:Record<string,unknown>={
 'react/jsx-runtime':jsx,'zod':{z},'next/navigation':{unstable_rethrow:()=>{}},
 '@/lib/nurse-chat/sent-handoffs':sent,'./sent-handoffs-read':{readSentHandoffs},
 '@/lib/nurse-chat/handoff-copy':handoffCopy,'@/lib/staff/member-identity':identity,
 '@/lib/staff/yerevan-time':time,'@/lib/staff/staff-locale-copy':copy,
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/observability/logger':{log:{warn:()=>{}}},'./config':{nurseChatEnabled:()=>enabled},
 './handoffs':handoffs,'./handoff-read':{readHandoffs:()=>{throw Error('Broad history read forbidden');}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{auth++;return {identity:{role},client:rpc};}},
};
function load(file:string){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
 return exports;
}
const action=load('lib/nurse-chat/handoff-actions.ts').readNurseHandoffOverview as ()=>Promise<unknown>;
const before=reads;enabled=false;assert.equal(await action(),null);assert.equal(auth,0);
enabled=true;
for(role of ['doctor','admin','clinic_admin'])assert.equal(await action(),null);
assert.equal(reads,before,'Other roles never reach the RPC');
role='nurse';assert.deepEqual(await action(),data);

const View=load('components/nurse-chat-v2/sent-handoffs.tsx').NurseSentHandoffs as typeof import('@/components/nurse-chat-v2/sent-handoffs').NurseSentHandoffs;
// Reproduce the reported completed-handoff shape without accessing staging.
const regression={...row,member:{...member,name:'Aram Test One'},status:'completed' as const,
 observation:'Fictional regression-audit hand-over, 7 Nov. Please ignore and close.',
 resolution:{...resolution,note:'Closed after the 7 Nov regression audit: fictional test hand-over.'}};
data={items:[regression],hasMore:false};
const mapped=await readSentHandoffs(rpc);assert.ok(mapped);
const regressionHtml=renderToStaticMarkup(React.createElement(View,{page:mapped,locale:'en',onMember:()=>{}}));
for(const expected of [regression.member.name,regression.observation,regression.resolution.note,'Completed','17:00'])assert.ok(regressionHtml.includes(expected),expected);
for(const locale of ['en','hy','ru'] as const){
 const c=sent.sentHandoffsCopy(locale);
 const page:sent.SentHandoffs={items:[row,{...row,taskId:member.id.replace(/1$/,'2'),status:'completed',resolution},{...row,taskId:member.id.replace(/1$/,'3'),status:'cancelled',resolution}],hasMore:true};
 const html=renderToStaticMarkup(React.createElement(View,{page,locale,onMember:()=>{}}));
 for(const expected of [c.title,c.observation,c.resolution,c.open,c.older,identity.memberIdentityLine(member,locale),handoffCopy.handoffTopicLabel(locale,row.topic),time.yerevanStamp(row.sentAt,locale),time.yerevanStamp(resolution.at,locale),'Fictional doctor','As typed\nSecond line','Fictional closing note\nAs typed',...['awaiting-doctor','completed','cancelled'].map(status=>sent.sentHandoffStatus(locale,status as typeof row.status))])assert.ok(html.includes(expected),expected);
 assert.equal((html.match(/data-handoff-resolution=/g)??[]).length,2,'Only completed/cancelled rows have a resolution');
 assert.equal((html.match(/<button /g)??[]).length,3,'Only open-conversation controls');
 assert.doesNotMatch(html,/<(?:input|textarea|select|form)\b/,'Read-only list');
 const empty=renderToStaticMarkup(React.createElement(View,{page:{items:[],hasMore:false},locale,onMember:()=>{}}));
 assert.ok(empty.includes(c.empty));assert.doesNotMatch(empty,/<button/);
 const unresolved=renderToStaticMarkup(React.createElement(View,{page:{items:[{...row,resolution}],hasMore:false},locale,onMember:()=>{},disabled:true}));
 assert.doesNotMatch(unresolved,/Fictional closing note|data-handoff-resolution/);assert.match(unresolved,/disabled/);
 const withoutNote=renderToStaticMarkup(React.createElement(View,{page:{items:[{...row,status:'completed',resolution:null}],hasMore:false},locale,onMember:()=>{}}));
 assert.doesNotMatch(withoutNote,/data-handoff-resolution/,'No invented resolution');
 for(const status of ['open','awaiting-member'] as const)assert.equal(sent.sentHandoffStatus(locale,status),(await import('@/lib/staff/real-coordination/status-copy')).taskStatusLabel(locale,status),'Other task statuses keep their actual labels');
}
const css=readFileSync('components/nurse-chat-v2/nurse-chat.css','utf8');
assert.match(css,/\.cv2-root \.ncv2-choice\s*\{[^}]*min-height:44px/);
assert.match(css,/\[data-nurse-sent-handoffs\] \.ncv2-choice\s*\{[^}]*min-width:44px/);
console.log('Sent handoffs: read mapping, failure paths, action gates, en/hy/ru, identity, Yerevan times, terminal resolution only, read-only controls, 44 px target rules. SQL authorization is not exercised here.');
