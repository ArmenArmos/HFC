import assert from 'node:assert/strict';
import {measurementOverview} from '@/lib/patient-care/overview';
import type {Measurement} from '@/lib/patient/types';

const now=new Date('2026-11-05T12:00:00Z');
const reported={id:'reported',submissionId:'reported',systolic:185,diastolic:115,measuredAt:now.toISOString(),source:'manual',entrySource:'patient_text_entry'} as Measurement;
const measured={...reported,id:'measured',systolic:120,diastolic:80,entrySource:null} as Measurement;
assert.equal(measurementOverview([reported],now).count,0,'a typed observation is excluded from verified reading counts');
assert.deepEqual(measurementOverview([reported,measured],now).average,{systolic:120,diastolic:80},'typed observations cannot change an average');
console.log('PASS unverified BP verified metrics');

const {healthDataBlock}=await import('@/lib/zoe/health-answer');
const data={bpWeek:null,labs:[],plan:null,bpReported:[{systolic:185,diastolic:115,daysAgo:0,entrySource:'patient_text_entry' as const}]};
assert.match(healthDataBlock(data),/185\/115.*Member-reported, not verified/,'member prompt keeps typed observations separate and labelled');

const {job,runPipeline}=await import('@/lib/zoe/eval/harness');
const chat={enabled:true,doctorName:'Test Doctor',answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en' as const};
const intake={enabled:true,registered:[],active:null,doctorName:'Test Doctor',latestReading:null,redFlagsAfterSeq:0};
const input=job(['My blood pressure is 185/115'],{healthAnswers:true,health:{bpWeek:null,labs:[],plan:null},intake,directAnswers:true,conversation:chat});
const run=await runPipeline(input,{directAnswers:true,env:{NOREON_ZOE_FREE_STYLE:'coach-first'},typedBp:{saves:[]}});
assert.match(run.finish?.receipt?.text??'',/Member-reported, not verified/,'the real member reply labels the numbers it repeats');
assert.match(run.finish?.summary??'',/Member-reported, not verified/,'the generated doctor hand-over labels its typed BP quote');

const {bpText}=await import('@/lib/zoe-chat-actions/copy');
const {unverifiedBpLabel}=await import('@/lib/patient/bp-provenance');
for(const l of ['en','hy','ru'] as const){
 assert.ok(bpText(l,{systolic:185,diastolic:115,pulse:null,entrySource:'patient_text_entry'}).includes(unverifiedBpLabel(l)),`${l} reading line labels typed numbers`);
}

const {buildOverview}=await import('@/lib/patient/overview');
const overview=buildOverview({now,locale:'en',name:'Synthetic',doctor:null,consent:true,questionnaireComplete:true,care:null,home:[reported],clinicBp:[],bpWeek:null,ldl:undefined,medicines:null,uploaded:[],released:[],labResultsReceived:false,visitDone:false,bookedVisit:null});
assert.equal(overview.bp.last,null,'overview latest verified value excludes typed observations');
assert.equal(overview.bp.ranges[14].evening.count+overview.bp.ranges[14].morning.count,0,'overview chart counts exclude typed observations');

const {createElement}=await import('react');
const {renderToStaticMarkup}=await import('react-dom/server');
const {MemberChat}=await import('@/components/chat-v2/member-chat');
const {SavedReading}=await import('@/components/chat-v2/reading-card');
const {cardSchema}=await import('@/lib/zoe-chat-actions/registry');
const card=cardSchema.parse({id:'b4000000-0000-4000-8000-000000000001',requestId:'b4000000-0000-4000-8000-000000000002',kind:'bp',source:'chip',sourceSeq:null,state:'done',outcome:{bp:{systolic:185,diastolic:115,pulse:null,entrySource:'patient_text_entry'}},claims:{},at:now.toISOString(),snapshot:{v:1,week:null,latest:null}});
assert.ok(card.valid&&card.kind==='bp');
for(const locale of ['en','hy','ru'] as const){
 const thread={ok:true as const,version:1,ack:null,zoeReplies:false,settledSeq:1,messages:[{seq:1,text:'My blood pressure is 185/115',at:now.toISOString(),channel:'app' as const,requestId:null}],replies:[],answers:[{id:'b4000000-0000-4000-8000-000000000009',text:'185/115 is very high.',at:new Date(now.getTime()+1000).toISOString()}]};
 const bubble=renderToStaticMarkup(createElement(MemberChat,{locale,memberName:'Synthetic',revision:1,initial:thread}));
 assert.equal(bubble.split(unverifiedBpLabel(locale)).length-1,2,`${locale} actual member bubble and historical Zoe quote both include the label`);
 const saved=renderToStaticMarkup(createElement(SavedReading,{card,reading:{systolic:185,diastolic:115,pulse:null,entrySource:'patient_text_entry'},said:false,locale,time:'12:00'}));
 assert.ok(saved.includes(unverifiedBpLabel(locale)),`${locale} actual saved reading line includes the label`);
}
console.log('PASS unverified BP member bubbles, cards, replies, hand-over and overview');

const {urgentStepsText}=await import('@/lib/zoe/health-answer');
const {runZoeJob}=await import('@/lib/zoe/pipeline');
type FinishInput=import('@/lib/zoe/pipeline').FinishInput;
for(const locale of ['en','hy','ru'] as const){
 const text={en:'My blood pressure is 185/115 and I have a headache',hy:'Իմ ճնշումը 185/115 է և գլխացավ ունեմ',ru:'Моё давление 185/115 и у меня болит голова'}[locale];
 const emergency=await runPipeline(job([text],{healthAnswers:true,health:{bpWeek:null,labs:[],plan:null},intake,directAnswers:true,conversation:{...chat,locale}}),{directAnswers:true,env:{NOREON_ZOE_FREE_STYLE:'coach-first'}});
 assert.equal(emergency.finish?.answer,urgentStepsText(locale,[text],false),`${locale} 103-first reply stays byte for byte unchanged`);
 for(const result of ['saved','refused','throw','pending'] as const){
  const published:FinishInput[]=[],deferred:(()=>Promise<void>)[]=[],saves:{seq:number;index:number;systolic:number;diastolic:number}[]=[];
  const urgentJob=job([text],{healthAnswers:true,health:{bpWeek:null,labs:[],plan:null},intake,directAnswers:true,conversation:{...chat,locale}});
  let release!:()=>void;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  await runZoeJob(urgentJob,{provider:null,directAnswers:true,seal:()=>null,env:{NOREON_ZOE_TEST_LEXICON:'true',NOREON_ZOE_FREE_STYLE:'coach-first'},ports:{
   reserve:async()=>{throw Error('Emergency must not reserve a model call');},
   finish:async(_id,input)=>{published.push(input);return {ok:true};},
   afterReply:task=>{assert.equal(published.length,1,'publish 103 before scheduling its observation');deferred.push(task);},
   saveTypedBp:async(runId,reading)=>{
    assert.equal(runId,urgentJob.runId);saves.push(reading);
    if(result==='pending')await pending;
    if(result==='throw')throw Error('Synthetic save failure');
    return {saved:result!=='refused',notified:result!=='refused'};
   },
  }});
  assert.equal(deferred.length,1,`${locale} ${result}: emergency schedules the observation save`);
  assert.equal(saves.length,0,'urgent pipeline returns without waiting for persistence');
  const before=JSON.stringify(published[0]);
  assert.equal(published[0].answer,emergency.finish?.answer,`${locale} ${result}: reply is byte-identical`);
  assert.deepEqual(published[0].health,emergency.finish?.health,`${locale} ${result}: urgency is unchanged`);
  const saving=deferred[0]();
  assert.deepEqual(saves,[{seq:1,index:0,systolic:185,diastolic:115}],'same per-message and reading key as the normal path');
  release();await saving;
  assert.equal(JSON.stringify(published[0]),before,'a successful or failed save never mutates the urgent publication');
 }
}
console.log('PASS unchanged 103-first wording in en/hy/ru');

// Emergency exits share the conservative save eligibility and only consider unanswered messages.
for(const test of [
 {texts:['My blood pressure is 185/115','My blood pressure is 184/116 and I have a headache'],expected:[{seq:1,index:0,systolic:185,diastolic:115},{seq:2,index:0,systolic:184,diastolic:116}]},
 {texts:['My mother has blood pressure 185/115 and chest pain'],expected:[]},
 {texts:['Yesterday my blood pressure was 185/115. I have chest pain now'],expected:[]},
 {texts:['My blood pressure is 185/115 on Monday. I have chest pain now'],expected:[]},
 {texts:['My blood pressure is 130/85 and I have chest pain'],expected:[]},
 {texts:['My blood pressure is 185/115','I have chest pain now'],answered:1,expected:[]},
 {texts:['My blood pressure is 185/115 and I have a headache'],refuseFinish:true,expected:[]},
]){
 const deferred:(()=>Promise<void>)[]=[],saves:{seq:number;index:number;systolic:number;diastolic:number}[]=[];
 await runZoeJob(job(test.texts,{healthAnswers:true,intake,directAnswers:true,conversation:{...chat,answeredThroughSeq:test.answered??0}}),{
  provider:null,directAnswers:true,seal:()=>null,env:{NOREON_ZOE_TEST_LEXICON:'true',NOREON_ZOE_FREE_STYLE:'coach-first'},ports:{
   reserve:async()=>{throw Error('Emergency must not reserve a model call');},
   finish:async(_id,input)=>{assert.ok(input.answer?.includes('103'),`eligibility fixture takes the urgent route: ${test.texts.join(' | ')}`);return {ok:!test.refuseFinish};},
   afterReply:task=>{deferred.push(task);},
   saveTypedBp:async(_id,reading)=>{saves.push(reading);return {saved:true,notified:true};},
  },
 });
 for(const task of deferred)await task();
 assert.deepEqual(saves,test.expected,`urgent save eligibility: ${test.texts.join(' | ')}`);
}
console.log('PASS urgent observation eligibility, batch ordering and refused publication');

const {inboxItemSchema,itemSummary}=await import('@/lib/doctor-inbox/contracts');
const note=inboxItemSchema.parse({id:'bp_repeat:1',lane:'P3',kind:'bp_repeat_pending',rank:3,memberId:'b4000000-0000-4000-8000-000000000004',memberName:'Synthetic',at:now.toISOString(),confidence:'rule',ai:'none',entrySource:'patient_text_entry',systolic:185,diastolic:115,sources:[{type:'measurement',ref:'synthetic'}]});
assert.match(itemSummary(note,'en'),/Member-reported, not verified/,'Zoe quoting the quiet note retains provenance too');
