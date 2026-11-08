import assert from'node:assert/strict';import{readFileSync}from'node:fs';import vm from'node:vm';import ts from'typescript';
import * as runtime from'@/lib/staff/visit-evidence-runtime';import * as schema from'@/lib/staff/visit-evidence-schema';
const member='b2400000-0000-4000-8000-000000000001',visit='b2400000-0000-4000-8000-000000000010',submission='b2400000-0000-4000-8000-000000000020';
const command:schema.VisitCommand={version:'visit-evidence-v1',op:'open-visit',id:member,revision:0,submissionId:submission,visitId:visit,booking:null};
let role='nurse',guardError:Error|null=null;const calls:string[]=[],paths:string[]=[];
let response:unknown={status:'saved',submissionId:submission,visitId:visit,revision:1,entryIds:[],replayed:false};
const client={rpc:async(name:string)=>{calls.push(name);return{data:response,error:null};}};
const exports:Record<string,unknown>={};const source=ts.transpileModule(readFileSync('lib/staff/visit-evidence-actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const modules:Record<string,unknown>={'next/cache':{revalidatePath:(p:string)=>paths.push(p)},'@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{if(guardError)throw guardError;return{client,identity:{id:member,role}};}},'./visit-evidence-runtime':runtime,'./visit-evidence-schema':schema};
new vm.Script(source).runInNewContext({exports,require:(name:string)=>{if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};assert.ok(name in modules,'Unexpected dependency '+name);return modules[name];}});
const save=exports.recordRealVisitEvidence as(memberId:string,input:unknown)=>Promise<schema.VisitCommandResult>;
const refresh=exports.refreshRealVisitEvidence as(memberId:string,input:unknown)=>Promise<schema.VisitRefreshResult>;
assert.equal((await save(member,command)).status,'saved');assert.deepEqual(calls,['patient_staff_visit_command'],'No legacy measurement or service RPC');assert.ok(paths.includes(`/staff/real/members/${member}`));
for(const other of['doctor','admin']){role=other;calls.length=0;assert.equal((await save(member,command)).status,'access');assert.deepEqual(calls,[]);}
role='doctor';assert.equal((await refresh(member,{id:member,visitId:visit,command})).status,'access');assert.deepEqual(calls,[],'Doctor cannot recover or retire nurse commands');
response={status:'loaded',data:{version:'visit-evidence-v1',memberId:member,revision:1,bookingContext:null,collectionAvailability:'unlinked',visits:[]},receipt:null};assert.equal((await refresh(member,{id:member,visitId:visit,command:null})).status,'loaded');assert.deepEqual(calls,['patient_staff_visit_refresh']);
calls.length=0;guardError=Error('Synthetic guard redirect');await assert.rejects(()=>save(member,command),e=>e===guardError);await assert.rejects(()=>refresh(member,{id:member,visitId:visit,command:null}),e=>e===guardError);assert.deepEqual(calls,[],'Auth control flow remains outside catch');
console.log('Actual server actions: guarded nurse-only save, doctor scoped read-only refresh, no full-command retirement by doctor/admin, guard throw propagates and no legacy/service writer. Injected guard/IO, not Auth.');
