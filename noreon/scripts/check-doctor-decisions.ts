import assert from 'node:assert/strict';
import {runItemDecision} from '@/lib/doctor-decisions/items';
const id='11111111-1111-4111-8111-111111111111';
const calls:unknown[]=[];
const client={async rpc(name:string,args?:Record<string,unknown>){calls.push({name,args});return {data:{status:'saved'},error:null};}};
assert.deepEqual(await runItemDecision(client,{kind:'ldl',id,memberId:id,revision:'a'.repeat(32),note:''}),{status:'saved'});
assert.equal(calls.length,1);
assert.deepEqual(calls[0],{name:'doctor_decision_apply',args:{p_kind:'ldl',p_id:id,p_member:id,p_revision:'a'.repeat(32),p_note:''}});
for(const status of ['stale','saved','access','disabled']){
 const result=await runItemDecision({async rpc(){return {data:{status},error:null};}},{kind:'ldl',id,memberId:id,revision:'b'.repeat(32)});
 assert.equal(result.status,status);
}
assert.equal((await runItemDecision(client,{kind:'publish',id,memberId:id,revision:'a'.repeat(32)})).status,'invalid');
assert.equal(calls.length,1,'No unsupported actions reach the database');
assert.equal((await runItemDecision({async rpc(){return {data:null,error:{code:'42501'}};}},{kind:'medicine',id,memberId:id,revision:'a'.repeat(32)})).status,'access');
console.log('Doctor decision adapter checks passed');

// Exercise the actual server action guard, with authentication and RPC IO replaced only.
const {readFileSync}=await import('node:fs');
const {createRequire}=await import('node:module');
const {default:vm}=await import('node:vm');
const {default:ts}=await import('typescript');
const require=createRequire(import.meta.url),exports:Record<string,unknown>={};
const {itemDecisionSchema}=await import('@/lib/doctor-decisions/items');
let role='nurse',enabled=true,authCalls=0,rpcCalls=0;
const serverClient={async rpc(){rpcCalls++;return {data:{status:'saved'},error:null};}};
const actionCode=ts.transpileModule(readFileSync('lib/doctor-decisions/actions.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
new vm.Script(actionCode).runInNewContext({exports,require(name:string){
 if(name==='next/cache')return {revalidatePath(){}};
 if(name==='@/lib/observability/with-logging')return {loggedAction:(_name:string,fn:unknown)=>fn};
 if(name==='@/lib/patient-care/clinical-case-repository')return {requireRealStaff:async()=>{authCalls++;return {identity:{role},client:serverClient};}};
 if(name==='@/lib/staff-zoe/workspace-config')return {doctorDecisionsEnabled:()=>enabled};
 if(name==='@/lib/care-alerts/contracts')return {careAlertsEnabled:()=>true};
 if(name==='./items')return {itemDecisionSchema,runItemDecision};
 return require(name);
}});
const press=exports.pressDoctorItem as (input:unknown)=>Promise<{status:string}>;
const valid={kind:'ldl',id,memberId:id,revision:'a'.repeat(32)};
for(role of ['nurse','admin'])assert.equal((await press(valid)).status,'access');
assert.equal(rpcCalls,0,'Wrong staff role never reaches a write');
role='doctor';enabled=false;const beforeAuth=authCalls;
assert.equal((await press(valid)).status,'disabled');assert.equal(authCalls,beforeAuth);
enabled=true;
assert.equal((await press({...valid,revision:undefined})).status,'invalid');assert.equal(rpcCalls,0,'A card can never omit its displayed revision');
assert.equal((await press(valid)).status,'saved');assert.equal(rpcCalls,1);

console.log('Actual doctor card action: wrong role, disabled flag, missing revision refused; assigned-doctor DB enforcement is in the SQL check');

const {ConversationRepository}=await import('@/lib/conversation-persistence/repository');
const command={schema:1,purpose:'reply.approve',intentId:'a'.repeat(32),requestId:'b'.repeat(32)};
const routed:unknown[]=[];
const repo=new ConversationRepository({async rpc(name,args){routed.push({name,args});return {data:{ok:false,code:'stale_context'},error:null};}});
await repo.command(command);
await repo.command(command,{memberId:id,modeRevision:'c'.repeat(32)});
assert.deepEqual(routed,[{name:'conversation_command',args:{p_command:command}},{name:'doctor_decision_reply_apply',args:{p_member:id,p_mode_revision:'c'.repeat(32),p_command:command}}]);
await assert.rejects(()=>repo.command(command,{memberId:id,modeRevision:'invalid'}));
assert.equal(routed.length,2,'Invalid takeover revision reaches no command');
console.log('Reply definition: legacy route retained, card route carries the mode revision, malformed revision refused');

// Legacy pages keep their own replay contract even when decision cards are off.
// Only authentication, navigation and database IO are replaced; the actions and parsers are real.
const contracts=await import('@/lib/care-alerts/contracts');
const suggestions=await import('@/lib/care-alerts/resolution-suggestion');
const runtime=await import('@/lib/ldl/response-runtime');
const items=await import('@/lib/doctor-decisions/items');
const config=await import('@/lib/staff-zoe/workspace-config');
const legacyEnv={NOREON_DOCTOR_WORKSPACE:'true',NOREON_DOCTOR_DECISIONS:'false',NOREON_CARE_ALERTS_ENABLED:'true'};
assert.equal(config.doctorDecisionsEnabled(legacyEnv),false);
const alert={id,memberId:id,memberName:'Fictional member',source:'message',priority:'urgent',reason:'urgent_words_matched',redFlags:[],
 state:'acknowledged',stateSeq:2,occurrences:1,createdAt:'2026-10-31T12:00:00Z',lastSeenAt:'2026-10-31T12:00:00Z',
 doctorName:'Fictional doctor',acknowledgedAt:'2026-10-31T12:01:00Z',acknowledgedBy:'Fictional doctor',resolvedAt:null,resolvedBy:null,
 resolution:null,resolutionNote:null,telegram:[]};
for(const lostResponse of [false,true]){
 for(const kind of ['ldl','alert']as const){
  let mutations=0,attempts=0;
  const legacyClient={async rpc(name:string,args?:Record<string,unknown>){
   const expected=kind==='ldl'?'doctor_ldl_response_close':'care_alert_acknowledge';
   assert.equal(name,expected,'Legacy pages must reach the replay-capable command directly');
   assert.deepEqual(JSON.parse(JSON.stringify(args)),kind==='ldl'?{p_response:id,p_note:'Fictional review'}:{p_alert:id,p_expected_seq:1});
   attempts++;
   const changed=mutations===0;
   if(changed)mutations++;
   // The first command commits, but its response never reaches the action.
   if(lostResponse&&attempts===1)throw Error('Synthetic response lost after commit');
   return {data:kind==='ldl'?{status:changed?'saved':'replayed'}:{ok:true,changed,alert},error:null};
  }};
  const actionExports:Record<string,unknown>={};
  const filename=kind==='ldl'?'lib/ldl/response-actions.ts':'lib/care-alerts/actions.ts';
  const code=ts.transpileModule(readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new vm.Script(code).runInNewContext({exports:actionExports,process:{env:legacyEnv},require(name:string){
   if(name==='next/cache')return {revalidatePath(){}};
   if(name==='next/navigation')return {redirect:(url:string)=>{throw new Error(url);}};
   if(name==='@/lib/observability/with-logging')return {loggedAction:(_name:string,fn:unknown)=>fn};
   if(name==='@/lib/observability/logger')return {log:{warn(){},error(){},info(){}}};
   if(name==='@/lib/patient-care/clinical-case-repository')return {requireRealStaff:async()=>({identity:{role:'doctor'},client:legacyClient})};
   if(name==='./contracts')return {...contracts,careAlertsEnabled:()=>contracts.careAlertsEnabled(legacyEnv)};
   if(name==='./resolution-suggestion')return suggestions;
   if(name==='./response-runtime')return runtime;
   if(name==='@/lib/doctor-decisions/items')return items;
   return require(name);
  }});
  const submit=actionExports[kind==='ldl'?'closeLdlResponse':'acknowledgeCareAlert']as(form:FormData)=>Promise<void>;
  const form=new FormData();
  if(kind==='ldl'){form.set('responseId',id);form.set('note','Fictional review');}
  else{form.set('alertId',id);form.set('seq','1');form.set('from','today');}
  const success=`/staff/real/today?notice=${kind==='ldl'?'ldl_reviewed':'acknowledged'}`;
  await assert.rejects(()=>submit(form),{message:lostResponse?'/staff/real/today?notice=unavailable':success});
  await assert.rejects(()=>submit(form),{message:success});
  assert.equal(attempts,2,'Both submissions reach the command');
  assert.equal(mutations,1,'A retry after success or a lost response changes the record once');
 }
}
console.log('Legacy LDL and alert actions: decisions off, successful retry and lost-response retry keep success notices with one mutation (controlled DB IO)');
