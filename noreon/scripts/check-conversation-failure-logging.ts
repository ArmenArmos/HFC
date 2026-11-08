import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {ConversationReview} from '@/components/conversation/review';
import {readReplyCard} from '@/lib/doctor-decisions/replies';
import {ConversationRepository} from '@/lib/conversation-persistence/repository';
import * as contracts from '@/lib/conversation-persistence/contracts';
import * as logging from '@/lib/observability/with-logging';
import {createLogger,log} from '@/lib/observability/logger';
import {noteActor,noteMember} from '@/lib/observability/context';

(globalThis as unknown as {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const id=(n:number)=>`d5600000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const privateBody='Private member reply with confidential details';
const privateName='Private Member Name';
const at='2026-11-05T09:00:00Z';
const initial={ok:true as const,conversationId:id(1),version:1,memberName:privateName,unsavedOverLimit:false,unsupportedMedia:false,clinicalRevision:0,draftEpoch:1,sourceToken:'source',messages:[],replies:[],drafts:[],deliveries:[]};
const draft={id:id(2),conversation_id:id(1),revision:1,state:'pending' as const,context_version:1,clinical_revision:0,source_token:'source',created_at:at,revisions:[{draft_id:id(2),revision:1,body:privateBody,summary:'Private summary',content_hash:'hash',author_id:id(3),author_kind:'staff' as const,provenance:{kind:'staff'},created_at:at}]};
const view={ok:true,view:{conversationId:id(1),conversationVersion:1,draft:{revision:1,body:privateBody,summary:'Private summary',contentHash:'hash',author:'staff'},actions:[{purpose:'reply.approve',intentId:'a'.repeat(32)}]}};
let operation='compose',failure='approval_access';
const repo=new ConversationRepository({rpc:async name=>{
 if(name==='conversation_actions'&&operation!=='prepare')return {data:view,error:null};
 if(failure==='approval_access')return {data:null,error:{code:'42501',message:`${privateName}: ${privateBody}`}};
 if(failure==='prepare_failed'||failure==='unknown')throw Error(`${privateName}: ${privateBody}`);
 return {data:{ok:false,code:failure},error:null};
}});
// Load the production server actions. Only authorization, persistence IO and Next effects
// are controlled; the repository, returned-failure classification and log redactor are real.
const modules:Record<string,unknown>={
 '@/lib/observability/with-logging':logging,
 'next/server':{after:()=>{}},'next/navigation':{redirect:()=>{throw Error('Unexpected redirect');}},'next/cache':{revalidatePath:()=>{}},
 '@/lib/conversation-persistence/contracts':contracts,
 '@/lib/conversation-persistence/server':{assignedDoctorConversation:async()=>{noteActor('staff',id(3));noteMember(id(10));return repo;}},
 '@/lib/telegram-runtime/server':{runConfiguredTelegramSweep:async()=>{}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{throw Error('Unexpected staff read');}},
};
const actions:Record<string,(...args:unknown[])=>Promise<unknown>>={};
vm.runInNewContext(ts.transpileModule(readFileSync('app/staff/real/conversation/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actions,require:(name:string)=>{assert.ok(name in modules,`Unexpected module ${name}`);return modules[name];}});
const lines:Record<string,unknown>[]=[];
const capture=createLogger({env:{NOREON_LOG_CONSOLE:'on'},console:{log:l=>lines.push(JSON.parse(l)),warn:l=>lines.push(JSON.parse(l)),error:l=>lines.push(JSON.parse(l))}});
const original={info:log.info,warn:log.warn,error:log.error};
Object.assign(log,{info:capture.info,warn:capture.warn,error:capture.error});
let tree:ReactTestRenderer|undefined;
try{
 for(const scenario of [
  {op:'compose',code:'approval_access',action:'composeConversationReply'},
  {op:'compose',code:'stale_context',action:'composeConversationReply'},
  {op:'prepare',code:'prepare_failed',action:'conversationActions'},
  {op:'approval',code:'approval_access',action:'commandConversation'},
  {op:'approval',code:'route_unavailable',action:'commandConversation'},
  {op:'approval',code:'unknown',action:'commandConversation'},
  {op:'compose',code:'private_code_that_must_not_be_logged',action:'composeConversationReply'},
 ]){
  operation=scenario.op;failure=scenario.code;lines.length=0;
  await act(async()=>{tree=create(React.createElement(ConversationReview,{memberId:id(10),doctorName:'Doctor',initial:{...initial,drafts:operation==='compose'?[]:[draft]},ports:{read:async()=>initial,actions:()=>actions.conversationActions(id(10)),compose:raw=>actions.composeConversationReply(raw),command:raw=>actions.commandConversation(raw),summary:async()=>null,recover:async()=>({status:'unknown'})}}));});
  const button=(text:string)=>tree!.root.findAllByType('button').find(b=>b.children.join('').includes(text))!;
  if(operation==='compose')await act(async()=>tree!.root.findByProps({id:'conversation-reply'}).props.onChange({target:{value:privateBody}}));
  await act(async()=>{await button('Review exact reply').props.onClick();});
  if(operation==='approval')await act(async()=>{await button('Approve exact reply').props.onClick();});
  assert.equal(tree!.root.findByProps({id:'conversation-reply'}).props.value,privateBody,'Every failure retains the reply');
  const entries=lines.filter(l=>l.action===scenario.action);
  assert.equal(entries.length,1,'One completion line per failed action');
  const uncertain=scenario.code==='unknown';
  assert.equal(entries[0].error_code,uncertain?'approval_failed':scenario.code.startsWith('private_')?'compose_failed':scenario.code);
  assert.equal(entries[0].outcome,uncertain||scenario.op==='prepare'?'error':'denied');
  assert.equal(entries[0].status,uncertain||scenario.op==='prepare'?500:409);
  assert.equal(entries[0].actor_id,id(3));assert.equal(entries[0].member_id,id(10));
  assert.ok(!JSON.stringify(lines).includes(privateBody)&&!JSON.stringify(lines).includes(privateName));
  assert.ok(!JSON.stringify(lines).includes('private_code_that_must_not_be_logged'));
  if(operation!=='prepare')assert.equal(!!button('Check saved result'),uncertain,'Only uncertain completion offers receipt recovery');
  await act(async()=>tree!.unmount());tree=undefined;
 }
 // The thrown error is also safe if Next logs it after the action wrapper rethrows.
 failure='unknown';
 await assert.rejects(()=>repo.command({schema:1,purpose:'reply.approve',intentId:'a'.repeat(32),requestId:'b'.repeat(32)}),error=>error instanceof Error&&error.message==='Conversation unavailable');
 // The chat's atomic preparation read catches IO failures before any compose action.
 for(const code of ['approval_access','prepare_failed','stale_context']){
  lines.length=0;
  const client={rpc:async()=>{
   if(code==='prepare_failed')throw Error(`${privateName}: ${privateBody}`);
   if(code==='approval_access')return {data:null,error:{code:'42501',message:privateBody}};
   return {data:{workspace:initial,actions:{ok:false,code},mode:{ok:true,doctorMode:true,zoeActive:true,since:null,byName:null,intakePaused:false},modeRevision:'a'.repeat(32)},error:null};
  }};
  if(code==='stale_context')await readReplyCard(client,id(10));
  else await assert.rejects(()=>readReplyCard(client,id(10)),/Decision reply unavailable/);
  assert.equal(lines.length,1);assert.equal(lines[0].error_code,code);assert.equal(lines[0].member_id,id(10));
  assert.ok(!JSON.stringify(lines).includes(privateBody)&&!JSON.stringify(lines).includes(privateName));
 }
}finally{
 Object.assign(log,original);
 if(tree)await act(async()=>tree!.unmount());
}
console.log('PASS actual prepare/compose/approval action failures: fixed safe codes, one server line, ids only, retained reply and uncertain completion recovery (controlled IO).');
