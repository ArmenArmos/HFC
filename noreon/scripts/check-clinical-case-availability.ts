import * as noticeLinks from '@/lib/staff-zoe/notice-link';
import {pdfArtifactSchema} from '@/lib/reports/pdf-artifact-schema';
import {careVisitSchema} from '@/lib/staff/visit-evidence-schema';
import {planVersionSchema} from '@/lib/doctor-completion/version-schema';
import * as nodeCrypto from 'node:crypto';
/** Actual availability action and snapshot schema; controlled Auth/RPC only. No network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
const navigation=require('next/navigation') as typeof import('next/navigation');
const id='11111111-1111-4111-8111-111111111111';
const snapshot={id,revision:3,evidenceToken:'a'.repeat(32),draft:null,draftSavedAt:null,draftStale:false,review:null,evidence:{profile:{name:'PRIVATE name',birthDate:null,biologicalSex:null},consent:null,assessment:null,measurements:[],reports:[]}};
let authError:unknown=null,rpcError:unknown=null,rpcThrows=false,data:unknown=snapshot;
let authCalls=0;
let rpcCalls:Array<{name:string;args:unknown}>=[];
const forbidden=()=>{throw Error('Unexpected write, cache refresh or external call');};
function load(path:string,repository=false):Record<string,unknown>{
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(code).runInNewContext({exports,Error,require(name:string){if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};
  if(['./clinical-review-current','@/lib/care-alerts/contracts','@/lib/doctor-inbox/member-urgent-server'].includes(name))return {};
  if(name==='@/lib/staff-zoe/notice-link')return noticeLinks;
  if(name==='node:crypto')return nodeCrypto;
  if(name==='@/lib/reports/pdf-artifact-schema')return {pdfArtifactSchema};
  if(name==='@/lib/staff/visit-evidence-schema')return {careVisitSchema};
  if(name==='@/lib/doctor-completion/version-schema')return {planVersionSchema};
  if(name==='zod')return require(name);
  if(name==='next/navigation')return navigation;
  if(name==='./clinical-case-repository')return {snapshotSchema,requireRealStaff:async()=>{
   authCalls++;if(authError)throw authError;
   return {identity:{id,role:'doctor'},client:{rpc:async(name:string,args:unknown)=>{
    rpcCalls.push({name,args});if(name!=='patient_clinical_case_snapshot')forbidden();
    if(rpcThrows)throw rpcError;
    return {data,error:rpcError};
   }}};
  }};
  if(name==='next/cache')return {revalidatePath:forbidden};
  if(name==='./clinical-review-engine')return {clinicalReviewEngine:forbidden};
  if(name==='./clinical-publication-server')return {clinicalWriteClient:forbidden};
  if(name==='@/lib/doctor-completion/config')return {doctorCompletionEnabled:()=>false};
  if(repository){
   if(name==='@/lib/staff/real-staff-access')return load('lib/staff/real-staff-access.ts',true);
   if(name==='./clinical-review-schema')return load('lib/patient-care/clinical-review-schema.ts');
   if(name==='@/lib/service-workflow/publication')return load('lib/service-workflow/publication.ts');
   if(['server-only','next/headers','@supabase/ssr','next/navigation','@/lib/supabase/server','@/lib/staff/hosts','./real-review-config','@/lib/staff/real-session-binding','@/lib/staff/staff-session-method','./real-session-binding','./staff-session-method','@/lib/staff-zoe/workspace-config'].includes(name))return {};
  }
  if(name==='@/lib/staff/yerevan-time')return load('lib/staff/yerevan-time.ts');
  if(name==='./required-evidence')return load('lib/patient-care/required-evidence.ts');
  if(name==='@/lib/staff/staff-server-copy')return load('lib/staff/staff-server-copy.ts');
  if(name==='@/lib/locale')return load('lib/locale.ts');
  throw Error(`Unexpected import: ${name}`);
 }});
 return exports;
}
const snapshotSchema=load('lib/patient-care/clinical-case-repository.ts',true).snapshotSchema;
const action=load('lib/patient-care/clinical-review-actions.ts').checkRealClinicalCaseAvailability as (id:unknown)=>Promise<{ok:boolean;message:string}>;
assert.equal(typeof action,'function','Refresh must have an authenticated availability action');
const reset=()=>{authError=null;rpcError=null;rpcThrows=false;data=snapshot;authCalls=0;rpcCalls=[];};
const unavailable=async(value:unknown)=>{
 const result=await action(value);
 assert.equal(result.ok,false);assert.match(result.message,/unavailable/);
 assert.doesNotMatch(result.message,/PRIVATE|NEXT_REDIRECT|NEXT_HTTP_ERROR/);
 assert.deepEqual(Object.keys(result).sort(),['message','ok'],'Only status and safe feedback cross the boundary');
 return result.message;
};
reset();const success=await action(id);
assert.equal(success.ok,true);assert.equal(success.message,'');
assert.deepEqual(Object.keys(success).sort(),['message','ok']);
assert.equal(authCalls,1);assert.equal(rpcCalls.length,1);assert.equal(rpcCalls[0].name,'patient_clinical_case_snapshot');
assert.equal((rpcCalls[0].args as {p_user_id:string}).p_user_id,id);
let unavailableMessage='';
for(const invalid of ['',null,undefined,{},'not-a-uuid']){
 reset();unavailableMessage=await unavailable(invalid);assert.equal(authCalls,0,'Invalid IDs do not probe Auth or RPC');assert.equal(rpcCalls.length,0);
}
function thrownBy(run:()=>never){try{run();}catch(error){return error;}assert.fail('Next navigation must throw its control exception');}
for(const problem of [thrownBy(()=>navigation.redirect('/staff/real/login')),thrownBy(()=>navigation.notFound())]){
 reset();authError=problem;
 await assert.rejects(()=>action(id),error=>error===problem,'Actual Next Auth navigation must propagate unchanged');
 assert.equal(authCalls,1);assert.equal(rpcCalls.length,0,'Auth navigation cannot read a case');
}
for(const problem of [new Error('PRIVATE auth outage')]){
 reset();authError=problem;assert.equal(await unavailable(id),unavailableMessage);assert.equal(authCalls,1);assert.equal(rpcCalls.length,0,'Failed authentication cannot read a case');
}
for(const problem of [{code:'',message:'PRIVATE FetchError'},{code:'42501',message:'PRIVATE SQL rejection'},{code:'PGRST003',message:'PRIVATE timeout'}]){
 reset();rpcError=problem;assert.equal(await unavailable(id),unavailableMessage);assert.equal(rpcCalls.length,1);
 reset();rpcThrows=true;rpcError=problem;assert.equal(await unavailable(id),unavailableMessage);assert.equal(rpcCalls.length,1);
}
for(const invalid of [null,{}, {...snapshot,revision:'3'}, {...snapshot,id:'22222222-2222-4222-8222-222222222222'}, {...snapshot,evidence:{...snapshot.evidence,reports:'PRIVATE invalid shape'}}]){
 reset();data=invalid;assert.equal(await unavailable(id),unavailableMessage);assert.equal(authCalls,1);assert.equal(rpcCalls.length,1);
}
console.log('Clinical availability checks passed: actual action, snapshot schema and Next navigation; controlled Auth/RPC; valid authenticated snapshot only, fixed outage feedback, preserved Auth navigation, no data/writes. No live Auth/DB evidence.');
