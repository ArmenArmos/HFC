import assert from 'node:assert/strict';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {renderToStaticMarkup} from 'react-dom/server';
import {NurseChat} from '@/components/staff/nurse-chat';
import {NurseReplies} from '@/components/conversation/nurse-replies';
import {chatItems,threadSchema,answeredCount} from '@/lib/zoe/app-chat-contracts';
import type {NurseWorkspace,NurseReply} from '@/lib/nurse-chat/contracts';
(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id=(n:number)=>`ad110000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const initial:Extract<NurseWorkspace,{ok:true}>={ok:true,memberId:id(1),memberName:'Fictional member',doctorName:'Fictional doctor',version:1,canSend:true,items:[{id:'m1',text:'Fictional question',at:'2026-10-31T08:00:00Z',senderName:'Fictional member',senderRole:'member'}]};
const calls:NurseReply[]=[];let lost=true;let reads=0;
let readData:NurseWorkspace=initial;
const ports={read:async()=>{reads++;return readData;},send:async(input:NurseReply)=>{calls.push(structuredClone(input));if(lost)throw Error('Response lost after commit');return {ok:true,replyId:id(21),replayed:true};}};
const props={children:React.createElement('p',null,'Visit card sentinel'),memberId:id(1),nurseName:'Fictional nurse',initial,locale:'en' as const,ports};
let tree!:ReactTestRenderer;
const text=()=>JSON.stringify(tree.toJSON());
const button=(part:string)=>tree.root.findAllByType('button').find(n=>n.children.join('').includes(part))!;
try{
 await act(async()=>{tree=create(React.createElement(NurseChat,props));});
 assert.equal(calls.length,0,'Opening never sends');
 assert.ok(text().includes('Fictional question'));
 assert.ok(text().includes('Visit card sentinel'),'Visit cards render in the shared thread');
 assert.ok(text().includes('Fictional doctor'));
 await act(async()=>tree.root.findByType('textarea').props.onChange({target:{value:'  Exact nurse reply  '}}));
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.equal(calls.length,1);
 assert.equal(calls[0].body,'Exact nurse reply');
 assert.equal(tree.root.findByType('textarea').props.disabled,true,'Unknown result freezes editing');
 assert.ok(button('Check or retry'));
 await act(async()=>button('Reload conversation').props.onClick());
 assert.equal(calls.length,1,'Refresh cannot send');
 assert.equal(tree.root.findByType('textarea').props.disabled,true,'A read cannot resolve unknown commit');
 lost=false;
 await act(async()=>tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
 assert.deepEqual(calls[1],calls[0],'Retry retains exact request id, member context and text');
 assert.equal(tree.root.findByType('textarea').props.value,'');
 assert.ok(text().includes('saved in the member'));
 assert.equal(reads,2);
 readData={ok:false,code:'denied'};
 await act(async()=>button('Reload conversation').props.onClick());
 assert.equal(tree.root.findAllByType('textarea').length,0);
 assert.ok(text().includes('Access denied'));
 assert.equal(text().includes('Visit card sentinel'),false,'Access loss also removes the visit card');
 assert.equal(text().includes('Fictional question'),false,'Access loss removes thread from rendered output');
 await act(async()=>tree.unmount());
 for(const code of ['off','denied','unavailable'] as const){
  await act(async()=>{tree=create(React.createElement(NurseChat,{...props,initial:{ok:false,code}}));});
  assert.equal(tree.root.findAllByType('textarea').length,0);
  assert.ok(tree.root.findAll(n=>n.props.role==='alert').length);
  await act(async()=>tree.unmount());
 }
 await act(async()=>{tree=create(React.createElement(NurseChat,{...props,initial:{...initial,canSend:false,items:[]}}));});
 assert.equal(tree.root.findByType('textarea').props.disabled,true);
 assert.ok(text().includes('Reading only'));
 assert.ok(text().includes('No messages yet'));
 await act(async()=>tree.unmount());
 for(const warning of ['unsupportedMedia','unsavedOverLimit'] as const){
  await act(async()=>{tree=create(React.createElement(NurseChat,{...props,initial:{...initial,[warning]:true}}));});
  assert.ok(text().includes('Some member messages could not be read or saved'),'Nurse sees the incomplete-message warning for '+warning);
  await act(async()=>tree.unmount());
 }
 const nurse={id:id(21),text:'Nurse message visible to both',at:'2026-10-31T08:01:00Z',senderName:'Actual nurse',senderRole:'nurse' as const};
 const thread=threadSchema.parse({ok:true,version:1,ack:null,zoeReplies:false,settledSeq:1,messages:[{seq:1,text:'Member text',at:'2026-10-31T08:00:00Z',channel:'app',requestId:id(20)}],replies:[],nurseReplies:[nurse],answers:[]});
 assert.ok(thread.ok);
 if(thread.ok){
  assert.deepEqual(chatItems(thread).map(i=>i.kind),['member','nurse']);
  const item=chatItems(thread).at(-1);assert.ok(item?.kind==='nurse'&&item.senderName==='Actual nurse');
  assert.equal(answeredCount(thread),1);
 }
 const doctor=renderToStaticMarkup(React.createElement(NurseReplies,{replies:[nurse],locale:'en'}));
 assert.ok(doctor.includes('Actual nurse')&&doctor.includes('Nurse message visible to both'));
 console.log('Nurse chat rendered checks: unknown-result exact retry, read-only/empty/denied/off/unavailable, access loss, member attribution and doctor visibility passed (mocked ports, no browser/Auth/SQL).');
}finally{if(tree)await act(async()=>tree.unmount());}
