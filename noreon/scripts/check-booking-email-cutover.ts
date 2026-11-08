// Regression for a existing production preference workflow while the email pilot is unavailable.
// Configured pilot creation remains separate. Execute the actual existing action with isolated IO.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as schemas from '@/lib/real-booking/schema';
const uid='11111111-1111-4111-8111-111111111111';
const commandId='22222222-2222-4222-8222-222222222222';
const calls:string[]=[];let runtime:unknown=null,portal=false;
const source=readFileSync('lib/real-booking/actions.ts','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
let lastArgs:unknown=null;let screeningUnavailable=false;
const modules:Record<string,unknown>={
 'next/cache':{revalidatePath:()=>{}},
 zod:await import('zod'),
 '@/lib/patient/auth':{requirePatient:async()=>({userId:uid,phone:'synthetic-only'})},
 '@/lib/patient-care/clinical-review-engine':{clinicalReviewEngine:()=>({version:'trusted-engine',tests:[]})},
 '@/lib/patient-care/clinical-case-repository':{snapshotSchema:{},requireRealStaff:async()=>{throw Error('Not a staff fixture');}},
 '@/lib/patient-care/clinical-publication-server':{clinicalWriteClient:()=>({rpc:async(name:string,args:unknown)=>{calls.push(name);lastArgs=args;return {data:{},error:null};}})},
 './config':{realBookingEnabled:()=>true},
 './scheduling-template':{schedulingRuntime:()=>runtime},
 './legacy-mode':{bookingChannelConfigured:()=>runtime!==null||portal,homeRequestsOnly:()=>runtime===null&&portal},
 // An LDL re-test request is accepted without the screening engine (Astra LDLR-02): the screening context throws here.
 './repository':{memberLdlRequestContext:async()=>({sourceToken:'ldl-source-token'}),memberBookingContext:async()=>{if(screeningUnavailable)throw Error('Complete the questionnaire and resolve urgent guidance first.');return {identity:{userId:uid},contextToken:'valid-requirements-token',sourceToken:'valid-source-token',engine:{version:'trusted-engine',tests:[{id:'lipid',title:'Lipid',method:'lab'},{id:'ecg',title:'ECG',method:'clinic'}]}};}},
 './schema':schemas,
 '@/lib/ldl/retest':await import('@/lib/ldl/retest'),
 './form-error':{bookingFailure:()=>({ok:false,code:'failed',message:'Request unavailable.'})},
};
const actions:Record<string,(previous:unknown,form:FormData)=>Promise<{ok:boolean;code?:string}>>={};
vm.runInNewContext(code,{exports:actions,FormData,JSON,process:{env:{}},require:(name:string)=>{if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};assert.ok(name in modules,`Unexpected dependency ${name}`);return modules[name];}});
const form=new FormData();
for(const [key,value] of Object.entries({operation:'create',requestId:commandId,contextToken:'valid-requirements-token',testIds:'["lipid"]',startsAt:'2030-01-01T08:00:00+04:00',timezone:'Asia/Yerevan',mode:'clinic',location:'Synthetic clinic'}))form.set(key,value);
const result=await actions.memberBookingCommand({ok:false,message:''},form);
assert.equal(calls.includes('create_patient_test_request'),true,'Existing production preference creation remains usable while email pilot is not configured');assert.equal(result.ok,true);assert.equal(result.code,'requested');
calls.length=0;runtime={enabled:true};const pilotResult=await actions.memberBookingCommand({ok:false,message:''},form);assert.equal(calls.includes('create_patient_test_request'),false,'Configured pilot never falls back to legacy creation');assert.equal(pilotResult.code,'unavailable');
calls.length=0;runtime=null;portal=true;const portalResult=await actions.memberBookingCommand({ok:false,message:''},form);assert.equal(calls.includes('create_patient_test_request'),false,'Clinic-portal scheduling never falls back to legacy creation');assert.equal(portalResult.code,'unavailable');
calls.length=0;form.set('mode','home');form.set('location','1 Fictional Home Street');const homeResult=await actions.memberBookingCommand({ok:false,message:''},form);assert.equal(calls.includes('create_patient_test_request'),true,'With clinic scheduling on and email off, a home visit stays a request for the admin queue');assert.equal(homeResult.code,'requested');
calls.length=0;runtime={enabled:true};const emailHome=await actions.memberBookingCommand({ok:false,message:''},form);assert.equal(calls.includes('create_patient_test_request'),false,'With email on, home visits use slots');assert.equal(emailHome.code,'unavailable');
{
 screeningUnavailable=true;runtime=null;portal=false;calls.length=0;
 const accept=new FormData();
 for(const [key,value] of Object.entries({operation:'accept',id:'00000000-0000-4000-8000-0000000000c1',revision:'1',commandId:'00000000-0000-4000-8000-0000000000c2',algorithmVersion:'ldl-retest-v1'}))accept.set(key,value);
 const r=await actions.memberBookingCommand({ok:false,message:''},accept);
 assert.equal(r.ok,true,'LDL accept works while the screening context is unavailable');
 assert.deepEqual(JSON.parse(JSON.stringify((lastArgs as {p_input:unknown}).p_input)),{engine:{sourceToken:'ldl-source-token',version:'ldl-retest-v1',tests:[{id:'ldl-retest-lipid-panel',title:'Lipid panel (LDL cholesterol) after a change to lipid treatment',method:'lab'}]}},'LDL accept sends the fixed LDL engine');
 accept.set('algorithmVersion','trusted-engine');accept.set('commandId','00000000-0000-4000-8000-0000000000c3');
 const other=await actions.memberBookingCommand({ok:false,message:''},accept);
 assert.equal(other.ok,false,'a screening request still needs the screening context');
 screeningUnavailable=false;
}
console.log('Legacy preference compatibility PASS with pilot unavailable; configured pilot legacy create denied. Actual action, mocked IO; SQL enforces reciprocal exclusion separately.');
