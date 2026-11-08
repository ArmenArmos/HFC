import assert from 'node:assert/strict';
import {readPendingConnection,sealPendingConnection} from '@/lib/doctor-telegram/pending';
import {passwordSession} from '@/lib/doctor-telegram/connect-session';
const doctor='11111111-1111-4111-8111-111111111111',sid='22222222-2222-4222-8222-222222222222';
let authError=false,other=false,recovery=false,signouts=0;
const calls:string[]=[];
const client={auth:{
 async signInWithPassword(args:unknown){calls.push('password');assert.deepEqual(args,{email:'doctor@example.invalid',password:'synthetic-password'});return {error:authError?{status:400}:null,data:{session:authError?null:{access_token:'synthetic-access',refresh_token:'synthetic-refresh'}}};},
 async getSession(){throw Error('Must use the exact new token');},
 async getUser(token:string){assert.equal(token,'synthetic-access');return {data:{user:{id:other?sid:doctor,email:'doctor@example.invalid',email_confirmed_at:'2026-10-01'}},error:null};},
 async getClaims(token:string){assert.equal(token,'synthetic-access');return {data:{claims:{sub:other?sid:doctor,session_id:sid,amr:[{method:recovery?'recovery':'password'}]}},error:null};},
 async signOut(args:unknown){assert.deepEqual(args,{scope:'local'});signouts++;},
}} as unknown as Parameters<typeof passwordSession>[0];
const run=()=>passwordSession(client,doctor,'doctor@example.invalid','synthetic-password');
assert.deepEqual(await run(),{kind:'session',sessionId:sid,accessToken:'synthetic-access',refreshToken:'synthetic-refresh'});
authError=true;assert.equal((await run()).kind,'password');authError=false;
other=true;assert.equal((await run()).kind,'unavailable');other=false;
recovery=true;assert.equal((await run()).kind,'unavailable');assert.equal(signouts,2);
assert.equal(calls.length,4);
console.log('Dedicated password session: exact token, wrong password, foreign identity and recovery refusal passed.');

const env={NOREON_DOCTOR_TELEGRAM_KEY:`v1:${Buffer.alloc(32,11).toString('base64')}`};
const context={doctorId:doctor,sessionId:sid,bindingGeneration:1},now=1_000_000;
const pending=sealPendingConnection({accessToken:'synthetic-access',refreshToken:'synthetic-refresh',challenge:{challengeId:sid,nonce:'a'.repeat(43)}},context,now,env);
assert.equal(readPendingConnection(pending,doctor,now,env).sessionId,sid);
assert.throws(()=>readPendingConnection(pending,sid,now,env));
const outer=JSON.parse(pending);outer.until=now+1_000_000;
assert.throws(()=>readPendingConnection(JSON.stringify(outer),doctor,now+300_000,env),'An edited outer expiry cannot extend an admitted challenge');
outer.ciphertext=outer.ciphertext.slice(0,-2)+'aa';assert.throws(()=>readPendingConnection(JSON.stringify(outer),doctor,now,env));
console.log('Pending connection: authenticated five-minute expiry, identity binding and tamper refusal passed.');

// Execute the actual server actions with local Auth/RPC/cookie boundaries.
const {readFileSync}=await import('node:fs'),{default:vm}=await import('node:vm'),{default:ts}=await import('typescript');
const {z}=await import('zod'),seal=await import('@/lib/doctor-telegram/seal'),pendingModule=await import('@/lib/doctor-telegram/pending');
const {parseStaffSigninState}=await import('@/lib/telegram-auth/staff-signin-config');
const originalKey=process.env.NOREON_DOCTOR_TELEGRAM_KEY;process.env.NOREON_DOCTOR_TELEGRAM_KEY=env.NOREON_DOCTOR_TELEGRAM_KEY;
let requireCode=true,openFails=false,openThrows=false,codeValid=true,flag=true,bound=true;
const cookieValues=new Map<string,string>(),rpcCalls:{name:string;args:Record<string,unknown>}[]=[];
const jar={get:(name:string)=>cookieValues.has(name)?{value:cookieValues.get(name)!}:undefined,set:(name:string,value:string,options:Record<string,unknown>)=>{assert.equal(options.httpOnly,true);assert.equal(options.maxAge,300);assert.equal(options.path,'/staff/real');cookieValues.set(name,value);},delete:(name:string)=>cookieValues.delete(name)};
const actionClient={auth:{signOut:async()=>{throw Error('No tokenless signout may substitute for exact-session cleanup');}},rpc:async(name:string)=>{assert.equal(name,'staff_signin_state');return {data:{ok:true,required:requireCode,admitted:!requireCode,enrolled:true,eligible:true},error:null};}};
const actionModules:Record<string,unknown>={
 '@/lib/observability/with-logging':{loggedAction:(_name:string,fn:unknown)=>fn},
 'next/headers':{cookies:async()=>jar},'@supabase/supabase-js':{createClient:(_url:unknown,_key:unknown,options:unknown)=>{assert.deepEqual(JSON.parse(JSON.stringify(options)),{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});return actionClient;}},'zod':{z},
 '@/lib/patient-care/clinical-case-repository':{requireRealStaff:async()=>({identity:{id:doctor,role:'doctor'},client:{auth:{browser:true}}})},
 '@/lib/staff/real-session-binding':{validatedStaffSession:async(auth:unknown)=>{assert.deepEqual(auth,{browser:true});return {user:{id:doctor,email:'doctor@example.invalid'},sessionId:'browser-session'};}},
 '@/lib/telegram-auth/runtime':{telegramAuthService:()=>({rpc:async(name:string,args:Record<string,unknown>)=>{rpcCalls.push({name,args});if(name==='doctor_telegram_status')return {data:{ok:true,binding:bound?{id:doctor,generation:1}:null,nextGeneration:1,connection:null},error:null};if(name==='doctor_telegram_open'){if(openThrows)throw Error('Lost setup response');return {data:{ok:!openFails},error:null};}assert.ok(['doctor_telegram_abandon','doctor_telegram_disconnect'].includes(name));return {data:{ok:true},error:null};}})},
 '@/lib/telegram-auth/staff-signin-config':{parseStaffSigninState,staffTelegramSigninEnabled:()=>true},
 '@/lib/telegram-auth/staff-signin-core':{beginStaffSessionCode:async(session:unknown)=>{assert.deepEqual(JSON.parse(JSON.stringify(session)),{userId:doctor,sessionId:sid});return {ok:true,pending:{challengeId:sid,nonce:'a'.repeat(43)}};},verifyStaffSessionCode:async(session:unknown)=>{assert.deepEqual(JSON.parse(JSON.stringify(session)),{userId:doctor,sessionId:sid});return codeValid?{ok:true}:{ok:false,reason:'invalid'};}},
 './config':{doctorTelegramEnabled:()=>flag},'./seal':seal,'./pending':pendingModule,
 './actor':{doctorBrokerActor:async(token:string,expected:string,options:unknown)=>{assert.equal(token,'synthetic-access');assert.equal(expected,doctor);assert.deepEqual(JSON.parse(JSON.stringify(options)),{sessionId:sid});return {identity:{id:doctor}};}},
 './connect-session':{passwordSession:async()=>({kind:'session',sessionId:sid,accessToken:'synthetic-access',refreshToken:'synthetic-refresh'})},
};
const actionExports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/doctor-telegram/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:actionExports,process,Date,JSON,require:(name:string)=>{assert.ok(name in actionModules,name);return actionModules[name];}});
const actions=actionExports as typeof import('@/lib/doctor-telegram/actions');
const passwordForm=new FormData();passwordForm.set('password','synthetic-password');
const codeForm=new FormData();codeForm.set('code','123456');
for(const throwing of [false,true]){
 openFails=!throwing;openThrows=throwing;rpcCalls.length=0;
 assert.equal((await actions.connectDoctorTelegram(passwordForm)).kind,'code');
 assert.ok(!rpcCalls.some(c=>c.name==='doctor_telegram_open'),'Never open a session before code admission');
 assert.equal((await actions.verifyDoctorTelegram(codeForm)).kind,'unavailable');
 assert.deepEqual(rpcCalls.filter(c=>c.name==='doctor_telegram_abandon').map(c=>JSON.parse(JSON.stringify(c.args))),[{p_doctor:doctor,p_session:sid}]);
 assert.equal(cookieValues.size,0);
}
openFails=false;openThrows=false;rpcCalls.length=0;
assert.equal((await actions.connectDoctorTelegram(passwordForm)).kind,'code');codeValid=false;
assert.equal((await actions.verifyDoctorTelegram(codeForm)).kind,'invalid');assert.equal(cookieValues.size,1);
assert.ok(!rpcCalls.some(c=>c.name==='doctor_telegram_abandon'));
codeValid=true;assert.equal((await actions.verifyDoctorTelegram(codeForm)).kind,'connected');assert.equal(cookieValues.size,0);
assert.ok(!rpcCalls.some(c=>c.name==='doctor_telegram_abandon'));
requireCode=false;openFails=true;rpcCalls.length=0;
assert.equal((await actions.connectDoctorTelegram(passwordForm)).kind,'unavailable');assert.equal(rpcCalls.at(-1)?.name,'doctor_telegram_abandon');
flag=false;rpcCalls.length=0;assert.equal(await actions.doctorTelegramMenuState(),null);assert.equal((await actions.connectDoctorTelegram(passwordForm)).kind,'unavailable');assert.equal(rpcCalls.length,0);
flag=true;bound=false;assert.equal(await actions.doctorTelegramMenuState(),null);
if(originalKey===undefined)delete process.env.NOREON_DOCTOR_TELEGRAM_KEY;else process.env.NOREON_DOCTOR_TELEGRAM_KEY=originalKey;
console.log('Connect actions: admission before open, invalid code retry, exact pending-session cleanup on refused/throwing open, and dark/unbound refusal passed (fake Auth/RPC/cookies).');
