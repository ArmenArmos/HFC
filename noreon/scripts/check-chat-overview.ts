/** The overview route with supplied reads, and the rules in buildOverview. No credentials, storage or network. */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {ZONE_RULES_V1} from '@/lib/clinical/zones/config-v1';
import {memberOverviewEnabled} from '@/lib/patient/zoe-app-v3';
import {buildOverview,memberFacingName,QUICK_TARGETS,WIRED_QUICK_TARGETS,type OverviewFacts} from '@/lib/patient/overview';
import type {MemberLdl} from '@/lib/ldl/schema';
import type {CarePlan} from '@/lib/patient-care/types';

// Route: both switches, exact, before any member data is read.
const env:Record<string,string|undefined>={};
const calls:string[]=[];
let urgent=false,emergencyCard=true;
const exports:Record<string,unknown>={};
const Overview=()=>null;
const source=readFileSync('app/patient/chat/overview/page.tsx','utf8');
const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
new vm.Script(code,{filename:'app/patient/chat/overview/page.tsx'}).runInNewContext({exports,require(name:string){
 if(name==='react/jsx-runtime')return jsx;
 if(name==='next/navigation')return {notFound(){throw Error('not-found');},redirect(to:string){throw Error(`redirect:${to}`);}};
 if(name==='@/components/chat-v2/overview')return {MemberOverview:Overview};
 if(name==='@/lib/patient/overview-server')return {readOverview:async()=>{calls.push('overview');return {};}};
 if(name==='@/lib/patient/presentation')return {patientPresentation:()=>({urgent})};
 if(name==='@/lib/patient/render-data')return {requireRegisteredForRender:async()=>{calls.push('registration');return {profile:{locale:'hy',name:'Synthetic'},assessment:{completedAt:null}};}};
 if(name==='@/lib/patient/zoe-app-v3')return {memberOverviewEnabled:()=>memberOverviewEnabled(env)};
 if(name==='@/lib/zoe/member-screen')return {zoeEmergencyCardEnabled:()=>emergencyCard};
 if(name.endsWith('.css'))return {};
 throw Error(`Unexpected route boundary: ${name}`);
}});
const page=exports.default as ()=>Promise<{type:unknown}>;
for(const [chat,v3] of [[undefined,undefined],['true',undefined],[undefined,'true'],['true','false'],['false','true'],['TRUE','true'],['true',' true']]){
 Object.assign(env,{NOREON_MEMBER_CHAT_V2:chat,NOREON_ZOE_APP_V3:v3});calls.length=0;
 await assert.rejects(page(),/not-found/);
 assert.deepEqual(calls,[],`chat ${chat}, v3 ${v3}: 404 before any member read`);
}
Object.assign(env,{NOREON_MEMBER_CHAT_V2:'true',NOREON_ZOE_APP_V3:'true'});
assert.equal((await page()).type,Overview);
urgent=true;calls.length=0;
await assert.rejects(page(),/redirect:\/patient\/chat$/);
emergencyCard=false;
await assert.rejects(page(),/redirect:\/patient\/urgent$/);
assert.ok(!calls.includes('overview'),'An urgent member never lands on the read-only view');

// Rules.
const now=new Date('2026-11-02T10:00:00Z');
const plan:CarePlan={id:'p',clinician:'Doctor',publishedAt:'2026-10-20T08:00:00Z',instructions:'',acknowledgedAt:null,medications:[]};
const goal=(over:Partial<Extract<MemberLdl,{inPathway:true}>['goal']&object>={}):NonNullable<Extract<MemberLdl,{inPathway:true}>['goal']>=>({version:1,category:'very_high',thresholdMmol:1.4,reductionRule:true,reductionPct:50,nextTestOn:'2026-12-01',setAt:'2026-10-20T08:00:00Z',doctorName:null,baseline:{kind:'pre_treatment',mmol:4,on:'2026-09-01',source:'lab_result'},...over});
const obs=(id:string,value:number,on:string,source:'member'|'clinic_result'|'upload_checked',memberVisible=true)=>({id,value,unit:'mmol/L',on,source,name:source==='clinic_result'?'LDL-C':null,memberVisible});
const ldl=(over:Partial<Extract<MemberLdl,{inPathway:true}>>={}):MemberLdl=>({version:'ldl-member-v1',enabled:true,inPathway:true,goal:goal(),observations:[obs('a',2,'2026-10-25','clinic_result')],...over});
const facts=(over:Partial<OverviewFacts>={}):OverviewFacts=>({now,locale:'en',name:'Ani',doctor:undefined,consent:undefined,questionnaireComplete:false,
 care:{plan,events:[],tests:[],appointments:[]},home:null,clinicBp:null,bpWeek:null,ldl:ldl(),medicines:null,uploaded:null,released:null,labResultsReceived:false,visitDone:false,bookedVisit:null,...over});
const held=(over:Partial<OverviewFacts>,why:string)=>{
 const data=buildOverview(facts(over));
 assert.deepEqual(data.ldl,{shown:false},why);
 assert.deepEqual(data.upcoming.rechecks,[],`${why}: no LDL date either`);
};
const shown=buildOverview(facts()).ldl;
assert.ok(shown.shown&&shown.current?.value==='2.0'&&shown.reduction==='50'&&shown.baseline?.value==='4.0'&&shown.target==='1.4','Approved: baseline, current, reduction and goal');
held({care:{plan:null,events:[],tests:[],appointments:[]}},'No published plan');
held({care:null},'Care read failed');
held({ldl:undefined},'LDL read failed');
held({ldl:{version:'ldl-member-v1',enabled:false}},'LDL switched off');
held({ldl:{version:'ldl-member-v1',enabled:true,inPathway:false}},'Not in the LDL pathway');
held({ldl:ldl({goal:null})},'No doctor goal');
held({ldl:ldl({withDoctor:{since:'2026-11-01T08:00:00+00:00',doctorName:null}})},'A result is waiting for the doctor');
const uncounted=buildOverview(facts({ldl:ldl({observations:[obs('m',1,'2026-10-30','member'),obs('h',1.1,'2026-10-29','clinic_result',false)]})})).ldl;
assert.ok(uncounted.shown&&uncounted.current===null&&uncounted.reduction===null,'A member-typed or unpublished value is never the current result');
const counted=buildOverview(facts({ldl:ldl({observations:[obs('c',1.9,'2026-10-20','upload_checked'),obs('m',1,'2026-10-30','member')]})})).ldl;
assert.ok(counted.shown&&counted.current?.on==='2026-10-20','The newest counted value wins over a newer uncounted one');
const rose=buildOverview(facts({ldl:ldl({observations:[obs('r',5,'2026-10-25','clinic_result')]})})).ldl;
assert.ok(rose.shown&&rose.reduction===null,'A rise is not shown as a reduction');

for(const name of ['STAGING Test Doctor','staging doctor',' STAGING','',null,undefined])assert.equal(memberFacingName(name),null);
assert.equal(memberFacingName('Dr. Stagings'),'Dr. Stagings');
assert.equal(buildOverview(facts({doctor:'STAGING Test Doctor'})).doctor,null);

const states=(over:Partial<OverviewFacts>)=>Object.fromEntries(buildOverview(facts(over)).journey.map(s=>[s.key,s.state]));
const noPlan={plan:null,events:[],tests:[],appointments:[]};
assert.equal(states({care:noPlan}).consent,'current','Nothing on record: the first step');
assert.deepEqual(states({care:noPlan,consent:undefined,questionnaireComplete:true}),{consent:'missing',anamnesis:'done',records:'current',labs:'next',consult:'next',plan:'next',monitoring:'next'},'A failed consent read is unknown, not done');
assert.deepEqual(states({care:null,consent:true,questionnaireComplete:true,labResultsReceived:true,visitDone:true}),{consent:'done',anamnesis:'done',records:'unavailable',labs:'done',consult:'done',plan:'unavailable',monitoring:'unavailable'},'A failed care read puts nobody at any step, and never moves them back');
assert.equal(buildOverview(facts({care:null})).plan,'unknown','A failed care read is not "waiting for approval"');
assert.equal(buildOverview(facts({care:noPlan})).plan,'waiting');
assert.equal(buildOverview(facts()).plan,'approved');
assert.equal(states({}).monitoring,'current','A published plan reaches monitoring');
assert.equal(states({}).records,'missing','Records are not assumed');

const reading=(systolic:number,diastolic:number,measuredAt:string,id='m')=>({id,submissionId:id,systolic,diastolic,measuredAt,source:'manual' as const});
const noBp=buildOverview(facts()).bp;
assert.equal(noBp.last,null,'No reading stays unknown');assert.equal(noBp.mean,null);
const atAge=(hours:number,systolic=120,diastolic=80)=>buildOverview(facts({home:[reading(systolic,diastolic,new Date(now.getTime()-hours*3600000).toISOString())]})).bp.last;
assert.equal(atAge(6,190,125)?.zone?.level,'orange','Numbers alone stop at orange: 103 needs a symptom');
assert.equal(atAge(6,120,80)?.zone?.level,'green');
assert.equal(ZONE_RULES_V1.readingFreshHours,24);
assert.ok(atAge(24)?.zone,'Exactly 24 hours is still recent');
const old=atAge(24.01);
assert.equal(old?.zone,null,'An older reading has no zone');
assert.equal(old?.systolic,120,'An older reading keeps its number');
assert.ok(old?.at,'An older reading keeps its date');
const future=buildOverview(facts({home:[reading(120,80,'2026-11-03T04:00:00Z')]})).bp.last;
assert.equal(future,null,'A future time is not the last reading');
const both=buildOverview(facts({home:[reading(120,80,'2026-11-01T04:00:00Z'),reading(130,80,'2026-11-01T05:00:00Z','c')],clinicBp:[{id:'c',systolic:130,diastolic:80,at:'2026-11-01T05:00:00Z'}]})).bp;
assert.equal(both.last?.source,'clinic','A clinic reading keeps its source');
assert.equal(both.ranges[7].morning.count,1,'The clinic copy is not a home reading');

assert.deepEqual(buildOverview(facts()).quick,[],'Nothing is wired in the chat yet, so nothing but 103 shows');
assert.ok(WIRED_QUICK_TARGETS.every(target=>QUICK_TARGETS.includes(target)));

for(const path of ['components/chat-v2/overview.tsx','components/chat-v2/overview-chart.tsx','lib/patient/overview.ts']){
 const text=readFileSync(path,'utf8');
 assert.doesNotMatch(text,/#[0-9a-f]{3,8}\b|rgba?\(/i,`${path}: colours are tokens`);
 assert.doesNotMatch(text,/SCORE2|risk class|cv risk|—/i,`${path}: no risk class, no em dash`);
 assert.doesNotMatch(text,/THRESHOLD\b/,`${path}: thresholds stay in the rules`);
}
assert.doesNotMatch(readFileSync('components/chat-v2/overview.tsx','utf8'),/ZONE_RULES/,'The view asks the builder, not the rules');
const view=readFileSync('components/chat-v2/overview.tsx','utf8');
assert.doesNotMatch(view,/<input\b|<textarea\b|<form\b|['"]use client['"]/,'The view is read-only and renders on the server');
console.log('Chat overview: both switches exact before any read, urgent route first, LDL held until approved, counted values only, unknown stays unknown, a failed care read claims nothing, zones only for recent readings, staging names hidden. Real route and builder, supplied reads.');
