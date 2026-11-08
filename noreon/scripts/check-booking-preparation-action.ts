import assert from 'node:assert/strict';
// @ts-expect-error Node 26 runtime provides registerHooks; project declarations target Node 20.
import {registerHooks} from 'node:module';
import {createWorkflow,applyServiceCommand} from '@/lib/service-workflow/model';
const now=new Date();const day=new Date(now.getTime()+86400000).toISOString().slice(0,10);
const workflow=applyServiceCommand(createWorkflow([{id:'lab',title:'Demo lab',method:'lab',preparation:'',source:'demo'}],now),{type:'book',testIds:['lab'],at:`${day}T09:00:00+04:00`,mode:'home',address:'Hanrapetutyan 4a, 15'},now);
const f={shared:true,staff:null as null|{role:string;id:string},data:{userId:'fixture',state:{profile:{},consentAccepted:true,assessment:{answers:{},completedAt:now.toISOString()}},workflow},saved:[] as unknown[],conflict:false};
Object.assign(globalThis,{__bookingPreparationAction:f});
const source='const f=globalThis.__bookingPreparationAction;';
const hook=registerHooks({resolve(specifier:string,context:object,next:(s:string,c:object)=>object){
 let mock='';
 if(specifier==='next/cache')mock='export const revalidatePath=()=>{};';
 if(specifier==='@/lib/patient/demo')mock=source+'export const demoEnabled=()=>true;export const readDemo=async()=>structuredClone(f.data);export const saveDemo=async()=>{throw Error("Unexpected local save")};';
 if(specifier==='@/lib/service-workflow/server')mock='export const workflowForDemo=data=>structuredClone(data.workflow);';
 if(specifier==='@/lib/staff/auth')mock=source+'export const getStaff=async()=>f.staff;export const workspaceAdmin=()=>{throw Error("Unexpected clinical RPC")};';
 if(specifier==='@/lib/staff/cases')mock=source+'export const sharedDemoEnabled=()=>f.shared;export const getWorkspaceCase=async()=>({id:"fixture",revision:7,state:structuredClone(f.data)});export const findWorkspaceCase=async()=>null;export const assignedCaseDoctor=async()=>null;export const persistWorkspaceCase=async(data,key,actor)=>{if(f.conflict)throw Error("workspace case conflict");f.saved.push({data:structuredClone(data),key,actor});f.data=structuredClone(data)};';
 return mock ? {url:'data:text/javascript,'+encodeURIComponent(mock),shortCircuit:true}:next(specifier,context);
}});
try{
 const {serviceCommand}=await import('@/app/patient/service/actions');
 const c={type:'record-provider-preparation',bookingId:workflow.bookings[0].id,provider:'Fictional lab',instructions:'Provider-supplied fixture text only.'} as const;
 assert.equal((await serviceCommand(c,workflow.revision)).ok,false);
 assert.equal((await serviceCommand(c,workflow.revision,'fixture')).ok,false);
 f.staff={role:'doctor',id:'doctor'};assert.equal((await serviceCommand(c,workflow.revision,'fixture')).ok,false);
 f.staff={role:'admin',id:'ops'};
 assert.match((await serviceCommand(c,workflow.revision+1,'fixture')).error??'',/changed/);
 f.conflict=true;assert.match((await serviceCommand(c,workflow.revision,'fixture')).error??'',/conflict/);f.conflict=false;
 assert.equal(f.saved.length,0);
 assert.equal((await serviceCommand(c,workflow.revision,'fixture')).ok,true);
 assert.equal(f.saved.length,1);assert.equal((f.saved[0] as {actor:string}).actor,'ops');
 assert.equal(f.data.workflow.bookings[0].providerPreparation?.instructions,c.instructions);
 assert.deepEqual(f.data.workflow.receivedTestIds,[]);
 f.shared=false;assert.equal((await serviceCommand(c,f.data.workflow.revision,'fixture')).ok,false);
 console.log('Actual server action with mocked auth/storage: member, missing staff, doctor, stale revision, conflict, admin save and disabled shared mode passed.');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__bookingPreparationAction');}
