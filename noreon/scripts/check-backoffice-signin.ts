import assert from 'node:assert/strict';
import * as nodeModule from 'node:module';
import {pathToFileURL} from 'node:url';
import {NextRequest} from 'next/server';
// One staff and clinic sign-in (Khikar, 17 Oct). Exercises the actual backofficeSignIn action:
// staff, clinic (one clinic, several clinics), Telegram second step for either portal, neither,
// and Auth/RPC failures, plus the proxy's root page and old-login redirects and the host lists.
// Auth, portal cookie clients and navigation are replaced; nothing reaches Supabase.
type Resolution={url:string;shortCircuit?:boolean};
type Resolver=(s:string,c:unknown,next:(s:string,c:unknown)=>Resolution)=>Resolution;
const {registerHooks}=nodeModule as unknown as {registerHooks:(h:{resolve:Resolver})=>{deregister:()=>void}};
type Rpc={data:unknown;error:unknown};
const f={
 portals:{staff:true,clinic:true},
 signIn:{error:null as unknown,session:{access_token:'probe-access',refresh_token:'probe-refresh'} as unknown},
 rpc:{} as Record<string,Rpc>,
 amr:[{method:'password'}] as unknown,
 telegram:false,
 calls:[] as string[],
 requireStaffOk:true,
 role:'doctor',
 throwUser:false,
 limited:false,
 limiterDown:false,
 localeCookies:[] as {name:string;value:string;options:Record<string,unknown>}[],
};
Object.assign(globalThis,{__backoffice:f});
const root=pathToFileURL(process.cwd()+'/').href;
const prefix='const f=globalThis.__backoffice;';
const mocks:Record<string,string>={
 './probe':prefix+`export function probeAuthClient(){return {auth:{
   signInWithPassword:async(v)=>{f.calls.push('probe.signIn:'+(v.options.captchaToken??''));return {data:{session:f.signIn.session},error:f.signIn.error};},
   signOut:async(o)=>{f.calls.push('probe.signOut:'+o.scope);return {error:null};},
   getSession:async()=>({data:{session:f.signIn.session},error:null}),
   getUser:async()=>f.throwUser?{data:{user:null},error:{status:503,message:'down'}}:({data:{user:{id:'00000000-0000-4000-8000-000000000001',email:'a@example.invalid',email_confirmed_at:'2026-10-17T00:00:00Z'}},error:null}),
   getClaims:async()=>({data:{claims:{sub:'00000000-0000-4000-8000-000000000001',session_id:'00000000-0000-4000-8000-0000000000aa',amr:f.amr}},error:null}),
  },rpc:async(name)=>{f.calls.push('probe.rpc:'+name);return f.rpc[name]??{data:null,error:null};}};}`,
 './signin':prefix+`export async function backofficePortals(){return f.portals;}export const clinicHomePath=(id,hy)=>'/clinic/real/batches?clinic='+id+'&locale='+(hy?'hy':'en');`,
 '@/lib/patient-care/clinical-case-repository':prefix+`export async function realStaffClient(){if(!f.portals.staff)throw Error('staff client on a non-staff host');return {auth:{setSession:async(t)=>{f.calls.push('staff.setSession:'+t.access_token);return {error:null};}}};}export async function requireRealStaff(){f.calls.push('requireRealStaff');if(!f.requireStaffOk)throw Error('redirect:/staff/real/login');return {identity:{role:f.role}};}`,
 '@/lib/clinic-portal/identity':prefix+`export async function clinicAuthClient(){if(!f.portals.clinic)throw Error('clinic client on a non-clinic host');return {auth:{setSession:async(t)=>{f.calls.push('clinic.setSession:'+t.access_token);return {error:null};}}};}`,
 '@/lib/telegram-auth/staff-signin-config':prefix+`export {parseStaffSigninState,telegramStepDue} from '${root}lib/telegram-auth/staff-signin-config.ts';export const staffTelegramSigninEnabled=()=>f.telegram;`,
 '@/lib/security/rate-limit':prefix+`export async function rateLimit(op,b){f.calls.push('limit:'+op+':'+b.map(x=>x.kind+'/'+(x.mode??'take')+(x.value?'/'+x.value:'')).join(','));if(f.limiterDown)throw Error('rate_limit_unavailable');return f.limited?{ok:false,retryAfter:60}:{ok:true};}
  export async function recordRateLimit(op,b){f.calls.push('record:'+op+':'+b.map(x=>x.kind+'/'+x.value).join(','));}`,
 'next/navigation':`export function redirect(url){throw Error('redirect:'+url);}export function notFound(){throw Error('notFound');}`,
 'next/headers':prefix+`export async function cookies(){return {set:(name,value,options)=>{f.localeCookies.push({name,value,options});},get:(name)=>f.localeCookies.findLast(c=>c.name===name)};}
   // Staff screens read the language header the proxy sets from ?locale=; a sign-in has none, so the cookie decides.
   export async function headers(){return {get:()=>null};}`,
};
const hook=registerHooks({resolve(s,c,next){const source=mocks[s];return source?{url:'data:text/javascript,'+encodeURIComponent(source),shortCircuit:true}:next(s,c);}});
const saved={...process.env};
try{
 delete process.env.NOREON_DOCTOR_WORKSPACE;delete process.env.NOREON_DOCTOR_CHAT_HOME;
 const {backofficeSignIn}=await import('@/lib/backoffice/actions');
 const clinicId='00000000-0000-4000-8000-0000000000c1';
 const clinicReady={data:{status:'ready',identity:{version:'clinic-portal-v1',userId:'00000000-0000-4000-8000-000000000001',membershipId:'00000000-0000-4000-8000-0000000000d1',membershipRevision:1,clinicId,clinicName:'Fixture clinic',displayName:'Fixture member',capability:'clinic_staff'}},error:null};
 const step=(over:object)=>({data:{ok:true,required:true,admitted:false,enrolled:true,eligible:true,staffEligible:false,clinicEligible:false,...over},error:null});
 const form=(locale='en',next='')=>{const x=new FormData();x.set('email','synthetic@example.invalid');x.set('password','synthetic-unused');x.set('locale',locale);x.set('captchaToken','fixture-token');x.set('next',next);return x;};
 const run=async(setup:()=>void,locale='en',next='')=>{
  Object.assign(f,{portals:{staff:true,clinic:true},signIn:{error:null,session:{access_token:'probe-access',refresh_token:'probe-refresh'}},rpc:{clinic_portal_identity:{data:null,error:{code:'42501'}}},amr:[{method:'password'}],telegram:false,calls:[],requireStaffOk:true,role:'doctor',limited:false,limiterDown:false});
  f.localeCookies=[];
  setup();
  try{return {state:await backofficeSignIn({ok:false,message:''},form(locale,next)),redirect:null as string|null};}
  catch(e){const m=String((e as Error).message);if(!m.startsWith('redirect:'))throw e;return {state:null,redirect:m.slice(9)};}
 };
 const setSessions=()=>f.calls.filter(c=>c.includes('.setSession:'));
 // Read through a function: after `f.localeCookies=[]` the compiler narrows the field to never[].
 const localeSet=()=>(f.localeCookies as {name:string;value:string}[]).map(c=>[c.name,c.value]);

 // Staff account: staff cookie, staff guards, members list. Staff wins even with a clinic membership.
 let r=await run(()=>{f.rpc.real_clinical_staff_identity={data:{id:'x'},error:null};f.rpc.clinic_portal_identity=clinicReady;});
 assert.equal(r.redirect,'/staff/real/members');
 assert.deepEqual(setSessions(),['staff.setSession:probe-access'],'Staff session goes only under the staff cookie');
 assert.ok(f.calls.includes('requireRealStaff'),'Staff guards (amr, onboarding exception, host role) run before the members list');
 assert.equal(f.calls[0],'limit:staff_signin:source/take,email/peek/synthetic@example.invalid','Network counted, account only checked, before Auth');
 assert.equal(f.calls[1],'probe.signIn:fixture-token','The password and CAPTCHA token are used once');
 assert.ok(!f.calls.some(c=>c.startsWith('record:')),'A successful sign-in does not count against the account');
 assert.equal(f.calls.filter(c=>c.startsWith('probe.signIn')).length,1);
 // A notice survives password sign-in and the staff-only second step. The server validates next.
 const notice='/staff/real/n/'+'ab'.repeat(24);
 r=await run(()=>{f.rpc.real_clinical_staff_identity={data:{id:'x'},error:null};},'en',notice);
 assert.equal(r.redirect,notice,'Password sign-in returns to the same opaque notice');
 for(const next of ['https://evil.invalid','//evil.invalid','/staff/real/members/id']){
  r=await run(()=>{f.rpc.real_clinical_staff_identity={data:{id:'x'},error:null};},'en',next);
  assert.equal(r.redirect,'/staff/real/members','Other redirect targets are ignored');
 }
 r=await run(()=>{f.telegram=true;f.rpc.staff_signin_state=step({staffEligible:true});},'en',notice);
 assert.equal(new URL(r.redirect!,'https://backoffice.noreon.health').searchParams.get('next'),notice,'Telegram verification retains the notice');
 r=await run(()=>{f.rpc.clinic_portal_identity=clinicReady;},'en',notice);
 assert.ok(r.redirect!.startsWith('/clinic/real/'),'Clinic sign-in never follows a staff notice');
 // The chat-home flag changes only the admitted doctor's destination.
 process.env.NOREON_DOCTOR_WORKSPACE='true';process.env.NOREON_DOCTOR_CHAT_HOME='true';
 r=await run(()=>{f.rpc.real_clinical_staff_identity={data:{id:'x',role:'doctor'},error:null};});
 assert.equal(r.redirect,'/staff/real/doctor-workspace');
 // The language chosen at sign-in must survive the redirect: staff screens read a cookie,
 // not the login URL's query string. Exercise the actual reader as well as the action.
 const {staffLocale}=await import('@/lib/staff/staff-locale');
 for(const role of ['doctor','nurse'])for(const locale of ['hy','ru','en']){
  r=await run(()=>{f.role=role;f.rpc.real_clinical_staff_identity={data:{id:'x',role},error:null};},locale);
  assert.equal(await staffLocale(role),locale,'Staff home uses the language chosen at sign-in');
  assert.deepEqual(f.localeCookies,[{name:'noreon-staff-locale',value:locale,options:{path:'/',httpOnly:true,sameSite:'lax',secure:process.env.NODE_ENV==='production',maxAge:60*60*24*365}}]);
 }
 for(const role of ['admin','nurse']){
  r=await run(()=>{f.role=role;f.rpc.real_clinical_staff_identity={data:{id:'x',role},error:null};});
  assert.equal(r.redirect,'/staff/real/members');
  if(role==='admin')assert.deepEqual(f.localeCookies,[],'Administrators retain English');
 }
 process.env.NOREON_DOCTOR_WORKSPACE='false';
 r=await run(()=>{f.rpc.real_clinical_staff_identity={data:{id:'x',role:'doctor'},error:null};});
 assert.equal(r.redirect,'/staff/real/members','Chat home requires the workspace flag');
 delete process.env.NOREON_DOCTOR_WORKSPACE;delete process.env.NOREON_DOCTOR_CHAT_HOME;
 // Staff guard refusal (e.g. role not allowed on this host) still ends on the login page.
 r=await run(()=>{f.rpc.real_clinical_staff_identity={data:{id:'x'},error:null};f.requireStaffOk=false;});
 assert.equal(r.redirect,'/staff/real/login');
 assert.deepEqual(f.localeCookies,[],'A refused staff guard does not save the preference');

 // Clinic account on the shared page: clinic cookie and clinic home, never the staff error.
 r=await run(()=>{f.rpc.clinic_portal_identity=clinicReady;},'hy');
 assert.equal(r.redirect,`/clinic/real/batches?clinic=${clinicId}&locale=hy`);
 assert.deepEqual(setSessions(),['clinic.setSession:probe-access'],'Clinic session goes only under the clinic cookie');
 assert.deepEqual(f.localeCookies,[],'Clinic sign-in does not change staff language');
 r=await run(()=>{f.rpc.clinic_portal_identity={data:{status:'selection-required',clinics:[{id:clinicId,name:'A'},{id:'00000000-0000-4000-8000-0000000000c2',name:'B'}]},error:null};});
 assert.equal(r.redirect,'/clinic/real/select');
 // A recovery or non-password session never reaches clinic access (amr check kept).
 r=await run(()=>{f.amr=[{method:'recovery'}];f.rpc.clinic_portal_identity=clinicReady;});
 assert.equal(r.state?.message,'An active staff or clinic account is required.');
 assert.deepEqual(setSessions(),[]);assert.ok(f.calls.includes('probe.signOut:local'));
 assert.ok(!f.calls.includes('probe.rpc:clinic_portal_identity'),'Non-password sessions are refused before the membership read');

 // Telegram second step, for each portal, only when the step is offered.
 r=await run(()=>{f.telegram=true;f.rpc.staff_signin_state=step({staffEligible:true});});
 assert.equal(r.redirect,'/staff/real/verify',JSON.stringify([r.state,f.calls]));assert.deepEqual(setSessions(),['staff.setSession:probe-access']);
 assert.ok(!f.calls.includes('requireRealStaff'),'An unadmitted session goes to the code screen, not the staff area');
 assert.deepEqual(localeSet(),[['noreon-staff-locale','en']],'The language chosen at sign-in is kept through the Telegram step');
 r=await run(()=>{f.telegram=true;f.rpc.staff_signin_state=step({staffEligible:true});},'hy');
 assert.equal(r.redirect,'/staff/real/verify');assert.deepEqual(localeSet(),[['noreon-staff-locale','hy']],'An Armenian choice is kept through the Telegram step');
 r=await run(()=>{f.telegram=true;f.rpc.staff_signin_state=step({clinicEligible:true});},'hy');
 assert.equal(r.redirect,'/clinic/real/verify?locale=hy');assert.deepEqual(setSessions(),['clinic.setSession:probe-access']);
 r=await run(()=>{f.telegram=false;f.rpc.staff_signin_state=step({staffEligible:true,clinicEligible:true});});
 assert.equal(r.state?.message,'An active staff or clinic account is required.','No code screen while the step is switched off');
 assert.deepEqual(setSessions(),[]);
 r=await run(()=>{f.rpc.staff_signin_state=step({clinicEligible:true,enrolled:false});});
 assert.equal(r.state?.message,'Telegram is not set up for your account yet. Contact your administrator.');

 // Neither: no cookie, this session revoked locally (other sessions untouched), one error.
 r=await run(()=>{});
 assert.equal(r.state?.ok,false);assert.equal(r.state?.message,'An active staff or clinic account is required.');
 assert.deepEqual(setSessions(),[]);assert.ok(f.calls.includes('probe.signOut:local'));assert.ok(!f.calls.includes('probe.signOut:global'));
 r=await run(()=>{},'hy');
 assert.equal(r.state?.message,'Անհրաժեշտ է աշխատակցի կամ կլինիկայի ակտիվ հաշիվ։');

 // Failures fail closed without a cookie.
 r=await run(()=>{f.signIn.error={message:'Invalid login credentials',code:'invalid_credentials'};f.signIn.session=null;});
 assert.match(r.state?.message??'',/Sign-in was unsuccessful/);assert.deepEqual(setSessions(),[]);
 assert.deepEqual(f.localeCookies,[],'Failed authentication does not save a staff preference');
 assert.ok(f.calls.includes('record:staff_signin:email/synthetic@example.invalid'),'A wrong password counts against the account');
 // A failed CAPTCHA never spends the account's quota (strangers cannot lock staff out).
 r=await run(()=>{f.signIn.error={message:'captcha protection: request disallowed (invalid-input-response)'};f.signIn.session=null;});
 assert.ok(!f.calls.some(c=>c.startsWith('record:')),'CAPTCHA failure recorded against the account');
 // Auth's own rate limit or an outage is not a wrong password.
 for(const error of [{message:'Request rate limit reached',code:'over_request_rate_limit',status:429},{message:'upstream down',status:503},{message:'Invalid login'}]){
  r=await run(()=>{f.signIn.error=error;f.signIn.session=null;});
  assert.match(r.state?.message??'',/Sign-in was unsuccessful/);
  assert.ok(!f.calls.some(c=>c.startsWith('record:')),'Non-credential Auth error recorded against the account: '+error.message);
 }
 // Over the limit: refused before Auth, nothing else runs.
 r=await run(()=>{f.limited=true;});
 assert.equal(r.state?.message,'Too many sign-in attempts. Wait 15 minutes and try again.');
 assert.ok(!f.calls.some(c=>c.startsWith('probe.')),'Auth called while limited');
 r=await run(()=>{f.limited=true;},'hy');
 assert.equal(r.state?.message,'Չափազանց շատ մուտքի փորձեր։ Սպասեք 15 րոպե և նորից փորձեք։');
 // Limiter down: fail closed, Auth not called.
 r=await run(()=>{f.limiterDown=true;});
 assert.match(r.state?.message??'',/could not be completed/);assert.ok(!f.calls.some(c=>c.startsWith('probe.')));
 r=await run(()=>{f.rpc.real_clinical_staff_identity={data:null,error:{code:'XX000'}};f.rpc.clinic_portal_identity=clinicReady;});
 assert.match(r.state?.message??'',/could not be completed/,'A staff identity error is not read as "not staff"');assert.deepEqual(setSessions(),[]);
 r=await run(()=>{f.rpc.clinic_portal_identity={data:null,error:{code:'XX000'}};});
 assert.match(r.state?.message??'',/could not be completed/);assert.deepEqual(setSessions(),[]);

 r=await run(()=>{f.throwUser=true;});f.throwUser=false;
 assert.match(r.state?.message??'',/could not be completed/,'An Auth outage while classifying is not read as "no account"');assert.deepEqual(setSessions(),[]);
 // Each portal only where it is enabled for this host.
 r=await run(()=>{f.portals={staff:false,clinic:true};f.rpc.real_clinical_staff_identity={data:{id:'x'},error:null};f.rpc.clinic_portal_identity=clinicReady;});
 assert.equal(r.redirect,`/clinic/real/batches?clinic=${clinicId}&locale=en`);assert.ok(!f.calls.includes('probe.rpc:real_clinical_staff_identity'));
 r=await run(()=>{f.portals={staff:true,clinic:false};f.rpc.clinic_portal_identity=clinicReady;});
 assert.equal(r.state?.message,'An active staff or clinic account is required.');assert.ok(!f.calls.includes('probe.rpc:clinic_portal_identity'));
 await assert.rejects(run(()=>{f.portals={staff:false,clinic:false};}),/notFound/);
 // With CAPTCHA switched on (NOREON_CAPTCHA_ENABLED, lib/captcha.ts) a token is required; off (the default) none is.
 process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY='fixture-site-key';process.env.NOREON_CAPTCHA_ENABLED='true';
 Object.assign(f,{portals:{staff:true,clinic:true},calls:[]});
 const noToken=form();noToken.delete('captchaToken');
 assert.equal((await backofficeSignIn({ok:false,message:''},noToken)).message,'Complete the sign-in verification.');
 assert.equal(f.calls.length,0,'Without a token, Auth is not called');
 delete process.env.NOREON_CAPTCHA_ENABLED;
 Object.assign(f,{calls:[]});
 assert.notEqual((await backofficeSignIn({ok:false,message:''},noToken)).message,'Complete the sign-in verification.','CAPTCHA off: no token needed');
 assert.equal(f.calls.includes('probe.signIn:'),true,'CAPTCHA off: Auth is called without a token');
 delete process.env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY;
 console.log('Backoffice sign-in: staff, clinic (one/many), Telegram step per portal, neither, failures and per-host portals routed by role (Auth mocked).');
}finally{hook.deregister();Reflect.deleteProperty(globalThis,'__backoffice');}

// Hosts and proxy: one sign-in at "/" on backoffice and doctor.*, old logins redirect there.
const {BACKOFFICE_HOSTS,staffPortalForHost,staffHostAllowed}=await import('@/lib/staff/hosts');
const {clinicHostAllowed}=await import('@/lib/clinic-portal/config');
assert.deepEqual([...BACKOFFICE_HOSTS],['backoffice.noreon.health','doctor.noreon.health']);
for(const host of ['backoffice.noreon.health','doctor.noreon.health','DOCTOR.NOREON.HEALTH']){
 assert.equal(staffPortalForHost(host),'admin');
 for(const role of ['admin','doctor','nurse'] as const)assert.equal(staffHostAllowed(host,role,{NODE_ENV:'production'}),true);
 assert.equal(clinicHostAllowed(host.toLowerCase(),{NODE_ENV:'production'}),true);
}
assert.equal(staffHostAllowed('doctors.noreon.health','admin',{NODE_ENV:'production'}),false,'doctors.* keeps its doctor/nurse portal');
for(const host of ['doctors.noreon.health','doctor.noreon.health.evil.invalid','app.noreon.health','evil.invalid'])assert.equal(clinicHostAllowed(host,{NODE_ENV:'production'}),false);
Object.assign(process.env,{NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_PATIENT_DEMO:'false',NOREON_DEPLOYMENT_TARGET:'app',NEXT_PUBLIC_SUPABASE_URL:'https://real.example.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-key',NOREON_CLINIC_PORTAL_ENABLED:'true'});
try{
 const {proxy}=await import('../proxy');
 const req=(url:string,method='GET')=>new NextRequest(url,{method,headers:{host:new URL(url).host}});
 for(const host of ['backoffice.noreon.health','doctor.noreon.health']){
  const rootPage=await proxy(req(`https://${host}/?locale=hy`));
  assert.equal(rootPage.headers.get('x-middleware-rewrite'),`https://${host}/staff/real/login?locale=hy`,`${host}/ renders the shared sign-in`);
  for(const path of ['/staff/real/login?password-reset=complete','/clinic/real/login?invited=1']){
   const old=await proxy(req(`https://${host}${path}`));
   assert.equal(old.status,307);assert.equal(old.headers.get('location'),`https://${host}/${path.slice(path.indexOf('?'))}`);
  }
  assert.equal((await proxy(req(`https://${host}/staff/real/login`,'POST'))).headers.get('location'),null,'Posts to the old address are not redirected');
 }
 const plural=await proxy(req('https://doctors.noreon.health/'));
 assert.equal(plural.headers.get('location'),'https://doctors.noreon.health/staff/real/members','doctors.* root behaves as before');
 const app=await proxy(req('https://app.noreon.health/'));
 assert.equal(app.headers.get('x-middleware-rewrite'),null,'The member app root is untouched');
 console.log('Backoffice hosts: backoffice and doctor aliases serve one sign-in at "/", old login addresses redirect there, doctors.* and the member app unchanged.');
}finally{for(const key of Object.keys(process.env))if(!(key in saved))delete process.env[key];Object.assign(process.env,saved);}
