import assert from 'node:assert/strict';
import {saveSchedulingSetting} from '@/lib/staff/clinic-scheduling-command';
const id='11111111-1111-4111-8111-111111111111';
function form(email='clinic@example.invalid'){const f=new FormData();f.set('clinicId',id);f.set('requestId',id);f.set('expectedRevision','0');f.set('email',email);return f;}
let calls=0,invalidations=0;
let response:{data:unknown;error:{code?:string}|null;status?:number}={data:{id,email:'clinic@example.invalid',revision:1},error:null};
let seen:unknown;
const deps={write:async(input:unknown)=>{calls++;seen=input;return response;},invalidate:()=>{invalidations++;}};
assert.deepEqual(await saveSchedulingSetting('clinic',form('bad'),deps),{ok:false,feedback:'invalid'});assert.equal(calls,0);
assert.equal((await saveSchedulingSetting('clinic',form(' clinic@example.invalid '),deps)).ok,true);assert.equal(calls,1);assert.equal(invalidations,1);
assert.equal((seen as {email:string}).email,'clinic@example.invalid');
for(const [code,feedback] of [['40001','stale'],['42501','access'],['22023','rejected'],['23505','rejected']] as const){response={data:null,error:{code},status:500};const r=await saveSchedulingSetting('clinic',form(),deps);assert.equal(r.feedback,feedback);assert.notEqual(r.outcomeUnknown,true);}
for(const bad of [{id,email:'different@example.invalid',revision:1},{id,email:'clinic@example.invalid',revision:2},{id:'22222222-2222-4222-8222-222222222222',email:'clinic@example.invalid',revision:1},null]){response={data:bad,error:null};assert.equal((await saveSchedulingSetting('clinic',form(),deps)).outcomeUnknown,true);}
response={data:null,error:{code:'40001'},status:503};assert.equal((await saveSchedulingSetting('clinic',form(),deps)).outcomeUnknown,true);
assert.equal((await saveSchedulingSetting('clinic',form(),{...deps,write:async()=>{throw Error('network');}})).outcomeUnknown,true);
response={data:{email:null,revision:1},error:null};const cleared=await saveSchedulingSetting('copy',form(''),deps);assert.equal(cleared.ok,true);assert.equal(cleared.email,null);
console.log('Scheduling command passed: invalid never writes; checked receipts, explicit clear, known rollback vs uncertain transport and truthful result validation.');

// Execute the actual exported server actions with isolated IO. The real DB
// authorization/receipt paths are separately tested in SQL and session races.
const {readFileSync}=await import('node:fs');
const vm=await import('node:vm');
const ts=await import('typescript');
const source=readFileSync('lib/staff/real-clinic-scheduling-actions.ts','utf8');
const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let entryDenied=true,entryWrites=0,entryAuthorizations=0;
let entryMethod='',entryArgs:Record<string,unknown>={};
const routes:string[]=[];
const modules:Record<string,unknown>={
 'next/cache':{revalidatePath:(path:string)=>routes.push(path)},
 './real-admin':{requireRealAdmin:async()=>{entryAuthorizations++;if(entryDenied)throw Error('Fixture admin denied');return {client:{rpc:async(method:string,args:Record<string,unknown>)=>{entryWrites++;entryMethod=method;entryArgs=args;return response;}}};}},
 './clinic-scheduling-command':{saveSchedulingSetting},
};
const entrypoints:Record<string,(state:{ok:boolean},form:FormData)=>Promise<{ok:boolean}>>={};
vm.runInNewContext(compiled,{exports:entrypoints,require:(name:string)=>{if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};assert.ok(name in modules,`Unexpected action dependency ${name}`);return modules[name];}});
for(const [name,method] of [['updateClinicSchedulingEmail','real_admin_update_clinic_scheduling_email'],['updateSchedulingCopyEmail','real_admin_update_scheduling_copy_email']]){
 const before=entryWrites;
 await assert.rejects(()=>entrypoints[name]({ok:false},form()),/Fixture admin denied/);
 assert.equal(entryWrites,before,'Denied action cannot write before authorization');
 entryDenied=false;
 response={data:{...(name==='updateClinicSchedulingEmail'?{id}:{}),email:'clinic@example.invalid',revision:1},error:null};
 assert.equal((await entrypoints[name]({ok:false},form())).ok,true);
 assert.equal(entryMethod,method,'Public entry point fixes the operation');
 assert.equal(entryArgs.p_request_id,id);assert.equal(entryArgs.p_expected_revision,0);
 assert.equal(entryArgs.p_email,'clinic@example.invalid');
 assert.equal('p_clinic_id' in entryArgs,name==='updateClinicSchedulingEmail');
 response={data:{...(name==='updateClinicSchedulingEmail'?{id}:{}),email:null,revision:1},error:null};
 assert.equal((await entrypoints[name]({ok:false},form(''))).ok,true);
 assert.equal('p_email' in entryArgs,false,'Clear uses the SQL default null, never a guessed mailbox');
 entryDenied=true;
}
assert.equal(entryAuthorizations,6);assert.deepEqual(routes,Array(4).fill('/staff/real/clinics'));
console.log('Actual admin action exports passed: authorize first, fixed clinic/copy RPC, typed arguments, explicit clear and revalidation. IO is mocked.');
