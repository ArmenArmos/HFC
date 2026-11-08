import assert from 'node:assert/strict';
// @ts-expect-error Runtime Node supports registerHooks; declarations target Node20.
import {registerHooks} from 'node:module';
const mock='data:text/javascript,'+encodeURIComponent(`export let calls=0;export async function dispatchMessages(){calls++;return {halted:null};}`);
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){return s==='@/lib/messaging/dispatch'?{url:mock,shortCircuit:true}:next(s,c);}});
const names=['CRON_SECRET','NOREON_MESSAGE_DELIVERY_ENABLED','NOREON_MESSAGE_RECOVERY_READY'];const old=Object.fromEntries(names.map(k=>[k,process.env[k]]));
try{
 const {GET}=await import('@/app/api/internal/message-dispatch/route');const state=await import(mock);
 Object.assign(process.env,{CRON_SECRET:'fictional-cron-secret',NOREON_MESSAGE_DELIVERY_ENABLED:'true',NOREON_MESSAGE_RECOVERY_READY:'true'});
 const request=(token='fictional-cron-secret')=>new Request('https://app.example.com/api/internal/message-dispatch',{headers:{authorization:'Bearer '+token}});
 assert.equal((await GET(request('wrong'))).status,404);assert.equal(state.calls,0);
 assert.equal((await GET(request())).status,200);assert.equal(state.calls,1);
 delete process.env.NOREON_MESSAGE_DELIVERY_ENABLED;assert.equal((await GET(request())).status,404);assert.equal(state.calls,1);
 process.env.NOREON_MESSAGE_DELIVERY_ENABLED='true';delete process.env.NOREON_MESSAGE_RECOVERY_READY;assert.equal((await GET(request())).status,404);assert.equal(state.calls,1);
}finally{hook.deregister();for(const k of names){if(old[k]===undefined)delete process.env[k];else process.env[k]=old[k];}}
console.log('Dispatch route requires cron authentication, real mode, explicit delivery and recovery activation; disabled requests do no work.');
