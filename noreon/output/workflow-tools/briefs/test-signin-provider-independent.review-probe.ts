// Isolated signed hook and RPC wiring. Fictional fixtures, no network or secrets.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {Webhook} from 'standardwebhooks';
import {handleTelegramAuthHook,telegramAuthKeys,unsealCode,sealCode} from '@/lib/telegram-auth/hook';
import {telegramAuthHookStore} from '@/lib/telegram-auth/runtime';
const secret='whsec_'+Buffer.alloc(32,7).toString('base64'),keys=telegramAuthKeys(secret);
const requestId='11111111-1111-4111-8111-111111111111';
const raw=JSON.stringify({user:{phone:'99900000001'},sms:{otp:'731904'}}),id='test_hook',at=new Date();
const request=()=>new Request('https://example.invalid/hook',{method:'POST',headers:{'content-type':'application/json','webhook-id':id,'webhook-timestamp':String(Math.floor(at.getTime()/1000)),'webhook-signature':new Webhook(secret).sign(id,at,raw)},body:raw});
let sealed='',sends=0;
const response=await handleTelegramAuthHook(request(),keys,()=>({
 async claim(){return {ok:true,replay:false,requestId,route:'test'};},
 async seal(_r,_w,value){sealed=value;return {ok:true,updated:true};},
 async finish(){return {ok:true,updated:true};},
}),async()=>{sends++;return {kind:'accepted',providerRef:'unexpected'};},{info(){},warn(){}});
assert.equal(response.status,200,'Test hook seals the real OTP');
assert.equal(sends,0,'Test route never sends to Telegram');
assert.equal(unsealCode(keys,requestId,sealed),'731904');
assert.equal(unsealCode(keys,'22222222-2222-4222-8222-222222222222',sealed),null,'Seal is bound to request');
const calls:{name:string;args:unknown}[]=[];
const db={rpc(name:string,args:unknown){calls.push({name,args});return {abortSignal:async()=>({data:{},error:null})};}};
for(const flag of [undefined,'false','true']){
 const store=telegramAuthHookStore(db as never,{NOREON_TEST_SIGNIN_ENABLED:flag});
 await store.claim('+99900000001','hook','a'.repeat(64),900);
 assert.equal(calls.at(-1)?.name,'test_signin_claim');
 assert.equal((calls.at(-1)?.args as {p_env_enabled:boolean}).p_env_enabled,flag==='true');
 await store.claim('+37499000001','hook','a'.repeat(64),900);
 assert.equal(calls.at(-1)?.name,'auth_code_request_claim','Real numbers keep the original hook');
}
// Load the real member module with isolated cookies/Auth/storage. No client-provided test mode.
let checkedName='',verifiedName='',token='',checks=0;
const realSealed=sealCode(keys,requestId,'731904');
const modules:Record<string,unknown>={
 'server-only':{},'node:crypto':await import('node:crypto'),'zod':await import('zod'),
 'next/headers':{cookies:async()=>({get:()=>({value:JSON.stringify({nonce:'a'.repeat(43),requestId})}),delete(){}})},
 '@/lib/supabase/server':{createClient:async()=>({auth:{verifyOtp:async(args:{token:string})=>{token=args.token;return {error:null,data:{session:{access_token:'x.'+Buffer.from(JSON.stringify({sub:requestId,session_id:requestId})).toString('base64url')+'.x'}}};},signOut:async()=>({})}})},
 '@/lib/observability/logger':{log:{info(){}}},
 '@/lib/telegram-runtime/dispatch-trigger':{requestTelegramDispatch:async()=>{}},
 '@/lib/telegram-runtime/config':{telegramBotUsername:()=>null},
 './hook':await import('@/lib/telegram-auth/hook'),
 './runtime':{telegramAuthEnabled:()=>true,telegramAuthService:()=>({rpc:async(name:string)=>{
  if(name.includes('check')){if(!checkedName)checkedName=name;checks++;return {error:null,data:{ok:true,phone:'+99900000001',...(name==='test_signin_check'?{sealed:realSealed}:{})}};}
  if(name.includes('verified'))verifiedName=name;return {error:null,data:{ok:true,result:'signed_in'}};
 }})},
};
const exports:{verifyTelegramCode?:(phone:string,code:string)=>Promise<unknown>}={};
new vm.Script(ts.transpileModule(readFileSync('lib/telegram-auth/member-signin.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
 .runInNewContext({exports,Buffer,process:{env:{NOREON_SUPABASE_SMS_HOOK_SECRET:secret,NOREON_TEST_SIGNIN_ENABLED:'true'}},require:(name:string)=>{assert.ok(name in modules,name);return modules[name];}});
assert.deepEqual(JSON.parse(JSON.stringify(await exports.verifyTelegramCode!('+99900000001','246810'))),{ok:true});
assert.equal(checkedName,'test_signin_check');assert.equal(checks,2);assert.equal(token,'731904','Real Supabase OTP is verified');
assert.equal(verifiedName,'test_signin_verified','Session finalized and audited, using normal verified function internally');
const ui=readFileSync('components/patient/phone-entry.tsx','utf8');
assert.doesNotMatch(ui,/>\s*(Test sign.?in|Use test account|Test mode)\s*</i);
const page=readFileSync('app/staff/real/(review)/test-signin/page.tsx','utf8');
assert.match(page,/await requireRealAdmin\(/);
console.log('PASS test-account sign-in: signed hook seal, no Telegram send, server env wiring, real OTP/session path, admin-only page.');
// Run the actual admin page and server action with IO mocked. Authorization must happen
// before storage/validation, including direct action calls with a forged previous state.
let admin=false,adminReads=0,adminCalls=0;
let adminData:unknown={enabled:false,numbers:[]};
const adminModules:Record<string,unknown>={
 'react/jsx-runtime':await import('react/jsx-runtime'),'zod':await import('zod'),
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 'next/navigation':{unstable_rethrow(){}},'next/cache':{revalidatePath(){}},
 '@/lib/staff/real-admin':{requireRealAdmin:async()=>{adminReads++;if(!admin)throw Error('not-admin');return {client:{}};}},
 '@/lib/telegram-auth/test-signin-admin':{testSigninListSchema:(await import('@/lib/telegram-auth/test-signin-admin')).testSigninListSchema,
  testSigninAdminRpc:async(_client:unknown,name:string)=>{adminCalls++;assert.ok(name.startsWith('test_signin_admin_'));return adminData;}},
 './manager':{TestSigninManager:()=>null},
};
function loadAdmin(path:string){
 const exports:Record<string,unknown>={};
 const compiled=ts.transpileModule(readFileSync(path,'utf8'),{fileName:path,reportDiagnostics:true,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}});
 assert.equal(compiled.diagnostics?.filter(d=>d.category===ts.DiagnosticCategory.Error).length,0);
 new vm.Script(compiled.outputText).runInNewContext({exports,process:{env:{}},require:(name:string)=>{assert.ok(name in adminModules,name);return adminModules[name];}});
 return exports;
}
const adminPage=loadAdmin('app/staff/real/(review)/test-signin/page.tsx').default as ()=>Promise<unknown>;
const adminAction=loadAdmin('app/staff/real/(review)/test-signin/actions.ts').manageTestSignin as (previous:unknown,form:FormData)=>Promise<{message:string;code?:string}>;
await assert.rejects(adminPage,/not-admin/);
const form=new FormData();form.set('action','set_code');form.set('id',requestId);
await assert.rejects(()=>adminAction({message:'forged',code:'111111'},form),/not-admin/);
assert.equal(adminCalls,0,'Non-admin cannot reach storage from a page or direct action');
admin=true;await adminPage();assert.equal(adminCalls,1);
adminData={ok:true,testCode:'246810',code_hash:'must-not-escape',sealed:realSealed};
const adminSet=await adminAction({},form);
assert.equal(adminSet.code,'246810','Only generated fixed test code is shown once');
assert.doesNotMatch(JSON.stringify(adminSet),/must-not-escape|sealed|731904/,'No hash or real OTP reaches the browser');
form.set('action','add');form.set('phone','+37499000001');form.set('label','Fictional');form.set('days','7');
const previousCalls=adminCalls;await adminAction({},form);assert.equal(adminCalls,previousCalls,'Real numbers refused before mutation');
assert.equal(adminReads,5,'Each entry point checks the admin session anew');
console.log('PASS test-account admin: page/action authorization, fixed-code-only response, rejected real number, empty/off list.');

// Provider-independent path: execute the actual server module, replacing only cookies,
// the Auth transport and privileged RPC transport. SQL companion proves admission rules.
let directCookie:string|undefined;
let directCalls:string[]=[],installed=0,revoked=0,created=0,updated=0;
let directRefusal:string|undefined,finalRefusal=false,authFailure=false,badIdentity=false,badRole=false,installFailure=false;
let existingUser:string|null=requestId,checkedPhone='+99900000001';
const env:Record<string,string|undefined>={NOREON_TEST_SIGNIN_ENABLED:'true'};
const passwords:string[]=[];
const jwt=()=> 'x.'+Buffer.from(JSON.stringify({sub:requestId,session_id:requestId,role:badRole?'service_role':'authenticated'})).toString('base64url')+'.x';
const directService={rpc:async(name:string,args:Record<string,unknown>)=>{
 directCalls.push(name);
 assert.equal(args.p_env_enabled,env.NOREON_TEST_SIGNIN_ENABLED==='true');
 assert.equal(args.p_phone,'+99900000001');
 if(args.p_request===null)return {error:null,data:{ok:false,code:'unknown_request'}};
 assert.match(String(args.p_nonce_hmac),/^[a-f0-9]{64}$/);
 if(directRefusal)return {error:null,data:{ok:false,code:directRefusal}};
 if(name==='test_signin_direct_begin')return {error:null,data:{ok:true,requestId}};
 if(name==='test_signin_direct_check'){
  assert.equal(args.p_test_code,'246810');
  return {error:null,data:{ok:true,phone:checkedPhone,userId:existingUser,codeDigest:'d'.repeat(64)}};
 }
 return {error:null,data:finalRefusal?{ok:false,code:'not_verifiable'}:{ok:true,result:'signed_in'}};
},auth:{admin:{
 async createUser(a:{password:string}){created++;passwords.push(a.password);return {error:null,data:{user:{id:requestId,phone:'99900000001'}}};},
 async updateUserById(id:string,a:{password:string}){assert.equal(id,requestId);updated++;passwords.push(a.password);return {error:null,data:{user:{id:requestId,phone:'99900000001'}}};},
},async signInWithPassword(a:{phone:string;password:string}){
 directCalls.push('password_grant');assert.equal(a.phone,'+99900000001');assert.equal(a.password,passwords.at(-1));
 return {error:authFailure?{}:null,data:{user:{id:badIdentity?'wrong':requestId,phone:'99900000001'},session:{access_token:jwt(),refresh_token:'server-refresh'}}};
},async signOut(){revoked++;}}};
let serviceClients=0,captchaValid=false,captchaChecks=0;
const captchaFetch=async(url:string,options:{body:URLSearchParams})=>{
 assert.equal(url,'https://api.hcaptcha.com/siteverify');captchaChecks++;
 assert.equal(options.body.get('secret'),'fictional-server-secret');assert.equal(options.body.get('sitekey'),'fictional-site-key');
 return Response.json({success:captchaValid});
};
const directModules:Record<string,unknown>={
 'server-only':{},'node:crypto':await import('node:crypto'),'zod':await import('zod'),
 'next/headers':{cookies:async()=>({get:()=>directCookie?{value:directCookie}:undefined,set:(_n:string,v:string,o:Record<string,unknown>)=>{directCookie=v;assert.equal(o.httpOnly,true);assert.equal(o.sameSite,'strict');},delete:()=>{directCookie=undefined;}})},
 '@/lib/supabase/server':{createClient:async()=>({auth:{setSession:async(a:Record<string,unknown>)=>{
  assert.ok(directCalls.includes('test_signin_direct_verified'),'No browser session until DB admission');
  assert.deepEqual(JSON.parse(JSON.stringify(a)),{access_token:jwt(),refresh_token:'server-refresh'});installed++;return {error:installFailure?{}:null};
 }}})},
 '@/lib/captcha':await import('@/lib/captcha'),
 './runtime':{telegramAuthService:()=>{serviceClients++;return directService;}},
};
const direct={} as typeof import('@/lib/telegram-auth/test-signin');
new vm.Script(ts.transpileModule(readFileSync('lib/telegram-auth/test-signin.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)
 .runInNewContext({exports:direct,Buffer,URLSearchParams,AbortSignal,fetch:captchaFetch,process:{env},require:(name:string)=>{assert.ok(name in directModules,name);return directModules[name];}});
const plain=(r:unknown)=>JSON.parse(JSON.stringify(r));
for(const provider of ['sms','twilio-whatsapp','meta-whatsapp-hook','brevo-sms-hook','twilio-sms-hook','twilio-verify-hook','telegram-hook',undefined,'off']){
 env.NOREON_PHONE_OTP_PROVIDER=provider;directCalls=[];serviceClients=0;
 assert.deepEqual(plain(await direct.requestTestSigninCode('+99900000001')),{ok:true});
 assert.deepEqual(plain(await direct.verifyTestSigninCode('+99900000001','246810')),{ok:true});
 assert.deepEqual(directCalls,['test_signin_direct_begin','test_signin_direct_check','password_grant','test_signin_direct_verified']);
 assert.equal(serviceClients,3,'Challenge, privileged admission and password grant use separate clients');
 assert.equal(directCookie,undefined,'Success clears challenge cookie');
}
assert.equal(new Set(passwords).size,passwords.length,'Every admitted login rotates a fresh random password');
assert.ok(passwords.every(p=>/^[A-Za-z0-9_-]{43}$/.test(p)&&p!=='246810'),'No test code becomes an Auth password');
// Each refusal from the actual RPC boundary stops before account creation or session exchange.
for(const reason of ['switched_off','not_allowlisted','rate_limited','wrong_code','expired','not_verifiable','unknown_request','switched_off_or_removed']){
 directRefusal=undefined;await direct.requestTestSigninCode('+99900000001');
 directRefusal=reason;directCalls=[];const mutations=created+updated,beforeInstall=installed;
 assert.equal((await direct.verifyTestSigninCode('+99900000001','246810')).ok,false,reason);
 assert.deepEqual(directCalls,['test_signin_direct_check']);assert.equal(created+updated,mutations);assert.equal(installed,beforeInstall);
 assert.equal((await direct.requestTestSigninCode('+99900000001')).ok,false,reason);
}
directRefusal=undefined;
for(const flag of [undefined,'false','TRUE','true']){
 env.NOREON_TEST_SIGNIN_ENABLED=flag;
 assert.equal(direct.testSigninEntryEnabled(env),flag==='true');
 directRefusal=flag==='true'?undefined:'switched_off';
 assert.equal((await direct.requestTestSigninCode('+99900000001')).ok,flag==='true');
}
env.NOREON_TEST_SIGNIN_ENABLED='true';directRefusal=undefined;
existingUser=null;await direct.requestTestSigninCode('+99900000001');
assert.equal((await direct.verifyTestSigninCode('+99900000001','246810')).ok,true);assert.equal(created,1,'Fresh fictional member uses normal Auth admin creation');
existingUser=requestId;
for(const failure of ['final','auth','identity','role','install','phone']){
 await direct.requestTestSigninCode('+99900000001');directCalls=[];
 finalRefusal=failure==='final';authFailure=failure==='auth';badIdentity=failure==='identity';badRole=failure==='role';installFailure=failure==='install';checkedPhone=failure==='phone'?'+99900000002':'+99900000001';
 const beforeInstall=installed,beforeRevoke=revoked;
 assert.equal((await direct.verifyTestSigninCode('+99900000001','246810')).ok,false,failure);
 if(failure!=='install')assert.equal(installed,beforeInstall,'Failure never publishes a session');
 if(failure!=='phone'){assert.equal(revoked,beforeRevoke+1);assert.equal(directCalls.at(-1),'test_signin_direct_abandon');}
 finalRefusal=authFailure=badIdentity=badRole=installFailure=false;checkedPhone='+99900000001';
}
assert.equal((await direct.requestTestSigninCode('+37499000001')).ok,false,'Real number cannot enter direct test module');
assert.equal((await direct.verifyTestSigninCode('+37499000001','246810')).ok,false);
console.log('PASS direct test sign-in: all app providers/off, separate Auth exchange, existing/fresh member, buffered session, refusal and revocation paths (Auth/RPC IO mocked).');

directCookie=undefined;directCalls=[];
assert.equal((await direct.verifyTestSigninCode('+99900000001','246810')).ok,false);
assert.deepEqual(directCalls,['test_signin_direct_check'],'Missing browser challenge is audited without an Auth mutation');
env.NOREON_CAPTCHA_ENABLED='true';env.NEXT_PUBLIC_HCAPTCHA_SITE_KEY='fictional-site-key';
env.HCAPTCHA_SECRET_KEY='fictional-server-secret';directCalls=[];
assert.equal((await direct.requestTestSigninCode('+99900000001','not-a-valid-captcha')).ok,false,'A nonempty invalid CAPTCHA cannot admit a test challenge');
assert.deepEqual(directCalls,[],'Invalid CAPTCHA never reaches challenge storage');
captchaValid=true;assert.equal((await direct.requestTestSigninCode('+99900000001','valid-fixture')).ok,true);
assert.equal(captchaChecks,2);
delete env.HCAPTCHA_SECRET_KEY;directCalls=[];
assert.equal((await direct.requestTestSigninCode('+99900000001','valid-fixture')).ok,false,'Missing CAPTCHA secret fails closed');
assert.deepEqual(directCalls,[]);
console.log('PASS test-only CAPTCHA validation: invalid token/missing secret fail closed before admission, valid token accepted (siteverify mocked).');

// Independent review probe: the Auth identity changes after SQL admission.
delete env.NOREON_CAPTCHA_ENABLED;
await direct.requestTestSigninCode('+99900000001');
let passwordChangedForRealIdentity=false;
const oldUpdate=directService.auth.admin.updateUserById;
directService.auth.admin.updateUserById=async(id:string,a:{password:string})=>{
 passwordChangedForRealIdentity=true;
 return {error:null,data:{user:{id,phone:'37499000001'}}};
};
const installsBeforeRace=installed;
assert.equal((await direct.verifyTestSigninCode('+99900000001','246810')).ok,false);
assert.equal(passwordChangedForRealIdentity,true);
assert.equal(installed,installsBeforeRace);
directService.auth.admin.updateUserById=oldUpdate;
console.log('REPRODUCED: changed-to-real-phone account is mutated before identity mismatch refuses; no browser session installed (Auth IO mocked).');
const {normalizePhone}=await import('@/lib/patient/validation');
for (const [raw,want] of [['+99900000',true],['+9990000',false],['+99900000000000',true],['+999000000000000',false],[' +999 (000) 00 ',true],['99900000001',false],['+37499000001',false],['099000001',false],['+999٠٠٠٠٠',false]] as const) {
 const ph=normalizePhone(raw);
 assert.equal(!!ph&&direct.isTestSigninPhone(ph),want,raw);
}
console.log('PASS normalization / leading zero / length / unicode / real-number boundary probes.');
