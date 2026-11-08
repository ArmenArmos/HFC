/** Actual action functions + Zod validation, with Auth/RPC/dispatch boundaries replaced. No network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
type State={ok:boolean;message:string;reservationCreated?:boolean;operationCreated?:boolean;outcomeUnknown?:boolean};
type Actions=Record<string,(previous:State,form:FormData)=>Promise<State>>;
const id='11111111-1111-4111-8111-111111111111';const clinic='22222222-2222-4222-8222-222222222222';const request='33333333-3333-4333-8333-333333333333';const invitation='44444444-4444-4444-8444-444444444444';const version='a'.repeat(32);
const context={id:invitation,generation:1,operationId:'66666666-6666-4666-8666-666666666666',expectedAuthUserId:id,authUserId:null,email:'nurse@example.invalid',name:'Invited team member',clinicId:clinic,issuerId:'55555555-5555-4555-8555-555555555555',status:'pending',sendStatus:'pending',expiresAt:'2030-01-01T00:00:00Z',tokenDigest:null,tokenType:null,dispatchClaimedAt:null,role:'nurse'};
const row={id,name:'Updated name',email:'nurse@example.invalid',clinicId:clinic,clinicName:'Clinic',active:true,role:'nurse',status:'accepted',version:'b'.repeat(32),assignmentCount:0};
let actor='admin';let ready=true;let rpcCalls:Array<{name:string;args:Record<string,unknown>}> = [];let dispatchCalls:unknown[]=[];let refreshed:string[]=[];
type RpcResponse={data:unknown;error:null|{code?:string;message:string};status?:number};
let rpcResponse:(name:string,args:Record<string,unknown>)=>Promise<RpcResponse> = async(name,args)=>({data:name.includes('reserve')?{...context,role:args.p_role??'doctor'}:name.includes('remove')?{...row,active:false,status:'removed'}:row,error:null,status:200});
function load(path:string,extra:Record<string,unknown>={}){
 const exports:Record<string,unknown>={};const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 new vm.Script(code).runInNewContext({exports,FormData,Buffer,process:{env:{}},require(name:string){if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};
  if(name in extra)return extra[name];if(name==='server-only')return {};if(name==='zod'||name==='node:crypto')return require(name);
  if(name==='./clinic-scheduling-schema')return load('lib/staff/clinic-scheduling-schema.ts');
  if(name==='next/cache')return {revalidatePath:(path:string)=>refreshed.push(path)};
  if(name==='./real-admin')return {realStaffDirectoryRowSchema:directorySchema,requireRealAdmin:async()=>{if(actor!=='admin')throw Error('Admin required');return {identity:{id:context.issuerId,role:'admin'},client:{rpc:async(name:string,args:Record<string,unknown>)=>{rpcCalls.push({name,args});return rpcResponse(name,args);}}};},realStaffInvitationReady:()=>ready};
  if(name==='./real-invitation-dispatch')return load('lib/staff/real-invitation-dispatch.ts');
  if(name==='@/lib/telegram-auth/staff-invite-config')return {telegramStaffInvitationReady:()=>false};
  if(name==='./real-invitations')return {sendManagedStaffInvitation:async(value:unknown)=>{dispatchCalls.push(value);return {ok:true,message:'Invitation sent.'};},sendManagedDoctorInvitation:async(value:unknown)=>{dispatchCalls.push(value);return {ok:true,message:'Invitation sent.'};}};
  throw Error(`Unexpected action import: ${name}`);
 }});return exports;
}
const directorySchema=load('lib/staff/real-admin.ts',{
 'next/headers':{headers:async()=>({get:()=> 'backoffice.noreon.health'})},
 'next/navigation':{notFound:()=>{throw Error('Not found');}},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{role:'admin'},client:{}})},
 '@/lib/patient-care/real-review-config':{realReviewEnabled:()=>true},
 './hosts':{staffHostAllowed:()=>true},
 '@/lib/messaging/brevo-email':{doctorInvitationOrigin:()=> 'https://doctors.noreon.health',parseBrevoEmailConfig:()=>({})},
}).realStaffDirectoryRowSchema;
const actions=load('lib/staff/real-admin-actions.ts') as Actions;
for(const name of ['inviteRealStaff','inviteRealDoctor','reissueRealStaffInvitation','updateRealStaff','removeRealStaffAccess'])assert.equal(typeof actions[name],'function',`${name} must exist`);
const initial={ok:false,message:''};
function form(values:Record<string,string>){const data=new FormData();for(const [key,value] of Object.entries(values))data.set(key,value);return data;}
const add=(role?:string)=>form({requestId:request,name:'Invited team member',email:'nurse@example.invalid',clinicId:clinic,...(role===undefined?{}:{role})});
const edit=()=>form({staffId:id,expectedVersion:version,name:'Updated name',clinicId:clinic,requestId:request});
const remove=()=>form({staffId:id,expectedVersion:version,requestId:request});
const reset=()=>{rpcCalls=[];dispatchCalls=[];refreshed=[];actor='admin';ready=true;rpcResponse=async(name,args)=>({data:name.includes('reserve')?{...context,role:args.p_role??'doctor'}:name.includes('remove')?{...row,active:false,status:'removed'}:row,error:null,status:200});};
for(const unauthorized of ['doctor','nurse','anonymous'])for(const name of ['inviteRealStaff','updateRealStaff','removeRealStaffAccess']){
 reset();actor=unauthorized;await assert.rejects(()=>actions[name](initial,name==='inviteRealStaff'?add('doctor'):name==='updateRealStaff'?edit():remove()),/Admin required/);assert.equal(rpcCalls.length,0,'Admin guard runs before RPC');
}
for(const invalidRole of [undefined,'admin','member','']){reset();const result=await actions.inviteRealStaff(initial,add(invalidRole));assert.equal(result.ok,false);assert.equal(rpcCalls.length,0,'Role is validated before reservation');}
for(const role of ['doctor','nurse']){reset();const result=await actions.inviteRealStaff(initial,add(role));assert.equal(result.ok,true);assert.equal(result.reservationCreated,true);assert.equal(rpcCalls[0].args.p_role,role);assert.equal((dispatchCalls[0] as {role:string}).role,role);assert.notEqual((dispatchCalls[0] as {operationId:string}).operationId,request,'Server dispatch operation is independent of the form request nonce');assert.ok(refreshed.includes('/staff/real/doctors'));}
reset();await actions.inviteRealDoctor(initial,add('nurse'));assert.equal(rpcCalls[0].args.p_role??'doctor','doctor','Legacy doctor entry fixes the doctor role');assert.equal((dispatchCalls[0] as {role:string}).role,'doctor');
reset();rpcResponse=async()=>({data:{...context,role:'doctor'},error:null,status:200});const mismatch=await actions.inviteRealStaff(initial,add('nurse'));assert.equal(mismatch.ok,false);assert.equal(dispatchCalls.length,0,'Reserved role mismatch must not reach dispatch');assert.equal(mismatch.reservationCreated,true);
reset();rpcResponse=async()=>({data:{...context,role:'nurse',generation:3},error:null,status:200});
const reissue=form({invitationId:invitation,generation:'2',requestId:request});
const nurseReissue=await actions.reissueRealStaffInvitation(initial,reissue);assert.equal(nurseReissue.ok,true);assert.equal((dispatchCalls[0] as {role:string}).role,'nurse');assert.equal(rpcCalls[0].args.p_invitation_id,invitation);assert.equal(rpcCalls[0].args.p_expected_generation,2);assert.equal(rpcCalls[0].args.p_request_id,request);
for(const name of ['updateRealStaff','removeRealStaffAccess']){
 reset();const data=name==='updateRealStaff'?edit():remove();data.set('role','admin');data.set('email','forged@example.invalid');
 const result=await actions[name](initial,data);assert.equal(result.ok,true);assert.equal(result.operationCreated,true);assert.ok(refreshed.includes('/staff/real/doctors'));
 assert.equal(rpcCalls[0].args.p_staff_id,id);assert.equal(rpcCalls[0].args.p_expected_version,version);assert.equal(rpcCalls[0].args.p_request_id,request);assert.equal(rpcCalls[0].args.p_role,undefined);assert.equal(rpcCalls[0].args.p_email,undefined,'Submitted identity fields cannot promote or replace email');
 if(name==='updateRealStaff'){assert.equal(rpcCalls[0].args.p_display_name,'Updated name');assert.equal(rpcCalls[0].args.p_clinic_id,clinic);}
 await actions[name](initial,data);assert.equal(rpcCalls[1].args.p_request_id,request,'Repeated form carries the same operation ID');
 for(const problem of [{code:'40001',message:'Staff changed'},{code:'P0001',message:'Reassign members'},{code:'22023',message:'Clinic unavailable'}]){
  reset();rpcResponse=async()=>({data:null,error:problem,status:400});const failed=await actions[name](initial,name==='updateRealStaff'?edit():remove());assert.equal(failed.ok,false);assert.equal(failed.outcomeUnknown??false,false,'SQL rejection is determinate');
 }
 for(const uncertain of ['throw','503','invalid-row']){
  reset();rpcResponse=async()=>{if(uncertain==='throw')throw Error('transport failed');return uncertain==='503'?{data:null,error:{message:'upstream unavailable'},status:503}:{data:{id,role:'admin'},error:null,status:200};};
  const unknown=await actions[name](initial,name==='updateRealStaff'?edit():remove());assert.equal(unknown.ok,false);assert.equal(unknown.outcomeUnknown,true,`${uncertain} cannot be called a definite rejection`);assert.ok(refreshed.includes('/staff/real/doctors'),'Unknown mutation outcomes cause readback');
 }
 for(const [field,value] of [['requestId','not-a-uuid'],['staffId','not-a-uuid'],['expectedVersion','invalid-version']]){reset();const invalid=name==='updateRealStaff'?edit():remove();invalid.set(field,value);const rejected=await actions[name](initial,invalid);assert.equal(rejected.ok,false);assert.equal(rpcCalls.length,0);}
}
console.log('Actual staff action validation, admin guard ordering, typed roles, immutable fields, CAS replay, and uncertain outcome checks passed.');
for(const name of ['updateRealStaff','removeRealStaffAccess']){
 reset();rpcResponse=async()=>({data:null,error:{code:'40001',message:'Staff changed. Reload and try again'},status:500});
 const stale=await actions[name](initial,name==='updateRealStaff'?edit():remove());
 assert.equal(stale.outcomeUnknown,false,'Trusted serialization failure remains determinate when PostgREST returns HTTP 500');
 assert.match(stale.message,/changed/);
 for(const status of [502,503]){
  reset();rpcResponse=async()=>({data:null,error:{code:'LOCAL_FIXTURE_UNAVAILABLE',message:'upstream unavailable'},status});
  const unavailable=await actions[name](initial,name==='updateRealStaff'?edit():remove());assert.equal(unavailable.outcomeUnknown,true,'Untrusted upstream errors remain unknown');
 }
}
