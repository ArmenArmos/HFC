import assert from 'node:assert/strict';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {ConversationReview,conversationThread,type ConversationReviewPorts} from '../components/conversation/review';
import type {StaffConversationWorkspace} from '../lib/conversation-persistence/contracts';
import type {ZoeReplyDraftView} from '../lib/zoe/reply-draft-contracts';
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id=(n:number)=>`c4400000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const data:StaffConversationWorkspace={ok:true,conversationId:id(1),version:1,memberName:'Synthetic member',unsavedOverLimit:false,unsupportedMedia:false,clinicalRevision:0,draftEpoch:1,sourceToken:'source',messages:[{seq:1,text:'Երկար փաստական հաղորդագրություն։ Synthetic member concern.',at:'2026-10-16T04:00:00Z',author:'member'}],replies:[],drafts:[{id:id(2),conversation_id:id(1),revision:1,state:'pending',context_version:1,clinical_revision:0,source_token:'source',created_at:'2026-10-16T04:01:00Z',revisions:[{draft_id:id(2),revision:1,body:'Exact reply',summary:'Private factual summary',content_hash:'hash',author_id:id(3),author_kind:'staff',provenance:{kind:'staff'},created_at:'2026-10-16T04:01:00Z'}]}],deliveries:[]};
const commands:unknown[]=[];let reads=0;let recoveries=0;let recovery:unknown={status:'unknown'};
const ports:ConversationReviewPorts={read:async()=>{reads++;return data;},actions:async()=>({ok:true,view:{conversationId:id(1),conversationVersion:1,draft:{revision:1,body:'Exact reply',summary:'Private factual summary',contentHash:'hash',author:'staff'},actions:[{purpose:'reply.approve',intentId:id(4).replaceAll('-','')},{purpose:'reply.edit',intentId:id(5).replaceAll('-','')}]}}),command:async c=>{commands.push(c);throw Error('lost acknowledgement');},compose:async()=>({ok:false,code:'stale_context'}),summary:async()=>({ok:false,code:'stale_context'}),recover:async()=>{recoveries++;return recovery;}};
const label=(node:{children:unknown[]})=>node.children.filter(x=>typeof x==='string').join('');
let tree!:ReactTestRenderer;
const button=(text:string)=>tree.root.findAllByType('button').find(node=>label(node).includes(text))!;
try{
 await act(async()=>{tree=create(React.createElement(ConversationReview,{memberId:id(10),doctorName:'Assigned doctor',initial:data,ports}));});
 assert.equal(commands.length,0,'Rendering never approves');assert.equal(button('Approve exact reply'),undefined);
 await act(async()=>{await button('Review exact reply').props.onClick();});
 assert.ok(button('Approve exact reply'));assert.equal(commands.length,0,'Preview never approves');
 await act(async()=>{await button('Approve exact reply').props.onClick();});
 assert.equal(commands.length,1);assert.equal((commands[0]as Record<string,unknown>).body,undefined,'Approval cannot supply replacement body');
 assert.ok(button('Check saved result'));assert.equal(button('Review exact reply').props.disabled,true);
 await act(async()=>{await button('Check saved result').props.onClick();});
 assert.equal(recoveries,1);assert.equal(reads,0,'Unknown receipt is not replaced by workspace inference');assert.equal(commands.length,1);
 assert.equal(button('Review exact reply').props.disabled,true,'Unknown command stays blocked');
 recovery={status:'not-recorded',requestId:(commands[0]as{requestId:string}).requestId,serialized:true};
 await act(async()=>{await button('Check saved result').props.onClick();});
 assert.ok(button('Continue with my entries'));assert.equal(commands.length,1);assert.equal(button('Review exact reply').props.disabled,true);
 await act(async()=>{await button('Continue with my entries').props.onClick();});assert.equal(reads,1);assert.equal(commands.length,1,'Explicit continuation never resubmits');
 await act(async()=>{await button('Review exact reply').props.onClick();});await act(async()=>{await button('Approve exact reply').props.onClick();});assert.equal(commands.length,2);
 recovery={status:'recorded',result:{ok:true,purpose:'reply.approve',draftId:id(2),revision:1,approvalId:id(6),deliveryId:id(7),replayed:false}};
 await act(async()=>{await button('Check saved result').props.onClick();});
 assert.equal(reads,2);assert.equal(commands.length,2,'Recovery never executes approval');
 console.log('PASS rendered component preview/explicit approval/lost response/unknown recovery; no browser or Auth claim');
}finally{if(tree)await act(async()=>tree.unmount());}

// Common reply flow: one text box, Review saves privately, then a separate exact approval.
const ready=structuredClone(data) as Extract<StaffConversationWorkspace,{drafts:unknown}>;
const inputCalls:Record<string,unknown>[]=[],fastCommands:Record<string,unknown>[]=[];
const fastPorts:ConversationReviewPorts={...ports,
 read:async()=>ready,
 compose:async raw=>{const input=raw as Record<string,unknown>;inputCalls.push(input);ready.drafts=[{...data.drafts[0],revisions:[{...data.drafts[0].revisions[0],body:String(input.body),summary:String(input.summary)}]}];return {ok:true,draftId:id(2),revision:1,replayed:false};},
 actions:async()=>({ok:true,view:{conversationId:id(1),conversationVersion:1,draft:{revision:ready.drafts[0].revision,body:ready.drafts[0].revisions.at(-1)!.body,summary:ready.drafts[0].revisions.at(-1)!.summary,contentHash:'hash',author:'staff'},actions:[{purpose:'reply.approve',intentId:id(4).replaceAll('-','')},{purpose:'reply.edit',intentId:id(5).replaceAll('-','')}]}}),
 command:async raw=>{const input=raw as Record<string,unknown>;fastCommands.push(input);if(input.purpose==='reply.edit'){ready.drafts[0].revision++;ready.drafts[0].revisions.push({...ready.drafts[0].revisions[0],revision:ready.drafts[0].revision,body:String(input.body)});}return {ok:true,purpose:input.purpose,draftId:id(2),revision:ready.drafts[0].revision,replayed:false};},
};
ready.drafts=[];
await act(async()=>{tree=create(React.createElement(ConversationReview,{memberId:id(10),doctorName:'Assigned doctor',initial:ready,ports:fastPorts}));});
const replyInput=()=>tree.root.findByProps({id:'conversation-reply'});
assert.equal(tree.root.findByProps({id:'conversation-summary'}).props.required,undefined,'Private summary does not block an ordinary reply');
await act(async()=>replyInput().props.onChange({target:{value:'Please bring your monitor to the visit.'}}));
await act(async()=>button('Review exact reply').props.onClick());
assert.equal(inputCalls.length,1);assert.equal(inputCalls[0].summary,'No private summary added.','Optional private summary records a transparent absence marker');
assert.equal(inputCalls[0].expectedVersion,1);assert.equal(inputCalls[0].expectedSource,'source');assert.equal(inputCalls[0].expectedClinicalRevision,0);
assert.equal(fastCommands.length,0,'Review saves privately without approval');
assert.ok(button('Approve exact reply'),'Saving and reviewing is one action');
await act(async()=>button('Approve exact reply').props.onClick());
assert.equal(fastCommands.length,1);assert.equal(fastCommands[0].purpose,'reply.approve');assert.equal(fastCommands[0].body,undefined,'Approval uses the issued exact intent');
await act(async()=>replyInput().props.onChange({target:{value:'Please bring your monitor and diary to the visit.'}}));
await act(async()=>button('Review exact reply').props.onClick());
assert.equal(fastCommands.length,2);assert.equal(fastCommands[1].purpose,'reply.edit');assert.ok(button('Approve exact reply'),'An edited saved draft opens the fresh exact preview in one action');
assert.equal(fastCommands.filter(c=>c.purpose==='reply.approve').length,1,'Editing never implicitly approves');
await act(async()=>tree.unmount());
// Yesayi, 1 Nov: a doctor's reply goes in at its time, so newer member messages come after it.
const reply=(n:number,at:string)=>({id:id(n),approval:{body:`Reply ${n}`,created_at:at,doctor_name:'Dr. Synthetic'}});
const said=(seq:number,at:string)=>({seq,text:`Message ${seq}`,at,author:'member'as const});
const order=conversationThread({messages:[said(1,'2026-11-01T10:00:00Z'),said(2,'2026-11-01T10:10:00Z'),said(3,'2026-11-01T10:20:00Z')],deliveries:[reply(8,'2026-11-01T10:05:00Z'),reply(9,'2026-11-01T10:15:00Z')]} as unknown as Parameters<typeof conversationThread>[0]);
assert.deepEqual(order.map(e=>e.kind==='reply'?e.body:e.message.text),['Message 1','Reply 8','Message 2','Reply 9','Message 3']);
console.log('PASS single-text reply, optional summary, save-and-preview, edit-and-preview, explicit exact intent approval (controlled IO)');

// The outer review must pass its language into the embedded source panel.
const source:ZoeReplyDraftView={runId:id(20),draftId:id(2),messageSeq:1,version:'fixture',planId:id(21),planPublishedAt:'2026-11-04T10:08:00Z',planCurrent:true,
 asked:'Verbatim member question',acknowledgement:'Recorded acknowledgement',acknowledgementId:'fixture',quoted:[{id:'fixture',kind:'instruction',text:'Verbatim published instruction'}],
 doctorDecides:[],outsidePlan:false,needsJudgement:false,judgementReasons:[],createdAt:'2026-11-04T10:08:00Z'};
for(const locale of ['en','hy','ru'] as const){
 await act(async()=>{tree=create(React.createElement(ConversationReview,{memberId:id(10),doctorName:'Assigned doctor',initial:data,ports,locale,replyDrafts:[source]}));});
 const html=JSON.stringify(tree.toJSON());
 assert.ok(html.includes({en:'How Zoe prepared this draft',hy:'Ինչպես է Zoe-ն պատրաստել այս սևագիրը',ru:'Как Zoe подготовила этот черновик'}[locale]));
 if(locale!=='en')assert.doesNotMatch(html,/How Zoe prepared this draft|What the member asked|Care instructions/);
 assert.ok(html.includes(source.asked));assert.ok(html.includes(source.quoted[0].text),'Source quotes stay verbatim');
 assert.ok(html.includes('14:08'));assert.doesNotMatch(html,/\b(?:AM|PM)\b/);
 await act(async()=>tree.unmount());
}
console.log('PASS mounted reply sources inherit en, hy and ru; authored text stays verbatim and source times use Yerevan 24-hour time.');
