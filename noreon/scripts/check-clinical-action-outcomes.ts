/** Actual server actions and draft validation, controlled Auth/RPC/engine/cache. No network or provider calls. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);
type State={ok:boolean;message:string;revision?:number;uncertain?:boolean};
type Action=(previous:State,form:FormData)=>Promise<State>;
const id='11111111-1111-4111-8111-111111111111',token='a'.repeat(32);
let role='doctor',failure:unknown=null,throws=false,snapshotFailure=false,engineRefusal='',engineTests:{id:string;title:string;method:string}[]=[];
let savedDraft:unknown=null,published=false,currentRevision=3;
let writes:string[]=[],reads=0,refreshes:string[]=[],lastArgs:unknown=null;
const rpc=async(name:string,args?:unknown)=>{
 if(name==='patient_clinical_case_snapshot'){
  reads++;
  return {data:{id,revision:currentRevision,evidenceToken:token,draft:savedDraft,draftStale:false,evidence:{assessment:null},publications:published?[{planId:id,draft:savedDraft}]:[]},error:snapshotFailure?{code:'',message:'PRIVATE upstream body'}:null};
 }
 writes.push(name);lastArgs=args;
 if(throws)throw failure;
 if(!failure){currentRevision=4;if(name.startsWith('save_patient_clinical_draft'))savedDraft=(args as {p_draft:unknown}).p_draft;if(name.startsWith('publish_patient_clinical'))published=true;}
 return {data:name.startsWith('publish_patient_clinical')?id:4,error:failure};
};
function load(path:string):Record<string,unknown>{
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(code).runInNewContext({exports,process:{env:{}},FormData,Error,require(name:string){if(name==='@/lib/observability/with-logging')return {loggedAction:(_action:string,run:unknown)=>run,withRouteLogging:(handler:unknown)=>handler,logSweep:()=>{}};
  if(name==='./clinical-review-actions')return {realClinicalCommand:async()=>({ok:true,message:'',revision:currentRevision})};
  if(name==='./clinical-review-current')return {currentClinicalReview:()=>true,sameClinicalValue:(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b)};
  if(name==='@/lib/care-alerts/contracts')return {careAlertsEnabled:()=>false};
  if(name==='@/lib/doctor-inbox/member-urgent-server')return {};
  if(name==='zod')return require(name);
  if(name==='next/cache')return {revalidatePath:(path:string)=>refreshes.push(path)};
  if(name==='next/navigation')return {redirect:()=>{throw Error('Unexpected redirect');}};
  if(name==='@/lib/supabase/server')return {createClient:async()=>{throw Error('Unexpected member client');}};
  if(name==='@/lib/patient/auth')return {patientIdentity:async()=>null};
  if(name==='./real-review-config')return {realReviewEnabled:()=>true};
  if(name==='./enrolment')return {enrolClinicalCase:async()=>{throw Error('Unexpected member enrolment');}};
  // B5 ships dark: with the switch off, publish keeps the original RPC.
  if(name==='@/lib/doctor-completion/config')return {doctorCompletionEnabled:()=>false};
  if(name==='@/lib/telegram-auth/staff-signin')return {readStaffSigninState:async()=>null,staffTelegramSigninEnabled:()=>false};
  if(name==='@/lib/telegram-runtime/config')return {telegramEnabled:()=>false};
  if(name==='@/lib/captcha')return {captchaRequired:()=>true};
  if(name==='@/lib/telegram-auth/runtime')return {telegramAuthEnabled:()=>false};
  if(name==='./clinical-case-repository')return {requireRealStaff:async()=>({identity:{id,role},client:{rpc}}),snapshotSchema:{parse:(data:unknown)=>data}};
  if(name==='./clinical-review-engine')return {clinicalReviewEngine:()=>{if(engineRefusal)throw Error(engineRefusal);return {tests:engineTests};}};
  if(name==='@/lib/staff/staff-server-copy')return load('lib/staff/staff-server-copy.ts');
  if(name==='@/lib/locale')return load('lib/locale.ts');
  if(name==='./required-evidence')return load('lib/patient-care/required-evidence.ts');
  if(name==='./clinical-publication-server')return {clinicalWriteClient:()=>({rpc})};
  if(name==='@/lib/service-workflow/publication')return load('lib/service-workflow/publication.ts');
  if(name==='@/lib/service-workflow/draft-input')return load('lib/service-workflow/draft-input.ts');
  if(name==='./publication')return load('lib/service-workflow/publication.ts');
  if(name==='@/lib/staff/yerevan-time')return load('lib/staff/yerevan-time.ts');
  throw Error(`Unexpected import: ${name}`);
 }});
 return exports;
}
const save=load('lib/patient-care/clinical-actions.ts').saveRealDraft as Action;
const command=load('lib/patient-care/clinical-review-actions.ts').realClinicalCommand as Action;
const initial={ok:false,message:''};
const form=(operation:string)=>{
 const data=new FormData();
 for(const [key,value] of Object.entries({id,revision:'3',token,operation,requestId:id,explanation:'Fictional explanation',instructions:'Fictional care instructions',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:'',decision:'not-required',note:'Fictional review note',reportId:id,reportRevision:'2',sourceChecked:'on',testId:'test',rows:'1',completedAt:'2026-10-14T09:00:00Z',mode:'phone'}))data.set(key,value);
 data.set('attachmentId',id);data.append('valueIds',id);
 return data;
};
const reset=()=>{savedDraft=null;published=false;currentRevision=3;role='doctor';engineRefusal='';engineTests=[];failure=null;throws=false;snapshotFailure=false;writes=[];reads=0;refreshes=[];};
const cases=[{name:'draft',action:save,write:'save_patient_clinical_draft'},...['prepare','publish','approve-report','receive-result','receive-clinic-result','receive-all-clinic-results','consultation-decision','complete-consultation'].map(name=>({name,action:command,write:name==='prepare'?'prepare_patient_clinical_review':name==='publish'?'publish_patient_clinical_plan':'command_patient_clinical_review'}))];
for(const entry of cases){
 for(const problem of [{code:'',message:'PRIVATE FetchError body'},{message:'PRIVATE missing-code body'},{code:'PGRST000',message:'PRIVATE connection body'},{code:'PGRST002',message:'PRIVATE schema body'},{code:'PGRST003',message:'PRIVATE timeout body'},{code:'ECONNRESET',message:'PRIVATE network body'},{code:'08006',message:'PRIVATE SQL connection body'}]){
  reset();failure=problem;
  const state=await entry.action(initial,form(entry.name));
  assert.equal(state.ok,false,`${entry.name}: unavailable RPC must not report success`);
  assert.equal(state.uncertain,true,`${entry.name}: ${problem.code??'missing code'} must require fresh context`);
  assert.doesNotMatch(state.message,/PRIVATE/,'Raw infrastructure errors must not reach the clinician');
  assert.deepEqual(writes,[entry.write],`${entry.name}: never retry an unconfirmed write`);
  assert.equal(refreshes.length,0,'No success refresh side effects after failed RPC');
 }
 for(const code of ['42501','40001','23514','55P03','22023','P0001']){
  reset();failure={code,message:'PRIVATE SQL detail'};
  const state=await entry.action(initial,form(entry.name));
  assert.equal(state.ok,false);assert.equal(state.uncertain??false,false,`${entry.name}: ${code} is a definitive SQL rejection`);
  assert.doesNotMatch(state.message,/PRIVATE/,'Do not disclose SQL error bodies');
  assert.deepEqual(writes,[entry.write]);assert.equal(refreshes.length,0);
 }
 if(entry.name==='publish')for(const [sqlMessage,expected] of [['Approve every current imported source report',/source report is not approved/],['Receive every required laboratory result',/laboratory result has not been received/],['Record an explicit consultation decision',/consultation is required/]] as const){
  reset();failure={code:'P0001',message:sqlMessage};
  const state=await entry.action(initial,form(entry.name));
  assert.equal(state.ok,false);assert.match(state.message,expected,'A known publication block names the unmet requirement');assert.doesNotMatch(state.message,/access/,'A publication block is not an access problem');
 }
 if(entry.name==='publish'){
  // Engine refusals (before any write) are named, not reported as an access problem.
  reset();engineRefusal='Profile and questionnaire context disagree.';
  const mismatch=await entry.action(initial,form(entry.name));
  assert.equal(mismatch.ok,false);assert.equal(mismatch.uncertain??false,false);assert.match(mismatch.message,/disagree on age or sex/);assert.deepEqual(writes,[],'An engine refusal never writes');
  reset();engineRefusal='The stored questionnaire is incomplete.';
  const incomplete=await entry.action(initial,form(entry.name));
  assert.equal(incomplete.message,'The stored questionnaire is incomplete.');
  reset();engineRefusal='PRIVATE engine detail';
  const unknown=await entry.action(initial,form(entry.name));
  assert.doesNotMatch(unknown.message,/PRIVATE/,'Unknown engine errors stay generic');
 }
 reset();throws=true;failure=new Error('PRIVATE fetch failure');
 const thrown=await entry.action(initial,form(entry.name));
 assert.equal(thrown.ok,false);assert.equal(thrown.uncertain,true);assert.doesNotMatch(thrown.message,/PRIVATE/);assert.deepEqual(writes,[entry.write]);
 reset();const invalid=form(entry.name);invalid.set(entry.name==='draft'?'instructions':'token','');
 const rejected=await entry.action(initial,invalid);
 assert.equal(rejected.ok,false);assert.equal(rejected.uncertain??false,false);assert.equal(writes.length,0,'Invalid forms cannot reach a write');
 reset();role='nurse';const denied=await entry.action(initial,form(entry.name));
 assert.equal(denied.ok,false);assert.equal(denied.uncertain??false,false);assert.equal(writes.length,0);
 reset();const success=await entry.action(initial,form(entry.name));
 assert.equal(success.ok,true);assert.equal(success.uncertain??false,false);assert.deepEqual(writes,[entry.write]);
 if(entry.name==='draft')assert.equal(success.revision,4);else assert.ok(refreshes.includes('/patient/review'));
}
for(const operation of ['prepare','publish']){
 reset();snapshotFailure=true;
 const state=await command(initial,form(operation));
 assert.equal(state.ok,false);assert.equal(state.uncertain??false,false);assert.equal(reads,1);assert.equal(writes.length,0);assert.doesNotMatch(state.message,/PRIVATE/);
}
// Gohar QA 161: the field that failed is named, and three times typed with spaces and a one-digit hour save.
reset();const noInstructions=form('draft');noInstructions.set('instructions','');
assert.equal((await save(initial,noInstructions)).message,'Add the care instructions.');assert.equal(writes.length,0);
reset();const medicine=form('draft');medicine.set('medicationName','Fictional medicine');medicine.set('medicationDose','5 mg');medicine.set('medicationTimes','9:00 15:00, 20:00');
assert.equal((await save(initial,medicine)).ok,true);
assert.deepEqual((lastArgs as {p_draft:{medicationTimes:string[]}}).p_draft.medicationTimes,['09:00','15:00','20:00']);
reset();const noDose=form('draft');noDose.set('medicationName','Fictional medicine');
assert.equal((await save(initial,noDose)).message,'Add the dose for this medicine.\nAdd at least one time for this medicine.');assert.equal(writes.length,0);
reset();const badRequest=form('publish');badRequest.set('requestId','bad');
const validation=await command(initial,badRequest);
assert.equal(validation.ok,false);assert.equal(validation.uncertain??false,false);assert.equal(writes.length,0,'Publication nonce validation precedes mutation');
// Phone test finding 2: a test with no way to record it is named, and publication is not attempted.
reset();engineTests=[{id:'fictional-panel',title:'Fictional panel',method:'lab'},{id:'unsupported-clinic',title:'Fictional investigation',method:'clinic'},{id:'unsupported-home',title:'Fictional home log',method:'home-log'},{id:'ecg-12-lead',title:'12-lead ECG',method:'clinic'}];
const unrecordable=await command(initial,form('publish'));
assert.equal(unrecordable.ok,false);assert.equal(unrecordable.uncertain??false,false);assert.equal(writes.length,0);
assert.equal(unrecordable.message,'Not published: Fictional investigation, Fictional home log cannot be recorded in Noreon yet. Trying again will not help. Ask the Noreon team.');
// Supported clinic and home evidence reaches the database, which still requires the doctor's confirmation.
reset();engineTests=['ecg-12-lead','echocardiogram','holter','bp-visit','anthropometry','bp-home-log'].map(id=>({id,title:id,method:id==='bp-home-log'?'home-log':'clinic'}));
failure={code:'P0001',message:'Confirm every required clinic or home test'};
const unconfirmed=await command(initial,form('publish'));
assert.equal(unconfirmed.ok,false);assert.deepEqual(writes,['publish_patient_clinical_plan']);
assert.equal(unconfirmed.message,'Not published: a required clinic or home test is not confirmed yet. Confirm it on the Evidence tab.');
console.log('Clinical action outcome checks passed: actual actions, controlled Auth/RPC/engine/cache; unknown returned/thrown failures, definitive denials, validation, single writes and success. No live Auth/DB evidence.');

reset();const bulk=form('receive-all-clinic-results');bulk.append('valueIds',id);bulk.set('testId','tsh');
assert.equal((await command(initial,bulk)).ok,true);
assert.equal(writes.length,1,'Bulk uses one atomic RPC');
const bulkInput=(lastArgs as {p_input:{valueIds:string[];testId?:string;sourceChecked:boolean};p_operation:string});
assert.equal(bulkInput.p_operation,'receive-all-clinic-results');assert.deepEqual(bulkInput.p_input.valueIds,[id]);
assert.equal(bulkInput.p_input.testId,undefined,'Bulk cannot supply client-chosen test ids');assert.equal(bulkInput.p_input.sourceChecked,true);
reset();const rows=form('receive-result');rows.delete('rows');rows.append('rows','1');rows.append('rows','3');
assert.equal((await command(initial,rows)).ok,true);
assert.deepEqual((lastArgs as {p_input:{rows:number[]}}).p_input.rows,[0,2],'Selected row checkboxes retain source indices');
for(const message of ['The selected values do not cover this required test','Lab results must be dated on or after the questionnaire and not in the future']){
 reset();failure={code:'P0001',message};assert.equal((await command(initial,form('receive-all-clinic-results'))).message,message);
}
console.log('Bulk action and report checkboxes preserve one write, selected values, source confirmation and fixed safety refusals.');
