import assert from 'node:assert/strict';
// @ts-expect-error Runtime supports registerHooks; declarations target Node 20.
import {registerHooks} from 'node:module';
const f={quota:1,outage:false,authCalls:0,claims:[] as Array<Record<string,string>>,clears:[] as Array<Record<string,string>>,ip:'203.0.113.1'};
Object.assign(globalThis,{__admissionLogin:f});
const setup='const f=globalThis.__admissionLogin;';
const hook=registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){
 if(s==='next/headers')return {url:'data:text/javascript,'+encodeURIComponent(setup+`export const headers=async()=>new Headers({'host':'doctors.noreon.health','x-vercel-forwarded-for':f.ip});`),shortCircuit:true};
 if(s==='next/navigation')return {url:'data:text/javascript,'+encodeURIComponent(`export function redirect(url){throw Object.assign(Error(url),{digest:'NEXT_REDIRECT'})}`),shortCircuit:true};
 if(s==='./auth'||s==='@/lib/staff/auth')return {url:'data:text/javascript,'+encodeURIComponent(setup+`export const requireStaff=async()=>({id:'doctor'});export const workspaceAuthClient=async()=>({auth:{signInWithPassword:async()=>{f.authCalls++;return {data:{user:{id:'doctor'}},error:null}},signOut:async()=>{}}});export function workspaceAdmin(){return {rpc:async(name,args)=>{if(name==='claim_workspace_admission'){f.claims.push(args);return {data:f.quota,error:f.outage?{}:null}}if(name==='clear_workspace_login_source'){f.clears.push(args);return {error:null}}throw Error('legacy email-wide throttle used')},from:table=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='workspace_staff'?{role:'doctor',active:true,clinic_id:'clinic'}:{active:true},error:null})};return q}}}`),shortCircuit:true};
 return next(s,c);
}});
process.env.VERCEL='1';process.env.NOREON_WORKSPACE_SERVICE_ROLE_KEY='fictional-admission-test-secret-at-least-32';
try{
 const {login,loginForm}=await import('@/lib/staff/actions');
 const form=new FormData();form.set('email','Doctor@Example.invalid');form.set('password','fictional-test-password');
 Object.assign(process.env,{NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_SHARED_DEMO:'false',NOREON_DEPLOYMENT_TARGET:'app'});
 await assert.rejects(login(form),/\/staff\/login\?error=1/);assert.equal(f.authCalls,0);assert.equal(f.claims.length,0,'Real mode must not admit legacy demo authentication');
 Object.assign(process.env,{NEXT_PUBLIC_PATIENT_DEMO:'true',NOREON_SHARED_DEMO:'true',NOREON_DEPLOYMENT_TARGET:'demo'});
 await assert.rejects(login(form),/\/staff\/login\?error=1/);assert.equal(f.authCalls,0);
 f.quota=0;f.outage=true;await assert.rejects(login(form),/\/staff\/login\?error=1/);assert.equal(f.authCalls,0);
 f.outage=false;await assert.rejects(login(form),/\/staff\/doctor/);assert.equal(f.authCalls,1);assert.equal(f.clears.length,1);
 assert.equal(f.clears[0].p_source,f.claims.at(-1)!.p_source);assert.equal(f.clears[0].p_email,f.claims.at(-1)!.p_email);
 f.ip='203.0.113.2';await assert.rejects(login(form),/\/staff\/doctor/);
 assert.notEqual(f.claims[0].p_source,f.claims.at(-1)!.p_source);assert.equal(f.claims[0].p_email,f.claims.at(-1)!.p_email);
 // QA 188: the form action returns a failure to the form (no reload, nothing in the URL) and still redirects on success.
 f.outage=true;assert.deepEqual(await loginForm({failed:0},form),{failed:1},'A refused attempt stays on the form');
 assert.deepEqual(await loginForm({failed:1},form),{failed:2},'Each refused attempt is a new state, so the form refocuses the password');
 f.outage=false;await assert.rejects(loginForm({failed:2},form),/\/staff\/doctor/,'Success still redirects to the workspace');
 console.log('Demo staff login rejects real mode, gates authentication on source admission, fails closed, and clears only the successful source/email pair.');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__admissionLogin');}
