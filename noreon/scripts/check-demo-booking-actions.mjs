import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
const io={data:null,staff:{id:'ops',role:'admin'},writes:0,enabled:true};
globalThis.__demoBookingCheck=io;
const sources={
 '@/lib/patient/demo':`const io=globalThis.__demoBookingCheck;export const demoEnabled=()=>io.enabled;export const readDemoSnapshot=async()=>io.data?{state:structuredClone(io.data)}:null;export const saveDemo=async data=>{io.data=data;io.writes++;};`,
 '@/lib/staff/auth':`export const getStaff=async()=>globalThis.__demoBookingCheck.staff;export const workspaceAdmin=()=>({from:()=>({select:()=>({eq:()=>({order:async()=>({data:[{id:'demo-clinic',name:'Fictional clinic',address:'Synthetic address'}],error:null})})})})});`,
 '@/lib/staff/cases':`const io=globalThis.__demoBookingCheck;export const sharedDemoEnabled=()=>io.enabled;export const getWorkspaceCase=async(id,staff)=>{if(id!==io.data.userId||staff.role!=='admin')throw Error('Access denied');return {state:structuredClone(io.data)};};export const persistWorkspaceCase=async data=>{io.data=data;io.writes++;};`,
 '@/lib/service-workflow/server':`export const workflowForDemo=data=>structuredClone(data.workflow);`,
 'next/cache':`export const revalidatePath=()=>{};`,
 'server-only':`export {};`,
};
const hook=registerHooks({resolve(specifier,context,next){if(Object.hasOwn(sources,specifier))return {url:'demo-check:'+specifier,shortCircuit:true};return next(specifier,context);},load(url,context,next){if(url.startsWith('demo-check:'))return {format:'module',source:sources[url.slice(11)],shortCircuit:true};return next(url,context);}});
try {
 const {demoMemberBookingCommand, demoStaffBookingCommand}=await import('../lib/demo-booking/actions.ts');
 const {demoBookingNeedsClinicalEligibility,getDemoMemberBookingData}=await import('../lib/demo-booking/repository.ts');
 const {createWorkflow}=await import('../lib/service-workflow/model.ts');
 const {applyDemoBookingOperation,demoBookingContext}=await import('../lib/demo-booking/model.ts');
 const now=new Date();const tomorrow=new Date(now.getTime()+86400000).toISOString(),end=new Date(now.getTime()+90000000).toISOString();
 const id='00000000-0000-4000-8000-000000000001',caseId='00000000-0000-4000-8000-000000000002';
 const terms={startsAt:tomorrow,endsAt:end,timezone:'Asia/Yerevan',mode:'clinic',location:'Fictional clinic'};
 let workflow=createWorkflow([{id:'lab-a',title:'Lab A',method:'lab',preparation:'',source:'fictional'}],now);workflow.clinicalContext='fixture';workflow.questionnaireRevision=1;
 const member={id:caseId,role:'member'},admin={id:'ops',role:'admin'};
 workflow=applyDemoBookingOperation(workflow,{operation:'create',id,contextToken:demoBookingContext(workflow),testIds:['lab-a'],terms},member,now);
 workflow=applyDemoBookingOperation(workflow,{operation:'confirm',id,revision:0,commandId:'provider',input:{provider:'Fictional provider',terms,obtainedAt:now.toISOString(),channel:'phone',source:'Simulated response',preparation:'Fictional instructions',replacesExisting:false}},admin,now);
 workflow=applyDemoBookingOperation(workflow,{operation:'accept',id,revision:1,commandId:'accept'},member,now);
 const base={userId:caseId,state:{profile:{name:'Demo',locale:'en'},consentAccepted:true,assessment:{completedAt:null,answers:{},urgentRule:null}},workflow};
 function form(operation,revision=2,extras={}){const form=new FormData();for(const [key,value]of Object.entries({operation,id,revision:String(revision),commandId:crypto.randomUUID(),...extras}))form.set(key,value);return form;}
 const initial={ok:false,message:''};
 assert.equal(demoBookingNeedsClinicalEligibility(workflow,{operation:'cancel',id,revision:2,commandId:'a'}),false);
 for(const operation of ['create','accept','request-change','confirm'])assert.equal(demoBookingNeedsClinicalEligibility(workflow,{operation,id,revision:2,commandId:'a'}),true);
 for(const urgent of [false,true]){
  io.data=structuredClone(base);if(urgent){io.data.state.assessment.completedAt=now.toISOString();io.data.state.assessment.urgentRule='red-fixture';}io.writes=0;
  const visible=await getDemoMemberBookingData();assert.equal(visible.available,false);assert.equal(visible.requests.length,1);
  const cancelled=await demoMemberBookingCommand(initial,form('cancel'));assert.equal(cancelled.ok,true);assert.equal(io.writes,1);assert.equal(io.data.workflow.bookings[0].status,'scheduled');
  const outcome=await demoStaffBookingCommand(caseId,initial,form('change-outcome',3,{outcome:'accepted',obtainedAt:now.toISOString(),channel:'phone',source:'Fictional cancellation response'}));assert.equal(outcome.ok,true);assert.equal(io.writes,2);assert.equal(io.data.workflow.bookings[0].status,'cancelled');
  io.data=structuredClone(base);if(urgent){io.data.state.assessment.completedAt=now.toISOString();io.data.state.assessment.urgentRule='red-fixture';}io.writes=0;
  const createBlocked=await demoMemberBookingCommand(initial,form('create',2,{...terms,requestId:crypto.randomUUID(),contextToken:demoBookingContext(workflow),testIds:JSON.stringify(['lab-a'])}));assert.equal(createBlocked.ok,false);assert.equal(io.writes,0);
  const acceptBlocked=await demoMemberBookingCommand(initial,form('accept'));assert.equal(acceptBlocked.ok,false);assert.equal(io.writes,0);
  const blocked=await demoMemberBookingCommand(initial,form('request-change',2,terms));assert.equal(blocked.ok,false);assert.equal(blocked.code,urgent?'clinical-hold':'unavailable');assert.equal(io.writes,0);
  const providerBlocked=await demoStaffBookingCommand(caseId,initial,form('confirm',2,{...terms,provider:'Fictional provider',obtainedAt:now.toISOString(),channel:'phone',source:'Fake source',preparation:'Fake preparation',replacesExisting:'on'}));assert.equal(providerBlocked.ok,false);assert.equal(io.writes,0);
  io.data.workflow.bookingRequests[0].pendingChange={kind:'reschedule',terms,memberAccepted:true};io.data.workflow.bookingRequests[0].status='change-pending';io.data.workflow.bookingRequests[0].proposal=structuredClone(io.data.workflow.bookingRequests[0].currentArrangement);
  assert.equal(demoBookingNeedsClinicalEligibility(io.data.workflow,{operation:'change-outcome',id,revision:2,commandId:'a',outcome:'accepted',source:{}}),true);
  const replacementBlocked=await demoStaffBookingCommand(caseId,initial,form('change-outcome',2,{outcome:'accepted',obtainedAt:now.toISOString(),channel:'phone',source:'Fake replacement'}));assert.equal(replacementBlocked.ok,false);assert.equal(io.writes,0);
  const declined=await demoStaffBookingCommand(caseId,initial,form('change-outcome',2,{outcome:'declined',obtainedAt:now.toISOString(),channel:'phone',source:'Fake decline'}));assert.equal(declined.ok,true);assert.equal(io.writes,1);assert.equal(io.data.workflow.bookings[0].status,'scheduled');
 }
 io.data=structuredClone(base);io.staff={id:'doctor',role:'doctor'};io.writes=0;
 assert.equal((await demoStaffBookingCommand(caseId,initial,form('change-outcome',2,{outcome:'declined',obtainedAt:now.toISOString(),channel:'phone',source:'Fake decline'}))).ok,false);assert.equal(io.writes,0);
 io.data.state.consentAccepted=false;assert.equal((await demoMemberBookingCommand(initial,form('cancel'))).ok,false);assert.equal(io.writes,0);
 console.log('Demo booking action boundary passed with mocked IO: incomplete/red cancellation and provider outcomes, blocked new/replacement arrangements, retained history, authenticated roles and consent.');
}finally{hook.deregister();delete globalThis.__demoBookingCheck;}
