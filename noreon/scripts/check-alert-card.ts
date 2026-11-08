import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {alertCardFields} from '@/lib/staff/alert-card';
import {alertReasons,alertSources,alertReason,type CareAlert} from '@/lib/care-alerts/contracts';
import {RED_FLAG_REGISTRY} from '@/lib/clinical/rules/rules';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {DayItemCards,dayItems} from '@/components/staff/doctor-workspace/day-cards';
import {RecordCard,ZoeAnswer} from '@/components/staff/zoe/answer';
import {openItemsResult} from '@/lib/staff-zoe/facts';
import {answerContentSchema,toolResultSchema} from '@/lib/staff-zoe/contracts';
import {factLine} from '@/lib/staff-zoe/check';
import {staffReviewStep,staffCodeLabel} from '@/lib/staff/display-text';
import {AlertCardLines} from '@/components/staff/alert-card';
import type {DoctorDay} from '@/lib/doctor-inbox/day';

const alertFixture:CareAlert={id:'11111111-1111-4111-8111-111111111111',memberId:'22222222-2222-4222-8222-222222222222',memberName:'Fictional member',source:'message',priority:'urgent',reason:'urgent_words_matched',redFlags:[],state:'open',stateSeq:1,occurrences:1,createdAt:'2026-11-04T05:06:00Z',lastSeenAt:'2026-11-04T07:08:00Z',doctorName:null,acknowledgedAt:null,acknowledgedBy:null,resolvedAt:null,resolvedBy:null,resolution:null,resolutionNote:null,telegram:[]};
const forbiddenAlertCopy=/RF-\d|_|care_alert|NRN|zoe\.|rule/i;
// Pin the enumeration to the actual reason table, so new labels cannot miss this check.
const cases=[...readFileSync('lib/care-alerts/contracts.ts','utf8').matchAll(/case '([^']+)'/g)].map(m=>m[1]);
assert.deepEqual([...alertReasons].sort(),cases.sort());
for(const locale of ['en','hy','ru'] as const){
 for(const reason of [...alertReasons,'future_reason_code','NRN-RULE-unknown','zoe.new_reason']){
  for(const redFlags of [[],...RED_FLAG_REGISTRY.map(r=>[r.id]),RED_FLAG_REGISTRY.map(r=>r.id),['RF-99']]){
   const fields=alertCardFields({...alertFixture,reason,redFlags},locale);
   assert.deepEqual(Object.keys(fields).sort(),['symptom','onset','severity','source','next','count','owner','escalation','acknowledgement','recordedAction'].sort());
   assert.doesNotMatch(Object.values(fields).join(' '),forbiddenAlertCopy,`${locale}/${reason}/${redFlags.join(',')}`);
   for(const key of ['symptom','onset','severity','source','next'] as const)assert.ok(fields[key]);
  }
 }
 assert.equal(alertCardFields({...alertFixture,reason:'future_rule_code'},locale).next,staffReviewStep(locale),'Unknown triggers ask for review without invented policy');
 for(const source of alertSources)assert.ok(alertCardFields({...alertFixture,source},locale).source);
 for(const flag of RED_FLAG_REGISTRY){
  assert.ok(alertCardFields({...alertFixture,reason:'questionnaire_red_flag',redFlags:[flag.id]},locale).symptom.includes(staffCodeLabel(flag.id,locale)),'A code inside a source sentence becomes a neutral label');
 }
 for(const source of {
  en:['RF-01 was ruled out. No current chest pain.','RF-01 occurred last year. No symptoms now.'],
  hy:['RF-01-ը բացառվել է։ Հիմա կրծքավանդակի ցավ չկա։','RF-01-ը եղել է անցյալ տարի։ Հիմա ախտանիշներ չկան։'],
  ru:['RF-01 исключён. Сейчас боли в груди нет.','RF-01 был в прошлом году. Сейчас симптомов нет.'],
 }[locale]){
  const fields=alertCardFields({...alertFixture,nextAction:source},locale);
  assert.ok(fields.recordedAction?.startsWith(source.replace('RF-01',staffCodeLabel('RF-01',locale))),'Recorded staff actions preserve negation and history');
  assert.doesNotMatch(fields.recordedAction!,/103|Suggested step|Առաջարկվող քայլ|Предлагаемый шаг/,'Recorded staff words never gain guidance');
 }
 assert.equal(alertCardFields({...alertFixture,reason:'questionnaire_unknown_rule'},locale).symptom,alertCardFields({...alertFixture,reason:'future_reason_code'},locale).symptom);
 assert.equal(alertCardFields(alertFixture,locale).symptom,alertReason(alertFixture,locale),'Reuse the existing message label');
 assert.equal(alertCardFields({...alertFixture,reason:'zoe_self_harm'},locale).symptom,alertReason({...alertFixture,reason:'zoe_self_harm'},locale));
 assert.doesNotThrow(()=>alertCardFields({...alertFixture,createdAt:'invalid',lastSeenAt:'invalid',occurrences:2},locale));
 const acknowledged=alertCardFields({...alertFixture,state:'acknowledged',acknowledgedBy:'Doctor Example'},locale);
 assert.ok(acknowledged.next.includes('Doctor Example'));
 assert.ok(!alertCardFields({...alertFixture,state:'open',acknowledgedBy:'Earlier Doctor'},locale).next.includes('Earlier Doctor'),'A reopened alert needs contact again');
}
const first=alertCardFields(alertFixture,'en');
for(const [locale,suggested,recorded] of [['en','Suggested step','Next action'],['hy','Առաջարկվող քայլ','Հաջորդ գործողություն'],['ru','Предлагаемый шаг','Следующее действие']] as const){
 const plain=renderToStaticMarkup(createElement(AlertCardLines,{alert:alertFixture,locale}));
 assert.ok(plain.includes(`${suggested}: `),'Static guidance has its own label');
 assert.ok(!plain.includes(`${recorded}: `),'Static guidance is not a recorded next action');
 const saved=renderToStaticMarkup(createElement(AlertCardLines,{alert:{...alertFixture,nextAction:'Synthetic recorded step',nextActionBy:'Synthetic nurse',nextActionAt:alertFixture.lastSeenAt},locale}));
 assert.ok(saved.includes(`${recorded}: `)&&saved.includes('Synthetic recorded step · Synthetic nurse · '),'Recorded next action keeps its label, name and time');
}
const nurseBackup=alertCardFields({...alertFixture,ownerName:'Synthetic nurse',ownerRole:'nurse',doctorName:'Synthetic doctor',escalatedAt:alertFixture.createdAt,escalatedTo:'nurse'},'en');
assert.match(nurseBackup.escalation??'',/Synthetic nurse/,'Editable nurse-backup routing names the nurse');
assert.doesNotMatch(nurseBackup.escalation??'',/Synthetic doctor/,'A nurse escalation is never labelled as the doctor');
assert.equal(first.onset,'Since 04 Nov 2026, 09:06');
assert.equal(first.count,1);assert.equal(first.severity,'Urgent');
assert.equal(first.next,'Contact the member, then record what you did');
const repeat=alertCardFields({...alertFixture,occurrences:3},'en');
assert.equal(repeat.onset,'Since 04 Nov 2026, 09:06 · 3 times, last 11:08');
assert.equal(repeat.count,3);
assert.equal(alertCardFields({...alertFixture,state:'acknowledged',acknowledgedBy:'Doctor Example'},'en').next,'Acknowledged by Doctor Example. Record what you did when done');
assert.match(alertCardFields({...alertFixture,reason:'future_reason_code'},'en').symptom,/Urgent alert, open the conversation to read the member's words/);
assert.doesNotMatch(alertCardFields({...alertFixture,state:'resolved'},'en').next,/Contact/);

// Catch flattening an alert to a reason before either the day cards or Zoe can render it.
for(const locale of ['en','hy','ru'] as const){
 for(const reason of ['urgent_words_matched','future_reason_code']){
  for(const state of ['open','acknowledged'] as const){
   const alert={...alertFixture,reason,state,occurrences:3,acknowledgedBy:state==='acknowledged'?'Doctor Example':null};
   const day:DoctorDay={windows:[],urgentWindowsTotal:0,urgentCapped:false,inbox:{version:'doctor-inbox-v1',ok:true,asOf:alert.lastSeenAt,p0:[{id:`care_alert:${alert.id}`,memberId:alert.memberId,memberName:alert.memberName,lane:'P0',kind:'care_alert',rank:state==='open'?0:1,confidence:'rule',ai:'none',sources:[],at:alert.lastSeenAt,alert}],p0Total:1,items:[],laneCap:50,unavailable:[],zoeAnswered:[],zoeAnsweredTotal:0,nurseActivity:[]},firstNotes:null,ldl:null,medicines:null,tasks:null,handoffs:null};
   const items=dayItems(day,locale);
   assert.doesNotMatch(items[0].label,/future[ _]reason[ _]code/i,'Member summaries cannot expose unknown codes either');
   const card=toolResultSchema.parse(openItemsResult({inbox:day.inbox,tasks:[]},{memberId:alert.memberId,role:'doctor',locale,now:new Date(alert.lastSeenAt)}));
   const content=answerContentSchema.parse({version:'staff-zoe-1',state:'answered',say:card.facts.map(f=>({text:factLine(f),facts:[f]})),quotes:[],notKnown:[],declined:false,notice:null,cards:[]});
   for(const [surface,element] of [
    ['day',createElement(DayItemCards,{items,locale})],
    ['record',createElement(RecordCard,{card,locale,memberRef:'Member'})],
    ['answer',createElement(ZoeAnswer,{content,locale,memberRef:'Member'})],
   ] as const){
    const html=renderToStaticMarkup(element),text=html.replace(/<[^>]*>/g,'');
    assert.equal((html.match(/data-alert-field=/g)??[]).length,5,`${surface}/${locale}/${reason}/${state}: five labelled fields`);
    assert.doesNotMatch(text,/future[ _]reason[ _]code|RF-\d|care_alert|NRN|zoe\.|rule/i);
    assert.match(text,/3/,'Repeat count remains visible');
    assert.ok(html.includes('11:08'),'Last occurrence time remains visible');
    assert.equal(text.includes('Doctor Example'),state==='acknowledged','Acknowledgement survives the mapping');
   }
  }
 }
}
console.log('PASS alert card: all reason labels, registry flags, sources and locales; no codes; first/repeat times and workflow states');
