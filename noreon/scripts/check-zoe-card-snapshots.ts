/**
 * What the Zoe results and plan cards show (test gap 6): buildSnapshot from lib/zoe-chat-actions/server.ts, the actual
 * builders, with only the reads stubbed. The same sources in the same order as the member's pages: a card shows the
 * exact recorded value and unit, never an older source over a current one, never a stopped or ended medicine as current
 * care, and a failed read says so rather than looking complete.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as zod from 'zod';
import * as bpFlow from '@/lib/zoe-chat-actions/bp-flow';
import * as doseFlow from '@/lib/zoe-chat-actions/dose-flow';
import * as registry from '@/lib/zoe-chat-actions/registry';
import * as publishedReview from '@/lib/patient-care/published-review';
import * as careModel from '@/lib/patient-care/model';
import * as medicineModel from '@/lib/member-medicines/model';
import * as bpModel from '@/lib/bp-week/model';
import * as typedReadings from '@/lib/zoe-chat-actions/typed-reading';
import {openCard} from '@/lib/zoe-chat-actions/commands';
import {mintActor} from '@/lib/zoe-chat-actions/actor';
import type {Snapshot} from '@/lib/zoe-chat-actions/registry';

const PLAN='6a000000-0000-4000-8000-0000000000a1',REPORT='6a000000-0000-4000-8000-0000000000b1';
const NOW=new Date('2026-10-30T08:00:00.000Z');
type Reads={v3?:boolean;booking?:()=>Promise<unknown>;emergencies?:unknown;messages?:{seq:number;text:string;at:string}[];publication?:()=>Promise<unknown>;care?:()=>Promise<unknown>;versions?:()=>Promise<unknown>;completion?:boolean};
function load(r:Reads){
 const calls={publication:0,care:0};
 const exports:Record<string,unknown>={};
 const code=ts.transpileModule(readFileSync('lib/zoe-chat-actions/server.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 new vm.Script(code).runInNewContext({exports,process:{env:{}},require(name:string){
  if(name==='server-only')return {};
  if(name==='@supabase/supabase-js')return {createClient:()=>{throw Error('No service client in this check.');}};
  if(name==='@/lib/zoe/app-chat')return {readZoeThread:async()=>({messages:r.messages??[]})};
  if(name==='./medicines-read')return {readMedicines:async()=>({token:'a'.repeat(64)})};
  if(name==='./account-read')return {readAccountSettings:async()=>({token:'b'.repeat(64)})};
  if(name==='@/lib/patient/member-chat-config')return {memberChatOnlyEnabled:()=>false};
  if(name==='./plan-read')return {readV3Plan:async()=>{throw Error('V3 plan read while disabled');},readConfirmedPlanDoses:async()=>{throw Error('V3 dose read while disabled');}};
  if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>r.v3===true};
  if(name==='./typed-reading')return typedReadings;
  if(name==='@/lib/supabase/server')return {createClient:async()=>({rpc:async(_name:string,args:{p_seq:number})=>{if(_name==='zoe_bp_open_emergencies')return {data:r.emergencies??{cards:[],clearedAt:null},error:null};const m=(r.messages??[]).find(x=>x.seq===args.p_seq);return {data:m?{receipt:null,memberId:'member',text:m.text,at:m.at}:null,error:null};}})};
  if(name==='@/lib/member-medicines/server')return {loadMemberMedicines:async()=>({enabled:false})};
  if(name==='@/lib/member-medicines/model')return medicineModel;
  if(name==='@/lib/bp-week/server')return {readMemberBpWeek:async()=>({enabled:false})};
  if(name==='@/lib/bp-week/model')return bpModel;
  if(name==='@/lib/patient-care/current-published-review')return {currentPatientPublishedReview:async()=>{calls.publication++;return (r.publication??(async()=>null))();}};
  if(name==='@/lib/patient-care/published-review')return publishedReview;
  if(name==='@/lib/patient-care/repository')return {getCareData:async()=>{calls.care++;return (r.care??(async()=>({results:[],plan:null})))();}};
  if(name==='@/lib/patient-care/model')return careModel;
  if(name==='@/lib/doctor-completion/config')return {doctorCompletionEnabled:()=>r.completion===true};
  if(name==='@/lib/doctor-completion/document-runtime')return {readMemberPlanVersions:async()=>(r.versions??(async()=>[]))()};
  if(name==='@/lib/real-booking/appointment-repository')return {getMemberAppointmentSummary:async()=>null};
  if(name==='@/lib/patient/member-chat-config')return {memberChatOnlyEnabled:()=>false};
  if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>r.v3===true};
  if(name==='./booking-read')return {readVisitBooking:async()=>r.booking?.()};
  if(name==='./registry')return registry;
  if(name==='./voice-receipt')return {verifyVoiceReceipt:()=>false};
  if(name==='@/lib/ldl/member')return {memberLdl:async()=>undefined};
  if(name==='@/lib/member-medicines/asks')return {medicineAskSchema:{safeParse:()=>({success:false})}};
  if(name==='@/lib/patient/zoe-app-v3')return {zoeAppV3Enabled:()=>r.v3===true};
  if(name==='@/lib/observability/logger')return {log:{error(){},warn(){},info(){},debug(){}},errorFields:()=>({})};
  if(name==='zod')return zod;
  if(name==='./living-visit')return {findLivingVisit:()=>undefined};
  if(name==='./bp-flow')return bpFlow;
  if(name==='./dose-flow')return doseFlow;
  if(name==='@/lib/member-medicines/side-effect-routing')return {sideEffectNurseFirstEnabled:()=>false,sideEffectRoute:()=>'doctor'};
  throw Error(`Unexpected boundary in server.ts: ${name}`);
 }});
 const build=exports.buildSnapshot as (kind:string,now?:Date)=>Promise<unknown>;
 return {calls,visit:()=>build('visit',NOW),typed:exports.typedFromMessage as (seq:number)=>Promise<unknown>,results:()=>build('results',NOW) as Promise<Snapshot<'results'>>,plan:()=>build('plan',NOW) as Promise<Snapshot<'plan'>>};
}
const source=(i:number,o:Partial<{name:string;literal:string;unit:string|null;reference:string|null}>={})=>({reportId:REPORT,rowIndex:i,
 source:{name:`Marker ${i}`,literal:`${i}.5`,unit:'mmol/L',reference:'3.0 - 5.0',page:1,snippet:'',uncertain:false,...o},laboratory:'Synthetic lab',reportDate:'2026-10-12',notes:['Checked']});
const publication=(rows:unknown[])=>({planId:PLAN,publishedAt:'2026-10-20T08:00:00.000Z',draft:{},sourceRows:rows});
const result=(marker:string,value:number,collectedAt:string,o:Record<string,unknown>={})=>({id:marker,testId:null,marker,value,unit:'mmol/L',referenceText:'< 3.0',referenceLow:null,referenceHigh:3,collectedAt,receivedAt:collectedAt,source:'laboratory',sourceLabel:'Synthetic lab',reviewedAt:collectedAt,reviewedBy:'Synthetic Doctor',explanation:'',...o});
const rows=(n:number,start=0)=>Array.from({length:n},(_,i)=>source(start+i));
const medicine=(name:string,o:Record<string,unknown>={})=>({id:name,planId:PLAN,originatingPlanId:PLAN,name,dose:'5 mg',instructions:'',times:['08:00'],startDate:'2026-10-01',endDate:null,active:true,...o});
const plan=(o:Record<string,unknown>={})=>({id:PLAN,clinician:'Dr Synthetic',publishedAt:'2026-10-20T08:00:00.000Z',instructions:'Older instructions on the plan row.',acknowledgedAt:null,medications:[medicine('Amlodipine')],...o});

{// The current publication's checked rows win over older reviewed results: exact literal, unit and reference, no mixing.
 // LDL first, as lib/zoe-chat-actions/server.ts orders every results card.
 const h=load({publication:async()=>publication([source(0,{literal:'<0.5',unit:null,reference:'negative'}),source(1,{name:'LDL',literal:'2.4',unit:'mmol/L',reference:'< 1.4'})]),care:async()=>({results:[result('Older LDL',9.9,'2026-10-29T00:00:00.000Z')],plan:null})});
 assert.deepEqual(await h.results(),{v:1,available:true,publishedAt:'2026-10-20T08:00:00.000Z',more:0,rows:[
  {name:'LDL',value:'2.4',unit:'mmol/L',reference:'< 1.4',at:'2026-10-12'},
  {name:'Marker 0',value:'<0.5',unit:null,reference:'negative',at:'2026-10-12'}]});
 assert.equal(h.calls.care,0,'an older source is not even read');
}
{// More than twelve published rows: twelve shown, the rest counted, nothing dropped silently.
 const s=await load({publication:async()=>publication(rows(15))}).results();
 assert.equal(s.rows.length,12);assert.equal(s.more,3);assert.equal(s.rows[11]!.name,'Marker 11');
}
{// A failed read of the current publication never falls back to older results shown as current.
 const h=load({publication:async()=>{throw Error('down');},care:async()=>({results:[result('Older LDL',9.9,'2026-10-29T00:00:00.000Z')],plan:null})});
 assert.deepEqual(await h.results(),{v:1,available:false,publishedAt:null,rows:[],more:0});
 assert.equal(h.calls.care,0);
}
{// No publication: doctor-reviewed results, LDL first, then newest first, exact values and units; an empty unit is no unit.
 const s=await load({publication:async()=>null,care:async()=>({results:[result('Older LDL',3.1,'2026-09-01T00:00:00.000Z'),result('Glucose',5.20,'2026-10-20T00:00:00.000Z',{unit:'',referenceText:null}),result('Newest LDL',2.4,'2026-10-25T00:00:00.000Z')],plan:null})}).results();
 assert.deepEqual(s,{v:1,available:true,publishedAt:null,more:0,rows:[
  {name:'Newest LDL',value:'2.4',unit:'mmol/L',reference:'< 3.0',at:'2026-10-25T00:00:00.000Z'},
  {name:'Older LDL',value:'3.1',unit:'mmol/L',reference:'< 3.0',at:'2026-09-01T00:00:00.000Z'},
  {name:'Glucose',value:'5.2',unit:null,reference:null,at:'2026-10-20T00:00:00.000Z'}]});
}
{// A publication with no checked rows and a failed care read: not available, never an empty list presented as complete.
 const s=await load({publication:async()=>publication([]),care:async()=>{throw Error('down');}}).results();
 assert.deepEqual(s,{v:1,available:false,publishedAt:null,rows:[],more:0});
}
{// The published instructions, the current version, and only medicines in force today.
 const h=load({completion:true,versions:async()=>[{planId:'6a000000-0000-4000-8000-0000000000a2',current:false,version:1},{planId:PLAN,current:true,version:3}],
  care:async()=>({results:[],plan:plan({publishedReview:{explanation:'',instructions:'Published instructions.',followUp:''},medications:[
   medicine('Amlodipine',{times:['08:00','20:00']}),
   medicine('Stopped by the doctor',{active:false}),
   medicine('Course that ended',{endDate:'2026-10-29'}),
   medicine('Last day today',{endDate:'2026-10-30'})]})})});
 assert.deepEqual(await h.plan(),{v:1,available:true,plan:{id:PLAN,version:3,clinician:'Dr Synthetic',publishedAt:'2026-10-20T08:00:00.000Z',instructions:'Published instructions.',acknowledged:false,
  medicines:[{name:'Amlodipine',dose:'5 mg',times:['08:00','20:00']},{name:'Last day today',dose:'5 mg',times:['08:00']}]}});
}
{// An unpublished-review plan keeps its own instructions; a failed version read only hides the version.
 const s=await load({completion:true,versions:async()=>{throw Error('down');},care:async()=>({results:[],plan:plan()})}).plan();
 assert.equal(s.plan!.instructions,'Older instructions on the plan row.');assert.equal(s.plan!.version,null);
}
{// No plan yet is an answer; a failed read is not.
 assert.deepEqual(await load({care:async()=>({results:[],plan:null})}).plan(),{v:1,available:true,plan:null});
 assert.deepEqual(await load({care:async()=>{throw Error('down');}}).plan(),{v:1,available:false,plan:null});
}

// A new acknowledgement's clearance cannot clear, deduplicate or rehabilitate the original reading.
{
 const at='2026-10-30T08:00:00.000Z';
 const server=load({messages:[{seq:1,text:'128/82',at},{seq:2,text:'thanks',at:'2026-10-30T08:00:30.000Z'}]});
 assert.equal(JSON.stringify(await server.typed(1)),JSON.stringify({typed:{systolic:128,diastolic:82,pulse:null,measuredAt:at}}),'the original message owns its numbers and time');
 assert.equal(JSON.stringify(await server.typed(2)),'{}','a previously held or already-carded reading cannot be copied to a new source sequence');
 assert.equal(JSON.stringify(await server.typed(999)),'{}','missing source messages provide no numbers');
}
console.log('check-zoe-card-snapshots: results and plan cards use the same sources as the pages, in force medicines only, failed reads fail closed');

// A deliberate booking hold survives snapshot construction and the shared open command.
const actor=mintActor('00000000-0000-4000-8000-000000000001','app');
const clinicalHold={token:'a'.repeat(64),hold:null,booking:{data:{clinicalHold:true},pilot:{appointments:[],unavailableReason:'clinical-hold'}}};
const red=registry.cardSchema.parse({id:'00000000-0000-4000-8000-000000000002',requestId:'00000000-0000-4000-8000-000000000003',kind:'red_flags',source:'chip',sourceSeq:null,state:'done',at:NOW.toISOString(),snapshot:{v:1,episodeId:'00000000-0000-4000-8000-000000000004',readingId:null,readings:[{sbp:190,dbp:125}],week:null},outcome:{'a:chest_pain':{answer:true,requestId:'00000000-0000-4000-8000-000000000005',text:'Synthetic symptom',doneAt:NOW.toISOString()}}});
const sams={...red,kind:'sams',snapshot:{v:1,episodeId:red.requestId},outcome:{'a:musclepain':{answer:true},'a:weakness':{answer:false},'a:darkurine':{answer:true,zone:'red',requestId:red.requestId,text:'Synthetic symptom'}}};
for(const [read,emergencies,call103] of [
 [{token:'a'.repeat(64),hold:'urgent',booking:null},undefined,true],
 [{token:'a'.repeat(64),hold:'questionnaire',crisis:true,booking:null},undefined,true],
 [clinicalHold,{cards:[red],clearedAt:null},true],
 [clinicalHold,{cards:[sams],clearedAt:null},true],
 [clinicalHold,{cards:[{...red,outcome:{...red.outcome,emergencyCleared:true}},sams],clearedAt:null},true],
 [clinicalHold,{cards:[{...red,outcome:{...red.outcome,emergencyCleared:true}}],clearedAt:NOW.toISOString()},false],
 [clinicalHold,{cards:[],clearedAt:NOW.toISOString()},false],
] as const){
 const h=load({v3:true,booking:async()=>read,emergencies});
 const opened=await openCard(actor,{snapshot:()=>h.visit(),post:async()=>{throw Error('A held visit must not post a booking card');}},{kind:'visit',sourceSeq:null,requestId:crypto.randomUUID(),reuseCurrent:true});
 assert.deepEqual(opened,{status:'held_urgent',call103},'The booking hold is a distinct result, including whether 103 is still active');
}
const failed=await openCard(actor,{snapshot:()=>load({v3:true,booking:async()=>{throw Error('Synthetic outage');}}).visit(),post:async()=>{throw Error('No post on read failure');}},{kind:'visit',sourceSeq:null,requestId:crypto.randomUUID()});
assert.equal(failed.status,'unavailable','An ordinary read failure keeps its old status');
console.log('Visit hold: urgent questionnaire, active BP alarm, cleared alarm with continuing hold, ordinary read failure. Real snapshot and command, injected reads.');

for(const read of [
 {token:'a'.repeat(64),hold:'questionnaire',crisis:false,booking:null},
 {token:'a'.repeat(64),hold:null,booking:{data:{clinicalHold:false},pilot:{appointments:[],unavailableReason:'configuration-unavailable'}}},
]){
 let posted=0;
 const result=await openCard(actor,{snapshot:()=>load({v3:true,booking:async()=>read}).visit(),post:async()=>{posted++;return {ok:false,code:'unavailable'};}},{kind:'visit',sourceSeq:null,requestId:crypto.randomUUID()});
 assert.equal(result.status,'unavailable');assert.equal(posted,1,'Nonurgent questionnaire and configuration states retain the ordinary card path');
}
const unreadable=await openCard(actor,{snapshot:()=>load({v3:true,booking:async()=>clinicalHold,emergencies:{cards:'malformed'}}).visit(),post:async()=>{throw Error('No card on unknown emergency state');}},{kind:'visit',sourceSeq:null,requestId:crypto.randomUUID()});
assert.equal(unreadable.status,'unavailable','Unknown emergency state never claims that the alarm was handled');

// These persisted cards used to look like no open alarm when redOutcome could not read them.
for(const [label,card] of [
 ['positive BP answer missing text',{...red,outcome:{'a:chest_pain':{answer:true,requestId:red.requestId}}}],
 ['unknown card kind',{...red,kind:'future_emergency'}],
 ['malformed outcome',{...red,outcome:{'a:chest_pain':{answer:'yes'}}}],
 ['null outcome',{...red,outcome:null}],
 ['positive SAMS answer missing text',{...sams,outcome:{'a:darkurine':{answer:true,zone:'red',requestId:red.requestId}}}],
 ['missing answer',{...red,outcome:{}}],
 ['malformed clear marker',{...red,outcome:{...red.outcome,emergencyCleared:'true'}}],
 ['malformed answer beside a cleared red',{...red,outcome:{...red.outcome,emergencyCleared:true,'a:dyspnea':{answer:'yes'}}}],
 ['unknown answer beside a cleared red',{...red,outcome:{...red.outcome,emergencyCleared:true,'a:future':{answer:true}}}],
 ['unreadable snapshot',{...red,snapshot:{v:1}}],
 ['invalid red request id',{...red,outcome:{'a:chest_pain':{answer:true,requestId:'broken',text:'Synthetic symptom'}}}],
] as const){
 let posted=0;
 const result=await openCard(actor,{snapshot:()=>load({v3:true,booking:async()=>clinicalHold,emergencies:{cards:[card],clearedAt:null}}).visit(),post:async()=>{posted++;return {ok:false,code:'unavailable'};}},{kind:'visit',sourceSeq:null,requestId:crypto.randomUUID()});
 assert.equal(result.status,'unavailable',`${label}: an unreadable alarm must offer retry, never reassurance`);
 assert.equal(posted,0,'Unknown emergency state cannot post a booking card');
}
