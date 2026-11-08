/** Real server orchestration with supplied session/read/RPC boundaries. No network or secrets. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {z} from 'zod';
import * as next from '@/lib/zoe-chat-actions/next-step';
import * as ids from '@/lib/zoe-chat-actions/next-step-id';
import * as registry from '@/lib/zoe-chat-actions/registry';
import {memberLabSummary} from '@/lib/staff/lab-stage-schema';
import * as journeyStage from '@/lib/patient/journey-stage';
import type {ZoeCard,ZoeCards} from '@/lib/zoe-chat-actions/registry';
import type {MemberDocument} from '@/lib/doctor-completion/document-schema';
import type {Appointment} from '@/lib/real-booking/appointment-schema';
const member='00000000-0000-4000-8000-000000000001';
let failure='',consent=true,complete=true,posted=0,testsChosen=false,v3=true,registeredReads=0,urgent=false;
let replay:{card:ZoeCard;cards:ZoeCard[]}|null=null;
let results:registry.Snapshot<'results'>={v:1,available:true,publishedAt:null,rows:[],more:0};
let publishedPlan:{id:string}|null=null;
let planState:{planId:string;version:number;teachBackConfirmedAt:string|null}|null=null;
let planStateReads=0;
let review:{status:'review_pending';createdAt:string}|null=null;
let released:MemberDocument[]=[];
let appointments:Appointment[]=[];
const lab:unknown[]=[],nurse:unknown=null;
const calls:Array<{name:string;args:Record<string,unknown>}>=[];
const planClient={rpc:async()=>({data:false,error:failure==='preparing'?{}:null}),from:()=>({select(){return this;},eq(){return this;},gte(){return this;},not(){return this;},limit:async()=>({data:testsChosen?[{id:member}]:[],error:failure==='chosen'?{}:null})})};
const rpc=async(name:string,args:Record<string,unknown>)=>{
 calls.push({name,args});
 if(name==='care_queue_raise')return {ok:failure!=='queue'};
 if(replay)return {ok:true,...replay};
 posted++;
 return {ok:true,cards:[],card:{id:crypto.randomUUID(),requestId:args.p_request,kind:'next_step',source:'chip',sourceSeq:null,state:'open',outcome:{},claims:{},at:'2026-11-02T09:00:00Z',snapshot:args.p_snapshot}};
};
const boundaries:Record<string,unknown>={
 'server-only':{},
 '@/lib/pilot-commerce/member':{getMemberPricing:async()=>undefined},
 '@/lib/supabase/server':{createClient:async()=>planClient},
 '@/lib/patient/repository':{requireRegistered:async()=>{registeredReads++;if(failure==='session')throw Error('Session unavailable');return {profile:{userId:member},assessment:{id:'a',completedAt:complete?'2026-11-02T08:00:00Z':null}};}},
 '@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:()=>v3},
 '@/lib/patient/journey-stage':journeyStage,
 '@/lib/zoe-chat-actions/plan-read':{readPlanState:async()=>{planStateReads++;if(failure==='plan-state')throw Error('Plan state unavailable');return planState;}},
 '@/lib/patient/presentation':{patientPresentation:()=>({urgent})},
 '@/lib/patient-care/repository':{getCareData:async()=>{if(failure==='care')throw Error('Sensitive provider detail');return {plan:publishedPlan};}},
 '@/lib/real-booking/config':{realBookingEnabled:()=>true},
 '@/lib/real-booking/repository':{getMemberBookingData:async()=>({available:failure!=='bookings',message:failure==='bookings'?'Unavailable':null,pilot:{appointments,clinics:{}},requests:[]})},
 '@/lib/patient-care/lab-stage-repository':{getMemberLabStages:async()=>failure==='lab'?null:lab},
 '@/lib/staff/lab-stage-schema':{memberLabSummary},
 '@/lib/patient-care/clinical-case-repository':{readRealMemberStatus:async()=>{if(failure==='review')throw Error('Review unavailable');return {enabled:!!review,status:review};}},
 '@/lib/nurse-visit/runtime':{readMemberNurseVisit:async()=>failure==='nurse'?undefined:nurse},
 '@/lib/doctor-completion/document-runtime':{readMemberDocuments:async()=>failure==='released'?null:released},
 '@/lib/doctor-completion/config':{doctorCompletionEnabled:()=>true},
 '@/lib/zoe/member':{readZoeConsents:async()=>({readsMessages:consent})},
 '@/lib/patient/member-next-step':{memberNextStepEnabled:()=>false},
 './server':{serviceRpc:()=>rpc,parseStoredCard:(v:unknown)=>v?registry.cardSchema.parse(v):null,buildSnapshot:async()=>failure==='results'?{v:1,available:false,rows:[],more:0}:results},
 './next-step':next,'./next-step-id':ids,'./registry':registry,
 '@/lib/clinical/zones/config-v1':{ZONE_RULES_V1:{version:'fixture'}},
 '@/lib/member-history/measures':{yerevanToday:()=> '2026-11-02'},
 '@/lib/member-history/lab-results':{},
 './bp-flow':{openFlags:()=>null,redOutcome:()=>null},
 '@/lib/patient-care/pagination':{},'@/lib/clinical/seed/tests':{},
};
const exports:Record<string,unknown>={};
const journeyExports:Record<string,unknown>={};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/patient/journey-read.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:journeyExports,Date,Error,Promise,process:{env:{}},require(name:string){const normalized=name.replace('@/lib/zoe-chat-actions/','./');assert.ok(name in boundaries||normalized in boundaries,`Unexpected journey dependency ${name}`);return boundaries[name]??boundaries[normalized];}});
boundaries['@/lib/patient/journey-read']=journeyExports;
vm.runInNewContext(ts.transpileModule(readFileSync('lib/zoe-chat-actions/next-step-read.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Error,Promise,require(name:string){assert.ok(name in boundaries,`Unexpected server dependency ${name}`);return boundaries[name];}});
const {readJourneyStage}=journeyExports as typeof import('../lib/patient/journey-read');
const {reconcileNextStep,queueMissingTests,readChatNextStep}=exports as typeof import('../lib/zoe-chat-actions/next-step-read');
const cards:ZoeCards={enabled:true,cards:[],clearedSeq:null};
v3=false;assert.equal(await readJourneyStage(),null);assert.equal(registeredReads,0,'The shared read is gated before member data');v3=true;
complete=false;assert.equal(await readJourneyStage(),null);complete=true;
urgent=true;assert.equal(await readJourneyStage(),null);assert.equal(await reconcileNextStep(cards),cards);urgent=false;
const failedReads=['care','lab','nurse','preparing','chosen','bookings','review','released','results'];
for(const broken of ['session',...failedReads]){failure=broken;assert.equal(await readJourneyStage(),null,'A failed shared read returns no guessed stage');}
failure='';const shared=await readJourneyStage();assert.equal(shared?.memberId,member);assert.equal(shared?.stage,'tests_to_choose');
assert.equal(journeyStage.journeyStage(shared!.input,shared!.options),shared?.stage);
consent=false;assert.equal(await reconcileNextStep(cards),cards);assert.equal(posted,0,'No post before consent');
consent=true;complete=false;assert.equal(await reconcileNextStep(cards),cards);assert.equal(posted,0,'No post before completion');
complete=true;
for(const broken of failedReads){failure=broken;const r=await reconcileNextStep(cards);assert.equal(r.nextStepStatus,'unavailable');assert.equal(posted,0,'A failed read must not post a guessed earlier stage');}
failure='';registeredReads=0;const read=await reconcileNextStep(cards);assert.equal(registeredReads,1,'Card reconciliation reuses its authenticated member read');assert.equal(read.cards.length,1);assert.equal(read.cards[0].valid&&read.cards[0].kind==='next_step'&&read.cards[0].snapshot.target,'tests_needed');
assert.equal(calls.at(-1)?.args.p_member,member,'Member identity comes from the session');
const tests=next.testsNeeded([{id:'lipid-panel',title:'Lipid panel',method:'lab'}],[],'2026-11-02');
assert.equal(await queueMissingTests(member,'r',tests),true);
const task=calls.at(-1)!;assert.equal(task.name,'care_queue_raise');assert.equal(task.args.p_queue,'admin');assert.equal(task.args.p_reason,'missing_baseline_labs');assert.equal(JSON.stringify(task.args.p_summary),'{}');assert.equal(task.args.p_zone,null);assert.equal(task.args.p_action,'book');assert.equal(task.args.p_sla,null);assert.equal(task.args.p_red_flags,null);assert.equal(task.args.p_source_ref,'r');
failure='queue';assert.equal(await queueMissingTests(member,'r',tests),false,'Failed queue cannot claim delivery');
failure='';

// Persistence is supplied at the RPC boundary; the real reconciler must merge its
// current-stage projection independently of the forty most recent history cards.
const testsCard=registry.cardSchema.parse({...read.cards[0],id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'tests_needed',at:'2026-11-02T09:01:00Z',snapshot:tests});
assert.equal(testsCard.valid,true);
const parent=registry.cardSchema.parse({...read.cards[0],state:'done',outcome:{next_step:{target:'tests_needed',requestId:testsCard.requestId,doneAt:testsCard.at}}});
const later=Array.from({length:40},(_,i)=>registry.cardSchema.parse({...parent,id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'message',snapshot:{v:1},outcome:{},at:new Date(Date.parse('2026-11-02T10:00:00Z')+i*1000).toISOString()}));
replay={card:parent,cards:[testsCard]};
for(const history of [later,[...later,testsCard],later]){
 const restored=await reconcileNextStep({...cards,cards:history});
 assert.equal(restored.nextStepStatus,undefined,'Opening the parent is not completion of its unfinished target');
 assert.equal(restored.cards.filter(c=>c.id===testsCard.id&&c.state==='open').length,1,'Reload and a second device recover the same tests action without duplicates');
 assert.equal(new Set(restored.cards.map(c=>c.id)).size,restored.cards.length);
}
const visitCard=registry.cardSchema.parse({...testsCard,id:crypto.randomUUID(),requestId:crypto.randomUUID(),kind:'visit',at:'2026-11-02T09:02:00Z',snapshot:{v:1,available:true,next:null,proposal:null,attention:false}});
assert.equal(visitCard.valid,true);
const chosenCard=registry.cardSchema.parse({...testsCard,state:'done',outcome:{tests_needed:{target:'visit',requestId:visitCard.requestId,doneAt:visitCard.at}}});
replay={card:parent,cards:[chosenCard,visitCard]};
testsChosen=true;
const booking=await reconcileNextStep({...cards,cards:later});
assert.equal(booking.nextStepStatus,undefined,'Opening booking is not a booked visit');
assert.equal(booking.cards.filter(c=>c.id===visitCard.id&&c.state==='open').length,1,'The unfinished booking survives outside history too');
assert.equal(calls.at(-1)?.args.p_request,parent.requestId,'Choosing tests cannot post another stage before booking');
replay={card:parent,cards:[chosenCard]};
assert.equal((await reconcileNextStep({...cards,cards:later})).nextStepStatus,'unavailable','An incomplete projection cannot imply completion from a parent press');
replay=null;testsChosen=false;

// Collection/report dates describe the evidence, not its release or review membership.
review={status:'review_pending',createdAt:'2026-11-01T08:00:00Z'};
lab.push({stages:[{stage:'at-lab'},{stage:'results-received'}]});
results={v:1,available:true,publishedAt:'2026-11-02T09:00:00Z',rows:[{name:'LDL',value:'3',unit:'mmol/L',reference:null,at:'2026-10-20'}],more:0};
const baseline=await readChatNextStep(cards);
assert.match(baseline!.step.detail.en,/approved your plan/,'An older baseline published for this review still waits for plan approval');
results={...results,rows:[{...results.rows[0],at:null}]};
assert.equal((await readChatNextStep(cards))!.step.stage,baseline!.step.stage,'Collection date cannot change release identity');
const arrangement={offerId:crypto.randomUUID(),offerVersion:'1',clinicId:crypto.randomUUID(),mode:'clinic' as const,startsAt:'2099-11-03T08:00:00Z',endsAt:'2099-11-03T09:00:00Z',timezone:'Asia/Yerevan' as const,location:'Fixture clinic',preparation:'Fixture preparation',preparationVersion:'1',coveredTestIds:[],followUps:[]};
appointments=[{version:'email-pilot-v1',id:crypto.randomUUID(),memberId:member,revision:1,status:'confirmed',program:[],current:arrangement,proposed:arrangement,noticeId:crypto.randomUUID(),createdAt:'2026-11-02T10:00:00Z'}];
lab.length=0;
assert.equal((await readChatNextStep(cards))!.step.journeyStage,'visit_booked','A newer visit retains main’s current-round precedence over an older release');
appointments=[];lab.push({stages:[{stage:'at-lab'},{stage:'results-received'}]});
results={...results,publishedAt:'2026-10-31T09:00:00Z'};
assert.match((await readChatNextStep(cards))!.step.detail.en,/approved your plan/,'A prior review publication cannot acknowledge this review');
results={...results,publishedAt:null,rows:[]};
assert.match((await readChatNextStep(cards))!.step.detail.en,/approved your plan/,'An unreleased control remains waiting');
released=[{fileId:crypto.randomUUID(),clinic:'Fixture lab',uploadedAt:'2026-10-20T08:00:00Z',releasedAt:'2026-11-02T09:00:00Z'}];
assert.match((await readChatNextStep(cards))!.step.detail.en,/approved your plan/,'PDF-only release still waits for plan approval');
released=[{...released[0],releasedAt:'2026-10-31T09:00:00Z'}];
assert.match((await readChatNextStep(cards))!.step.detail.en,/approved your plan/,'A release before this review does not advance it');
released=[];results={v:1,available:true,publishedAt:null,rows:[],more:0};lab.length=0;review=null;

// Main's teach-back confirmation must finish the shared Home/chat journey for this publication only.
publishedPlan={id:crypto.randomUUID()};
assert.equal((await readJourneyStage())?.stage,'plan_published','A publication without teach-back still needs confirmation');
planState={planId:publishedPlan.id,version:1,teachBackConfirmedAt:null};
assert.equal((await readJourneyStage())?.stage,'plan_published','A saved publication with no confirmation still needs teach-back');
planState={...planState,teachBackConfirmedAt:'2026-11-04T09:00:00Z'};
assert.equal((await readJourneyStage())?.stage,'plan_confirmed','Saved current-publication teach-back advances Home and chat');
assert.equal((await readChatNextStep(cards))?.step.target,null,'Confirmed publication has no further plan action');
planState={...planState,planId:crypto.randomUUID()};
assert.equal((await readJourneyStage())?.stage,'plan_published','An older publication confirmation cannot confirm its replacement');
failure='plan-state';
assert.equal(await readJourneyStage(),null,'Unreadable confirmation cannot guess the publication stage');
assert.equal((await reconcileNextStep(cards)).nextStepStatus,'unavailable');
failure='';v3=false;planStateReads=0;
await readJourneyStage();assert.equal(planStateReads,0,'The V3-off Home path never reads teach-back state');
v3=true;publishedPlan=null;planState=null;

// Exercise buildSnapshot('results') itself: a released PDF without structured rows is still readable.
const resultExports:Record<string,unknown>={};
const doc={fileId:crypto.randomUUID(),clinic:'Fixture lab',uploadedAt:'2026-11-02T08:00:00Z',releasedAt:'2026-11-02T09:00:00Z'};
const resultBoundaries:Record<string,unknown>={
 'server-only':{},'zod':{z},'./registry':registry,
 '@/lib/supabase/server':{createClient:async()=>({})},
 '@/lib/patient/zoe-app-v3':{zoeAppV3Enabled:()=>true},
 '@/lib/doctor-completion/config':{doctorCompletionEnabled:()=>true},
 '@/lib/doctor-completion/document-runtime':{readMemberDocuments:async()=>[doc]},
 '@/lib/patient-care/current-published-review':{currentPatientPublishedReview:async()=>null},
 '@/lib/patient-care/published-review':{currentPublishedSourceRows:()=>[]},
 '@/lib/patient-care/repository':{getCareData:async()=>({results:[]})},
};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/zoe-chat-actions/server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:resultExports,Date,Error,Promise,Object,require(name:string){return resultBoundaries[name]??{};}});
const result=await (resultExports.buildSnapshot as typeof import('../lib/zoe-chat-actions/server').buildSnapshot)('results');
const parsed=registry.SNAPSHOTS.results.parse(result);assert.equal(parsed.available,true);assert.equal(parsed.rows.length,0);assert.deepEqual(parsed.documents,[doc]);

console.log('Next-step server reads: fail-closed stages, session identity, admin task, paginated tests/booking recovery, stable stage, current-review releases and PDF-only results passed');
