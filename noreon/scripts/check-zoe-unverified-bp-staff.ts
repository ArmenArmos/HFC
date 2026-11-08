import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {bpResult,buildBpSeries} from '@/lib/staff-zoe/facts';
import {chatReportedFacts,quotesTypedBp} from '@/lib/staff-zoe/chat-reported';
import {runStaffTurn,type TurnPorts,type FinishInput} from '@/lib/staff-zoe/turn';
import {fixtureRead} from '@/lib/staff-zoe/fixture-tools';
import {ZoeAnswer} from '@/components/staff/zoe/answer';
import {QuoteLine} from '@/components/staff/zoe/answer';
import {FICTIONAL_RECORDS,MEMBER_A} from '@/lib/staff-zoe/eval/fixtures';
import {unverifiedBpLabel} from '@/lib/patient/bp-provenance';
const fixture=FICTIONAL_RECORDS[MEMBER_A]!;
// The shared display helper and the doctor's actual quote card must reject dates
// and fractions while retaining typed BP across languages and parser bounds.
for(const locale of ['en','hy','ru'] as const){
 for(const [text,labelled] of [
  ['150/95',true],['142/88 pulse 76',true],['150 на 95',true],['Ճնշումս՝ 142/88',true],['BP 148/93',true],
  ['150 over 95',true],['Ճնշումս 150\\95',true],['60/30',true],['300/200',true],
  ['Appointment on 12/05; BP 148/93',true],
  ['Appointment on 12/05',false],['Visit 15/06 at 10:00',false],['12/05',false],['1/5',false],
  ['12/05/26',false],['12/05/2026',false],['12.05',false],['12/05 May',false],['at 12/05',false],
  ['до 12/05',false],['на 12/05',false],['Այցը՝ 12/05',false],['3/4 of a tablet',false],
  ['59/30',false],['301/95',false],['150/29',false],['250/201',false],['90/90',false],['80/120',false],
 ] as const){
  assert.equal(quotesTypedBp(text),labelled,text);
  const html=renderToStaticMarkup(createElement(QuoteLine,{text,date:null,flagged:false,locale}));
  assert.equal(html.includes(unverifiedBpLabel(locale)),labelled,`Doctor quote ${locale}: ${text}`);
 }
}
const snapshot=structuredClone(fixture.snapshot!);
snapshot.evidence.measurements=[
 {id:'verified',systolic:120,diastolic:80,pulse:70,measured_at:'2026-10-29T10:00:00Z',entry_source:'nurse'},
 {id:'typed',systolic:190,diastolic:120,pulse:90,measured_at:'2026-10-30T10:00:00Z',entry_source:'patient_text_entry'},
];
const week=structuredClone(fixture.bpWeek!);
assert.ok(week.enabled);
week.weeks=week.weeks.slice(0,1);
week.weeks[0]!.readings=[
 {id:'verified',day:1,slot:'morning',systolic:120,diastolic:80,pulse:70,measuredAt:'2026-10-29T10:00:00Z',entrySource:'patient_photo'},
 {id:'typed',day:1,slot:'morning',systolic:190,diastolic:120,pulse:90,measuredAt:'2026-10-30T10:00:00Z',entrySource:'patient_text_entry'},
];
for(const locale of ['en','hy','ru'] as const){
 const card=bpResult(week,snapshot,{locale,memberId:MEMBER_A,role:'doctor',now:new Date('2026-10-30')});
 assert.equal(card.state,'ok');
 assert.ok(card.facts.some(f=>f.value==='120/80 mmHg'));
 assert.ok(card.facts.filter(f=>f.value.includes('190/120')).every(f=>f.label.includes(unverifiedBpLabel(locale))));
 assert.ok(card.facts.some(f=>f.value.includes('190/120')),'Typed safety evidence is retained');
 assert.ok(!card.facts.some(f=>f.value.includes('155/100')),'Typed values never enter averages');
 const quote={id:'member_messages.1',text:'My blood pressure is 190/120',date:'2026-10-30',flagged:false};
 assert.ok(chatReportedFacts([quote],locale).bp[0]!.label.includes(unverifiedBpLabel(locale)));
 const html=renderToStaticMarkup(createElement(QuoteLine,{...quote,locale}));
 assert.ok(html.includes(unverifiedBpLabel(locale)),'Quoted typed BP carries the exact localized label');
 assert.ok(html.includes(quote.text),'Member wording stays verbatim');
 const typedOnly=structuredClone(snapshot);typedOnly.evidence.measurements=typedOnly.evidence.measurements.slice(1);
 const only=bpResult(null,typedOnly,{locale,memberId:MEMBER_A,role:'nurse',now:new Date('2026-10-30')});
 assert.equal(only.state,'ok','Typed-only evidence cannot say nothing recorded');
 if(locale==='en')assert.ok(only.facts.some(f=>f.value==='0 verified readings · 1 member-reported, not verified'));
 const typedWeek=structuredClone(week);typedWeek.weeks[0]!.readings=typedWeek.weeks[0]!.readings.slice(1);
 const weekOnly=bpResult(typedWeek,null,{locale,memberId:MEMBER_A,role:'nurse',now:new Date('2026-10-30')});
 assert.equal(weekOnly.state,'ok');
 assert.ok(weekOnly.facts.some(f=>f.label===unverifiedBpLabel(locale)&&f.value==='190/120 mmHg'));
 assert.ok(!weekOnly.facts.some(f=>/average/.test(f.label)));
 assert.ok(!weekOnly.missing.some(m=>m.includes('No structured home BP week recorded')));
}
assert.equal(buildBpSeries(week).length,1,'Trend chart excludes typed values');
// Actual staff-turn orchestration, with database reads and model selection replaced by fictional local ports.
for(const role of ['doctor','nurse'] as const)for(const locale of ['en','hy','ru'] as const)for(const intent of ['summary','bp','messages'] as const){
 const record={...fixture,snapshot,bpWeek:week,messages:[{seq:1,text:'My blood pressure is 190/120',at:'2026-10-30T10:00:00Z'}]};
 let saved:FinishInput|null=null;
 const ports:TurnPorts={
  begin:async()=>({ok:true,runId:'f0000000-0000-4000-8000-000000000003',memberId:MEMBER_A,memberName:'Fictional',role,tier:'low',lastTools:[],history:[]}),
  read:tool=>fixtureRead(record,tool,role,locale,new Date('2026-10-30T12:00:00Z')),
  models:async()=>({primary:{providerName:'test',requestModel:'test',region:'local',local:true,pricing:{inputUsdPerMTok:0,outputUsdPerMTok:0,label:'test'},complete:async()=>{
   const bp=bpResult(week,snapshot,{memberId:MEMBER_A,role,locale,now:new Date('2026-10-30')});
   return {kind:'ok',raw:JSON.stringify({need:[],facts:intent==='messages'?[]:bp.facts.filter(f=>f.value.includes('190/120')).map(f=>f.id),quotes:intent==='messages'?['member_messages.1']:[],not_known:false,declined:false}),finishReason:'stop',usage:{inputTokens:10,outputTokens:10},responseModel:'test',responseId:'test'};
  }},fallback:null,fast:false,effort:null}),
  reserve:async()=>({ok:true}),finish:async(_id,input)=>{saved=input;},seal:()=>null,now:()=>Date.parse('2026-10-30T12:00:00Z'),
 };
 for await(const event of runStaffTurn({conversationId:'f0000000-0000-4000-8000-000000000002',submissionId:'f0000000-0000-4000-8000-000000000003',text:intent==='summary'?'Summarise the record':intent==='bp'?'How is the blood pressure?':'Show the member messages',intent},locale,ports)){
  if(event.type!=='answer')continue;
  assert.equal(event.content.state,'answered');
  const html=renderToStaticMarkup(createElement(ZoeAnswer,{content:event.content,locale,memberRef:'F'}));
  assert.ok(html.includes(unverifiedBpLabel(locale)),`${role}/${locale}/${intent}: displayed provenance`);
  if(intent!=='messages')assert.ok(event.content.say.every(line=>!line.text.includes('190/120')||line.text.includes(unverifiedBpLabel(locale))));
 }
 assert.ok(saved,'The actual turn persisted its checked answer');
}
console.log('Staff Zoe unverified BP checks passed');
