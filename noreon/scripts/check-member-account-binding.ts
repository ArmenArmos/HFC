import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import {readFileSync} from 'node:fs';
import {NextRequest} from 'next/server';
// A stale tab must not write to whoever signed in last on a shared browser (QA a6-01), or receive their data through a
// soft navigation or a poll (BC-02). Each member page carries the account it was rendered for; a request from it that
// reaches the proxy under a different session is refused before any action, page or route runs, and the tab says so.
// A tab that does not know its account never takes a member page in place. Auth is injected; no live requests.
type Resolution={url:string;shortCircuit?:boolean};
type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;
const {registerHooks}=nodeModule as unknown as {registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
const A='a0000000-0000-4000-8000-000000000001',B='b0000000-0000-4000-8000-000000000002';
const COOKIE='sb-makyulcjgqffiuzbhyte-auth-token';
const BINDING='x-noreon-member-page',REFUSED='x-noreon-account-changed',UNCHECKED='x-noreon-account-unchecked',VERIFIED='x-noreon-verified-member';
let sessionUser:string|null=B,refresh=false,getUserCalls=0,authError:unknown=null;
type SetAll=(v:{name:string;value:string;options:Record<string,unknown>}[],h:Record<string,string>)=>void;
Object.assign(globalThis,{__binding:{create:(_u:string,_k:string,options:{cookies:{setAll:SetAll}})=>({auth:{getUser:async()=>{
 getUserCalls++;
 if(refresh)options.cookies.setAll([{name:COOKIE,value:'synthetic-refreshed',options:{path:'/'}}],{});
 return {data:{user:sessionUser?{id:sessionUser}:null},error:authError};
}}})}});
const hook=registerHooks({resolve(s,c,next){
 if(s==='@supabase/ssr')return {url:'data:text/javascript,'+encodeURIComponent('export const createServerClient=(...args)=>globalThis.__binding.create(...args);'),shortCircuit:true};
 return next(s,c);
}});
const site='http://localhost:3000';
const write=(path:string,headers:Record<string,string>={},method='POST')=>new NextRequest(`${site}${path}`,{method,headers:{cookie:`${COOKIE}=x`,...headers}});
try{
 Object.assign(process.env,{NODE_ENV:'development',NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_DEPLOYMENT_TARGET:'app',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:65431',NEXT_PUBLIC_SUPABASE_ANON_KEY:'synthetic-test-only'});
 const {updateSession}=await import('@/lib/supabase/session');
 const {proxy}=await import('../proxy');
 const action={'next-action':'synthetic-action-id',[BINDING]:A};
 // The reported case: A's page, B's session, on a server action.
 for(const path of ['/patient/medicines','/patient/zoe','/patient/measurements/new','/patient/care','/patient/answers','/patient/progress/earlier/upload']){
  const r=await updateSession(write(path,action));
  assert.equal(r.status,409,`${path}: a write for A under B's session is refused`);
  assert.equal(r.headers.get(REFUSED),'1',`${path}: the tab can tell this refusal from any other 409`);
  assert.equal(r.headers.get('x-middleware-next'),null,`${path}: the action never runs`);
  assert.equal(r.headers.get('cache-control'),'no-store');
 }
 // The route handlers under /api/patient are outside the member prefix, so the proxy must look at them too.
 const api=await proxy(write('/api/patient/reports',{[BINDING]:A,origin:site}));
 assert.equal(api.status,409,'a report write for A under B\'s session is refused');
 assert.equal(api.headers.get(REFUSED),'1');
 // Same account: untouched, including after a token refresh.
 assert.equal((await updateSession(write('/patient/medicines',{'next-action':'x',[BINDING]:B}))).status,200,'the account the page was rendered for writes');
 assert.equal((await proxy(write('/api/patient/reports',{[BINDING]:B,origin:site}))).status,200);
 // A refresh that happens on the refused request is not lost: refresh tokens rotate, so dropping it would sign B out.
 refresh=true;
 const refused=await updateSession(write('/patient/medicines',action));
 assert.equal(refused.status,409);assert.equal(refused.cookies.get(COOKIE)?.value,'synthetic-refreshed','the refreshed session reaches the browser');
 refresh=false;
 // No page binding (sign-in forms, older tabs): the session decides, as before.
 assert.equal((await updateSession(write('/patient',{'next-action':'x'}))).status,200,'a sign-in form has no binding');
 // Signed out, the action checks its own session; an ended session never costs the red check (Astra TG-R1).
 sessionUser=null;
 assert.equal((await updateSession(write('/patient/zoe',action))).status,200,'no session is not another account');
 // BC-05: any action answers an ended session itself, so the form keeps what was typed; the page is still sent to sign in.
 for(const path of ['/patient/measurements/new','/patient/account','/patient/care']){
  assert.equal((await updateSession(write(path,action))).status,200,`${path}: the action reaches its own session check`);
  assert.equal((await updateSession(write(path,{},'GET'))).status,307,`${path}: the page goes to sign in`);
 }
 assert.equal((await updateSession(write('/patient/measurements/new',{[BINDING]:A}))).status,307,'a POST that is not an action gets no pass');
 sessionUser=B;
 // A tab rendered with no account cannot write under a session, whoever's it is (Astra R1).
 const unbound={'next-action':'x',[BINDING]:'none'};
 for(const user of [A,B]){
  sessionUser=user;
  const r=await updateSession(write('/patient/medicines',unbound));
  assert.equal(r.status,409,'no binding under a session is refused');assert.equal(r.headers.get(REFUSED),'1');
 }
 assert.equal((await proxy(write('/api/patient/reports',{[BINDING]:'none',origin:site}))).status,409,'routes too');
 sessionUser=null;
 assert.equal((await updateSession(write('/patient/zoe',unbound))).status,200,'signed out, the action meets its own session check');
 sessionUser=B;
 // Auth down: the session cannot be compared, so a bound write does not run (Astra R1). Nothing is signed out by it.
 sessionUser=null;authError={status:503};
 for(const path of ['/patient/medicines','/patient/answers']){
  const r=await updateSession(write(path,action));
  assert.equal(r.status,503,`${path}: unchecked is not allowed through`);
  assert.equal(r.headers.get(UNCHECKED),'1');assert.equal(r.headers.get('x-middleware-next'),null);
 }
 assert.equal((await proxy(write('/api/patient/reports',{[BINDING]:A,origin:site}))).status,503,'routes too');
 assert.equal((await updateSession(write('/patient/zoe',action))).status,200,'urgent text still reaches the red check');
 assert.equal((await updateSession(write('/patient/medicines',{'next-action':'x'}))).status,200,'an unbound request meets its own session check, as before');
 sessionUser=B;authError=null;
 // BC-02, the two routes a stale tab reads through. Both are refused before the page or route runs, by the same check
 // as a write and with the same marker: a soft navigation (an RSC GET, which never re-renders the layout) and a poll.
 const rsc={rsc:'1',[BINDING]:A};
 for(const path of ['/patient/account','/patient/dashboard','/patient/zoe','/patient/medicines']){
  const r=await proxy(write(path,rsc,'GET'));
  assert.equal(r.status,409,`${path}: a soft navigation of A's tab under B's session is refused`);
  assert.equal(r.headers.get(REFUSED),'1',`${path}: the tab can tell`);
  assert.equal(r.headers.get('x-middleware-next'),null,`${path}: the page never renders`);
  assert.equal(r.headers.get('cache-control'),'no-store');
 }
 for(const path of ['/api/patient/zoe/thread','/api/patient/zoe/cards','/api/patient/reports']){
  const r=await proxy(write(path,{[BINDING]:A},'GET'));
  assert.equal(r.status,409,`${path}: a poll of A's tab under B's session is refused`);
  assert.equal(r.headers.get(REFUSED),'1');assert.equal(r.headers.get('x-middleware-next'),null,`${path}: the route never runs`);
 }
 // The same reads for the account the tab belongs to are untouched, and a read of no account under a session is refused.
 assert.equal((await proxy(write('/patient/account',{rsc:'1',[BINDING]:B},'GET'))).status,200,'its own soft navigation');
 assert.equal((await proxy(write('/api/patient/zoe/thread',{[BINDING]:B},'GET'))).status,200,'its own poll');
 assert.equal((await proxy(write('/api/patient/zoe/thread',{[BINDING]:'none'},'GET'))).status,409,'fail closed: an unknown binding gets no one\'s data');
 // No session is not another account: the page sends it to sign in and the route answers 401, as before.
 sessionUser=null;
 assert.equal((await proxy(write('/patient/account',rsc,'GET'))).status,307,'an ended session goes to sign in');
 assert.equal((await proxy(write('/api/patient/zoe/thread',{[BINDING]:A},'GET'))).status,200,'the route answers for itself');
 // Auth down: the session cannot be compared, so no bound read runs either; the tab tries again and then fails as offline.
 authError={status:503};
 for(const [path,headers] of [['/patient/account',rsc],['/api/patient/zoe/thread',{[BINDING]:A}]] as const){
  const r=await proxy(write(path,headers,'GET'));
  assert.equal(r.status,503,`${path}: an unchecked read does not run`);assert.equal(r.headers.get(UNCHECKED),'1');
 }
 sessionUser=B;authError=null;
 // An unbound read (a document load, the native app) meets the session alone, and an /api/patient one costs no second auth call.
 const before=getUserCalls;
 assert.equal((await proxy(new NextRequest(`${site}/api/patient/zoe/thread`,{headers:{cookie:`${COOKIE}=x`}}))).status,200);
 assert.equal(getUserCalls,before,'unbound API reads do not reach auth in the proxy');
 // The layout learns the account from the proxy, which verified it; a browser cannot supply it.
 const page=await proxy(new NextRequest(`${site}/patient/dashboard`,{headers:{cookie:`${COOKIE}=x`,[VERIFIED]:A}}));
 assert.equal(page.headers.get(`x-middleware-request-${VERIFIED}`),B,'the verified session is what reaches the layout');
 sessionUser=null;
 const out=await proxy(new NextRequest(`${site}/patient`,{headers:{cookie:`${COOKIE}=x`,[VERIFIED]:A}}));
 assert.equal(out.headers.get(`x-middleware-request-${VERIFIED}`),null,'a forged value never reaches the layout');
 sessionUser=B;

 // The browser side: every member write carries the binding, and a refusal stops the tab.
 const {boundFetch}=await import('@/lib/patient/account-binding');
 type Seen={input:RequestInfo|URL;init?:RequestInit};
 const seen:Seen[]=[];let answer=new Response('{}'),bound:string|null=A,refusals=0;
 const original=(async(input:RequestInfo|URL,init?:RequestInit)=>{seen.push({input,init});return answer;}) as typeof fetch;
 let signInPage=false,lastRefusal='';const fullLoads:string[]=[];
 const wrapped=boundFetch(original,{origin:site,bound:()=>bound,signInPage:()=>signInPage,onRefused:r=>{refusals++;lastRefusal=r;},fullLoad:url=>{fullLoads.push(url);},retryDelayMs:0});
 const sent=()=>new Headers(seen.at(-1)!.init?.headers).get(BINDING);
 await wrapped('/patient/medicines',{method:'POST',headers:{'next-action':'x'}});
 assert.equal(sent(),A,'server action');
 assert.equal(new Headers(seen.at(-1)!.init?.headers).get('next-action'),'x','its own headers are kept');
 await wrapped(`${site}/api/patient/reports`,{method:'POST'});assert.equal(sent(),A,'report route');
 await wrapped('/patient/progress/earlier/upload',{method:'PUT'});assert.equal(sent(),A,'upload route');
 await wrapped(new URL(`${site}/patient/answers`),{method:'POST'});assert.equal(sent(),A,'URL input');
 await wrapped(new Request(`${site}/patient/answers`,{method:'POST',headers:{'x-kept':'1'}}));
 assert.equal(sent(),A,'Request input');assert.equal(new Headers(seen.at(-1)!.init?.headers).get('x-kept'),'1');
 for(const [input,init,label] of [['/patient/zoe/urgent',undefined,'the 103 screen'],['https://project.supabase.co/rest/v1/x',{method:'POST'},'another origin'],['/staff/real/x',{method:'POST'},'a staff path'],['/patient-lookalike',{method:'POST'},'a lookalike path']] as const){
  await wrapped(input,init);assert.equal(sent(),null,`${label}: no binding`);
 }
 // Reads carry it too: a soft navigation, a prefetch and a poll (BC-02).
 await wrapped(`${site}/patient/account?_rsc=abc`,{headers:{rsc:'1'}});assert.equal(sent(),A,'soft navigation');
 assert.equal(new Headers(seen.at(-1)!.init?.headers).get('rsc'),'1','Next\'s own headers are kept');
 await wrapped(`${site}/patient/account?_rsc=abc`,{headers:{rsc:'1','next-router-prefetch':'1'}});assert.equal(sent(),A,'prefetch');
 await wrapped('/api/patient/zoe/thread',{cache:'no-store',credentials:'same-origin'});assert.equal(sent(),A,'poll');
 await wrapped('/api/patient/zoe/cards');assert.equal(sent(),A,'poll with no init');
 // Fail closed: a tab with no account says so, and only the sign-in page may write without one (Astra R1).
 bound=null;
 await wrapped('/patient/medicines',{method:'POST'});assert.equal(sent(),'none','an unbound member page declares it');
 await wrapped('/api/patient/reports',{method:'POST'});assert.equal(sent(),'none');
 signInPage=true;await wrapped('/patient',{method:'POST'});assert.equal(sent(),null,'the sign-in page creates the session');signInPage=false;
 await wrapped('/api/patient/zoe/thread');assert.equal(sent(),'none','a poll of an unbound tab declares it, so the proxy refuses it under any session');
 // Unknown binding, BC-02: a soft navigation is never sent, whoever is signed in. A full load gets page and account from
 // one request. Nothing may reach the page first, so nothing is awaited here but the wrapper's own decision.
 for(const unknownOnSignIn of [false,true]){
  signInPage=unknownOnSignIn;fullLoads.length=0;
  const asked=seen.length;
  const navigation=wrapped(`${site}/patient/account?x=1&_rsc=abc`,{headers:{rsc:'1'}});
  assert.equal(await Promise.race([navigation.then(()=>'settled'),new Promise(r=>setTimeout(()=>r('held'),20))]),'held','the router gets no answer to apply');
  assert.deepEqual(fullLoads,[`${site}/patient/account?x=1`],'it leaves for the page itself');
  const prefetch=await wrapped(`${site}/patient/account?_rsc=abc`,{headers:{rsc:'1','next-router-prefetch':'1'}});
  assert.equal(prefetch.status,204,'a prefetch gets nothing to cache');
  assert.equal(seen.length,asked,'neither reached the server');assert.equal(fullLoads.length,1,'a prefetch never navigates');
 }
 signInPage=false;
 // The way to 103 is never slowed, unknown or not.
 fullLoads.length=0;await wrapped(`${site}/patient/zoe/urgent?_rsc=abc`,{headers:{rsc:'1'}});assert.equal(sent(),null);assert.equal(fullLoads.length,0);
 bound=A;
 answer=new Response('{}',{status:409,headers:{[REFUSED]:'1'}});
 const pending=wrapped('/patient/medicines',{method:'POST'});
 const state=await Promise.race([pending.then(()=>'settled'),new Promise(r=>setTimeout(()=>r('held'),20))]);
 assert.equal(state,'held','a refused write never returns to the form, so it cannot report anything else');
 assert.equal(refusals,1);assert.equal(lastRefusal,'write','a write is told nothing was saved');
 // A refused read stops the tab the same way, before anything reaches the page. No timing: the answer is what decides.
 for(const [input,init] of [[`${site}/patient/account?_rsc=abc`,{headers:{rsc:'1'}}],['/api/patient/zoe/thread',{cache:'no-store'}]] as const){
  const already:number=refusals;
  const read=wrapped(input,init);
  assert.equal(await Promise.race([read.then(()=>'settled'),new Promise(r=>setTimeout(()=>r('held'),20))]),'held','a refused read never returns, so nothing of it can be drawn');
  assert.equal(refusals,already+1);assert.equal(lastRefusal,'read','a read is not told something was not saved');
 }
 const beforeOther=refusals;
 answer=new Response('{}',{status:409});
 assert.equal((await wrapped('/patient/medicines',{method:'POST'})).status,409,'a 409 from the app itself is the form\'s to handle');
 assert.equal(refusals,beforeOther);

 // Auth blinks: the write is sent again; if it stays down the caller sees what it sees when offline.
 const down=()=>new Response('{}',{status:503,headers:{[UNCHECKED]:'1'}});
 const replies=[down(),new Response('{"ok":true}')];let calls=0;
 const flaky=boundFetch((async()=>{calls++;return replies.shift()!;}) as typeof fetch,{origin:site,bound:()=>A,signInPage:()=>false,onRefused:()=>{},fullLoad:()=>{},retryDelayMs:0});
 assert.equal((await flaky('/patient/medicines',{method:'POST',body:'x'})).status,200,'recovers');assert.equal(calls,2);
 calls=0;
 const gone=boundFetch((async()=>{calls++;return down();}) as typeof fetch,{origin:site,bound:()=>A,signInPage:()=>false,onRefused:()=>{},fullLoad:()=>{},retryDelayMs:0});
 await assert.rejects(gone('/patient/medicines',{method:'POST',body:'x'}),TypeError,'stays down');assert.equal(calls,3,'a bounded number of tries');
 calls=0;await assert.rejects(gone('/api/patient/zoe/thread'),TypeError,'an unchecked poll fails as offline');assert.equal(calls,3);

 // BC-03: a Server Action that never answers ends at the fetch, or Next's one-at-a-time queue holds "Try again" behind it.
 // A hung request here settles only through its abort signal, so this passes by the deadline and not by a guess.
 let hungSignal:AbortSignal|undefined,hung=0;
 const hanging=(async(_:RequestInfo|URL,init?:RequestInit)=>{hung++;hungSignal=init?.signal??undefined;return new Promise<Response>((_,reject)=>{init?.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')));});}) as typeof fetch;
 const timed=boundFetch(hanging,{origin:site,bound:()=>A,signInPage:()=>false,onRefused:()=>{},fullLoad:()=>{},actionTimeoutMs:5});
 await assert.rejects(timed('/patient/zoe',{method:'POST',headers:{'next-action':'x'},body:'[]'}),/Abort/,'it reads as a failure the caller already handles');
 assert.equal(hung,1,'one attempt: the retry is the member\'s, with the same request id');
 assert.equal(hungSignal?.aborted,true,'the request itself ended');
 // Headers are not the answer (Astra BC-R1): a reply that stalls in its body holds Next's queue the same way.
 let stalledSignal:AbortSignal|undefined;
 const stalling=boundFetch((async(_:RequestInfo|URL,init?:RequestInit)=>{
  stalledSignal=init?.signal??undefined;
  const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('0:'));init?.signal?.addEventListener('abort',()=>c.error(new DOMException('Aborted','AbortError')));}});
  return new Response(body,{status:200,headers:{'content-type':'text/x-component'}});
 }) as typeof fetch,{origin:site,bound:()=>A,signInPage:()=>false,onRefused:()=>{},fullLoad:()=>{},actionTimeoutMs:5});
 const stalled=await stalling('/patient/zoe',{method:'POST',headers:{'next-action':'x'},body:'[]'});
 await assert.rejects(stalled.text(),/Abort/,'the stalled body fails, so whatever reads it stops waiting');
 assert.equal(stalledSignal?.aborted,true);
 // A complete reply is read to its end and untouched, and nothing is aborted after it.
 let doneSignal:AbortSignal|undefined;
 const whole=boundFetch((async(_:RequestInfo|URL,init?:RequestInit)=>{doneSignal=init?.signal??undefined;return new Response('complete');}) as typeof fetch,{origin:site,bound:()=>A,signInPage:()=>false,onRefused:()=>{},fullLoad:()=>{},actionTimeoutMs:5});
 assert.equal(await (await whole('/patient/zoe',{method:'POST',headers:{'next-action':'x'},body:'[]'})).text(),'complete');
 await new Promise(r=>setTimeout(r,15));assert.equal(doneSignal?.aborted,false,'the deadline ended with the reply');
 const {ACTION_TIMEOUT_MS}=await import('@/lib/patient/account-binding');
 assert.ok(ACTION_TIMEOUT_MS>=20_000&&ACTION_TIMEOUT_MS<=30_000,'about 20 to 30 seconds');
 // Only Server Actions: an upload may take minutes and a read has its own limit.
 hungSignal=undefined;void timed('/patient/progress/earlier/upload',{method:'PUT',body:'x'});
 await new Promise(r=>setTimeout(r,0));assert.equal(hungSignal,undefined,'an upload has no deadline here');

 // Every member document mounts the binding, from the proxy's verified value.
 const layout=readFileSync('app/patient/layout.tsx','utf8');
 assert.match(layout,/<AccountBinding userId=\{/,'the member layout binds the page');
 assert.match(layout,/VERIFIED_MEMBER_HEADER\)\s*\?\?\s*\(await patientIdentity\(\)/,'a page rendered after auth blinked in the proxy is still bound');
 // A plain form post can run before scripts, so it carries the account (Astra R2).
 const urgent=readFileSync('app/patient/urgent/review/page.tsx','utf8'),urgentAction=readFileSync('lib/care-alerts/member-actions.ts','utf8');
 assert.match(urgent,/name="account" value=\{account\}/);
 assert.match(urgentAction,/form\.get\('account'\)!==who\.userId/);
 assert.ok(urgentAction.indexOf("form.get('account')")<urgentAction.indexOf('requireRegistered()'),'before anything is read');
 const binding=readFileSync('components/patient/account-binding.tsx','utf8');
 assert.match(binding,/blocked === "write" && /,'only a refused write says nothing was saved');
 assert.match(binding,/href="tel:103"/,'the refusal keeps the way to 103: an urgent text in a stale tab never reaches the red check');
 assert.match(binding,/else if \(!bound && lastPath\.current !== path\) window\.location\.reload\(\);/,'a tab that opened unbound takes page and account from one request');
 assert.doesNotMatch(binding,/router\.refresh/,'a refresh could bring the next member\'s account to this member\'s page');
 assert.match(readFileSync('components/patient/phone-entry.tsx','utf8'),/window\.location\.replace\(continuePath\(next\)/,'signing in binds the tab at once');
 // Member writes that do not go through fetch would skip the binding.
 for(const dir of ['components/patient','components/patient-care','components/member-history','components/reports']){
  for(const file of (await import('node:fs')).readdirSync(dir)){
   if(!/\.tsx?$/.test(file))continue;
   assert.doesNotMatch(readFileSync(`${dir}/${file}`,'utf8'),/sendBeacon|new XMLHttpRequest/,`${dir}/${file}: writes go through fetch`);
  }
 }
}finally{hook.deregister();}
console.log('Member account binding checks passed.');
