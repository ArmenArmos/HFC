import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {ConversationRepository} from '@/lib/conversation-persistence/repository';
import {nurseChatEnabled} from '@/lib/nurse-chat/config';
let enabled=false,role='nurse',authCalls=0,rpcCalls=0,authFails=false;
const fakeEnv={get NOREON_NURSE_CHAT(){return enabled?'true':undefined;}};
const client={rpc:async()=>{rpcCalls++;return {data:{ok:false,code:'denied'},error:null};}};
function load(path:string,dependencies:Record<string,unknown>){
 const exports:Record<string,unknown>={};
 const source=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(source).runInNewContext({exports,process:{env:fakeEnv},require:(name:string)=>{assert.ok(name in dependencies,`Unexpected dependency ${name}`);return dependencies[name];}});
 return exports;
}
const server=load('lib/conversation-persistence/server.ts',{
 'server-only':{},'@/lib/supabase/server':{createClient:()=>{throw Error('Nurse must use end-user staff client');}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{authCalls++;if(authFails)throw Error("Identity unavailable");return {identity:{role},client};}},
 './repository':{ConversationRepository},'@/lib/patient-care/real-review-config':{realReviewEnabled:()=>true},
 '@/lib/nurse-chat/config':{nurseChatEnabled:()=>nurseChatEnabled(fakeEnv)},
}) as {assignedNurseConversation:()=>Promise<null|{read:(id:string)=>Promise<unknown>;send:(v:unknown)=>Promise<unknown>}>;assignedDoctorConversation:()=>Promise<unknown>};
assert.equal(await server.assignedNurseConversation(),null);
assert.equal(authCalls,0,'Flag off refuses before any staff or conversation data read');
enabled=true;
for(const deniedRole of ['doctor','admin','clinic']){role=deniedRole;assert.equal(await server.assignedNurseConversation(),null);}
role='nurse';
const nurse=await server.assignedNurseConversation();assert.ok(nurse);
assert.deepEqual(Object.keys(nurse).sort(),['read','send'],'Nurse receives no compose/approve/takeover powers');
const denied=await nurse.read('ad110000-0000-4000-8000-000000000001');
assert.deepEqual(denied,{ok:false,code:'denied'});
assert.equal(rpcCalls,1,'Read uses the authenticated staff client');
await assert.rejects(server.assignedDoctorConversation,/Assigned doctor required/);
const actions=load('lib/nurse-chat/actions.ts',{
 'next/navigation':{unstable_rethrow:()=>{}},'@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 '@/lib/conversation-persistence/server':server,'./config':{nurseChatEnabled:()=>nurseChatEnabled(fakeEnv)},
}) as {readNurseConversation:(id:string)=>Promise<unknown>;sendNurseReply:(v:unknown)=>Promise<unknown>};
enabled=false;const before=authCalls;
assert.equal((await actions.readNurseConversation('invalid') as {code:string}).code,'off');
assert.equal((await actions.sendNurseReply({}) as {code:string}).code,'off');
assert.equal(authCalls,before,'Direct server action invocation stays dark');
enabled=true;role='doctor';
assert.equal((await actions.readNurseConversation('invalid') as {code:string}).code,'denied');
assert.equal((await actions.sendNurseReply({}) as {code:string}).code,'denied');
assert.equal(rpcCalls,1,'Wrong-role actions never call conversation RPC');
role='nurse';authFails=true;
assert.equal((await actions.readNurseConversation('ad110000-0000-4000-8000-000000000001') as {code:string}).code,'unavailable','Identity outage shows explicit unavailable');
console.log('Nurse chat access: off and wrong-role actions refused, end-user client retained, doctor approval adapter still refuses nurses. SQL assignment checks are separate.');
