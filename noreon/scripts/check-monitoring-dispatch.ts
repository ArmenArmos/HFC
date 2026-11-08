import assert from 'node:assert/strict';
// @ts-expect-error Node 24 runtime hook; project types target Node 20.
import {registerHooks} from 'node:module';
const f={pending:Array.from({length:205},(_,i)=>`case-${i}`),failed:new Set<string>(),active:0,maxActive:0,calls:[] as string[],enabled:true,queryError:false,clock:0,advance:0};
Object.assign(globalThis,{__monitoringDispatch:f});
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='./cases')return {url:'data:text/javascript,export const sharedDemoEnabled=()=>globalThis.__monitoringDispatch.enabled;',shortCircuit:true};
 if(s==='./auth')return {url:'data:text/javascript,'+encodeURIComponent(`const f=globalThis.__monitoringDispatch;export const workspaceAdmin=()=>({rpc(name,args){return {abortSignal(){return this},then(resolve,reject){return (async()=>{if(name==='workspace_due_monitoring_cases'){return {data:f.pending.filter(id=>!(args.p_excluded??[]).includes(id)).slice(0,args.p_limit),error:f.queryError?{}:null}}if(name!=='workspace_reconcile_monitoring')throw Error('unexpected RPC');f.calls.push(args.p_id);f.clock+=f.advance;f.active++;f.maxActive=Math.max(f.maxActive,f.active);await new Promise(r=>setImmediate(r));f.active--;if(f.failed.has(args.p_id))return {error:{message:'failed'},data:null};f.pending=f.pending.filter(x=>x!==args.p_id);return {data:1,error:null};})().then(resolve,reject)}}}});`),shortCircuit:true};
 return next(s,c);
}});
try{
 const {dispatchMonitoring}=await import('@/lib/staff/monitoring-dispatch');
 let result=await dispatchMonitoring();assert.equal(result.processed,205,'One scheduled invocation must catch up more than one page');assert.equal(result.failed,0);assert.equal(f.pending.length,0);assert.ok(f.maxActive<=5);assert.ok(f.maxActive>1);
 f.pending=Array.from({length:105},(_,i)=>`retry-${i}`);f.failed.add('retry-0');f.calls=[];
 result=await dispatchMonitoring();assert.equal(result.failed,1);assert.equal(result.processed,104);assert.equal(f.calls.filter(x=>x==='retry-0').length,1,'Failed cases are retried next schedule, not looped in the same invocation');
 f.pending=Array.from({length:150},(_,i)=>`blocked-${i}`);f.failed=new Set(f.pending.slice(0,100));f.calls=[];result=await dispatchMonitoring();assert.equal(result.processed,50,'100 failures must not starve later due cases');assert.equal(result.failed,100);assert.equal(new Set(f.calls).size,150);
 f.pending=Array.from({length:1100},(_,i)=>`cap-${i}`);f.failed.clear();f.calls=[];result=await dispatchMonitoring();assert.equal(f.calls.length,1000);assert.equal(f.pending.length,100);assert.equal(result.hasMore,true);
 const realNow=Date.now;try{f.pending=Array.from({length:100},(_,i)=>`time-${i}`);f.calls=[];f.clock=0;f.advance=10_000;Date.now=()=>f.clock;result=await dispatchMonitoring();assert.equal(f.calls.length,5);assert.equal(result.hasMore,true);}finally{Date.now=realNow;f.advance=0;}
 f.queryError=true;await assert.rejects(dispatchMonitoring,/unavailable/);f.queryError=false;
 f.enabled=false;f.calls=[];result=await dispatchMonitoring();assert.equal(result.processed,0);assert.equal(f.calls.length,0);
 console.log('Scheduled follow-up drains multiple pages with bounded concurrency and does not loop failed cases.');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__monitoringDispatch');}
