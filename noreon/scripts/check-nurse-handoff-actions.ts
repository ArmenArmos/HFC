import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import * as handoffs from '@/lib/nurse-chat/handoffs';
import * as taskSchema from '@/lib/staff/real-coordination/schema';
let enabled=false,role='nurse',authCalls=0;
const calls:{name:string;args:unknown}[]=[];
let response:unknown={ok:true,taskId:'ad130000-0000-4000-8000-000000000009',replayed:false};
const client={rpc:async(name:string,args:unknown)=>{calls.push({name,args});return {data:response,error:null};}};
const dependencies:Record<string,unknown>={
 'zod':{z},'next/navigation':{unstable_rethrow:()=>{}},'@/lib/staff/member-identity-command':{runStaffMemberIdentities:async()=>[]},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},'@/lib/observability/logger':{log:{warn:()=>{},info:()=>{},error:()=>{}}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{authCalls++;return {identity:{role},client};}},
 './config':{nurseChatEnabled:()=>enabled},'./handoffs':handoffs,
 './handoff-read':{readHandoffs:async()=>({items:[],hasMore:false})},
 './sent-handoffs-read':{readSentHandoffs:async()=>({items:[],hasMore:false})},
 '@/lib/staff/real-coordination/schema':taskSchema,
 '@/lib/care-alerts/nurse':{readNurseAlerts:async()=>({kind:'off'})},
 '@/lib/nurse-visit/runtime':{readNurseVisits:async()=>({version:'nurse-visit-v1',enabled:false,visits:[]})},
};
function load(path:string){
 const exports:Record<string,unknown>={};
 new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports,Date,Error,require:(name:string)=>{assert.ok(name in dependencies,`Unexpected dependency ${name}`);return dependencies[name];}});
 return exports;
}
const actions=load('lib/nurse-chat/handoff-actions.ts') as typeof import('@/lib/nurse-chat/handoff-actions');
const today=load('lib/nurse-chat/today-actions.ts') as typeof import('@/lib/nurse-chat/today-actions');
const id=(n:number)=>`ad130000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const command={memberId:id(1),requestId:id(2),messageId:'m1',expectedVersion:1,topic:'member-request',observation:' Exact note '};
assert.equal((await actions.escalateNurseMessage(command)).ok,false);
assert.equal(await actions.readNurseHandoffs(id(1)),null);
assert.equal((await today.readNurseToday()).ok,false);
assert.equal(authCalls,0,'Disabled actions read no identity or data');
enabled=true;
for(const otherRole of ['doctor','admin','clinic']){
 role=otherRole;
 assert.equal((await actions.escalateNurseMessage(command)).ok,false);
 assert.equal(await actions.readNurseHandoffs(id(1)),null);
 assert.equal((await today.readNurseToday()).ok,false);
}
assert.equal(calls.length,0,'Wrong roles never dispatch RPC');
role='nurse';
assert.equal((await actions.escalateNurseMessage({...command,ownerId:id(4)})).ok,false,'Caller cannot choose doctor');
assert.equal(calls.length,0);
assert.equal((await actions.escalateNurseMessage(command)).ok,true);
assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{name:'conversation_nurse_handoff',args:{p_member:id(1),p_request_id:id(2),p_expected_version:1,p_message_id:'m1',p_topic:'member-request',p_observation:'Exact note'}});
response={tasks:[],nextCursor:null};
const result=await today.readNurseToday();assert.ok(result.ok&&result.page&&result.visits&&!result.visits.enabled);
const cursor={createdAt:'2026-10-30T08:00:00Z',id:id(4)};
await today.readNurseToday(cursor);
assert.equal((calls.at(-1)!.args as Record<string,unknown>).p_after_id,cursor.id,'Today paging uses the existing task cursor');
console.log('Nurse handoff/Today actions: environment and role gates, normalized exact source, recipient spoof rejection, existing paging and visit-off state passed (mocked IO).');
