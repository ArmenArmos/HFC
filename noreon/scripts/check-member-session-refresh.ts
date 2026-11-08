import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import {NextRequest} from 'next/server';
// Member session refresh (FINDINGS 2026-10-17): every /patient request, including server actions
// and RSC navigations, refreshes through the proxy, and the refreshed cookies reach both the
// downstream request and the browser as persistent cookies with no-store headers. Signing out
// ends only this device's session. Auth is injected; no live requests.
type Resolution={url:string;shortCircuit?:boolean};
type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;
const {registerHooks}=nodeModule as unknown as {registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
const NO_STORE={'cache-control':'private, no-cache, no-store, must-revalidate, max-age=0',expires:'0',pragma:'no-cache'};
const COOKIE='sb-makyulcjgqffiuzbhyte-auth-token';
let refreshCalls=0,signedIn=true,refresh=true;
const signOuts:unknown[]=[];
type SetAll=(v:{name:string;value:string;options:Record<string,unknown>}[],h:Record<string,string>)=>void;
Object.assign(globalThis,{__memberSession:{create:(_url:string,_key:string,options:{cookieOptions?:unknown;cookies:{getAll:()=>{name:string;value:string}[];setAll:SetAll}})=>{
 // The member client keeps @supabase/ssr's default cookie (persistent, 400 days), not a staff/clinic name.
 assert.equal(options.cookieOptions,undefined);
 return {auth:{
  getUser:async()=>{
   refreshCalls++;
   assert.ok(options.cookies.getAll().some(c=>c.name===COOKIE),'the proxy reads the member cookie');
   if(refresh)options.cookies.setAll([{name:COOKIE,value:'synthetic-refreshed',options:{path:'/',sameSite:'lax',httpOnly:false,maxAge:400*24*60*60}}],NO_STORE);
   return {data:{user:signedIn?{id:'synthetic-member'}:null},error:null};
  },
  signOut:async(arg:unknown)=>{signOuts.push(arg);return {error:null};},
 }};
}}});
const hook=registerHooks({resolve(s,c,next){
 if(s==='@supabase/ssr')return {url:'data:text/javascript,'+encodeURIComponent('export const createServerClient=(...args)=>globalThis.__memberSession.create(...args);'),shortCircuit:true};
 if(s==='@/lib/supabase/server')return {url:'data:text/javascript,'+encodeURIComponent('export const createClient=async()=>globalThis.__memberSession.create("","",{cookies:{getAll:()=>[{name:"'+COOKIE+'",value:"x"}],setAll(){}}});'),shortCircuit:true};
 return next(s,c);
}});
try{
 Object.assign(process.env,{NODE_ENV:'development',NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_DEPLOYMENT_TARGET:'app',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:65431',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-test-only'});
 const {updateSession}=await import('@/lib/supabase/session');
 const {proxy}=await import('../proxy');
 const cookie=`${COOKIE}=synthetic-stale; noreon-real-staff-auth=synthetic-staff`;
 const variants:Array<[string,{method?:string;headers:Record<string,string>}]>=[
  ['page load',{headers:{cookie}}],
  ['server action',{method:'POST',headers:{cookie,'next-action':'synthetic-action-id','content-type':'text/plain;charset=UTF-8'}}],
  ['RSC navigation',{headers:{cookie,rsc:'1','next-router-state-tree':'%5B%5D'}}],
 ];
 for(const [label,init] of variants){
  const before=refreshCalls;
  const request=new NextRequest('http://localhost:3000/patient/dashboard',init);
  const response=await updateSession(request);
  assert.equal(refreshCalls,before+1,`${label}: refreshes once`);
  assert.equal(response.status,200,`${label}: not redirected`);
  const set=response.cookies.get(COOKIE);
  assert.equal(set?.value,'synthetic-refreshed',`${label}: refreshed cookie written back`);
  assert.equal(set?.maxAge,400*24*60*60,`${label}: persistent cookie, survives app restarts`);
  assert.equal(set?.sameSite,'lax');assert.equal(set?.path,'/');
  assert.equal(request.cookies.get(COOKIE)?.value,'synthetic-refreshed',`${label}: downstream render sees the new token`);
  assert.equal(response.headers.get('cache-control'),NO_STORE['cache-control'],`${label}: refreshed response is not cacheable`);
  assert.equal(response.cookies.get('noreon-real-staff-auth'),undefined,`${label}: staff cookie untouched`);
 }
 // The proxy itself sends member pages, actions and navigations through the refresh.
 for(const [label,init] of variants){
  const before=refreshCalls;
  const response=await proxy(new NextRequest('http://localhost:3000/patient/questions',init));
  assert.equal(refreshCalls,before+1,`proxy ${label}: refreshes`);
  assert.equal(response.cookies.get(COOKIE)?.value,'synthetic-refreshed',`proxy ${label}: cookie persisted`);
 }
 // No refresh needed: nothing is written and nothing is forced uncacheable.
 refresh=false;
 const quiet=await updateSession(new NextRequest('http://localhost:3000/patient/dashboard',{headers:{cookie}}));
 assert.equal(quiet.cookies.get(COOKIE),undefined);assert.equal(quiet.headers.get('cache-control'),null);
 // A signed-out member on a protected page goes to sign-in with the return path.
 signedIn=false;
 const out=await updateSession(new NextRequest('http://localhost:3000/patient/dashboard',{headers:{cookie}}));
 assert.equal(out.status,307);assert.equal(new URL(out.headers.get('location')!).pathname,'/patient');
 assert.equal(new URL(out.headers.get('location')!).searchParams.get('next'),'/patient/dashboard');
 const notice='/patient/chat?notice=11111111-1111-4111-8111-111111111111';
 const pushed=await updateSession(new NextRequest(`http://localhost:3000${notice}`,{headers:{cookie}}));
 assert.equal(new URL(pushed.headers.get('location')!).searchParams.get('next'),notice,'Push target survives an expired session');
 const invalid=await updateSession(new NextRequest('http://localhost:3000/patient/chat?notice=untrusted',{headers:{cookie}}));
 assert.equal(new URL(invalid.headers.get('location')!).searchParams.get('next'),'/patient/chat','Invalid notice cannot enter the continuation');
 // Every page a one-tap Telegram link opens keeps its destination through sign-in (night QA F-1: /patient/zoe lost it).
 const {CONTINUE_PATHS}=await import('@/lib/patient/continue-path');
 for(const path of Object.values(CONTINUE_PATHS)){
  const r=await updateSession(new NextRequest(`http://localhost:3000${path}`,{headers:{cookie}}));
  assert.equal(r.status,307,`${path}: signed-out visit is sent to sign-in`);
  assert.equal(new URL(r.headers.get('location')!).searchParams.get('next'),path,`${path}: keeps ?next=`);
 }
 // The 103 screen opens with no session (Astra TG-R1), and nothing beside it does.
 assert.equal((await updateSession(new NextRequest('http://localhost:3000/patient/zoe/urgent',{headers:{cookie}}))).status,200,'signed out: the 103 screen opens');
 assert.equal((await updateSession(new NextRequest('http://localhost:3000/patient/zoe/urgent/other',{headers:{cookie}}))).status,307,'only that exact path');
 assert.equal((await updateSession(new NextRequest('http://localhost:3000/patient/zoe',{headers:{cookie}}))).status,307,'the chat still needs a session');
 // An action reaches the server signed out and checks its own session (Astra TG-R1, for every action since BC-05: a
 // redirect lost the form's reply, and the same action is reachable from /patient anyway). Pages and plain POSTs do not.
 const post=(path:string,headers:Record<string,string>)=>updateSession(new NextRequest(`http://localhost:3000${path}`,{method:'POST',headers:{cookie,...headers}}));
 assert.equal((await post('/patient/zoe',{'next-action':'synthetic-action-id'})).status,200,'signed out: a Zoe chat action passes');
 assert.equal((await post('/patient/zoe',{})).status,307,'a POST that is no action does not');
 assert.equal((await post('/patient/dashboard',{'next-action':'synthetic-action-id'})).status,200,'an action on another page answers for itself too');
 assert.equal((await post('/patient/dashboard',{})).status,307,'a plain POST there still goes to sign in');
 assert.equal((await updateSession(new NextRequest('http://localhost:3000/patient/zoe',{headers:{cookie,'next-action':'synthetic-action-id'}}))).status,307,'a GET with the header does not');
 // Signing out on one device must not end the installed app's session on another.
 const {signOut}=await import('@/app/patient/actions');
 assert.deepEqual(await signOut(),{ok:true});
 assert.deepEqual(signOuts,[{scope:'local'}],'member sign-out is local to this device');
 console.log('Member session refresh persists cookies on page loads, server actions and RSC navigations; sign-out is local PASS (injected Auth, no live requests).');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__memberSession');}
