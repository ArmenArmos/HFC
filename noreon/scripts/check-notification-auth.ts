import assert from 'node:assert/strict';
// @ts-expect-error Runtime supports registerHooks; declarations target Node 20.
import {registerHooks} from 'node:module';
const f={signedIn:false,outage:false,queries:0};Object.assign(globalThis,{__notificationAuth:f});
const setup='const f=globalThis.__notificationAuth;';
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='@/lib/staff/auth')return {url:'data:text/javascript,'+encodeURIComponent(setup+`export const getStaff=async()=>f.signedIn?{id:'doctor',role:'doctor'}:null;export const requireStaff=async()=>{if(!f.signedIn)throw Error('NEXT_REDIRECT');return {id:'doctor',role:'doctor'}};export function workspaceAdmin(){f.queries++;if(f.outage)throw Error('storage unavailable');const q=new Proxy({},{get(_t,p){if(p==='then')return r=>r({data:[],error:null});return ()=>q;}});return {from:()=>q};}`),shortCircuit:true};
 if(s==='@/lib/staff/cases')return {url:'data:text/javascript,'+encodeURIComponent(setup+`export const requireMemberCase=async()=>{if(!f.signedIn)throw Error('unauthorized');return {id:'member'}};export const getWorkspaceCase=async()=>({id:'member'});`),shortCircuit:true};
 if(s==='@/lib/staff/request')return {url:'data:text/javascript,export const sameWorkspaceOrigin=()=>true;',shortCircuit:true};
 return next(s,c);
}});
try{
 const {notificationsGet,notificationsPost}=await import('@/lib/notifications/http');
 for(const staff of [false,true]){
  f.signedIn=false;f.queries=0;
  assert.equal((await notificationsGet(staff)).status,401);
  assert.equal((await notificationsPost(new Request('http://localhost/feed',{method:'POST',body:'{"id":1}'}),staff)).status,401);
  assert.equal(f.queries,0,'signed-out calls must not query inbox');
  f.signedIn=true;f.outage=false;const ok=await notificationsGet(staff);assert.equal(ok.status,200);assert.deepEqual(await ok.json(),{items:[]});
  f.outage=true;const failed=await notificationsGet(staff);assert.equal(failed.status,503);assert.equal(failed.headers.get('cache-control'),'no-store');
 }
 console.log('Actual notification identity/HTTP paths return 401 signed out, 200 authenticated and 503 for storage failure.');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__notificationAuth');}
