import * as bpUnit from '@/lib/bp-unit';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import * as schema from '@/lib/nurse-visit/schema';
import * as locale from '@/lib/staff/staff-locale-copy';
import * as time from '@/lib/staff/yerevan-time';
import * as visitCopy from '@/lib/nurse-visit/copy';
import {renderToStaticMarkup} from 'react-dom/server';
import * as catalogue from '@/lib/patient/catalogue-label';
import type {NurseVisitReady} from '@/lib/nurse-visit/schema';

// Catches default collection, overwritten exceptions, missing reasons and lost drafts.
const file='components/nurse-chat-v2/sample-collection.tsx';
assert.ok(existsSync(file),'The chat needs its single sample collection card');
const collection=await import('@/lib/nurse-visit/collection');
const modules:Record<string,unknown>={'@/lib/bp-unit':bpUnit,'@/lib/nurse-visit/copy':visitCopy,'@/lib/nurse-visit/protocol-copy':await import('@/lib/nurse-visit/protocol-copy'),'react':React,'react/jsx-runtime':jsx,'@/lib/nurse-visit/schema':schema,'@/lib/nurse-visit/collection':collection,'@/lib/staff/staff-locale-copy':locale,'@/lib/staff/yerevan-time':time,'@/lib/patient/catalogue-label':catalogue};
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,crypto,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
const Card=exports.NurseSampleCollection as React.ComponentType<{data:NurseVisitReady;locale:'en'|'hy'|'ru';disabled:boolean;collect:(command:Record<string,unknown>)=>Promise<{status:string}>;reload:()=>Promise<unknown>}>;
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const member='aa110000-0000-4000-8000-000000000001';
const mark=(status:'collected'|'not-collected'|'issue')=>({done:status==='collected',collectionStatus:status,note:status==='collected'?null:'Member asked to wait',values:null,recordedAt:'2026-11-01T09:00:00Z',nurseName:'Narine'});
const seed=():NurseVisitReady=>({version:'nurse-visit-v1',enabled:true,visit:{source:'appointment',id:member,memberId:member,memberName:'Ani Example',arrangementToken:member,startsAt:'2026-11-01T09:00:00Z',endsAt:null,mode:'home',location:null,bookingStatus:'confirmed',completion:null},items:[
 {key:'sample:cbc',kind:'sample',testId:'cbc',title:'Complete blood count',mark:null},
 {key:'sample:lipids',kind:'sample',testId:'lipids',title:'Lipid panel',mark:mark('collected')},
 {key:'sample:urine',kind:'sample',testId:'urine',title:'Urine test',mark:mark('not-collected')},
 {key:'sample:hba1c',kind:'sample',testId:'hba1c',title:'HbA1c',mark:mark('issue')},
 ],counts:{samplesPlanned:4,samplesTaken:1,bpTaken:false,deviceDone:null,openItems:[]},steps:[{step:'confirmed',at:'2026-11-01T08:00:00Z',by:'Narine'}],checklistVersion:'v1.0',caseRevision:7,today:'2026-11-01',completion:null});
let screen=undefined as unknown as ReactTestRenderer,mode='saved',reloads=0,reloadedData:NurseVisitReady|null=null;
const calls:Record<string,unknown>[]=[];
const send=async(command:Record<string,unknown>)=>{calls.push(command);return {status:mode};};
async function mount(data=seed(),lang:'en'|'hy'|'ru'='en'){await act(async()=>{screen=create(React.createElement(Card,{data,locale:lang,disabled:false,collect:send,reload:async()=>{reloads++;if(reloadedData){screen.update(React.createElement(Card,{data:reloadedData,locale:lang,disabled:false,collect:send,reload:async()=>reloadedData}));}return reloadedData??data;}}));});}
const text=()=>JSON.stringify(screen.toJSON());
const button=(label:string)=>screen.root.findAllByType('button').find(n=>n.children.join('')===label)!;
async function press(label:string){const b=button(label);assert.ok(b,label);assert.ok(!b.props.disabled,label);await act(async()=>{await b.props.onClick();});}
for(const [lang,reason] of [['en','Confirm the visit with the member first.'],['hy','Նախ հաստատեք այցը անդամի հետ։'],['ru','Сначала подтвердите визит с участником.']] as const){
 const data=seed();data.steps=[];
 await mount(data,lang);
 assert.ok(text().includes(reason),'The reason is visible before confirmation');
 assert.ok(screen.root.findAllByType('button').every(b=>b.props.disabled===true),'Booking confirmation alone never enables collection or corrections');
 const html=renderToStaticMarkup(React.createElement(Card,{data,locale:lang,disabled:false,collect:send,reload:async()=>data}));
 assert.match(html,/<button[^>]*disabled=""/,'Collection uses real disabled attributes');
 await act(async()=>screen.update(React.createElement(Card,{data:seed(),locale:lang,disabled:false,collect:send,reload:async()=>seed()})));
 assert.equal(button(collection.collectionCopy(lang).confirm).props.disabled,false,'The recorded confirmed step enables collection');
 assert.ok(!text().includes(reason));
 await act(async()=>screen.unmount());
}
for(const [n,en,ru] of [[1,'test','ожидающий образец как взятый'],[2,'tests','ожидающих образца как взятые'],[5,'tests','ожидающих образцов как взятые']] as const){
 assert.ok(collection.collectionCopy('en').explanation(n).includes(`Record ${n} pending ${en} as collected by you now.`));
 assert.ok(collection.collectionCopy('hy').explanation(n).includes(`${n} սպասող հետազոտության նմուշ`));
 assert.ok(collection.collectionCopy('ru').explanation(n).includes(`Записать ${n} ${ru} вами сейчас.`));
 const items=Array.from({length:n},(_,i)=>({...seed().items[0]!,key:`sample:${i}`,mark:mark('issue')}));
 assert.ok(collection.collectionCopy('en').summary(items as never).includes(`${n} ${n===1?'issue':'issues'}, 0 pending`));
 const statuses=['collected','not-collected','issue'] as const;
 const all=[...statuses.flatMap(status=>items.map(item=>({...item,mark:mark(status)}))),...items.map(item=>({...item,mark:null}))];
 assert.equal(collection.collectionCopy('en').summary(all as never),`${n} of ${4*n} collected, ${n} not collected, ${n} ${n===1?'issue':'issues'}, ${n} pending`);
 assert.equal(collection.collectionCopy('hy').summary(all as never),`${4*n}-ից ${n}-ը վերցված է, ${n}-ը չի վերցվել, խնդիր՝ ${n}, սպասում է՝ ${n}`);
 assert.equal(collection.collectionCopy('ru').summary(all as never),`Взято ${n} из ${4*n}, не взято: ${n}, с проблемой: ${n}, в ожидании: ${n}`);
}
assert.match(collection.collectionCopy('en').summary([seed().items[0]!]),/0 of 1 collected, 0 not collected, 0 issues, 1 pending/);
await mount();assert.equal(calls.length,0,'Reading never collects');
assert.match(text(),/1 of 4 collected/);for(const label of ['Pending','Collected','Not collected','Issue'])assert.match(text(),new RegExp(label));
assert.match(text(),/Member asked to wait/);assert.match(text(),/Ani Example/);assert.match(text(),/Record 1 pending/);
await press('Confirm all collected');assert.equal(calls.length,1,'One explicit tap sends one collection command');assert.equal(calls[0]!.all,true);assert.equal(calls[0]!.expectedRevision,7);
assert.equal(calls[0]!.arrangementToken,seed().visit.arrangementToken,'Collection carries the arrangement shown on the card');
assert.ok(!('startsAt'in calls[0]!), 'Start time is no longer a collection freshness token');
await act(async()=>screen.unmount());
await mount();await press('Not collected');let field=screen.root.findByType('textarea');
assert.equal(field.props.maxLength,300);assert.equal(button('Save collection status').props.disabled,true);
await act(async()=>field.props.onChange({target:{value:'   '}}));assert.equal(button('Save collection status').props.disabled,true);
await act(async()=>field.props.onChange({target:{value:'Member declined'}}));mode='outcome-unknown';
await press('Save collection status');assert.match(text(),/could not be saved, your reasons are kept/);assert.equal(screen.root.findByType('textarea').props.value,'Member declined');
const first=calls.at(-1)!;mode='saved';await press('Check or retry');assert.equal(calls.at(-1)!.submissionId,first.submissionId,'Unknown outcomes retry the exact submission');
await act(async()=>screen.unmount());
mode='saved';await mount();await press('Mark collected');assert.equal(calls.at(-1)!.testId,'urine');assert.equal(calls.at(-1)!.status,'collected');assert.equal(calls.at(-1)!.reason,null,'A correction to collected removes the exception reason');await act(async()=>screen.unmount());
assert.equal(calls.at(-1)!.arrangementToken,seed().visit.arrangementToken,'Single-sample corrections carry the rendered arrangement too');
const legacy=seed();legacy.items[2]!.mark={...mark('not-collected'),note:'a'.repeat(343)};
await mount(legacy);assert.ok(text().includes('a'.repeat(343)),'The full legacy reason stays visible');await act(async()=>screen.unmount());
mode='stale';await mount();await press('Issue');field=screen.root.findByType('textarea');await act(async()=>field.props.onChange({target:{value:'Label needs checking'}}));await press('Save collection status');assert.match(text(),/Reload/);assert.equal(screen.root.findByType('textarea').props.value,'Label needs checking');const beforeReload=calls.at(-1)!;reloadedData=seed();reloadedData.visit.arrangementToken='bb110000-0000-4000-8000-000000000002';
await press('Reload collection');assert.equal(reloads,1);mode='saved';await press('Save collection status');
assert.equal(calls.at(-1)!.arrangementToken,reloadedData.visit.arrangementToken,'A command after reload uses the new token even at the same start time');
assert.notEqual(calls.at(-1)!.submissionId,beforeReload.submissionId,'Reload produces a fresh command');reloadedData=null;
await act(async()=>screen.unmount());mode='saved';
for(const [lang,title] of [['en','Sample collection'],['hy','Նմուշների վերցնում'],['ru','Взятие образцов']] as const){await mount(seed(),lang);assert.match(text(),new RegExp(title));assert.equal(screen.root.findAll(n=>n.props['data-sample-collection']!==undefined).length,1);assert.equal(screen.root.findAll(n=>n.props['data-sample-status']!==undefined).length,4);assert.doesNotMatch(text(),/undefined/);await act(async()=>screen.unmount());}
for(const cancelled of [false,true]){const data=seed();if(cancelled)data.visit.bookingStatus='cancelled';else data.completion={completedAt:'2026-11-01T10:00:00Z',nurseName:'Narine',reason:null,summary:data.counts,visitId:member};await mount(data);assert.equal(screen.root.findAllByType('button').length,0,'Terminal visit is read-only');await act(async()=>screen.unmount());}
console.log('Nurse collection card: statuses, summary, explicit one-tap confirm, reasons, corrections, read-only, locales, failure retention and stale reload passed (mounted, mocked transport).');

// The real runtime validates intent and correlates saved replies; only RPC IO is replaced.
const serverModules:Record<string,unknown>={...modules,'server-only':{},zod:await import('zod'),'./schema':schema,'@/lib/observability/logger':{log:{warn(){}}}};
function load(file:string,deps:Record<string,unknown>){const exports:Record<string,unknown>={};vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require:(name:string)=>{assert.ok(name in deps,name);return deps[name];}});return exports;}
const runtime=load('lib/nurse-visit/runtime.ts',serverModules) as typeof import('@/lib/nurse-visit/runtime');
const base={version:'nurse-visit-v1',memberId:member,source:'appointment',sourceId:member,submissionId:member,expectedRevision:7,arrangementToken:seed().visit.arrangementToken};
let rpcCalls=0,answer:unknown={status:'saved',submissionId:member,replayed:false};
const rpc={rpc:async(name:string,args?:Record<string,unknown>)=>{rpcCalls++;assert.equal(name,'nurse_visit_collect');assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_command:{...base,all:true}});return {data:answer,error:null};}};
for(const input of [{...base},{...base,all:true,testId:'cbc'}, {...base,testId:'cbc',status:'issue',reason:' '},{...base,testId:'cbc',status:'not-collected',reason:'x'.repeat(301)},{...base,testId:'cbc',status:'collected',reason:'unneeded'}])assert.equal((await runtime.sendNurseVisitCollect(rpc,input)).status,'invalid');
const withoutArrangement={version:base.version,memberId:member,source:base.source,sourceId:member,submissionId:member,expectedRevision:7};
for(const input of [{...withoutArrangement,all:true},{...base,arrangementToken:'',all:true},{...base,arrangementToken:1,all:true},{...base,startsAt:seed().visit.startsAt,all:true},{...withoutArrangement,testId:'cbc',status:'collected',reason:null}])assert.equal((await runtime.sendNurseVisitCollect(rpc,input)).status,'invalid','Collection requires a valid arrangement token');
assert.equal(rpcCalls,0);
assert.equal((await runtime.sendNurseVisitCollect(rpc,{...base,all:true})).status,'saved');
answer={status:'saved',submissionId:'bb110000-0000-4000-8000-000000000002',replayed:false};assert.equal((await runtime.sendNurseVisitCollect(rpc,{...base,all:true})).status,'outcome-unknown');
answer={status:'stale'};assert.equal((await runtime.sendNurseVisitCollect(rpc,{...base,all:true})).status,'stale');
assert.equal((await runtime.sendNurseVisitCollect({rpc:async()=>{throw Error('Transport unavailable');}},{...base,all:true})).status,'outcome-unknown');
// Doctor-visible exceptions stay outside the collapsed item list and include who and when.
const recordModules={...modules,'@/lib/nurse-visit/copy':visitCopy,'@/lib/locale':await import('@/lib/locale'),'@/components/patient-care/common':{CareSection:({title,children}:{title:string;children:React.ReactNode})=>React.createElement('section',null,React.createElement('h2',null,title),children)},'./nurse-visit-timeline':{NurseVisitTimeline:()=>null}};
const RecordPanel=load('components/staff/nurse-visit-record.tsx',recordModules).NurseVisitRecordPanel as typeof import('@/components/staff/nurse-visit-record').NurseVisitRecordPanel;
for(const lang of ['en','hy','ru'] as const){const data=seed();const html=renderToStaticMarkup(React.createElement(RecordPanel,{locale:lang,data:{version:'nurse-visit-v1',enabled:true,visits:[{visit:data.visit,steps:[],items:data.items,completion:null}]}}));const visible=html.slice(0,html.indexOf('<details>'));assert.ok(visible.includes('Member asked to wait'));assert.ok(visible.includes('Narine'));assert.ok(visible.includes(collection.collectionCopy(lang).statuses.issue));}
console.log('Nurse collection contracts: invalid commands never reach RPC, saved reply correlation, stale/transport states, and doctor-visible exception reasons with nurse/time passed.');

// The legacy card reload uses the same scoped runtime without requiring a chat feature flag.
let role='nurse',detail:unknown=seed(),reads=0;
const actions=load('lib/nurse-visit/actions.ts',{
 ...serverModules,'./runtime':runtime,
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 'next/cache':{revalidatePath(){}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{role},client:{rpc:async(name:string,args:unknown)=>{reads++;assert.equal(name,'nurse_visit_detail');assert.deepEqual(JSON.parse(JSON.stringify(args)),{p_member:member,p_source:'appointment',p_id:member});return {data:detail,error:null};}}})},
}) as typeof import('@/lib/nurse-visit/actions');
assert.equal(await actions.refreshNurseVisit('invalid','appointment',member),null);assert.equal(reads,0);
role='doctor';assert.equal(await actions.refreshNurseVisit(member,'appointment',member),null);assert.equal(reads,0);
role='nurse';assert.equal((await actions.refreshNurseVisit(member,'appointment',member))?.caseRevision,7);
for(const refused of [{version:'nurse-visit-v1',status:'access'},{version:'nurse-visit-v1',enabled:false},{...seed(),visit:{...seed().visit,id:'bb110000-0000-4000-8000-000000000002'}}]){detail=refused;assert.equal(await actions.refreshNurseVisit(member,'appointment',member),null);}
console.log('Legacy collection reload: invalid IDs, role and scoped visit identity enforced (real action/runtime, mocked auth/RPC).');
