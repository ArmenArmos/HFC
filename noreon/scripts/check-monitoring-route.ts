import assert from 'node:assert/strict';
// @ts-expect-error Node 26 runtime provides registerHooks; project declarations target Node 20.
import {registerHooks} from 'node:module';
const fixture={enabled:true,candidates:['a','b'],candidateError:false,failCase:'',calls:[] as {name:string;args:unknown}[]};
Object.assign(globalThis,{__noreonMonitoringRouteFixture:fixture});
const source='const f=globalThis.__noreonMonitoringRouteFixture;';
const hook=registerHooks({resolve(specifier:string,context:object,next:(specifier:string,context:object)=>object){
 if(specifier==='@/lib/staff/cases'||specifier==='./cases')return {url:'data:text/javascript,'+encodeURIComponent(source+'export const sharedDemoEnabled=()=>f.enabled;'),shortCircuit:true};
 if(specifier==='./auth')return {url:'data:text/javascript,'+encodeURIComponent(source+`export const workspaceAdmin=()=>({rpc:(name,args)=>({abortSignal(){return this},then(resolve){f.calls.push({name,args});return Promise.resolve(name==='workspace_due_monitoring_cases'?{data:f.candidates,error:f.candidateError?{}:null}:{data:1,error:args.p_id===f.failCase?{}:null}).then(resolve);}})});`),shortCircuit:true};
 if(specifier==='server-only')return {url:'data:text/javascript,export {};',shortCircuit:true};
 return next(specifier,context);
}});
const old=process.env.CRON_SECRET;process.env.CRON_SECRET='fictional-test-only';
try {
 const {GET}=await import('@/app/api/internal/monitoring-follow-up/route');
 const request=(auth='Bearer fictional-test-only')=>new Request('http://localhost/api/internal/monitoring-follow-up',{headers:{authorization:auth}});
 assert.equal((await GET(request('Bearer wrong'))).status,404);assert.equal(fixture.calls.length,0);
 fixture.enabled=false;assert.equal((await GET(request())).status,404);assert.equal(fixture.calls.length,0);fixture.enabled=true;
 let response=await GET(request());assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');assert.deepEqual(await response.json(),{processed:2,failed:0,hasMore:false});
 assert.deepEqual(fixture.calls[0],{name:'workspace_due_monitoring_cases',args:{p_actor:undefined,p_limit:100,p_excluded:[]}});
 fixture.failCase='b';response=await GET(request());assert.equal(response.status,503);assert.deepEqual(await response.json(),{processed:1,failed:1,hasMore:true});
 fixture.candidateError=true;assert.equal((await GET(request())).status,503);
 fixture.candidateError=false;fixture.candidates=[];response=await GET(request());assert.deepEqual(await response.json(),{processed:0,failed:0,hasMore:false});
 console.log('Actual monitoring cron route: authorization, disabled mode, bounded dispatch, partial failure, query failure and empty batch passed.');
}finally{if(old===undefined)delete process.env.CRON_SECRET;else process.env.CRON_SECRET=old;hook.deregister();Reflect.deleteProperty(globalThis,'__noreonMonitoringRouteFixture');}
