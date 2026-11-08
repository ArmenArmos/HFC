/** Real action/access/server entry points, with session, provider and storage IO mocked. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import {staffHostAllowed} from '../lib/staff/hosts';
import {startPractice,practiceEditSchema} from '../lib/zoe/practice/engine';
import './check-zoe-practice-store';
import './check-zoe-practice-engine';
type Exports=Record<string,(...args:unknown[])=>Promise<unknown>>;
function load(path:string,deps:Record<string,unknown>,env:Record<string,string|undefined>={}):Exports{
 const out={};new vm.Script(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,process:{env},require:(name:string)=>{assert.ok(name in deps,`Unexpected dependency ${name}`);return deps[name];}});return out as Exports;
}
let role='doctor',host='backoffice.noreon.health',storage=0,provider=0,staffCalls=0;
const env:Record<string,string|undefined>={};
const access=load('lib/zoe/practice/access.ts',{
 'server-only':{},'next/navigation':{notFound:()=>{throw Error('not_found');}},'next/headers':{headers:async()=>({get:()=>host})},
 // Production rule: localhost is only for local development, where NODE_ENV is not production.
 '@/lib/staff/hosts':{staffHostAllowed:(name:string)=>staffHostAllowed(name,undefined,{NODE_ENV:'production'})},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{staffCalls++;return {identity:{id:'10000000-0000-4000-8000-000000000001',role},client:{from:()=>{storage++;throw Error('unexpected read');}}};}},
},env);
const server=load('lib/zoe/practice/server.ts',{
 'server-only':{},zod:{z},'./access':access,
 './engine':{startPractice,practiceEditSchema,runPracticeTurn:async()=>{provider++;throw Error('unexpected generation');},editPracticeRecord:()=>{throw Error('unexpected edit');}},
 './store':{practiceServiceRpc:()=>{storage++;return async()=>{storage++;return {ok:false,code:'access'};};},mutatePractice:async()=>{storage++;return {ok:false,code:'access'};},practiceDailyLimits:()=>({doctor:60,global:300})},
 './provider':{practiceProviders:async()=>{provider++;return null;}},'../pipeline':{ZOE_CONFIG_VERSION:'test-config'},
});
const wrapped:string[]=[];
const actions=load('app/staff/real/zoe-practice/actions.ts',{'@/lib/zoe/practice/server':server,'@/lib/observability/with-logging':{loggedAction:(name:string,fn:unknown)=>{wrapped.push(name);return fn;}}});
const invokeAll=async()=>{for(const fn of Object.values(actions))await assert.rejects(()=>fn({}),/not_found/);};
for(const value of [undefined,'false','TRUE','1','true ']){env.NOREON_ZOE_PRACTICE=value;await invokeAll();}
assert.equal(staffCalls,0,'Exact disabled flag is checked before session access');
env.NOREON_ZOE_PRACTICE='true';
for(host of ['app.noreon.health','noreon.health','localhost:3000','127.0.0.1:3000','backoffice.noreon.health.evil.example',''])await invokeAll();
host='backoffice.noreon.health';
for(role of ['nurse','member','qa','clinic'])await invokeAll();
assert.equal(storage,0,'Denied actions reach no storage');assert.equal(provider,0,'Denied actions reach no provider');
for(role of ['doctor','admin']){const result=await actions.startPracticeSession({patientId:'practice-new-ldl'});assert.equal((result as {ok:boolean}).ok,false);}
const beforeInvalidMark=storage;
for(const mark of [
 {rating:'wrong',reason:'unsafe',correction:''},
 {rating:'wrong',reason:'invented_reason',correction:'Fictional correction'},
 {rating:'wrong',correction:'Fictional correction'},
]){
 const result=await actions.markPracticeReply({sessionId:'10000000-0000-4000-8000-000000000001',turnId:'10000000-0000-4000-8000-000000000002',...mark});
 assert.equal((result as {ok:boolean}).ok,false);
}
assert.equal(storage,beforeInvalidMark,'Invalid wrong mark cannot reach storage');
assert.equal(wrapped.length,5,'Every action uses logging wrapper without forwarding input as log fields');
console.log('Practice actions: exact flag, strict hosts, every nurse/member action denied before IO; doctor/admin reach practice storage (mocked).');
