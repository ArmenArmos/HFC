import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
import * as runtime from '@/lib/lab-ai/doctor-runtime';
import * as schemas from '@/lib/lab-ai/doctor-schema';

// Controlled IO: run the actual server action with synthetic session/RPC/cache boundaries.
const input={memberId:'a5c00000-0000-4000-8000-000000000004',fileId:'a5c00000-0000-4000-8000-000000000011',submissionId:'a5c00000-0000-4000-8000-000000000801'};
let enabled=true,role='doctor',authCalls=0,rpcCalls=0;
let result:unknown={status:'saved',replayed:false,confirmed:1,remaining:1};
let error:{code?:string}|null=null,throws=false;
const refreshed:string[]=[];
const client={rpc:async(name:string,args?:Record<string,unknown>)=>{
 rpcCalls++;assert.equal(name,'doctor_lab_ai_confirm_passing');
 assert.deepEqual(args,{p_command:{...input,version:'lab-ai-confirm-passing-v1'}});
 if(throws)throw Error('Synthetic failure');return {data:result,error};
}};
const modules:Record<string,unknown>={
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 'next/cache':{revalidatePath:(p:string)=>refreshed.push(p)},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>{authCalls++;return {identity:{role},client};}},
 '@/lib/lab-ai/config':{labAiEnabled:()=>enabled},
 '@/lib/lab-ai/doctor-runtime':runtime,'@/lib/lab-ai/doctor-schema':schemas,
};
const source=readFileSync('lib/staff-zoe/lab-review-actions.ts','utf8');
const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
const exported:Record<string,unknown>={};
new Function('require','exports',js)((name:string)=>{if(name in modules)return modules[name];throw Error(`Unexpected import ${name}`);},exported);
const confirm=exported.confirmPassingLabValues as (raw:unknown)=>Promise<unknown>;
assert.equal(typeof confirm,'function');
assert.equal(schemas.confirmPassingInputSchema.safeParse(input).success,true,'Confirm all accepts the viewed file ID');
for(const bad of [null,{}, {...input,memberId:'bad'},{...input,fileId:null},{...input,submissionId:3},{...input,attachmentId:input.fileId},{memberId:input.memberId,attachmentId:input.fileId,submissionId:input.submissionId},{...input,extra:true},{...input,version:'lab-ai-confirm-passing-v1'}]){
 assert.deepEqual(await confirm(bad),{status:'invalid'});
}
assert.equal(authCalls,0,'invalid requests never reach session or RPC');assert.equal(rpcCalls,0);
enabled=false;assert.deepEqual(await confirm(input),{status:'disabled'});assert.equal(authCalls,0);
enabled=true;role='nurse';assert.deepEqual(await confirm(input),{status:'access'});assert.equal(rpcCalls,0);
role='doctor';assert.deepEqual(await confirm(input),result);assert.deepEqual(refreshed,[`/staff/real/members/${input.memberId}`]);
result={status:'saved',replayed:true,confirmed:1,remaining:1};assert.deepEqual(await confirm(input),result);
for(const status of ['identity-first','open-first','stale','invalid','disabled','unavailable']){
 result={status};const count=refreshed.length;assert.deepEqual(await confirm(input),result);assert.equal(refreshed.length,count);
}
for(const [code,status] of [['42501','access'],['55P03','unavailable'],['XX000','outcome-unknown']]){
 error={code};assert.deepEqual(await confirm(input),{status});
}
error=null;
for(const malformed of [null,{}, {status:'saved'}, {status:'saved',replayed:false,confirmed:-1,remaining:0}]){
 result=malformed;assert.deepEqual(await confirm(input),{status:'outcome-unknown'});
}
throws=true;assert.deepEqual(await confirm(input),{status:'outcome-unknown'});
console.log('Confirm passing: validation, doctor boundary, RPC envelope, counts, error mapping and refresh passed (controlled IO).');
