import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import ts from 'typescript';
import * as taskCopy from '@/lib/staff/real-coordination/task-copy';
import type {CoordinationCommand,CoordinationTask,CoordinationSnapshot,CoordinationResult} from '@/lib/staff/real-coordination/schema';
import type {useNurseTask as Hook} from '@/components/nurse-chat-v2/use-nurse-task';
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const id='aa110000-0000-4000-8000-000000000001';
const task:CoordinationTask={id,caseId:id,memberName:'Fictional member',kind:'contact-followup',title:'Confirm time',instructions:'Check the time',dueAt:null,creatorId:id,ownerId:id,ownerName:'Fictional nurse',status:'open',revision:1,createdAt:'2026-11-02T00:00:00Z',updatedAt:'2026-11-02T00:00:00Z',needsReassignment:false,eligibleOwners:[{id,name:'Fictional doctor',role:'doctor'}]};
let result:CoordinationResult={ok:true,id,revision:2,status:'open'},fresh:CoordinationSnapshot={...task,events:[]},readFails=false;
const calls:CoordinationCommand[]=[];
const exports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('components/nurse-chat-v2/use-nurse-task.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,crypto,require:(name:string)=>name==='react'?React:name.endsWith('/task-copy')?taskCopy:{coordinationCommand:async(command:CoordinationCommand)=>{calls.push(command);return result;},refreshCoordinationTask:async()=>readFails?{ok:false,error:'Unavailable'}:{ok:true,task:fresh}}});
const useNurseTask=exports.useNurseTask as typeof Hook;
let api!:ReturnType<typeof useNurseTask>,draft='';
function Harness(){const current=useNurseTask(value=>{draft=value;});React.useLayoutEffect(()=>{api=current;});return null;}
let tree!:ReactTestRenderer;
async function mount(){calls.length=0;readFails=false;fresh={...task,events:[]};result={ok:true,id,revision:2,status:'open'};await act(async()=>{tree=create(React.createElement(Harness));});}
for(const [status,kind,expected] of [
 ['open','contact-followup',['contact','await-member','complete']],['awaiting-member','contact-followup',['contact','reopen','complete']],['awaiting-doctor','evidence-collection',['contact','reopen','complete']],['open','doctor-referral',['contact','refer']],['awaiting-doctor','doctor-referral',['contact']],['completed','contact-followup',[]],['cancelled','doctor-referral',[]],
] as const)assert.deepEqual(taskCopy.availableTaskOperations({...task,status,kind}),expected);
assert.deepEqual(taskCopy.availableTaskOperations({...task,eligibleOwners:[]}),[]);
assert.deepEqual(taskCopy.availableTaskOperations({...task,kind:'doctor-referral',eligibleOwners:[{id,name:'Fictional nurse',role:'nurse'}]}),[]);
assert.deepEqual(taskCopy.availableTaskOperations({...task,needsReassignment:true}),['contact','await-member','complete'],'TaskRow derives owner eligibility rather than trusting an inconsistent flag');
for(const operation of ['complete','contact','await-member','reopen','refer'] as const){
 await mount();const target={...task,status:operation==='reopen'?'awaiting-member' as const:'open' as const,kind:operation==='refer'?'doctor-referral' as const:task.kind};
 await act(async()=>{assert.equal(api.start(target,'turn',operation),true);});
 if(operation==='contact')await act(async()=>api.setOutcome('unreachable'));
 await act(async()=>api.send(taskCopy.taskNeedsNote(operation)?' Exact note ':''));
 assert.equal(calls.length,1);assert.equal(calls[0].operation,operation);
 assert.deepEqual(JSON.parse(JSON.stringify(calls[0].input)),operation==='contact'?{note:' Exact note ',outcome:'unreachable'}:taskCopy.taskNeedsNote(operation)?{note:' Exact note '}:{});
 assert.equal(api.active,false);await act(async()=>tree.unmount());
}
for(const operation of ['complete','contact','await-member','reopen','refer'] as const){
 await mount();const target={...task,status:operation==='reopen'?'awaiting-member' as const:'open' as const,kind:operation==='refer'?'doctor-referral' as const:task.kind};
 await act(async()=>{api.start(target,'replay',operation);});result={ok:false,uncertain:true,error:'Unknown'};
 await act(async()=>api.send(taskCopy.taskNeedsNote(operation)?' Same note ':''));const command=calls[0];
 assert.equal(api.frozen,true);fresh={...target,events:[]};result={ok:true,id,revision:2,status:'open'};
 await act(async()=>api.check());assert.equal(calls[1],command);assert.equal(api.active,false);await act(async()=>tree.unmount());
}
await mount();await act(async()=>{api.start(task,'unknown','contact');api.setOutcome('reached');});result={ok:false,uncertain:true,error:'Unknown'};
await act(async()=>api.send(' Keep exact '));const frozen=calls[0];assert.equal(api.frozen,true);
await act(async()=>{api.cancel();api.setOutcome('unreachable');});assert.equal(api.active,true);assert.equal(api.outcome,'reached');
readFails=true;await act(async()=>api.check());assert.equal(calls.length,1);assert.equal(api.frozen,true);
readFails=false;result={ok:true,id,revision:2,status:'open'};await act(async()=>api.check());assert.equal(calls[1],frozen);assert.equal(api.active,false);await act(async()=>tree.unmount());
for(const changed of [false,true]){
 await mount();await act(async()=>{api.start(task,'refused');});result={ok:false,error:'Assignment changed'};readFails=true;
 await act(async()=>api.send(' Preserve exact '));assert.equal(api.active,true);assert.equal(api.needsRefresh,true);assert.equal(draft,' Preserve exact ','A failed read keeps the words against the still-visible target');
 await act(async()=>api.send('blocked'));assert.equal(calls.length,1);
 fresh={...task,revision:4,title:changed?'Different task instructions':task.title,events:[]};readFails=false;
 await act(async()=>api.check());assert.equal(api.needsRefresh,false);assert.equal(draft,changed?'':' Preserve exact ');assert.equal(api.task?.revision,4);
 result={ok:true,id,revision:5,status:'completed'};await act(async()=>api.send('New accepted note'));assert.equal(calls[1].revision,4);assert.notEqual(calls[1].requestId,calls[0].requestId);await act(async()=>tree.unmount());
}
await mount();await act(async()=>{api.start(task,'terminal');});result={ok:false,error:'Assignment changed'};fresh={...task,status:'completed',events:[]};
await act(async()=>api.send('Do not reuse'));assert.equal(api.active,false);assert.equal(draft,'');await act(async()=>tree.unmount());
console.log('Nurse task actions: operation gates, exact payloads, frozen unknown replay, failed-read target retention, and refusal draft eligibility passed with controlled action IO.');

// The server filters before paging, so rows changed here must be filtered by the same rule.
const statuses=['open','awaiting-member','awaiting-doctor','completed','cancelled'];
for(const status of statuses){
 const row={status,needsReassignment:false},live=!['completed','cancelled'].includes(status);
 assert.equal(taskCopy.taskMatchesFilter(row,'active'),live,`active ${status}`);
 for(const filter of ['open','awaiting-member','awaiting-doctor','completed','cancelled'])assert.equal(taskCopy.taskMatchesFilter(row,filter),status===filter,`${filter} ${status}`);
 assert.equal(taskCopy.taskMatchesFilter({status,needsReassignment:true},'reassign'),live,`reassign ${status}`);
 assert.equal(taskCopy.taskMatchesFilter(row,'reassign'),false,`reassign without need ${status}`);
}
console.log('Nurse task filters: a task changed after paging leaves or enters a list as the server would decide, for every status.');
