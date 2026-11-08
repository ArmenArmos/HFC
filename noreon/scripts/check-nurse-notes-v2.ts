import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import * as schemas from '@/lib/staff/care-command-schema';

let flag='true',enabled=true,reads=0;
const modules:Record<string,unknown>={
 './member-card-actions':{readNurseMemberCard:async(id:string,card:string)=>{reads++;assert.equal(card,'notes');return {kind:'ready',card,memberId:id,revision:1,notes:[]};}},
 './config':{nurseChatEnabled:()=>enabled},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,action:unknown)=>action},
};
function load(file:string){
 const exports:Record<string,unknown>={};
 vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{get NOREON_NURSE_CHAT_V2(){return flag;}}},require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
 return exports;
}
const {readNurseChatNotes}=load('lib/nurse-chat/v2-notes-actions.ts') as {readNurseChatNotes:(id:string)=>Promise<{kind:string}>};
for(flag of ['','false','TRUE'])assert.equal((await readNurseChatNotes('member')).kind,'off');
flag='true';enabled=false;assert.equal((await readNurseChatNotes('member')).kind,'off');assert.equal(reads,0);
enabled=true;assert.equal((await readNurseChatNotes('member')).kind,'ready');assert.equal(reads,1,'The enabled route reuses the existing member-card scope');

let role='nurse',response:{data:unknown;error:null|{code?:string}}={data:2,error:null},calls=0;
Object.assign(modules,{
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},zod:{z},'next/cache':{revalidatePath:()=>{}},'./auth':{},'./cases':{},'./care-command-schema':schemas,
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{role},client:{rpc:async(name:string,input:unknown)=>{assert.equal(name,'patient_staff_care_command');assert.deepEqual(JSON.parse(JSON.stringify(input)),{p_id:id,p_revision:1,p_operation:'note',p_input:{kind:'evidence',note:'Observed cuff delivery'}});calls++;return response;}}})},
 '@/lib/patient/measured-at':{isFutureMeasurement:()=>false},
});
const id='aa110000-0000-4000-8000-000000000001';
const command={id,revision:1,op:'note',kind:'evidence',note:'Observed cuff delivery'};
const {realStaffCareCommand}=load('lib/staff/nurse-actions.ts') as {realStaffCareCommand:(input:unknown)=>Promise<{ok:boolean;uncertain?:boolean}>};
assert.equal((await realStaffCareCommand({...command,note:''})).ok,false);assert.equal(calls,0);
role='admin';assert.equal((await realStaffCareCommand(command)).ok,false);assert.equal(calls,0);role='nurse';
assert.equal((await realStaffCareCommand(command)).ok,true);
for(const code of ['40001','42501','23514','22P02','P0001']){response={data:null,error:{code}};const result=await realStaffCareCommand(command);assert.equal(result.ok,false);assert.equal(result.uncertain,false,`${code} is a definite refusal`);}
for(const error of [null,{}, {code:'08006'}]){response={data:null,error};const result=await realStaffCareCommand(command);assert.equal(result.ok,false);assert.equal(result.uncertain,true,'A missing or transport result must not release an exact pending note');}
console.log('Nurse notes v2: exact dark gates, existing scoped reader, native command payload/role/validation, definite refusal versus unknown transport result passed (controlled IO).');
