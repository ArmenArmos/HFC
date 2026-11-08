import assert from 'node:assert/strict';
// @ts-expect-error Node 24 runtime hook; project declarations target Node 20.
import {registerHooks} from 'node:module';
const fixture={due:['case'],throws:false,queryError:false,filters:[] as unknown[],role:'doctor',writes:0};
Object.assign(globalThis,{__noreonQueueFixture:fixture});
const source='const f=globalThis.__noreonQueueFixture;';
const hook=registerHooks({resolve(specifier:string,context:object,next:(specifier:string,context:object)=>object){
 if(specifier==='./monitoring-dispatch')return {url:'data:text/javascript,'+encodeURIComponent(source+`export async function dispatchMonitoring(){f.writes++;return {processed:1,failed:0};}`),shortCircuit:true};
 if(specifier==='./auth')return {url:'data:text/javascript,'+encodeURIComponent(source+`export async function requireStaff(){return {id:'doctor',role:f.role};}export const workspaceAdmin=()=>({rpc(name,args){if(name!=='workspace_due_monitoring_cases'||args.p_actor!=='doctor'||args.p_limit!==1)throw Error('Unexpected write or unscoped read');return {abortSignal(){return this},then(resolve,reject){return (f.throws?Promise.reject(Error('unavailable')):Promise.resolve({data:f.due,error:null})).then(resolve,reject)}}},from(){const q={select(){return q;},eq(...a){f.filters.push(a);return q;},gt(){return q;},order(){return q;},then(resolve){return Promise.resolve({data:[{id:'case',state:{},revision:1,assigned_doctor_id:'doctor',expires_at:'2026-10-12',evidence_revision:1,reviewed_evidence_revision:0,review_tasks:[],followups:[]}],error:f.queryError?{}:null}).then(resolve);}};return q;}});`),shortCircuit:true};
 return next(specifier,context);
}});
try {
 const {listCases}=await import('@/lib/staff/admin');
 let result=await listCases();assert.equal(fixture.writes,0,'Opening staff queue must not dispatch writes');assert.equal(result.cases.length,1);assert.match(result.monitoringWarning??'',/pending/i);assert.ok(fixture.filters.some(x=>JSON.stringify(x)==='["assigned_doctor_id","doctor"]'));
 fixture.throws=true;result=await listCases();assert.equal(result.cases.length,1);assert.match(result.monitoringWarning??'',/could not/i);
 fixture.throws=false;fixture.due=[];result=await listCases();assert.equal(result.monitoringWarning,null);
 fixture.queryError=true;await assert.rejects(listCases(),/Could not load cases/);
 console.log('Queue reads never dispatch writes; role-scoped pending/unavailable status is visible without hiding cases.');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__noreonQueueFixture');}
