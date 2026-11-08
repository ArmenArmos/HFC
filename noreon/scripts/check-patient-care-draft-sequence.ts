/** Actual shared server actions, isolated auth/DB/engine. No hosted data or provider calls. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import {snapshotSchema} from '@/lib/patient-care/clinical-case-repository';
import type {ClinicalSnapshot} from '@/lib/patient-care/clinical-case-repository';
const require=createRequire(import.meta.url),id='11111111-1111-4111-8111-111111111111',token='a'.repeat(32);
const engine={version:'fixture',urgency:'green' as const,tests:[]};
const draft={explanation:'Reviewed explanation',instructions:'Reviewed care instructions',followUp:'',medicationName:'',medicationDose:'',medicationInstructions:'',medicationTimes:[]};
let publicationError:{code:string;message:string}|null=null;
let snapshot:ClinicalSnapshot=emptySnapshot(),ops:string[]=[],prepareFails=false,readFails=false,saveFails=false,urgent=false,unconfirmed=false,changeDuringPrepare=false;
function emptySnapshot():ClinicalSnapshot{return {id,revision:5,evidenceToken:token,draft:null,draftSavedAt:null,draftStale:false,review:null,evidence:{visits:[],profile:{name:null,birthDate:null,biologicalSex:null},consent:{},assessment:null,measurements:[],reports:[]}};}
function reset(){publicationError=null;snapshot=emptySnapshot();ops=[];prepareFails=false;readFails=false;saveFails=false;urgent=false;unconfirmed=false;changeDuringPrepare=false;}
const rpc=async(name:string,args:Record<string,unknown>={})=>{
 if(name==='patient_clinical_case_snapshot')return {data:structuredClone(snapshot),error:readFails?{code:'08006'}:null};
 ops.push(name);
 assert.equal(args.p_expected_revision,snapshot.revision,'Every write uses the last read revision');
 assert.equal(args.p_evidence_token,snapshot.evidenceToken,'Every write uses the last read evidence token');
 if(name==='prepare_patient_clinical_review'){
  if(prepareFails)return {data:null,error:{code:'P0001'}};
  snapshot.review={evidenceToken:token,doctorId:id,preparedAt:'2026-11-05T00:00:00Z',engine,approvals:{},receipts:{},consultation:{decision:'not-required'}};
  snapshot.revision++;
  if(changeDuringPrepare)snapshot.evidenceToken='c'.repeat(32);
  return {data:snapshot.revision,error:null};
 }
 if(name==='save_patient_clinical_draft'||name==='save_patient_clinical_draft_from_ai'){
  if(saveFails)return {data:null,error:{code:'40001'}};
  assert.ok(snapshot.review,'Review must exist before save');
  if(!unconfirmed){snapshot.draft=args.p_draft as typeof draft;snapshot.draftSavedAt='2026-11-05T01:00:00Z';snapshot.draftStale=false;snapshot.revision++;}
  return {data:snapshot.revision,error:null};
 }
 if(name.startsWith('publish_patient_clinical')){
  if(publicationError)return {data:null,error:publicationError};
  if(!unconfirmed)snapshot.publications=[{planId:id,publishedAt:'2026-11-05T02:00:00Z',draft:snapshot.draft!}];
  return {data:id,error:null};
 }
 throw Error(`Unexpected RPC ${name}`);
};
const cache=new Map<string,Record<string,unknown>>();
function load(path:string):Record<string,unknown>{
 if(cache.has(path))return cache.get(path)!;
 const exports:Record<string,unknown>={};cache.set(path,exports);
 vm.runInNewContext(ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,process:{env:{}},FormData,Error,require(name:string):unknown{
  if(name==='server-only')return {};
  if(name==='@/lib/observability/with-logging')return {loggedAction:(_name:string,fn:unknown)=>fn};
  if(name==='next/cache')return {revalidatePath(){}};
  if(name==='next/navigation')return {unstable_rethrow(){}};
  if(name==='@/lib/patient/auth')return {patientIdentity:async()=>null};
  if(name==='./real-review-config')return {realReviewEnabled:()=>true};
  if(name==='./enrolment')return {};
  if(name==='./clinical-case-repository')return {snapshotSchema,requireRealStaff:async()=>({client:{rpc},identity:{id,role:'doctor'}})};
  if(name==='./clinical-review-engine')return {clinicalReviewEngine:()=>engine};
  if(name==='./clinical-review-actions')return load('lib/patient-care/clinical-review-actions.ts');
  if(name==='./clinical-review-current')return load('lib/patient-care/clinical-review-current.ts');
  if(name==='./clinical-publication-server')return {clinicalWriteClient:()=>({rpc})};
  if(name==='@/lib/doctor-inbox/member-urgent-server')return {readMemberUrgent:async()=>({alerts:urgent?[{priority:'urgent'}]:[],window:null,incomplete:false})};
  if(name==='@/lib/care-alerts/contracts')return {careAlertsEnabled:()=>true};
  if(name==='@/lib/doctor-completion/config')return {doctorCompletionEnabled:()=>false};
  if(name==='./required-evidence')return {hasEvidencePath:()=>true};
  if(name.startsWith('@/'))return require(process.cwd()+'/'+name.slice(2)+'.ts');
  return require(name);
 }});return exports;
}
const save=load('lib/patient-care/clinical-actions.ts').saveRealDraft as (p:unknown,f:FormData)=>Promise<{ok:boolean;message:string;uncertain?:boolean}>;
const command=load('lib/patient-care/clinical-review-actions.ts').realClinicalCommand as typeof save;
const form=(revision=5)=>{const f=new FormData();Object.entries({...draft,id,revision:String(revision),token,medicationTimes:'',baselineDraft:'null',requestId:id}).forEach(([k,v])=>f.set(k,String(v)));return f;};
reset();assert.equal((await save({},form())).ok,true);assert.deepEqual(ops,['prepare_patient_clinical_review','save_patient_clinical_draft'],'Null review: prepare before save');
reset();assert.equal((await save({},form(4))).ok,true,'Revision-only changes rebase over an unchanged saved draft');
reset();prepareFails=true;const refused=await save({},form());assert.equal(refused.ok,false);assert.match(refused.message,/review.*prepared/i);assert.deepEqual(ops,['prepare_patient_clinical_review']);
reset();saveFails=true;assert.equal((await save({},form())).ok,false);
reset();unconfirmed=true;assert.equal((await save({},form())).ok,false,'A successful RPC without a matching reread is not success');
reset();changeDuringPrepare=true;assert.equal((await save({},form())).ok,false);assert.deepEqual(ops,['prepare_patient_clinical_review'],'Evidence changed during prepare: no save');
reset();snapshot.draft={...draft,instructions:'Other doctor edits'};assert.equal((await save({},form(4))).ok,false);assert.deepEqual(ops,[],'Never overwrite a competing saved draft');
reset();snapshot.evidenceToken='b'.repeat(32);assert.equal((await save({},form())).ok,false);assert.deepEqual(ops,[],'Changed evidence needs explicit review');
reset();readFails=true;assert.equal((await save({},form())).ok,false);assert.deepEqual(ops,[]);
reset();const publish=form();publish.set('operation','publish');urgent=true;const blocked=await command({},publish);assert.equal(blocked.ok,false);assert.match(blocked.message,/urgent alerts are open/);assert.deepEqual(ops,[]);
reset();await save({},form());ops=[];const ready=form(snapshot.revision);ready.set('operation','publish');assert.equal((await command({},ready)).ok,true);assert.deepEqual(ops,['publish_patient_clinical_plan']);
reset();await save({},form());unconfirmed=true;const unknown=form(snapshot.revision);unknown.set('operation','publish');assert.equal((await command({},unknown)).ok,false,'Publish success requires matching publication reread');
console.log('Patient-care prepare → reread → save → reread and explicit publish: null review, stale revision, changed evidence, competing draft, failures, unconfirmed outcomes and urgent block passed (controlled Auth/RPC/engine).');

// A manual replacement after publication remains a separate save and publish sequence.
reset();snapshot.draft={...draft,instructions:'Previously published care'};snapshot.publications=[{planId:id,publishedAt:'2026-11-04T02:00:00Z',draft:snapshot.draft}];
const replacement=form();replacement.set('instructions','Reviewed replacement after changed labs');
assert.equal((await save({},replacement)).ok,true);assert.ok(!ops.some(op=>op.startsWith('publish_')),'Saving a replacement still does not publish');
const replacementPublish=form(snapshot.revision);replacementPublish.set('operation','publish');
assert.equal((await command({},replacementPublish)).ok,true);
console.log('Patient-care manual replacement: prepare and save after prior publication, then separate explicit confirmed publication (controlled RPC).');

// Hidden SQL-only gates still name the actual refusal through the shared action.
for(const [code,message,expected] of [
 ['42501','Verified member required',/phone.*verified/i],
 ['42501','Current doctor session required',/session.*sign in/i],
 ['42501','Assigned active doctor required',/assigned active doctor/i],
 ['P0001','Publication request conflict',/request.*reload/i],
 ['P0001','Complete questionnaire and resolve urgent guidance',/questionnaire.*urgent/i],
 ['P0001','Native source-specific mandatory consultation pathway unavailable',/mandatory consultation pathway is unavailable/i],
 ['P0001','Routine review is on hold: recorded crisis-range blood pressure has no linked symptom triage or resolution. Arrange clinical assessment; later normal readings do not clear this hold.',/crisis-range.*clinical assessment/i],
 ['22023','Regimen approval is missing',/review every medicine and dose/i],
 ['22023','Keep the change note within 1000 characters',/1000 characters/i],
 ['40001','Lab values need doctor review before publication',/not published.*unverified.*review/i],
 ['40001','Lab values changed since the AI-prepared plan was saved',/lab values changed.*save the draft again/i],
 ['P0001','Required source receipt is stale',/received result changed.*current source/i],
 ['P0001','An abnormal investigation needs a completed consultation',/abnormal investigation.*completed consultation/i],
] as const){
 reset();await save({},form());publicationError={code,message};
 const publish=form(snapshot.revision);publish.set('operation','publish');
 const result=await command({},publish);
 assert.equal(result.ok,false);assert.match(result.message,expected,message);
 assert.ok(!snapshot.publications?.length,'A refused publication is never recorded as success');
}
reset();await save({},form());publicationError={code:'P0001',message:'Unrecognized provider text with sensitive input'};
const hidden=form(snapshot.revision);hidden.set('operation','publish');
assert.doesNotMatch((await command({},hidden)).message,/sensitive input/,'Only fixed allowlisted SQL messages may reach the screen');
console.log('Publication refusals: hidden SQL gates surface fixed plain-language explanations; unknown provider text is not exposed (controlled RPC).');
