import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import ts from 'typescript';
import {z} from 'zod';
import * as locale from '@/lib/staff/staff-locale-copy';
import * as time from '@/lib/staff/yerevan-time';
import * as runtime from '@/lib/nurse-visit/runtime';
import * as schema from '@/lib/nurse-visit/schema';
import * as evidenceRuntime from '@/lib/staff/visit-evidence-runtime';
import * as list from '@/components/staff/nurse-chat-visit-list';
let enabled=true,role='nurse',authCalls=0;const calls:string[]=[];
const id=(n:number)=>`aa110000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const summary={samplesPlanned:0,samplesTaken:0,bpTaken:false,deviceDone:null,openItems:[]};
const ready:schema.NurseVisitReady={version:'nurse-visit-v1',enabled:true,today:'2026-11-01',checklistVersion:'protocol-draft-1',caseRevision:0,visit:{source:'appointment',id:id(1),memberId:id(2),memberName:'Fictional member',arrangementToken:id(3),startsAt:'2026-11-01T08:00:00Z',endsAt:null,mode:'clinic',location:null,bookingStatus:'confirmed',completion:null},steps:[],items:[],counts:summary,completion:null};
let detail:unknown=ready,evidence:unknown={version:'visit-evidence-v1',memberId:id(2),revision:0,bookingContext:null,collectionAvailability:'unavailable',visits:[]};
const rpc={async rpc(name:string,args?:Record<string,unknown>){if(name==='nurse_visit_detail')assert.equal(args?.p_member,id(2),'Thread member cannot be overridden by query parameters');calls.push(name);return {error:null,data:name==='nurse_visit_detail'?detail:name==='nurse_visit_list'?{version:'nurse-visit-v1',enabled:true,today:'2026-11-01',role:'nurse',visits:[]}:evidence};}};
const actions={recordNurseVisitMark:async()=>{},recordNurseVisitStep:async()=>{},recordNurseVisitComplete:async()=>{}};
const evidenceActions={recordRealVisitEvidence:async()=>{},refreshRealVisitEvidence:async()=>{}};
const Widget=()=>null, Evidence=()=>null;
const Link=()=>null;
const modules:Record<string,unknown>={'react/jsx-runtime':jsx,'next/link':{default:Link},'next/navigation':{unstable_rethrow:()=>{}},'zod':{z},'@/lib/staff/real-staff-render':{requireRealStaffForRender:async()=>{authCalls++;return {client:rpc,identity:{role},actorScope:'fixture'};}},'@/lib/staff/staff-locale-copy':locale,'@/lib/staff/yerevan-time':time,'@/lib/nurse-chat/config':{nurseChatEnabled:()=>enabled},'@/lib/nurse-visit/runtime':runtime,'@/lib/nurse-visit/schema':schema,'@/lib/nurse-visit/actions':actions,'@/lib/staff/visit-evidence-runtime':evidenceRuntime,'@/lib/staff/visit-evidence-actions':evidenceActions,'./nurse-visit-actions':{NurseVisitActions:Widget},'./real-visit-evidence':{RealVisitEvidence:Evidence},'./nurse-chat-visit-list':list};
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('components/staff/nurse-chat-visits.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,crypto,URLSearchParams,require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
const {NurseChatVisits}=exports as typeof import('../components/staff/nurse-chat-visits');
const input={memberId:id(2),selection:{source:'appointment',visit:id(1)},locale:'en' as const};
function find(node:React.ReactNode,type:unknown):React.ReactElement<Record<string,unknown>>|undefined{
 if(!React.isValidElement(node))return;
 if(node.type===type)return node as React.ReactElement<Record<string,unknown>>;
 return React.Children.toArray((node.props as {children?:React.ReactNode}).children).map(child=>find(child,type)).find(Boolean);
}
enabled=false;assert.equal(await NurseChatVisits(input),null);assert.equal(authCalls,0);assert.deepEqual(calls,[]);
enabled=true;role='doctor';assert.equal(await NurseChatVisits(input),null);assert.deepEqual(calls,[]);role='nurse';
const tree=await NurseChatVisits(input),widget=find(tree,Widget);assert.ok(widget);assert.equal(widget.props.inline,true);assert.equal(widget.props.mark,actions.recordNurseVisitMark);assert.equal(widget.props.complete,actions.recordNurseVisitComplete);assert.equal(widget.props.step,actions.recordNurseVisitStep);
assert.deepEqual(calls.splice(0),['nurse_visit_detail']);
const overridden=await NurseChatVisits({...input,selection:{...input.selection,memberId:id(9)} as typeof input.selection});assert.ok(find(overridden,Widget),'Unexpected query parameters cannot replace the thread member');calls.splice(0);
await NurseChatVisits({...input,selection:{source:'appointment',visit:'bad'}});assert.deepEqual(calls,[],'Invalid IDs never reach RPC');
for(const state of [{version:'nurse-visit-v1',status:'access'},{version:'nurse-visit-v1',status:'unavailable'},{...ready,visit:{...ready.visit,memberId:id(9)}},null]){
 detail=state;const result=await NurseChatVisits({...input,selection:{...input.selection,evidence:'true'}});
 assert.ok(!find(result,Widget)&&!find(result,Evidence),'Refused, cancelled or mismatched visit exposes no write UI');assert.deepEqual(calls.splice(0),['nurse_visit_detail'],'No evidence read before visit access');
}
evidence={version:'visit-evidence-v1',memberId:id(2),revision:0,bookingContext:null,collectionAvailability:'unavailable',visits:[{id:id(20),createdAt:'2026-11-01T09:00:00Z',bookingContext:null,entries:[]},{id:id(21),createdAt:'2026-11-01T09:00:00Z',bookingContext:null,entries:[]}]};
detail={...ready,completion:{completedAt:'2026-11-01T09:00:00Z',nurseName:'Fictional nurse',reason:null,summary,visitId:id(20)}};
const completed=await NurseChatVisits({...input,selection:{...input.selection,evidence:'true'}});const evidenceWidget=find(completed,Evidence);assert.ok(evidenceWidget);assert.equal(evidenceWidget.props.canRecord,false,'Completed evidence is read-only');assert.equal(evidenceWidget.props.visitId,id(20));assert.equal((evidenceWidget.props.data as {visits:unknown[]}).visits.length,1,'Selected history excludes unrelated member visits');
detail=ready;calls.splice(0);const beforeCompletion=await NurseChatVisits({...input,selection:{...input.selection,evidence:'true'}});assert.ok(!find(beforeCompletion,Evidence),'Selected incomplete visit never opens member-global evidence writer');assert.deepEqual(calls,['nurse_visit_detail']);
const memberRecord=await NurseChatVisits({memberId:id(2),selection:{memberEvidence:'true'},locale:'en'});assert.equal(find(memberRecord,Evidence)?.props.canRecord,true,'Authorized generic writer is a separate member-record card');assert.ok(!find(memberRecord,Widget));
detail=ready;evidence=null;const unavailable=await NurseChatVisits({...input,selection:{...input.selection,evidence:'true'}});assert.ok(!find(unavailable,Evidence));
calls.splice(0);await NurseChatVisits({locale:'en'});assert.deepEqual(calls,['nurse_visit_list']);
console.log('Chat visit server card: dark gate, role gate, input validation, scoped detail before evidence, cancelled/access/malformed/mismatched reads, existing action wiring and completed evidence lock passed (real adapters, mocked RPC/auth).');

assert.equal(find(tree,Link)?.props.href,`/staff/real/nurse-chat?member=${id(2)}&view=visits`,'Visit detail returns to the selected member visit list');
assert.equal(find(memberRecord,Link)?.props.href,`/staff/real/nurse-chat?member=${id(2)}&view=visits`,'Member evidence returns to the selected member visit list');
const badVisit=await NurseChatVisits({...input,selection:{source:'appointment',visit:'bad'}});
assert.equal(find(badVisit,Link)?.props.href,'/staff/real/nurse-chat?view=visits','Unavailable visit recovery opens the visit list');

// The pre-visit limitation must be read before any visit actions, including completion.
const ordered:unknown[]=[];
function visitOrder(value:unknown){
 if(Array.isArray(value)){value.forEach(visitOrder);return;}
 if(!React.isValidElement<{children?:unknown}>(value))return;
 ordered.push(value.type);visitOrder(value.props.children);
}
visitOrder(tree);
assert.ok(ordered.indexOf('aside')>=0&&ordered.indexOf('aside')<ordered.indexOf(Widget),'Care-team safety check precedes the actionable visit widget');

// The standalone route serves the same collection-capable widget as the member Visit tab.
const pageExports:Record<string,unknown>={};
const pageModules={...modules,
 'next/navigation':{unstable_rethrow:()=>{},notFound:()=>{throw Error('not-found');}},
 '@/lib/staff/staff-locale':{staffLocale:async()=>'en'},
 '@/components/staff/nurse-visit-actions':{NurseVisitActions:Widget},
};
vm.runInNewContext(ts.transpileModule(readFileSync('app/staff/real/(review)/visits/[memberId]/[source]/[id]/page.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports:pageExports,crypto,require:(name:string)=>{assert.ok(name in pageModules,name);return pageModules[name as keyof typeof pageModules];}});
const VisitPage=pageExports.default as typeof import('../app/staff/real/(review)/visits/[memberId]/[source]/[id]/page').default;
detail=ready;role='nurse';
const standalone=await VisitPage({params:Promise.resolve({memberId:id(2),source:'appointment',id:id(1)})});
const standaloneWidget=find(standalone,Widget);assert.ok(standaloneWidget);
assert.equal((standaloneWidget.props.data as schema.NurseVisitReady).visit.id,id(1));
assert.equal(standaloneWidget.props.mark,actions.recordNurseVisitMark);
assert.equal(standaloneWidget.props.step,actions.recordNurseVisitStep);
assert.equal(standaloneWidget.props.inline,undefined);
console.log('Standalone visit route renders the same collection widget and existing non-sample actions (real route/runtime, mocked auth/RPC).');
