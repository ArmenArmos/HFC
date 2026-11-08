/** Actual React state and controls; DOM layout/auth/storage/model transport are controlled, not browser proof. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {act,create,type ReactTestRenderer,type ReactTestInstance} from 'react-test-renderer';
import {st} from '@/lib/staff/staff-locale-copy';
import * as patients from '@/lib/zoe/practice/patients';
import {patientCopy} from '@/components/zoe-practice/copy';
import {startPractice,runPracticeTurn,editPracticeRecord,type PracticeState,type PracticeEdit} from '@/lib/zoe/practice/engine';
import {createFakeProvider} from '@/lib/zoe/provider';
import {createFakeJudge} from '@/lib/zoe/reply-check';
(globalThis as {IS_REACT_ACT_ENVIRONMENT?:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const deps={provider:createFakeProvider(),judge:createFakeJudge(),env:{NOREON_ZOE_URGENT_PLACEHOLDER:'true'}};
let session:{id:string;version:number;state:PracticeState};
let failMark=false,loseSend=false,limited=false,sends=0;
const marks:unknown[]=[];
const actions={
 startPracticeSession:async({patientId}:{patientId:string})=>({ok:true,session:session={id:crypto.randomUUID(),version:0,state:startPractice(patientId)}}),
 sendPracticeMessage:async(i:{text:string;expectedVersion:number})=>{
  if(i.expectedVersion!==session.version)return {ok:false,code:'conflict',session};
  if(limited)return {ok:false,code:'daily_limit'};
  sends++;session={...session,version:session.version+1,state:await runPracticeTurn(session.state,i.text,deps)};
  if(loseSend){loseSend=false;return {ok:false,code:'unavailable'};}
  return {ok:true,session};
 },
 changePracticeRecord:async({edit}:{edit:PracticeEdit})=>({ok:true,session:session={...session,version:session.version+1,state:editPracticeRecord(session.state,edit)}}),
 resetPracticeSession:async()=>({ok:true,session:session={id:crypto.randomUUID(),version:0,state:startPractice(session.state.patientId)}}),
 markPracticeReply:async(i:unknown)=>{if(failMark){failMark=false;return {ok:false,code:'unavailable'};}marks.push(i);return {ok:true,mark:i};},
};
const out:Record<string,unknown>={};
const boundaries:Record<string,unknown>={react:React,'react/jsx-runtime':jsx,'lucide-react':{ArrowUp:()=>null},
 '@/lib/staff/staff-locale-copy':{st},'@/lib/brand':await import('@/lib/brand'),'@/lib/zoe/practice/patients':patients,'./copy':{patientCopy},
 '@/app/staff/real/zoe-practice/actions':actions,'@/components/patient/use-chat-viewport':{useChatViewport:()=>false},
 '@/components/chat-v2/use-thread-scroll':{useThreadScroll:()=>({threadRef:{current:null},contentRef:{current:null},unread:false,newest:()=>{}})},
};
const source=ts.transpileModule(readFileSync('components/zoe-practice/practice-room.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new vm.Script(source).runInNewContext({exports:out,document:{activeElement:null},require:(name:string)=>{assert.ok(name in boundaries,`Unexpected view dependency ${name}`);return boundaries[name];}});
let view:ReactTestRenderer;
await act(async()=>{view=create(React.createElement(out.PracticeRoom as React.ComponentType),{createNodeMock:()=>({style:{},scrollHeight:42,focus(){},showModal(){},close(){}})});});
const root=()=>view!.root;
const content=(node:ReactTestInstance|string):string=>typeof node==='string'?node:node.children.map(content).join('');
const button=(name:string)=>root().findAllByType('button').find(n=>content(n)===name||n.props['aria-label']===name)!;
const click=async(name:string)=>{const b=button(name);assert.ok(b,`Button ${name} exists`);await act(async()=>{b.props.onClick();});};
const composer=()=>root().findAllByType('textarea').find(n=>n.props['aria-label']==='Your message')!;
const send=async(text:string)=>{await act(async()=>composer().props.onChange({target:{value:text}}));await act(async()=>root().findAllByType('form').find(n=>n.props.className==='cv2-composer')!.props.onSubmit({preventDefault(){}}));};
await act(async()=>root().findAllByType('button').find(n=>content(n).startsWith('Alex (fictional)'))!.props.onClick());
await send('Can we discuss my cholesterol?');
assert.equal(root().findAll(n=>n.props['data-practice-reply']!==undefined).length,1);
await click('What Zoe saw');await click('Change the record');
const ldl=root().findByType('input');await act(async()=>ldl.props.onChange({target:{value:'3,7',setCustomValidity(){}}}));
await act(async()=>root().findAllByType('form').find(n=>n.props.className==='zp-form')!.props.onSubmit({preventDefault(){}}));
assert.equal(session!.state.record.memberRecord.ldl!.latest!.mmol,3.7);
await click('Good');assert.match(JSON.stringify(view!.toJSON()),/Saved: good/);
await click('Wrong');
const correction=root().findAllByType('textarea').find(n=>n.props.required)!;
await act(async()=>correction.props.onChange({target:{value:'Use the recorded LDL result.'}}));
failMark=true;await act(async()=>root().findAllByType('form').find(n=>n.props.className==='zp-form')!.props.onSubmit({preventDefault(){}}));
assert.ok(button('Retry save'));assert.match(JSON.stringify(view!.toJSON()),/Use the recorded LDL result/);
await act(async()=>root().findAllByType('form').find(n=>n.props.className==='zp-form')!.props.onSubmit({preventDefault(){}}));
assert.match(JSON.stringify(view!.toJSON()),/Saved: wrong/);assert.equal(marks.length,2);
loseSend=true;await send('How does this change my next test?');assert.equal(composer().props.value,'How does this change my next test?');
await send('How does this change my next test?');assert.equal(composer().props.value,'');assert.equal(sends,2);
await send('Can we discuss the medicine next?');assert.equal(sends,3);
limited=true;await send('One more question');assert.match(JSON.stringify(view!.toJSON()),/daily practice limit/);assert.equal(sends,3);
assert.equal(root().findAllByType('a').length,0);
// A failed correction stays with its own session: after a reset the same turn id must not offer or send it.
limited=false;await send('Please check this reply.');
const lastReply=()=>root().findAll(n=>n.props['data-practice-reply']!==undefined).at(-1)!;
const inReply=(name:string)=>lastReply().findAllByType('button').find(n=>content(n)===name)!;
await act(async()=>inReply('Wrong').props.onClick());
await act(async()=>root().findAllByType('textarea').find(n=>n.props.required)!.props.onChange({target:{value:'A correction for the first session.'}}));
failMark=true;await act(async()=>root().findAllByType('form').find(n=>n.props.className==='zp-form')!.props.onSubmit({preventDefault(){}}));
assert.ok(button('Retry save'),'Failed correction offers a retry in its session');
await click('Close');assert.ok(button('Retry save'));
await click('Reset conversation');await click('Reset to the start');assert.equal(session!.state.turns.length,0);assert.equal(session!.state.record.memberRecord.ldl!.latest!.mmol,1.7);
assert.equal(Boolean(button('Retry save')),false,'Reset drops the failed correction');
await send('A different question after the reset.');
assert.equal(Boolean(button('Retry save')),false,'New reply with the same turn id offers no old retry');
await act(async()=>inReply('Wrong').props.onClick());
assert.equal(root().findAllByType('textarea').find(n=>n.props.required)!.props.value,'','Old correction text does not follow');
const before=marks.length;assert.equal(Boolean(button('Retry save')),false);assert.equal(marks.length,before,'Nothing submitted to the new session');
await click('Close');
await act(async()=>view!.unmount());
console.log('Practice React view: choose, edit, good/wrong, failed save retry, lost-response recovery, limit, reset and no links passed (controlled IO, no rendered layout).');
