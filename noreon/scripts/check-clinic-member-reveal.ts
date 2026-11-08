import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {revealClinicMember} from '@/lib/clinic-admin/member-reveal';
import {readClinicMemberMasked} from '@/lib/clinic-portal/member-masked';

const clinic='c4710000-0000-4000-8000-000000000001',member='c4710000-0000-4000-8000-000000000002';
const calls:{name:string;args?:Record<string,unknown>}[]=[];
let data:unknown={ok:true,phone:'+37499120123',birthDate:'1968-02-23'};
const rpc={rpc:async(name:string,args?:Record<string,unknown>)=>{calls.push({name,args});return{data,error:null};}};
for(const reason of ['', '   ', 'abcd', 'x'.repeat(501)]){
 assert.deepEqual(await revealClinicMember(rpc,clinic,member,{reason}),{ok:false,code:'reason_required'});
}
for(const input of [null,{}, {reason:5},{reason:'Valid reason',extra:'hidden'}])assert.deepEqual(await revealClinicMember(rpc,clinic,member,input),{ok:false,code:'reason_required'});
assert.equal(calls.length,0,'Invalid reasons never reach a reveal RPC');
assert.deepEqual(await revealClinicMember(rpc,clinic,member,{reason:'  Calling tomorrow  '}),data);
assert.deepEqual(calls.at(-1),{name:'clinic_admin_member_reveal',args:{p_clinic:clinic,p_member:member,p_reason:'Calling tomorrow'}});
for(const code of ['reason_required','rate_limited','refused','disabled','access']){
 data={ok:false,code};assert.deepEqual(await revealClinicMember(rpc,clinic,member,{reason:'Valid reason'}),data);
}
data={ok:true,phone:'1234',birthDate:'1968'};
assert.deepEqual(await revealClinicMember(rpc,clinic,member,{reason:'Valid reason'}),{ok:false,code:'unavailable'});
assert.deepEqual(await revealClinicMember({rpc:async()=>{throw Error('Synthetic failure');}},clinic,member,{reason:'Valid reason'}),{ok:false,code:'unavailable'});

data={ok:true,members:[{memberId:member,phoneLast4:'0123',birthYear:1968}]};calls.length=0;
assert.deepEqual(await readClinicMemberMasked(rpc,clinic,[member,member]),{status:'loaded',members:(data as {members:unknown}).members});
assert.deepEqual(calls,[{name:'clinic_member_masked',args:{p_clinic:clinic,p_members:[member]}}],'A page uses one deduplicated read');
data={ok:true,members:[{memberId:clinic,phoneLast4:'0123',birthYear:1968}]};
assert.deepEqual(await readClinicMemberMasked(rpc,clinic,[member]),{status:'unavailable'},'Unexpected member ids are refused');
data={ok:false,code:'access'};assert.deepEqual(await readClinicMemberMasked(rpc,clinic,[member]),{status:'unavailable'});
calls.length=0;assert.deepEqual(await readClinicMemberMasked(rpc,clinic,[]),{status:'loaded',members:[]});assert.equal(calls.length,0);
const manyIds=Array.from({length:201},(_,n)=>`c4710000-0000-4000-8000-${String(n+10).padStart(12,'0')}`);
const sizes:number[]=[];
const large=await readClinicMemberMasked({rpc:async(_name,args)=>{const ids=args?.p_members as string[];sizes.push(ids.length);return{error:null,data:{ok:true,members:ids.map(memberId=>({memberId,phoneLast4:'0123',birthYear:1968}))}};}},clinic,manyIds);
assert.deepEqual(sizes,[200,1],'Oversized legacy lists use bounded batches rather than truncate members');
assert.ok(large.status==='loaded'&&large.members.length===201);

// Exercise the actual exported action with synthetic identity/logging only. No Auth, secrets or DB.
let capability='clinic_admin',guardCalls=0,profileCalls=0;
const revalidated:string[]=[];
const scope='current';
const actionCalls:unknown[][]=[];
const dependencies:Record<string,unknown>={
 'next/cache':{revalidatePath(path:string){revalidated.push(path);}},
 '@/lib/observability/with-logging':{loggedAction:(_name:string,action:unknown)=>action},
 '@/lib/lab-ai/upload-trigger':{scheduleLabRead(){throw Error('Reveal must not start lab reading');}},
 '@/lib/clinic-portal/identity':{requireClinicPortal:async()=>{guardCalls++;return{identity:{capability},actorScope:scope,rpc};}},
 './record':{updateClinicPatientProfile:async()=>{profileCalls++;return'saved';}},'./files':{},'./files-schema':{},
 './member-reveal':{revealClinicMember:async(...args:unknown[])=>{actionCalls.push(args);return{ok:true,phone:'+37499120123',birthDate:'1968-02-23'};}},
};
const out:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('lib/clinic-admin/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,require:(name:string)=>{assert.ok(name in dependencies,name);return dependencies[name];}});
const action=out.clinicAdminMemberReveal as(c:string,s:string,m:string,i:unknown)=>Promise<unknown>;
assert.deepEqual(JSON.parse(JSON.stringify(await action(clinic,'stale',member,{reason:'Valid reason'}))),{ok:false,code:'refused'});assert.equal(actionCalls.length,0,'Stale actor scope refuses before reveal');
capability='clinic_staff';assert.deepEqual(JSON.parse(JSON.stringify(await action(clinic,'current',member,{reason:'Valid reason'}))),{ok:false,code:'refused'});assert.equal(actionCalls.length,0,'Staff never call reveal');
capability='clinic_admin';await action(clinic,'current',member,{reason:'Valid reason'});assert.equal(actionCalls.length,1);assert.equal(guardCalls,3);
console.log('Clinic member reveal PASS: input validation, trim, typed refusals, strict response, page mask batching, and actual action scope/admin guard (synthetic IO).');

const saveProfile=out.clinicPatientProfileUpdate as(c:string,s:string,m:string,i:unknown)=>Promise<unknown>;
assert.equal(await saveProfile(clinic,'stale',member,{}),'refused');assert.equal(profileCalls,0);
capability='clinic_staff';assert.equal(await saveProfile(clinic,'current',member,{}),'refused');assert.equal(profileCalls,0);
capability='clinic_admin';assert.equal(await saveProfile(clinic,'current',member,{}),'saved');
assert.equal(profileCalls,1);assert.deepEqual(revalidated,[`/clinic/real/records/${member}`,'/clinic/real/records']);
console.log('Clinic profile action PASS: scope/admin fences, saved result and record/list revalidation (synthetic IO).');
