/** Actual action module; local mocks only at Auth, proof/cookie and database boundaries. */
import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';import vm from 'node:vm';import ts from 'typescript';
const require=createRequire(import.meta.url),user='11111111-1111-4111-8111-111111111111';
let stage='verified',status='verified',passwordCalls=0,proofWrites=0,signouts=0,problem='none';const steps:string[]=[];let contextReads=0;let validatedCalls=0;
class AccessChanged extends Error{}
const setup=()=>({context:{id:'22222222-2222-4222-8222-222222222222',generation:1},session:{user:{id:user},sessionId:'33333333-3333-4333-8333-333333333333'},proof:{stage,tokenDigest:'a'.repeat(64)},client:{auth:{updateUser:async()=>{passwordCalls++;if(problem==='throw')throw Error('Unknown local transport');return {data:{user:{id:user}},error:problem==='password'?{status:400}:problem==='unknown'?{status:503}:null};},signOut:async()=>{signouts++;}}}});
const exports:Record<string,unknown>={};const source=ts.transpileModule(readFileSync('lib/staff/real-recovery-actions.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
new vm.Script(source).runInNewContext({exports,Buffer,require(name:string){if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};
 if(name==='zod'||name==='node:crypto')return require(name);
 if(name==='next/navigation')return {redirect:(path:string)=>{throw Error('redirect:'+path);}};
 if(name==='next/cache')return {revalidatePath:()=>{}};
 if(name==='./real-invitation-session')return {doctorInvitationAvailable:async()=>true};
 if(name==='@/lib/patient-care/clinical-case-repository')return {realStaffClient:async()=>({auth:{verifyOtp:async()=>({error:null,data:{session:problem==='sessionless'?null:{access_token:'local-synthetic-token'}}}),signOut:async()=>{}}})};
 if(name==='./real-session-binding')return {validatedStaffSession:async()=>{validatedCalls++;return ({user:{id:user,email:'doctor@example.invalid'},sessionId:'33333333-3333-4333-8333-333333333333'});}};
 if(name==='./real-recovery-dispatch')return {recoveryTokenDigest:()=> 'a'.repeat(64)};
 if(name==='./real-recovery-session')return {recoveryContext:async()=>{contextReads++;if(contextReads>1)throw Error('Post-OTP context DB unavailable');return {id:'22222222-2222-4222-8222-222222222222',generation:1,staffId:user,identity:{email:'doctor@example.invalid'},status:'pending',tokenDigest:'a'.repeat(64)};},RecoveryAccessChanged:AccessChanged,recoverySetup:async()=>setup(),writeRecoveryProof:async(_c:unknown,_u:string,_s:string,next:string)=>{stage=next;proofWrites++;},clearRecoveryProof:async()=>{},recoveryStep:async(_c:unknown,step:string)=>{
  steps.push(step);if(step==='verify'&&problem==='otp-db')throw Error('Verification record DB unavailable');if(step==='complete'&&problem==='audit')throw Error('Audit unavailable');if(step==='complete'&&problem==='removed')throw new AccessChanged();
  if(step==='claim-password'){if(status!=='verified')return {claimed:false};status='changing';return {claimed:true};}
  if(step==='password-failed')status='verified';if(step==='password-unknown')status='cancelled';if(step==='complete')status='completed';return {};
 }};
 if(['./real-admin','./real-invitation-session','@/lib/patient-care/clinical-case-repository','./real-session-binding','./real-recovery-dispatch'].includes(name))return {};
 throw Error('Unexpected import '+name);
}});
type State={ok:boolean;message:string;passwordSaved?:boolean;restartRequired?:boolean;outcomeUnknown?:boolean};const actions=exports as Record<string,(previous:State,data:FormData)=>Promise<State>>;
const initial={ok:false,message:''},form=new FormData();form.set('password','fictional-reset-password');form.set('confirmation','fictional-reset-password');
const reset=(error:string)=>{problem=error;stage='verified';status='verified';passwordCalls=0;proofWrites=0;signouts=0;steps.length=0;};
reset('audit');const pending=await actions.resetRealStaffPassword(initial,form);assert.equal(pending.passwordSaved,true);assert.equal(stage,'password_saved');assert.equal(passwordCalls,1);assert.equal(proofWrites,1);
problem='none';await assert.rejects(()=>actions.confirmRealStaffPasswordReset(initial,new FormData()),/redirect:\/staff\/real\/login\?password-reset=complete/);assert.equal(passwordCalls,1,'Audit retry must never resave password');assert.equal(signouts,1);
reset('password');const failed=await actions.resetRealStaffPassword(initial,form);assert.equal(failed.passwordSaved,undefined);assert.equal(status,'verified');assert.equal(stage,'verified');
for(const failure of ['unknown','throw']){reset(failure);const unknown=await actions.resetRealStaffPassword(initial,form);assert.equal(unknown.outcomeUnknown,true);assert.equal(unknown.restartRequired,true);assert.equal(status,'cancelled');assert.equal(proofWrites,0);}
reset('none');status='changing';const competing=await actions.resetRealStaffPassword(initial,form);assert.equal(competing.restartRequired,true);assert.equal(passwordCalls,0);
reset('removed');const removed=await actions.resetRealStaffPassword(initial,form);assert.equal(removed.passwordSaved,true);assert.equal(removed.restartRequired,true);assert.equal(signouts,1);assert.match(removed.message,/access changed/);
reset('otp-db');contextReads=0;const verifyForm=new FormData();for(const [key,value] of Object.entries({operationId:'22222222-2222-4222-8222-222222222222',generation:'1',token:'x'.repeat(64),type:'recovery'}))verifyForm.set(key,value);
await assert.rejects(()=>actions.verifyRealStaffRecovery(initial,verifyForm),/redirect:\/staff\/real\/reset-password/);assert.equal(contextReads,1,'Consumed OTP must not precede another DB context read before proof');assert.equal(proofWrites,1,'Exact OTP success writes resumable proof before database record');
reset('sessionless');contextReads=0;validatedCalls=0;const sessionless=await actions.verifyRealStaffRecovery(initial,verifyForm);assert.equal(sessionless.ok,false);assert.equal(validatedCalls,0,'Sessionless direct OTP cannot fall back to another session');assert.equal(proofWrites,0);
console.log('Actual recovery actions: known success proof before audit, confirmation-only retry, determinate/unknown Auth errors, competing claim and removal handling passed. Mocked external boundaries.');
