// Khikar 18 Oct: finishing the questionnaire (or reaching a red flag in it) enrols the member for
// the care team without the "request review" button. Drives the path the real questionnaire uses,
// POST /patient/answers (Fable #277 F1), plus the Finish action. Real route, actions, service and
// enrolment code; auth, store, Supabase and after() are fixtures. Enrolment runs after the
// response, never blocks the save, and the internal hint never reaches the browser.
import assert from 'node:assert/strict';
import fs from 'node:fs';
// @ts-expect-error Node 26 runtime supports registerHooks; declarations target Node 20.
import {registerHooks} from 'node:module';
import type {Answers} from '@/lib/clinical/types';
type Fixture={rpcs:string[];fail:'none'|'refuse'|'throw';state:unknown;after:(()=>unknown)[]};
const fixture:Fixture={rpcs:[],fail:'none',state:null,after:[]};
delete process.env.NOREON_TELEGRAM_ENABLED;delete process.env.NOREON_TELEGRAM_AUTH_ENABLED;
Object.assign(globalThis,{__qEnrol:fixture});
Object.assign(process.env,{NOREON_REAL_MEMBER_REVIEW_ENABLED:'true',NEXT_PUBLIC_PATIENT_DEMO:'false',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:1',NEXT_PUBLIC_SUPABASE_ANON_KEY:'fixture'});
const f='const f=globalThis.__qEnrol;';
const mocks:Record<string,string>={
 'next/cache':'export const revalidatePath=()=>{};',
 '@/lib/patient/auth':'export const patientIdentity=async()=>({userId:"q-member",phone:"+37491000000"});export const patientIdentityForSave=patientIdentity;',
 // after(): queued, so the check can prove nothing ran before the response, then run it.
 'next/server':f+'export const after=(fn)=>{f.after.push(fn);};',
 '@/lib/patient/repository':f+'export const patientStore=()=>({read:async()=>f.state,profile:async()=>1,assessment:async()=>1,measurement:async()=>{}});',
 '@/lib/supabase/server':f+'export const createClient=async()=>({rpc:async(name)=>{f.rpcs.push(name);if(f.fail==="throw")throw Error("fixture outage");return f.fail==="refuse"&&name==="enroll_patient_clinical_case"?{error:{code:"42501"}}:{data:null,error:null};}});',
 '@/lib/messaging/twilio-verify-feedback':'export const completeVerifiedPhone=()=>{throw Error("Unexpected provider access")};',
 '@/lib/patient/demo':'export const demoEnabled=()=>false;export const restartDemoQuestions=()=>{};export const demoSignIn=()=>{};export const demoSignOut=()=>{};export const readDemo=()=>{};export const DEMO_PHONE="";',
};
registerHooks({resolve(s:string,c:object,next:(s:string,c:object)=>object){return mocks[s]?{url:'data:text/javascript,'+encodeURIComponent(mocks[s]),shortCircuit:true}:next(s,c);}});
const actions=await import('@/app/patient/actions');
const route=await import('@/app/patient/answers/route');
const {enrollRealMember}=await import('@/lib/patient-care/clinical-actions');
const full=JSON.parse(fs.readFileSync(new URL('./fixtures/patient-answers.json',import.meta.url),'utf8')) as Answers;
const state=(answers:Answers)=>({profile:{name:'Fictional',birthDate:'1974-05-18',biologicalSex:'male',locale:'en',userId:'q-member'},consentAccepted:true,
 assessment:{id:'a',revision:0,assessmentDate:'2026-10-18',answers,completedAt:null,urgentRule:null}});
const lastKey=Object.keys(full).filter(k=>!k.startsWith('q1.')).at(-1)!;
const withoutLast=Object.fromEntries(Object.entries(full).filter(([k])=>k!==lastKey)) as Answers;
const enrolled=()=>fixture.rpcs.filter(n=>n==='enroll_patient_clinical_case').length;
const reset=(answers:Answers,fail:Fixture['fail']='none')=>{fixture.rpcs=[];fixture.after=[];fixture.fail=fail;fixture.state=state(answers);};
// Runs the work scheduled with after(), as Next does once the response is sent.
const drain=async()=>{const q=fixture.after.splice(0);for(const fn of q)await fn();};
const post=async(entries:unknown)=>{const res=await route.POST(new Request('http://localhost:3000/patient/answers',{method:'POST',headers:{origin:'http://localhost:3000','content-type':'application/json'},
 body:JSON.stringify({expectedAssessmentId:'a',expectedRevision:0,entries})}));return {status:res.status,body:await res.json()};};

// 1. The last answer, saved through the questionnaire's route, completes it: the member is enrolled.
reset(withoutLast);
let p=await post([{fieldId:lastKey,value:full[lastKey]!.value}]);
assert.equal(p.status,200);
assert.deepEqual(p.body,{ok:true,revision:1},'The browser gets the same body as before: no enrol hint');
assert.equal(enrolled(),0,'Nothing runs before the response');
await drain();
assert.equal(enrolled(),1,'Completing the questionnaire enrols the member after the response');
// 2. An answer that leaves it incomplete does not enrol.
reset(Object.fromEntries(Object.entries(withoutLast).slice(0,3)) as Answers);
p=await post([{fieldId:'q3.status',value:'never'}]);
await drain();
assert.equal(p.status,200);assert.equal(enrolled(),0,'A partial questionnaire does not enrol');
// 3. Completing through the finish button enrols.
reset(full);
let r=await actions.completeAssessment(0);
assert.deepEqual(r,{ok:true,revision:1});assert.equal(enrolled(),0,'Finish responds first');
await drain();assert.equal(enrolled(),1,'Finish enrols');
// 4. A red flag enrols too, so the doctor sees the member.
reset(withoutLast);
p=await post([{fieldId:'q9.present',value:'yes'},{fieldId:'q9.right_now',value:'yes'}]);
assert.deepEqual(p.body,{ok:true,revision:1},'Red-flag save body unchanged');
await drain();
assert.equal(enrolled(),1,'A red-flag answer through the route enrols the member');
// (The caller-less saveAnswers server action was removed, review item 58: the route above is the only save path.)
// 5. A refusal or an outage never blocks the member's save.
reset(withoutLast,'refuse');
p=await post([{fieldId:lastKey,value:full[lastKey]!.value}]);
await drain();
assert.deepEqual(p.body,{ok:true,revision:1},'A refused enrolment still saves the answer');
reset(full,'throw');
r=await actions.completeAssessment(0);
await drain();
assert.deepEqual(r,{ok:true,revision:1},'An enrolment outage still completes the questionnaire');
// 6. With Telegram sign-in off, enrolment makes no Telegram call (linking is unchanged, moved code).
reset(full);
await actions.completeAssessment(0);await drain();
assert.deepEqual(fixture.rpcs,['enroll_patient_clinical_case'],'Only the enrolment call while Telegram sign-in is off');
// 7. The explicit "request review" button still works and reports refusals.
reset(full);
assert.equal((await enrollRealMember()).ok,true,'Explicit button enrols');
reset(full,'refuse');
assert.equal((await enrollRealMember()).ok,false,'Explicit button reports a refusal');
console.log('Questionnaire enrolment: through the answers route, finishing (last answer or Finish) and a red flag enrol the member after the response with no hint in the body; partial does not; refusal and outage never block the save; no Telegram call while it is off; explicit button kept.');
