import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import TestRenderer,{act} from 'react-test-renderer';
import type {WorkspaceDecisions} from '@/lib/doctor-decisions/read';
import {st} from '@/lib/staff/staff-locale-copy';
import * as kitThread from '@/components/patient/zoe-kit/thread';
import {stamp} from '@/components/patient-care/common';
import {memberRef} from '@/lib/staff-zoe/contracts';
import {AlertCardLines} from '@/components/staff/alert-card';
import {alertCardFields} from '@/lib/staff/alert-card';
import {formatMmol,formatPercent} from '@/lib/ldl/status';
import type {ItemCard} from '@/lib/doctor-decisions/items';
const require=createRequire(import.meta.url),exports:Record<string,unknown>={};
const id='11111111-1111-4111-8111-111111111111';
const itemCalls:unknown[]=[],replyCalls:unknown[]=[],composeCalls:unknown[]=[];
let status='saved',reloads=0,heldItem:Promise<{status:string}>|null=null;
const code=ts.transpileModule(readFileSync('components/staff/doctor-workspace/decisions.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new vm.Script(code).runInNewContext({exports,crypto,require(name:string){
 if(name==='next/navigation')return {useRouter:()=>({refresh:()=>reloads++})};
 if(name==='next/link')return {default:(p:React.AnchorHTMLAttributes<HTMLAnchorElement>)=>React.createElement('a',p)};
 if(name==='@/lib/staff/staff-locale-copy')return {st};
 if(name==='@/lib/staff-zoe/contracts')return {memberRef};
 if(name==='@/components/staff/alert-card')return {AlertCardLines};
 if(name==='@/components/patient-care/common')return {stamp};
 if(name==='@/lib/ldl/status')return {formatMmol,formatPercent};
 if(name==='@/components/patient/zoe-kit/thread')return kitThread;
 if(name==='./approval-cards')return {DoctorApprovalCards:()=>null};
 if(name==='@/lib/doctor-decisions/actions')return {pressDoctorItem:async(input:unknown)=>{itemCalls.push(input);return (input as {id:string}).id===id+'2'&&heldItem?heldItem:{status};}};
 if(name==='@/app/staff/real/conversation/actions')return {
  commandConversation:async(...input:unknown[])=>{replyCalls.push(input);return {ok:true,purpose:'reply.approve'};},
  composeConversationReply:async(input:unknown)=>{composeCalls.push(input);return {ok:true};},
 };
 return require(name);
}});
const Cards=exports.DoctorDecisionCards as React.ComponentType<{data:WorkspaceDecisions;locale:'en'|'hy'|'ru';single?:boolean;onReply?:()=>void}>;
const medicine={kind:'medicine' as const,id,memberId:id,revision:'a'.repeat(32),at:'2026-10-31T12:00:00Z',data:{kind:'side_effect' as const,ask:{id,source:'self' as const,medicineId:id,dueAt:'2026-10-31T08:00:00Z',trigger:'skipped' as const,state:'answered' as const,reason:'side_effect' as const,createdAt:'2026-10-31T12:00:00Z',answeredAt:'2026-10-31T12:00:00Z',medicine:{name:'Recorded medicine',dose:'Recorded dose'},careTeamAsked:true}}};
const reply={memberId:id,draftId:id,revision:4,body:'Exact <saved> reply\nSecond line',author:'staff' as const,summary:'Private summary',contentHash:'hash',intentId:'b'.repeat(32),requestId:'c'.repeat(32),takeover:true,modeRevision:'d'.repeat(32)};
const data:WorkspaceDecisions={items:[medicine],reply:{card:reply,prepare:null},approvals:null};
const alert:ItemCard={kind:'alert',id,memberId:id,revision:'a'.repeat(32),at:medicine.at,data:{id,memberId:id,memberName:'Fictional member',source:'lab',priority:'urgent',reason:'lab_result_critical',redFlags:[],state:'open',stateSeq:1,occurrences:1,createdAt:medicine.at,lastSeenAt:medicine.at,doctorName:null,acknowledgedAt:null,acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[]}};
for(const locale of ['en','hy','ru']as const){
 const alertHtml=renderToStaticMarkup(React.createElement(Cards,{data:{...data,items:[alert]},locale}));
 assert.ok(alertHtml.includes(alertCardFields(alert.data,locale).symptom),'The alert keeps its reason in each locale');
 assert.equal((alertHtml.match(/data-alert-field=/g)??[]).length,5);
 assert.doesNotMatch(alertHtml.replace(/<[^>]*>/g,''),/RF-\d|_|care_alert|NRN|zoe\.|rule/i);
 if(locale==='en')assert.equal((alertHtml.match(/Acknowledge this alert/g)??[]).length,1,'The acknowledgment action appears only on the button');
 for(const state of ['open','acknowledged'] as const){
  const html=renderToStaticMarkup(React.createElement(Cards,{data:{...data,items:[{...alert,data:{...alert.data,reason:'future_reason_code',state,occurrences:3,acknowledgedBy:state==='acknowledged'?'Doctor Example':null}}]},locale}));
  assert.equal((html.match(/data-alert-field=/g)??[]).length,5);
  assert.doesNotMatch(html.replace(/<[^>]*>/g,''),/future[ _]reason[ _]code/i);
  assert.ok(html.includes('3'));
  assert.equal(html.includes('Doctor Example'),state==='acknowledged');
 }
 const html=renderToStaticMarkup(React.createElement(Cards,{data,locale}));
 assert.ok(html.includes('Exact &lt;saved&gt; reply'),'Saved text is escaped, not executable');
 assert.ok(html.includes('Recorded medicine'));
 assert.ok(html.includes(stamp(medicine.at,locale)),'Decision timestamp uses the shared readable date and time');
 assert.ok(!html.includes('Private summary'),'Internal summary is not presented as member text');
 assert.ok(html.includes('data-decision="takeover"'));
 if(locale==='en'){assert.match(html,/takes over the conversation/);assert.match(html,/Your draft/);}
}
assert.equal(itemCalls.length+replyCalls.length+composeCalls.length,0,'Rendering or chat text cannot mutate anything');
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
let tree:TestRenderer.ReactTestRenderer;
await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data,locale:'en'}));});
let press=tree!.root.findAllByType('button').find(b=>String(b.props.children).includes('medicine concern'))!;
await act(async()=>{press.props.onClick();press.props.onClick();});
assert.equal(itemCalls.length,1,'A rapid double press sends one command');
assert.deepEqual(JSON.parse(JSON.stringify(itemCalls[0])),{kind:'medicine',id,memberId:id,revision:'a'.repeat(32)});
assert.ok(tree!.root.findAllByProps({role:'status'}).some(n=>n.children.includes('Saved.')));
press=tree!.root.findAllByType('button').find(b=>b.props.children==='Send this reply and take over')!;
await act(async()=>{press.props.onClick();press.props.onClick();});
assert.equal(replyCalls.length,1,'Reply/takeover double press queues one command');
assert.deepEqual(JSON.parse(JSON.stringify(replyCalls[0])),[{schema:1,purpose:'reply.approve',intentId:reply.intentId,requestId:reply.requestId},{memberId:id,modeRevision:reply.modeRevision}]);
await act(async()=>tree!.unmount());
// React entangles overlapping transitions: a settled save must not borrow a sibling's pending label.
let finishItem!:(r:{status:string})=>void;
heldItem=new Promise(resolve=>{finishItem=resolve;});
await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:{...data,items:[medicine,{...medicine,id:id+'2'}]},locale:'en'}));});
const itemSections=tree!.root.findAllByProps({'data-decision':'medicine'});
await act(async()=>{itemSections[0].findByType('button').props.onClick();itemSections[1].findByType('button').props.onClick();});
assert.ok(itemSections[0].findAllByProps({role:'status'}).some(n=>n.children.includes('Saved.')));
assert.notEqual(itemSections[0].findByType('button').children.join(''),'Saving…','A confirmed save clears its Saving label even while another save is pending');
assert.equal(itemSections[1].findByType('button').children.join(''),'Saving…','An unresolved save still has its pending label');
await act(async()=>finishItem({status:'saved'}));heldItem=null;
await act(async()=>tree!.unmount());
status='stale';
await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data,locale:'en'}));});
press=tree!.root.findAllByType('button').find(b=>String(b.props.children).includes('medicine concern'))!;
await act(async()=>press.props.onClick());
assert.ok(tree!.root.findAllByProps({role:'alert'}).some(n=>String(n.children).includes('This card has changed')));
assert.equal(tree!.root.findAllByType('button').find(b=>String(b.props.children).includes('medicine concern'))!.props.disabled,true);
await act(async()=>tree!.unmount());
const unavailable=renderToStaticMarkup(React.createElement(Cards,{data:{items:null,reply:null,approvals:null},locale:'en'}));
assert.match(unavailable,/Decision items could not be read/);assert.doesNotMatch(unavailable,/No item decision cards/);
const prepare={memberId:id,expectedVersion:1,expectedClinicalRevision:1,expectedDraftEpoch:0,expectedSource:'source'};
let opened=0;
await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data:{items:[],reply:{card:null,prepare},approvals:null},locale:'en',onReply:()=>{opened++;}}));});
assert.equal(tree!.root.findAllByType('textarea').length,0,'No duplicate reply editor');
await act(async()=>tree!.root.findAllByType('button').find(b=>b.props.children==='Open conversation and reply')!.props.onClick());
assert.equal(opened,1,'Reply opens the inline conversation');assert.equal(composeCalls.length,0,'Opening conversation creates no draft or message');
await act(async()=>tree!.unmount());
console.log('Doctor decision cards: locales, exact text, explicit press, double press, stale refusal, unavailable and single reply entry passed (controlled IO; no browser/DB)');

// Switching the single visible card cannot reset an action that is frozen after a stale result.
await act(async()=>{tree=TestRenderer.create(React.createElement(Cards,{data,locale:'en',single:true}));});
const positions=()=>tree!.root.findAll(n=>n.props['data-decision-position']!==undefined);
assert.equal(positions().filter(n=>!n.props.hidden).length,1);
press=positions()[0].findByType('button');
await act(async()=>press.props.onClick());
const move=(label:string)=>tree!.root.findAllByType('button').find(b=>b.props.children===label)!;
await act(async()=>move('Next item').props.onClick());
assert.equal(positions()[0].props.hidden,true);
assert.equal(positions()[1].props.hidden,false);
await act(async()=>move('Previous item').props.onClick());
assert.equal(positions()[0].findByType('button').props.disabled,true,'Browsing decisions preserves stale-action lock');
assert.equal(positions().filter(n=>!n.props.hidden).length,1);
await act(async()=>tree!.unmount());
console.log('Single decision navigation preserves frozen actions and shows one card at a time.');

const emptySingle=renderToStaticMarkup(React.createElement(Cards,{single:true,locale:'en',data:{items:[],approvals:{firstNote:null,regimen:null,consultation:null},reply:{card:null,prepare:null}}}));
assert.equal(emptySingle,'','No empty Zoe turn when no decisions are pending');
