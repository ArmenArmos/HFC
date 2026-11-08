import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import TestRenderer,{act} from 'react-test-renderer';
import {ConversationReview} from '@/components/conversation/review';
import {st} from '@/lib/staff/staff-locale-copy';
const require=createRequire(import.meta.url),exports:Record<string,unknown>={};
const id='11111111-1111-4111-8111-111111111111',doctor='22222222-2222-4222-8222-222222222222';
const initial={ok:true,conversationId:id,version:4,memberName:'Fictional member',unsavedOverLimit:false,unsupportedMedia:false,clinicalRevision:0,draftEpoch:1,sourceToken:'source',messages:[],replies:[],drafts:[{id,conversation_id:id,revision:1,state:'pending',context_version:4,clinical_revision:0,source_token:'source',created_at:'2026-10-31T04:01:00Z',revisions:[{draft_id:id,revision:1,body:'Check 135/85 mmHg.',summary:'Private factual summary',content_hash:'hash',author_id:doctor,author_kind:'staff',provenance:{kind:'staff'},created_at:'2026-10-31T04:01:00Z'}]}],deliveries:[]};
const data={kind:'ready',card:'conversation',conversationId:id,memberId:id,initial,mode:{ok:true,doctorMode:true,zoeActive:true,since:'2026-10-31T04:01:00Z',byName:'Fictional doctor',intakePaused:false,scope:'topic'},modeRevision:'a'.repeat(32),zoeReview:{conversationId:id,memberId:id,version:4,reviewed:false},replyDrafts:[],topicBreaks:[]};
const marks:unknown[][]=[],handbacks:unknown[][]=[],commands:unknown[][]=[];let refreshes=0;let reads=0,failRead=false,handbackKind='changed',markKind='saved';
const code=ts.transpileModule(readFileSync('components/staff/doctor-workspace/conversation-card.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new vm.Script(code).runInNewContext({exports,crypto,require(name:string){
 if(name==='@/lib/staff-zoe/card-actions')return {readDoctorCard:async()=>{reads++;if(failRead)return {kind:'unavailable'};return {...data,mode:{...data.mode,doctorMode:handbackKind!=='saved'},zoeReview:{...data.zoeReview,reviewed:true}};}};
 if(name==='@/lib/staff-zoe/everyday-actions')return {markDoctorCardReviewed:async(...args:unknown[])=>{marks.push(args);return {kind:markKind};},handBackDoctorCard:async(...args:unknown[])=>{handbacks.push(args);return {kind:handbackKind};}};
 if(name==='@/app/staff/real/conversation/actions')return {readZoeReplyDrafts:async()=>[],composeConversationReply:async()=>({ok:false,code:'stale_context'}),editConversationSummary:async()=>({ok:false,code:'stale_context'}),recoverConversationCommand:async()=>({status:'unknown'}),commandConversation:async(...args:unknown[])=>{commands.push(args);return {ok:false,code:'stale_context'};},conversationActions:async()=>({ok:true,view:{conversationId:id,conversationVersion:4,draft:{revision:1,body:'Check 135/85 mmHg.',summary:'Private factual summary',contentHash:'hash',author:'staff'},actions:[{purpose:'reply.approve',intentId:'b'.repeat(32)},{purpose:'reply.reject',intentId:'c'.repeat(32)}]}})};
 if(name==='@/components/conversation/review')return {ConversationReview};
 if(name==='@/lib/staff/staff-locale-copy')return {st};
 return require(name);
}});
const Card=exports.DoctorConversationCard as typeof import('@/components/staff/doctor-workspace/conversation-card').DoctorConversationCard;
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});let tree:TestRenderer.ReactTestRenderer;
const button=(label:string)=>tree!.root.findAllByType('button').find(b=>b.children.filter(c=>typeof c==='string').join('')===label)!;
await act(async()=>{tree=TestRenderer.create(<Card response={data as never} doctorId={doctor} doctorName="Fictional doctor" locale="en" onRefresh={()=>{refreshes++;}}/>);});
assert.equal(tree!.root.findAllByType('a').length,0,'Embedded conversation does not require record-page navigation');
await act(async()=>{const click=button('Mark reviewed').props.onClick;await Promise.all([click(),click()]);});assert.equal(marks.length,1);assert.deepEqual(JSON.parse(JSON.stringify(marks[0])),[{conversationId:id,action:'reviewed',version:4},doctor]);
assert.equal(refreshes,1,'A saved conversation review refreshes the decision cards');
await act(async()=>button('Reload conversation').props.onClick());assert.equal(refreshes,2,'Safe conversation refresh also updates decision context');assert.ok(button('Reopen for my reply'));assert.equal(button('Mark reviewed'),undefined);
await act(async()=>button('Hand back to Zoe').props.onClick());assert.equal(handbacks.length,0);
await act(async()=>{const click=button('Confirm hand-back').props.onClick;await Promise.all([click(),click()]);});assert.deepEqual(JSON.parse(JSON.stringify(handbacks)),[[{conversationId:id,version:4,modeRevision:'a'.repeat(32)},doctor]]);
await act(async()=>button('Reload conversation').props.onClick());
await act(async()=>button('Review exact reply').props.onClick());await act(async()=>button('Approve exact reply').props.onClick());assert.equal(commands.length,1);assert.deepEqual(JSON.parse(JSON.stringify(commands[0][1])),{memberId:id,modeRevision:'a'.repeat(32)},'Approval keeps the displayed takeover guard');
const reply=()=>tree!.root.findAllByType('textarea').find(x=>x.props.id==='conversation-reply')!;
await act(async()=>button('Reload conversation').props.onClick());
await act(async()=>reply().props.onChange({target:{value:'Unsaved correction 135/85'}}));failRead=true;
await act(async()=>button('Reload conversation').props.onClick());assert.equal(reply().props.value,'Unsaved correction 135/85','Failed safe refresh retains edits');
assert.ok(reads>0);await act(async()=>tree!.unmount());
// A newly read inactive state explains why hand-back is unavailable.
const inactive={...data,mode:{...data.mode,zoeActive:false}};
await act(async()=>{tree=TestRenderer.create(<Card response={inactive as never} doctorId={doctor} doctorName="Fictional doctor" locale="en"/>);});
assert.equal(button('Hand back to Zoe').props.disabled,true);
assert.ok(JSON.stringify(tree!.toJSON()).includes('Zoe is disabled or this member’s consent has been withdrawn. You are still answering.'));
assert.equal(button('Confirm hand-back'),undefined);
await act(async()=>tree!.unmount());
// Availability can change after the card read; the server refusal keeps the explanation.
handbackKind='zoe_inactive';
await act(async()=>{tree=TestRenderer.create(<Card response={data as never} doctorId={doctor} doctorName="Fictional doctor" locale="en"/>);});
await act(async()=>button('Hand back to Zoe').props.onClick());
await act(async()=>button('Confirm hand-back').props.onClick());
assert.ok(JSON.stringify(tree!.toJSON()).includes('Zoe is disabled or this member’s consent has been withdrawn. You are still answering.'));
assert.equal(button('Hand back to Zoe').props.disabled,true);
await act(async()=>tree!.unmount());
console.log('Actual embedded conversation: reviewed/reopen, exact guarded handback/approval, double press and failed-refresh text retention pass (controlled IO)');

for(const action of ['mark','handback']){
 markKind='off';handbackKind='off';
 await act(async()=>{tree=TestRenderer.create(<Card response={data as never} doctorId={doctor} doctorName="Fictional doctor" locale="en"/>);});
 if(action==='mark')await act(async()=>button('Mark reviewed').props.onClick());
 else {await act(async()=>button('Hand back to Zoe').props.onClick());await act(async()=>button('Confirm hand-back').props.onClick());}
 assert.ok(JSON.stringify(tree!.toJSON()).includes('feature is switched off'),'Disabled actions explain the feature gate');
 assert.ok(!JSON.stringify(tree!.toJSON()).includes('conversation changed or access'));
 await act(async()=>tree!.unmount());
}

handbackKind='saved';failRead=false;
await act(async()=>{tree=TestRenderer.create(<Card response={data as never} doctorId={doctor} doctorName="Fictional doctor" locale="en"/>);});
await act(async()=>button('Hand back to Zoe').props.onClick());
await act(async()=>button('Confirm hand-back').props.onClick());
assert.equal(button('Hand back to Zoe'),undefined,'Authoritative mode refresh removes the stale hand-back button');
assert.ok(JSON.stringify(tree!.toJSON()).includes('Zoe is answering this member'));
assert.ok(JSON.stringify(tree!.toJSON()).includes('delivery is not confirmed'));
await act(async()=>tree!.unmount());
