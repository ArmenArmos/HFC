/** Saved journey examples and the real reader with isolated IO. No database or network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {JOURNEY_STAGES, STAGE_CLASSES, journeyStage, zoeSentenceMatchesStage, type JourneyOptions, type JourneyStage} from '@/lib/patient/journey-stage';
import {memberJourneyStep, type JourneyInput} from '@/lib/patient-care/journey-step';
import {memberLabSummary} from '@/lib/staff/lab-stage-schema';
import type {readJourneyStage} from '@/lib/patient/journey-read';

const base: JourneyInput = {questionnaireComplete:true, review:null, appointments:[], clinics:{}, canBook:true,
 hasOpenRequest:false, lab:null, nurseVisit:null, released:[], planPublished:false, now:new Date('2026-11-03T10:00:00Z')};
const options: JourneyOptions = {episode:'synthetic', testsChosen:false, teachBackConfirmed:false, resultsReleased:false};
assert.equal(JOURNEY_STAGES.length,17);
for(const stage of JOURNEY_STAGES){
 for(const locale of ['hy','en','ru'] as const) assert.ok(STAGE_CLASSES[stage][locale].trim(),`${stage}: ${locale} sentence`);
 assert.equal(zoeSentenceMatchesStage(stage,STAGE_CLASSES[stage].key),true);
 assert.equal(zoeSentenceMatchesStage(stage,'unknown'),false);
}
const visit: NonNullable<JourneyInput['nurseVisit']> = {startsAt:'2026-11-04T10:00:00Z',mode:'home',samplesTaken:null,
 steps:[{step:'confirmed',at:'2026-11-03T09:00:00Z'}]};
const examples: {name:string; input:JourneyInput; options?:Partial<JourneyOptions>; action:string|null; stage:JourneyStage}[] = [
 {name:'questionnaire open',input:{...base,questionnaireComplete:false},action:null,stage:'questionnaire_open'},
 {name:'book tests',input:base,action:'journey-book',stage:'tests_to_choose'},
 {name:'tests chosen',input:base,options:{testsChosen:true},action:'journey-book',stage:'booking_needed'},
 {name:'visit confirmed',input:{...base,nurseVisit:visit},action:'journey-nurse-confirmed',stage:'visit_booked'},
 {name:'results waiting',input:{...base,lab:'at-lab'},action:'journey-samples',stage:'results_waiting'},
 {name:'results received but not released',input:{...base,lab:'results-received'},action:'journey-results',stage:'results_waiting'},
 {name:'released documents',input:{...base,released:[{clinic:'Synthetic clinic',uploadedAt:'2026-11-03T09:00:00Z'}]},options:{resultsReleased:true},action:'journey-results',stage:'results_waiting'},
 {name:'older release, newer pending visit request',input:{...base,appointments:[{id:'a1',status:'notification-pending',createdAt:'2026-11-03T08:00:00Z',startsAt:'2026-11-05T10:00:00Z',clinicName:'Synthetic clinic'} as unknown as NonNullable<JourneyInput['appointments']>[number]],released:[{clinic:'Synthetic clinic',uploadedAt:'2026-10-01T09:00:00Z'}]},options:{resultsReleased:true},action:'journey-waiting',stage:'visit_confirmation_pending'},
 {name:'plan published',input:{...base,planPublished:true},action:null,stage:'plan_published'},
 {name:'plan confirmed',input:{...base,planPublished:true},options:{teachBackConfirmed:true},action:null,stage:'plan_confirmed'},
 {name:'review request',input:{...base,review:'none'},action:'journey-review',stage:'review_needed'},
 {name:'review pending',input:{...base,canBook:false,review:{status:'review_pending'}},action:'journey-reviewing',stage:'review_pending'},
 {name:'consultation leads release',input:{...base,review:{status:'consultation_needed'}},options:{resultsReleased:true},action:'journey-consultation',stage:'consultation'},
 {name:'preparing leads release',input:{...base,planPreparing:true},options:{resultsReleased:true},action:'journey-plan-preparing',stage:'plan_preparing'},
 {name:'unknown',input:{...base,review:undefined,appointments:undefined,lab:undefined,nurseVisit:undefined,canBook:false},action:null,stage:'waiting'},
];
for(const example of examples){
 assert.equal(memberJourneyStep(example.input)?.id??null,example.action,`${example.name}: saved Home action`);
 assert.equal(journeyStage(example.input,{...options,...example.options}),example.stage,example.name);
}

// Removing a failed-read guard must fail here, rather than showing a new booking step.
let bookingOn=true, enabled=true, urgent=false, documentsEnabled=true, registeredReads=0, dataReads=0;
const member:NonNullable<Parameters<typeof readJourneyStage>[0]>={
 profile:{userId:'synthetic',name:'Synthetic member',birthDate:'1986-01-01',biologicalSex:'female',locale:'en'},consentAccepted:true,
 assessment:{id:'assessment',revision:1,assessmentDate:'2026-11-01',answers:{},urgentRule:null,completedAt:'2026-11-01T10:00:00Z'},
};
const fresh=()=>({
 care:{plan:null as {id:string}|null},
 bookings:{available:true,requests:[],pilot:{appointments:[],clinics:{}}} as {available:boolean;requests:[];pilot?:{appointments:[];clinics:Record<string,string>};message?:string;clinicalHold?:boolean},
 lab:[] as []|null, status:{enabled:true,status:null as {status:'review_pending';createdAt:string}|null},
 nurse:null as typeof visit|null|undefined,
 released:[] as {fileId:string;clinic:string;uploadedAt:string;releasedAt:string}[]|null,
 preparing:{data:false as unknown,error:null as object|null},
});
let facts=fresh();
let fail:string|null=null;
const read=async(name:string,value:unknown)=>{dataReads++;if(fail===name)throw Error('Synthetic read failure');return value;};
const out:Record<string,unknown>={};
new vm.Script(ts.transpileModule(readFileSync('lib/patient/journey-read.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText).runInNewContext({exports:out,Date,process:{env:{}},require(name:string){
 if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>false};
 if(name==='@/lib/zoe-chat-actions/plan-read')return {readPlanState:()=>{throw Error('V3 off must not read teach-back state');}};
 if(name==='@/lib/zoe-chat-actions/server')return {buildSnapshot:()=>{throw Error('V3 off must not read result cards');}};
 if(name==='@/lib/zoe-chat-actions/next-step-id')return {stableRequestId:()=> 'synthetic-revision'};
 if(name==='server-only')return {};
 if(name==='@/lib/patient/member-next-step')return {memberNextStepEnabled:()=>enabled};
 if(name==='@/lib/patient/repository')return {requireRegistered:async()=>{registeredReads++;return member;}};
 if(name==='@/lib/patient/presentation')return {patientPresentation:()=>({urgent})};
 if(name==='@/lib/supabase/server')return {createClient:async()=>({rpc:(rpc:string)=>{assert.equal(rpc,'patient_plan_preparing');return read('preparing',facts.preparing);}})};
 if(name==='@/lib/patient-care/repository')return {getCareData:()=>read('care',facts.care)};
 if(name==='@/lib/real-booking/config')return {realBookingEnabled:()=>bookingOn};
 if(name==='@/lib/real-booking/repository')return {getMemberBookingData:(args:unknown)=>{assert.deepEqual(JSON.parse(JSON.stringify(args)),{summaryOnly:true});return read('bookings',facts.bookings);}};
 if(name==='@/lib/patient-care/lab-stage-repository')return {getMemberLabStages:()=>read('lab',facts.lab)};
 if(name==='@/lib/staff/lab-stage-schema')return {memberLabSummary};
 if(name==='@/lib/patient-care/clinical-case-repository')return {readRealMemberStatus:()=>read('status',facts.status)};
 if(name==='@/lib/nurse-visit/runtime')return {readMemberNurseVisit:()=>read('nurse',facts.nurse)};
 if(name==='@/lib/doctor-completion/document-runtime')return {readMemberDocuments:()=>read('released',facts.released)};
 if(name==='@/lib/doctor-completion/config')return {doctorCompletionEnabled:()=>documentsEnabled};
 if(name==='@/lib/patient/journey-stage')return {journeyStage};
 throw Error(`Unexpected journey boundary: ${name}`);
}});
const readStage=out.readJourneyStage as typeof readJourneyStage;
enabled=false;assert.equal(await readStage(),null);assert.equal(registeredReads,0);assert.equal(dataReads,0);
enabled=true;
assert.equal(await readStage({...member,assessment:{...member.assessment,completedAt:null}}),null);
urgent=true;assert.equal(await readStage(member),null);urgent=false;
assert.equal(dataReads,0,'Off, incomplete and urgent stop before journey reads');
let saved=await readStage();
assert.equal(saved?.memberId,'synthetic');assert.equal(saved?.stage,'review_needed');
assert.equal(saved?.options.testsChosen,false);assert.equal(saved?.options.teachBackConfirmed,false);
assert.equal(saved?.options.resultsReleased,false);
for(const name of ['care','bookings','lab','status','nurse','released','preparing']){
 fail=name;assert.equal(await readStage(member),null,`${name}: rejected read`);
}
fail=null;
for(const corrupt of [
 ()=>{facts.lab=null;},()=>{facts.nurse=undefined;},()=>{facts.released=null;},
 ()=>{facts.preparing.error={};},()=>{facts.preparing.data=null;},
 ()=>{facts.bookings={available:false,requests:[],message:'Unavailable'};},
 ()=>{facts.bookings.pilot=undefined;},
]){facts=fresh();corrupt();assert.equal(await readStage(member),null,'Unknown data never invents an earlier stage');}
// Booking switched off in this environment is a configuration, not a failed read: the stage still resolves (no booking step is offered).
facts=fresh();facts.bookings={available:false,requests:[],message:'Test requests are not available yet.'};
bookingOn=false;saved=await readStage(member);
assert.ok(saved,'booking off does not make the next step unavailable');assert.equal(saved?.input.canBook,false,'and offers no booking step');
bookingOn=true;assert.equal(await readStage(member),null,'the same answer with booking on is still a failed read');
facts=fresh();facts.status.status={status:'review_pending',createdAt:'2026-11-02T10:00:00Z'};
facts.released=[{fileId:'old',clinic:'Synthetic clinic',uploadedAt:'2026-11-01T08:00:00Z',releasedAt:'2026-11-01T09:00:00Z'}];
saved=await readStage();assert.equal(saved?.options.resultsReleased,false,'A release from a previous review is not current');
facts.released.push({fileId:'current',clinic:'Synthetic clinic',uploadedAt:'2026-11-01T08:00:00Z',releasedAt:'2026-11-03T09:00:00Z'});
saved=await readStage();assert.equal(saved?.stage,'review_pending','A release still waits for doctor approval');
assert.equal(saved?.input.released?.length,1);
documentsEnabled=false;saved=await readStage();assert.equal(saved?.options.resultsReleased,false,'Disabled documents never imply release');
console.log('Journey stages: 17 translated sentences, saved Home examples, unknown waiting, fail-closed reads and current released documents. Isolated IO only.');
