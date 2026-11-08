import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import {NextRequest} from 'next/server';
// A hiccup at the auth service or its database is not a sign-out (QA A1-obs): the member gets a retry, not the sign-in
// page. A session that really ended still goes to sign-in. Auth is injected; no live requests.
type Resolution={url:string;shortCircuit?:boolean};
type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;
const {registerHooks}=nodeModule as unknown as {registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
const {AuthRetryableFetchError,AuthApiError,AuthSessionMissingError}=await import('@supabase/supabase-js');
let answer:{data:{user:unknown};error:unknown}={data:{user:null},error:null};
const client={auth:{getUser:async()=>answer}};
const shared={client,headers:{} as Record<string,string>};
Object.assign(globalThis,{__transient:shared});
const stub=(code:string)=>({url:'data:text/javascript,'+encodeURIComponent(code),shortCircuit:true});
const hook=registerHooks({resolve(s,c,next){
 if(s==='@supabase/ssr')return stub('export const createServerClient=()=>globalThis.__transient.client;');
 if(s==='@/lib/supabase/server')return stub('export const createClient=async()=>globalThis.__transient.client;');
 if(s==='server-only')return stub('');
 if(s==='next/navigation')return stub('export const redirect=(to)=>{throw Object.assign(new Error("redirect"),{to});};');
 if(s==='next/headers')return stub('export const headers=async()=>new Headers(globalThis.__transient.headers);');
 if(s==='@/lib/observability/context')return stub('export const noteActor=()=>{};');
 return next(s,c);
}});
const site='http://localhost:3000';
const member={id:'a0000000-0000-4000-8000-000000000001',phone:'37499000261',phone_confirmed_at:'2026-10-30T00:00:00Z'};
const transient:[string,unknown][]=[
 ['network failure',new AuthRetryableFetchError('fetch failed',0)],
 ['gateway timeout',new AuthRetryableFetchError('timed out',504)],
 ['auth database error',new AuthApiError('Database error querying schema',500,'unexpected_failure')],
 ['rate limit',new AuthApiError('Too many requests',429,'over_request_rate_limit')],
];
const ended:[string,unknown][]=[
 ['no session',new AuthSessionMissingError()],
 ['expired or revoked session',new AuthApiError('Session from session_id claim in JWT does not exist',403,'session_not_found')],
 ['invalid refresh token',new AuthApiError('Invalid Refresh Token',400,'refresh_token_not_found')],
 ['bad token',new AuthApiError('invalid JWT',401,'bad_jwt')],
];
try{
 Object.assign(process.env,{NODE_ENV:'development',NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_DEPLOYMENT_TARGET:'app',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:65431',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-test-only'});
 const {updateSession}=await import('@/lib/supabase/session');
 const {patientIdentity,patientIdentityForSave,requirePatient}=await import('@/lib/patient/auth');
 const page=()=>updateSession(new NextRequest(`${site}/patient/dashboard`,{headers:{cookie:'sb-x-auth-token=x'}}));
 for(const [label,error] of transient){
  answer={data:{user:null},error};
  const r=await page();
  assert.equal(r.status,200,`proxy, ${label}: not sent to sign-in`);
  assert.equal(r.headers.get('location'),null);
  await assert.rejects(patientIdentity(),/temporarily unavailable/,`patientIdentity, ${label}: not "signed out"`);
  await assert.rejects(patientIdentityForSave(),/temporarily unavailable/,`patientIdentityForSave, ${label}`);
  await assert.rejects(requirePatient(),/temporarily unavailable/,`requirePatient, ${label}: an error page with a retry, not a redirect`);
 }
 for(const [label,error] of ended){
  answer={data:{user:null},error};
  const r=await page();
  assert.equal(r.status,307,`proxy, ${label}: goes to sign-in`);
  assert.equal(new URL(r.headers.get('location')!).searchParams.get('next'),'/patient/dashboard');
  assert.equal(await patientIdentity(),null,`patientIdentity, ${label}`);
  await assert.rejects(requirePatient(),(e:{to?:string})=>e.to==='/patient',`requirePatient, ${label}: sign-in`);
 }
 answer={data:{user:member},error:null};
 assert.equal((await patientIdentity())?.userId,member.id);
 answer={data:{user:{...member,phone_confirmed_at:null}},error:null};
 assert.equal(await patientIdentity(),null,'an unverified phone is still not a member');
 // The last guard, for Zoe's chat action, which the proxy lets through while auth is down.
 answer={data:{user:member},error:null};
 shared.headers={'x-noreon-member-page':'b0000000-0000-4000-8000-000000000002'};
 await assert.rejects(patientIdentity(),/Another account/,'a page for another account gets no identity');
 shared.headers={'x-noreon-member-page':member.id};
 assert.equal((await patientIdentity())?.userId,member.id);
 shared.headers={};
 // Both chat screens keep their urgent path while auth is down; anything else is refused unchecked.
 const post=(path:string,action:boolean)=>updateSession(new NextRequest(`${site}${path}`,{method:'POST',headers:{cookie:'sb-x-auth-token=x','x-noreon-member-page':member.id,...(action?{'next-action':'x'}:{})}}));
 answer={data:{user:null},error:transient[0]![1]};
 for(const path of ['/patient/zoe','/patient/chat']){
  assert.notEqual((await post(path,true)).status,503,`${path}: a chat action reaches the red check during an outage`);
  assert.equal((await post(path,false)).status,503,`${path}: only a chat action passes unchecked`);
 }
 assert.equal((await post('/patient/care',true)).status,503,'another path stays refused during an outage');
 answer={data:{user:null},error:new AuthSessionMissingError()};
 const signedOut=await updateSession(new NextRequest(`${site}/patient/chat`,{headers:{cookie:'sb-x-auth-token=x'}}));
 assert.equal(new URL(signedOut.headers.get('location')!).searchParams.get('next'),'/patient/chat','a signed-out visit returns to the new chat');
 // Pages that must open without auth keep opening.
 const {readFileSync}=await import('node:fs');
 assert.match(readFileSync('app/patient/zoe/urgent/page.tsx','utf8'),/patientIdentity\(\)\.catch/,'the 103 screen never depends on auth');
 assert.match(readFileSync('app/patient/help/page.tsx','utf8'),/patientIdentity\(\)\.catch/,'help never depends on auth');
 assert.match(readFileSync('app/patient/actions.ts','utf8'),/const identity = await patientIdentity\(\)\.catch/,'sign-out still signs out');
 const errorPage=readFileSync('app/patient/error.tsx','utf8');
 assert.match(errorPage,/onClick=\{retry\}/,'the error page offers a retry');
 assert.match(errorPage,/href="tel:103"/,'and keeps the way to 103 (Astra R3)');
 const uploads=readFileSync('lib/member-history/ai-server.ts','utf8');
 assert.match(uploads,/try \{ c = await member\(\); \} catch \{ return \{ status: "unavailable" \}; \}/,'an upload command during an outage says try again, not sign in (Astra R5)');
}finally{hook.deregister();}
console.log('Member auth outage checks passed.');
