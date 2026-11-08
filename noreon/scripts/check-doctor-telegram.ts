import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {doctorTelegramEnabled} from '../lib/doctor-telegram/config';
import {sealRefreshToken,unsealRefreshToken} from '../lib/doctor-telegram/seal';
import {doctorBrokerActor,type DoctorBrokerActor} from '../lib/doctor-telegram/actor';
import {withBroker,doctorBrokerAuth,type BrokerDependencies} from '../lib/doctor-telegram/broker';
import type {StaffAccessClient} from '../lib/staff/real-staff-access';
const doctor='11111111-1111-4111-8111-111111111111',session='22222222-2222-4222-8222-222222222222',other='33333333-3333-4333-8333-333333333333',connection='44444444-4444-4444-8444-444444444444',lease='55555555-5555-4555-8555-555555555555';
const env={NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_CHAT_HOME:'true',NOREON_DOCTOR_CHAT_V2:'true',NOREON_DOCTOR_TELEGRAM:'true',NOREON_DOCTOR_TELEGRAM_KEY:`v1:${randomBytes(32).toString('base64')}`};
const context={doctorId:doctor,sessionId:session,generation:1,bindingGeneration:1};
const sealed=sealRefreshToken('original-refresh',context,env);
assert.equal(unsealRefreshToken(sealed,context,env),'original-refresh');
assert.notEqual(sealRefreshToken('original-refresh',context,env).nonce,sealed.nonce);
for(const changed of [{doctorId:other},{sessionId:other},{generation:2},{bindingGeneration:2}])assert.throws(()=>unsealRefreshToken(sealed,{...context,...changed},env));
assert.throws(()=>unsealRefreshToken({...sealed,ciphertext:`${sealed.ciphertext[0]==='A'?'B':'A'}${sealed.ciphertext.slice(1)}`},context,env));
assert.throws(()=>unsealRefreshToken({...sealed,keyVersion:'v2'},context,env));
assert.throws(()=>sealRefreshToken('token',context,{...env,NOREON_DOCTOR_TELEGRAM_KEY:'bad'}));
assert.equal(doctorTelegramEnabled(env),true);
for(const key of ['NOREON_DOCTOR_WORKSPACE','NOREON_DOCTOR_CHAT_HOME','NOREON_DOCTOR_CHAT_V2','NOREON_DOCTOR_TELEGRAM']){
 assert.equal(doctorTelegramEnabled({...env,[key]:'TRUE'}),false);
 assert.equal(doctorTelegramEnabled({...env,[key]:undefined}),false);
}
type AccessOptions={role?:string;identityId?:string;method?:string[];admitted?:boolean;required?:boolean;zoe?:boolean;sessionId?:string;identityError?:boolean;admissionError?:boolean};
function fakeAccess(options:AccessOptions={}){
 const calls:string[]=[];
 const user={id:doctor,email:'doctor@example.invalid',email_confirmed_at:'2026-11-01T00:00:00Z'};
 const client={auth:{getSession:async()=>{throw Error('Exact token must not read cached session');},getUser:async(token:string)=>{calls.push(`user:${token}`);return {data:{user},error:null};},getClaims:async(token:string)=>{calls.push(`claims:${token}`);return {data:{claims:{sub:doctor,session_id:options.sessionId??session,amr:(options.method??['password']).map(method=>({method}))}},error:null};}},rpc:async(name:string)=>{
  calls.push(name);
  if(name==='real_clinical_staff_identity')return {data:{id:options.identityId??doctor,name:'Doctor',role:options.role??'doctor',clinicId:null},error:options.identityError?{}:null};
  if(name==='staff_signin_state')return {data:{required:options.required??true,admitted:options.admitted??true},error:options.admissionError?{}:null};
  if(name==='staff_zoe_status')return {data:options.zoe??true,error:null};
  throw Error('Unexpected RPC');
 }};
 return {client:client as unknown as StaffAccessClient,calls};
}
const happy=fakeAccess();
assert.ok(await doctorBrokerActor('exact-access',doctor,{client:happy.client,env,sessionId:session}));
assert.deepEqual(happy.calls,['user:exact-access','claims:exact-access','real_clinical_staff_identity','staff_signin_state','staff_zoe_status']);
for(const options of [{role:'nurse'},{role:'admin'},{identityId:other},{method:['password','recovery']},{method:['otp']},{admitted:false},{zoe:false},{sessionId:other},{identityError:true},{admissionError:true}]){
 const fake=fakeAccess(options);
 if(options.identityError)await assert.rejects(doctorBrokerActor('exact-access',doctor,{client:fake.client,env,sessionId:session}));
 else assert.equal(await doctorBrokerActor('exact-access',doctor,{client:fake.client,env,sessionId:session}),null);
}
assert.equal(await doctorBrokerActor('exact-access',other,{client:fakeAccess().client,env}),null);
assert.equal(await doctorBrokerActor('exact-access',doctor,{client:fakeAccess().client,env:{...env,NOREON_DOCTOR_CHAT_V2:'false'}}),null);
assert.ok(await doctorBrokerActor('exact-access',doctor,{client:fakeAccess({required:false,admitted:false}).client,env}));

// Real default HTTP port must never inherit the SDK's refresh retries.
for(const failure of ['network','server','malformed','ok'] as const){
 let count=0;
 const auth=doctorBrokerAuth({...env,NEXT_PUBLIC_SUPABASE_URL:'https://auth.example.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public-anon'},async(url,init)=>{
  count++;assert.equal(url,'https://auth.example.invalid/auth/v1/token?grant_type=refresh_token');assert.equal(init?.body,JSON.stringify({refresh_token:'input-refresh'}));
  if(failure==='network')throw Error('Lost response');
  return new Response(JSON.stringify(failure==='malformed'?{}:{access_token:'access',refresh_token:'refresh'}),{status:failure==='server'?503:200});
 });
 const result=await auth.refreshSession({refresh_token:'input-refresh'});
 assert.equal(count,1);assert.equal(!!result.data.session,failure==='ok');
}

function fakeBroker(mode:'ok'|'refreshFail'|'refreshCrash'|'saveFail'|'saveCrash'|'expired'|'denyAdmission'|'crashedPrevious'='ok'){
 const calls:string[]=[];let saved:Record<string,unknown>|null=null;
 const row={id:connection,doctor_id:doctor,session_id:session,generation:1,binding_generation:1,state:'active',ciphertext:sealed.ciphertext,key_version:sealed.keyVersion,nonce:sealed.nonce,expires_at:mode==='expired'?'2000-01-01T00:00:00Z':'2099-01-01T00:00:00Z',lease_token:lease};
 const deps:BrokerDependencies={env,auth:{refreshSession:async input=>{
  calls.push('auth.refresh');assert.equal(input.refresh_token,'original-refresh');
  if(mode==='refreshCrash')throw Error('Auth connection lost');
  return {data:{session:mode==='refreshFail'?null:{access_token:'rotated-access',refresh_token:'rotated-refresh'}},error:mode==='refreshFail'?{}:null};
 }},actor:async(token,id,options)=>{
  calls.push('actor');assert.equal(token,'rotated-access');assert.equal(id,doctor);assert.equal(options?.sessionId,session);
  return {client:fakeAccess().client,identity:{id:doctor,name:'Doctor',role:'doctor',clinicId:null},sessionId:session} as DoctorBrokerActor;
 },rpc:async(name,args)=>{
  calls.push(name);
  if(name==='doctor_telegram_take_lease')return mode==='crashedPrevious'?{ok:false,code:'quarantined'}:{ok:true,connection:row};
  assert.equal(args.p_connection,connection);assert.equal(args.p_generation,1);assert.equal(args.p_lease,lease);
  if(name==='doctor_telegram_finish_refresh'){
   if(mode==='saveCrash')throw Error('Save acknowledgement lost');
   if(mode==='saveFail')return {ok:false};
   saved=args;
   assert.equal(unsealRefreshToken({ciphertext:args.p_ciphertext as string,keyVersion:args.p_key_version as string,nonce:args.p_nonce as string},context,env),'rotated-refresh');
  }
  if(name==='doctor_telegram_action_admit'&&mode==='denyAdmission')return {ok:false};
  return {ok:true};
 }};
 return {deps,calls,saved:()=>saved};
}
const broker=fakeBroker();
assert.deepEqual(await withBroker({connectionId:connection,generation:1},async actor=>{broker.calls.push('work');await actor.admit();return 'connected';},broker.deps),{ok:true,value:'connected'});
assert.ok(broker.saved());
assert.ok(broker.calls.indexOf('doctor_telegram_begin_refresh')<broker.calls.indexOf('auth.refresh'));
assert.ok(broker.calls.indexOf('doctor_telegram_finish_refresh')<broker.calls.indexOf('actor'));
assert.ok(broker.calls.indexOf('doctor_telegram_action_admit')<broker.calls.indexOf('work'));
for(const mode of ['refreshFail','refreshCrash','saveFail','saveCrash','expired','denyAdmission','crashedPrevious'] as const){
 const fake=fakeBroker(mode);let worked=false;
 assert.equal((await withBroker({connectionId:connection,generation:1},async()=>{worked=true;},fake.deps)).ok,false);
 assert.equal(worked,false);
 assert.equal(fake.calls.filter(c=>c==='auth.refresh').length,['expired','crashedPrevious'].includes(mode)?0:1);
 if(['refreshFail','refreshCrash','saveFail','saveCrash'].includes(mode)){
  assert.ok(fake.calls.includes('doctor_telegram_quarantine'));
  assert.ok(!fake.calls.includes('doctor_telegram_release_lease'));
 }
}
// T1 ships a plain connected response only. Clinical operations must not appear in this broker.
const brokerSource=readFileSync(new URL('../lib/doctor-telegram/broker.ts',import.meta.url),'utf8');
for(const operation of ['reply.approve','doctor_chat_hand_back','care_alert_acknowledge','care_alert_resolve'])assert.ok(!brokerSource.includes(operation));
console.log('Doctor Telegram seal, actor and broker checks passed (fake Auth and RPC; no hosted calls).');
