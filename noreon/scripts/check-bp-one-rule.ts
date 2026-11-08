// The one BP check (Armen's 2 Nov list, tasks 4 and 5) on every route: the rule, chat and Telegram text through the real pipeline,
// the form, week and card saves, the staff warning, the questionnaire's window and the history date. The database's send is
// scripts/check-bp-one-rule.sql; this file pins that its cuts match the rule's.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {BP_CHECK_VERSION,BP_REPEAT,bpDoctorToday,bpQuietNote,bpCheck,bpCheckReadings,bpIsRepeat,bpNeedsAction,bpVeryHigh} from '@/lib/clinical/rules/bp-check';
import {bpCareTeamLine,bpWaitingLine,BP_NURSE_GUIDANCE,BP_QUESTIONNAIRE_NEXT,BP_SOON,BP_STAFF_WARNING,bpRemeasureLine,bpSavedLine,bpSoonLine,bpTodayLine} from '@/lib/clinical/rules/bp-words';
import {consultationWindow,consultationWindowDays,evaluate} from '@/lib/clinical/rules/engine';
import {bloodPressureBand} from '@/lib/clinical/rules/derived';
import {RED_FLAG_REGISTRY} from '@/lib/clinical/rules/rules';
import type {Answers,FieldValue} from '@/lib/clinical/types';
import {THRESHOLD} from '@/lib/clinical/rules/thresholds';
import {alertReason,alertSources} from '@/lib/care-alerts/contracts';
import {inboxItemSchema,itemSummary} from '@/lib/doctor-inbox/contracts';
import {valueInputSchema,yerevanToday} from '@/lib/member-history/measures';
import {bpStepAfterSave} from '@/lib/patient/bp-after-save';
import {bpAwaitingRepeat,bpChatTurn,bpCurrentVeryHigh,bpSymptomAsserted} from '@/lib/zoe/bp-chat';
import {job,runPipeline} from '@/lib/zoe/eval/harness';
import {FIXED} from '@/lib/zoe/eval/conversation-scripts';
import {FREE_MODE_CONFIG} from '@/lib/zoe/free-mode-config';
import {BP_FAMILY} from '@/lib/zoe/eval/conversation-families-bmi-bp';
import {SAME_DAY_LINE,sameDayFloor,STATIN_PAUSE_LINE} from '@/lib/zoe/health-answer';

const r=(systolic:number,diastolic:number)=>({systolic,diastolic});
const was=(systolic:number,diastolic:number,minutesAgo:number)=>({systolic,diastolic,minutesAgo});

// 1. The rule. One table, the same rows as the database's in check-bp-one-rule.sql.
for(const [s,d,first,repeat] of [
 [179,109,'routine','routine'],[165,100,'routine','routine'],[180,80,'remeasure','doctor_today'],[120,110,'remeasure','doctor_48h'],
 [170,115,'remeasure','doctor_48h'],[179,119,'remeasure','doctor_48h'],[170,120,'remeasure','doctor_today'],[185,115,'remeasure','doctor_today'],[200,125,'remeasure','doctor_today'],
] as const){
 assert.equal(bpCheck(r(s,d),{repeat:false,symptoms:'no'}),first,`${s}/${d} first`);
 assert.equal(bpCheck(r(s,d),{repeat:true,symptoms:'no'}),repeat,`${s}/${d} repeat`);
 assert.equal(bpCheck(r(s,d),{repeat:true}),repeat,`${s}/${d} repeat, symptoms unknown, still goes to the doctor`);
 assert.equal(bpCheck(r(s,d),{repeat:false,symptoms:'yes'}),first==='routine'?'routine':'call_103',`${s}/${d} any symptom`);
}
// Either number counts for the same day (answers file, item 15): the 48-hour band is diastolic 110 to 119 with systolic below 180.
for(const [s,d,step] of [[180,100,'doctor_today'],[230,100,'doctor_today'],[185,115,'doctor_today'],[170,120,'doctor_today'],[170,125,'doctor_today'],[179,110,'doctor_48h'],[179,119,'doctor_48h']] as const)assert.equal(bpCheck(r(s,d),{repeat:true,symptoms:'no'}),step,`${s}/${d}`);
assert.ok(!bpIsRepeat([was(185,115,BP_REPEAT.restMinutes-1)]),'Inside the rest is not a repeat');
assert.ok(bpIsRepeat([was(185,115,BP_REPEAT.restMinutes)]));assert.ok(bpIsRepeat([was(185,115,BP_REPEAT.withinMinutes)]));
assert.ok(!bpIsRepeat([was(185,115,BP_REPEAT.withinMinutes+1)]),'Hours later is a new first reading');
assert.ok(!bpIsRepeat([was(150,90,10)]),'An ordinary earlier reading is not a first one');
assert.equal(bpCheckReadings(r(150,90),[was(185,115,10)]),'routine','A calm repeat ends it');

// One threshold everywhere: the old floor reads the rule's numbers, and the database repeats them.
assert.deepEqual(FREE_MODE_CONFIG.bpSameDay,{systolic:THRESHOLD.bpDoctorTodaySystolic,diastolic:THRESHOLD.bpDoctorTodayDiastolic});
const sql=readFileSync('supabase/migrations/20261103100100_bp_one_rule.sql','utf8');
const level=sql.slice(sql.indexOf('function public._bp_check_level'),sql.indexOf('create function public._bp_check_raise'));
assert.ok(level.includes(`s>=${THRESHOLD.crisisSystolic} or d>=${THRESHOLD.crisisDiastolic}`),'Very high range in SQL');
assert.ok(level.includes(`s>=${THRESHOLD.bpDoctorTodaySystolic} or d>=${THRESHOLD.bpDoctorTodayDiastolic}`),'Doctor today in SQL: either number');
assert.ok(sql.includes(`interval '${BP_REPEAT.withinMinutes} minutes' and new.measured_at-interval '${BP_REPEAT.restMinutes} minutes'`),'Repeat window in SQL');
assert.ok(sql.includes(`'${BP_CHECK_VERSION}'`),'Rule version in SQL');

// 2. Chat and Telegram text: the same pipeline. Fixed words, no model, nothing sent before the repeat.
const m=(seq:number,text:string,minutesAgo=0)=>({seq,text,minutesAgo});
const chat={enabled:true,doctorName:'Test Doctor',answeredThroughSeq:0,memberSpentTodayUsd:0,injectionsLast24h:0,locale:'en'as const};
const intake={enabled:true,registered:[],active:null,doctorName:'Test Doctor',latestReading:null,redFlagsAfterSeq:0};
const env={NOREON_ZOE_FREE_STYLE:'coach-first'};
const J=(messages:ReturnType<typeof m>[],o:Record<string,unknown>={})=>job(messages.map(x=>x.text),{messageSeq:messages.at(-1)!.seq,messages,healthAnswers:true,health:{bpWeek:null,labs:[],plan:null},intake,directAnswers:true,conversation:chat,...o} as never);
const run=(j:ReturnType<typeof J>)=>runPipeline(j,{directAnswers:true,env,fixtureRaw:JSON.stringify({reply:'A short answer.',urgency:'none',forward:'none',forward_reason:'none',summary:'s',language:'en'})});
const said=(x:Awaited<ReturnType<typeof run>>)=>x.finish?.answer??x.finish?.receipt?.text??'';

// A typed very high reading is saved at once, as the member's own, and only then does the reply say the doctor has it (Gohar's QA 267).
{
 for(const l of ['en','hy','ru'] as const){const t=bpCareTeamLine(l);assert.ok(t.length>10&&!/passed|փոխանց|передал/u.test(t),`${l}: the care team line claims nothing is done`);}
 type Save={seq:number;index:number;systolic:number;diastolic:number};
 type Port={saves:Save[];result?:{saved:boolean;notified:boolean}|'throw'};
 const withPort=(typedBp:Port,j:ReturnType<typeof J>)=>runPipeline(j,{directAnswers:true,env,typedBp,fixtureRaw:JSON.stringify({reply:'A short answer.',urgency:'none',forward:'none',forward_reason:'none',summary:'s',language:'en'})});
 const claim=/passed this to your doctor|passed this to Dr/;
 const saves:Save[]=[];
 const saved=await withPort({saves},J([m(1,'My blood pressure is 185/115',3)]));
 assert.deepEqual(saves,[{seq:1,index:0,systolic:185,diastolic:115}],'the typed reading is saved once, with its message and place in it');
 assert.equal(saved.reason,'bp_remeasure');assert.match(said(saved),claim,'saved and its note exists: the line stands');
 assert.ok(saved.events.some(e=>e.name==='zoe.bp_save'&&e.outcome==='recorded'&&e.reason==='typed_reading_saved'),'the save is traced');
 for(const result of [{saved:true,notified:false},{saved:false,notified:false},'throw'] as const){
  const bad:Save[]=[];
  const failed=await withPort({saves:bad,result},J([m(1,'My blood pressure is 185/115')]));
  assert.equal(failed.reason,'bp_remeasure',`${JSON.stringify(result)}: the step stands`);
  assert.doesNotMatch(said(failed),claim,`${JSON.stringify(result)}: no claim that the doctor has it when no note or alert row exists`);
  assert.match(said(failed),/very high/,`${JSON.stringify(result)}: the member still gets the repeat request`);
  assert.match(said(failed),/make sure your care team sees this/,`${JSON.stringify(result)}: she says the care team will see it, not that it is done`);
  assert.ok(failed.events.some(e=>e.name==='zoe.bp_save'),`${JSON.stringify(result)}: the save attempt is traced`);
 }
 // A first reading and its repeat in one unanswered batch: both are saved, oldest first, and the repeat's alert is what is claimed.
 const batch=[m(1,'185/115',10),m(2,'184/116')];
 const both:Save[]=[];
 const repeat=await withPort({saves:both},J(batch));
 assert.deepEqual(both,[{seq:1,index:0,systolic:185,diastolic:115},{seq:2,index:0,systolic:184,diastolic:116}],'a batch saves every very high reading in order');
 assert.equal(repeat.reason,'same_day_floor_bp_repeat');assert.match(said(repeat),claim);
 const repFail=await withPort({saves:[],result:{saved:true,notified:false}},J(batch));
 assert.match(said(repFail),/make sure your care team sees this/,'a repeat without its alert: the care team line, no claim');
 assert.doesNotMatch(said(repFail),claim,'a repeat whose alert does not exist does not claim the doctor has it');
 assert.match(said(repFail),/doctor today/,'it still says a doctor is needed today');
 // Only the member's own reading, now: another person, a past day or year is not put on their record.
 for(const text of ['She measured her blood pressure and got 185/115','In 2020 my blood pressure was 185/115','My blood pressure was 185/115 last Monday','My mother has 185/115',
  'Моё давление было 185/115 вчера','Մայրիկիս ճնշումը 185/115 է','У сестры давление 185/115','У брата давление 185/115','Քրոջս ճնշումը 185/115 է','185/115 on Monday',
  'My blood pressure is 185/115 on Monday','BP 185/115 for my neighbour','the doctor said 185/115 is high']){
  const none:Save[]=[];
  const r=await withPort({saves:none},J([m(1,text)]));
  assert.deepEqual(none,[],`not saved: ${text}`);
  assert.doesNotMatch(said(r),claim,`no claim for: ${text}`);
 }
 // What does go on the record: the member's own words, or the reading alone.
 for(const text of ['185/115','BP 185/115','Blood pressure 185/115 mmHg','My blood pressure is 185/115','I measured 185/115','Моё давление 185/115','Давление 185/115','Ճնշումս 185/115 է']){
  const some:Save[]=[];
  await withPort({saves:some},J([m(1,text)]));
  assert.equal(some.length,1,`saved: ${text}`);
 }
 // A calm reading is not saved here; a run with no port keeps the wording.
 const none:Save[]=[];await withPort({saves:none},J([m(1,'My blood pressure is 130/85')]));assert.equal(none.length,0,'an ordinary reading is not saved here');
 assert.match(said(await run(J([m(1,'My blood pressure is 185/115')]))),claim,'no port (practice, eval): the wording is unchanged');
}

for(const [s,d] of [[185,115],[170,115],[200,125]] as const){
 const first=await run(J([m(1,`${s}/${d}`)]));
 assert.equal(said(first),bpRemeasureLine('en',r(s,d))+(bpDoctorToday(r(s,d))?"\n\nI've also passed this to your doctor so they can see it.":'')+`\n\nMember-reported, not verified: ${s}/${d} mmHg.`,`${s}/${d}: a re-measure first, with the quiet note disclosed`);
 assert.equal(first.finish?.outcome,'summary_only');
 // 180 or more, or 120 or more: a quiet note at once, no alert and no 103. The band below sends nothing before the repeat.
 const quiet=bpDoctorToday(r(s,d));
 assert.deepEqual([first.finish?.health?.urgency,first.finish?.health?.forward,first.finish?.health?.forwardReason],quiet?['doctor_soon','auto','bp_repeat_pending']:[undefined,undefined,undefined],`${s}/${d}: quiet note`);
 assert.equal(/repeat pending/.test(first.finish?.summary??''),quiet);assert.equal(bpQuietNote(r(s,d),'remeasure'),quiet);
 assert.equal(first.providerCalls.length,0,'No model on a fixed line');
}
// Retest 623: every natural family wording, both cuts, named and unnamed doctor, all receipt languages.
const passed={en:(name:boolean)=>`I've also passed this to ${name?'Dr Armen':'your doctor'} so they can see it.`,
 hy:(name:boolean)=>`Սա փոխանցեցի նաև ${name?'բժիշկ Armen-ին':'ձեր բժշկին'}, որպեսզի տեսնի։`,
 ru:(name:boolean)=>`Я также передала это ${name?'доктору Armen':'вашему врачу'}.`};
for(const family of BP_FAMILY)for(const name of [true,false])for(const pair of [null,'180/100','170/120','179/119']as const){
 const original=family.turns[0]!.text as string;
 const text=pair?original.replace(/\d{3}(?:\/| over )\d{3}/u,pair):original;
 const result=await run(J([m(1,text)],{conversation:{...chat,doctorName:name?'Dr Armen':null,locale:family.locale},intake:{...intake,doctorName:name?'Dr Armen':null}}));
 assert.equal(result.reason,'bp_remeasure',text);
 const line=passed[result.finish!.receipt!.language](name),quiet=pair!=='179/119';
 assert.equal(said(result).split(line).length-1,quiet?1:0,`${text}: disclosure exactly once only at same-day cut`);
 assert.equal(result.finish?.health?.forward,quiet?'auto':undefined);
 assert.equal(result.providerCalls.length,0);
 assert.doesNotMatch(said(result),/one working day|աշխատանքային|рабочего дня/u,'No reply-time promise before the repeat');
}

const repeatJob=(s:number,d:number,gap=6,text=`now ${s}/${d}`)=>J([m(1,'185/115',gap),m(2,text)],{answers:[{body:bpRemeasureLine('en',r(185,115)),minutesAgo:gap-1}],conversation:{...chat,answeredThroughSeq:1}});
const today=await run(repeatJob(186,122));
assert.equal(said(today),bpTodayLine('en',true),'Repeat at 180/120: doctor today, no careful line');assert.doesNotMatch(said(today),/want to be careful|103/,'The re-measure line named the 103 symptoms once');
assert.deepEqual([today.finish?.health?.urgency,today.finish?.health?.forward,today.finish?.health?.forwardReason],['same_day','auto','same_day'],'Doctor today is sent automatically');
const band=await run(J([m(1,'170/115',6),m(2,'now 172/114')],{answers:[{body:bpRemeasureLine('en',r(170,115)),minutesAgo:5}],conversation:{...chat,answeredThroughSeq:1}}));
assert.equal(said(band),bpSoonLine('en',true),'Repeat in the band: 48 hours');assert.doesNotMatch(said(band),/103/,'No second 103 line');
assert.deepEqual([band.finish?.health?.urgency,band.finish?.health?.forward,band.finish?.health?.forwardReason],['doctor_soon','auto','bp_repeat_high'],'The band is sent automatically too');
const soon=await run(repeatJob(186,122,2));
assert.equal(said(soon),bpRemeasureLine('en',r(186,122))+'\n\nMember-reported, not verified: 186/122 mmHg.','Too soon: rest first');assert.equal(soon.finish?.health?.forward,undefined,'No second quiet note');
const calmer=await run(repeatJob(150,90));
assert.notEqual(calmer.finish?.health?.forward,'auto','A calmer repeat sends nothing');assert.ok(!said(calmer).includes(SAME_DAY_LINE.en),'A calmer repeat is not same-day');

// Any symptom: 103, at once and when told after Zoe asked. In all three languages, with the rule's four symptoms.
const is103=(x:Awaited<ReturnType<typeof run>>)=>/103/u.test(said(x))&&['intake_escalated','discarded'].includes(x.finish?.outcome??'');
assert.ok(is103(await run(J([m(1,'192/114 and I have a headache')]))),'Reading with a symptom');
for(const t of ['I have a headache','my vision is blurred','I have chest pain','I feel weak','голова болит','слабость и боль в груди','գլխացավ ունեմ','թուլություն ունեմ','krcqis cav ka']){
 assert.ok(bpSymptomAsserted(t),`Symptom read: ${t}`);
 assert.ok(is103(await run(J([m(1,'192/114',3),m(2,t)],{answers:[{body:bpRemeasureLine('en',r(192,114)),minutesAgo:2}],conversation:{...chat,answeredThroughSeq:1}}))),`Symptom after a typed reading: ${t}`);
}
// And no false 103: a denied symptom or an unrelated complaint after a typed reading stays below it.
for(const t of ['no headache, no chest pain','I have a cough','my knee hurts','not weak at all','нет головной боли']){
 assert.ok(!bpSymptomAsserted(t),`Not the rule's symptom: ${t}`);
 const x=await run(J([m(1,'192/114',3),m(2,t)],{answers:[{body:bpRemeasureLine('en',r(192,114)),minutesAgo:2}],conversation:{...chat,answeredThroughSeq:1}}));
 assert.ok(!is103(x),`No false 103: ${t}`);
}
assert.equal(bpCurrentVeryHigh([m(1,'192/114',BP_REPEAT.withinMinutes+1)],null),null,'An old typed reading no longer counts with a symptom');
assert.equal(bpCurrentVeryHigh([m(1,'192/114',9),m(2,'sorry, typo: 125/85',8)],null),null,'A correction ends it');
assert.equal(bpCurrentVeryHigh([m(1,'192/114',9)],was(125,85,3)),null,'A calmer saved reading ends it');
assert.ok(bpCurrentVeryHigh([m(1,'192/114',9)],was(125,85,60)),'An older calm reading does not');
assert.ok(bpCurrentVeryHigh([m(1,'today 185/115, yesterday 150/90')],null),'The clause with today counts');

// BP-02: only the member's newest current reading. No false 103, the rule that matters most, and genuine ones stay.
const afterFirst=(first:string,next='I have a mild headache',o:Record<string,unknown>={})=>run(J([m(1,first,3),m(2,next)],{answers:[{body:'Thanks for telling me.',minutesAgo:2}],conversation:{...chat,answeredThroughSeq:1},...o}));
// A comma must not turn a past or quoted number into a current reading for the next turn.
for(const first of ['Yesterday, my BP was 192/114','The leaflet says, 192/114 is high','Yesterday, after resting, my BP was 192/114','The leaflet says, after resting, 192/114 is high']){
 assert.equal(bpCurrentVeryHigh([m(1,first)],null),null,`Not current across clauses: ${first}`);
 assert.ok(!is103(await afterFirst(first)),`No false 103 after: ${first}`);
 assert.notEqual((await run(J([m(1,first)]))).reason,'bp_remeasure',`Not asked to repeat: ${first}`);
}
for(const first of ['Yesterday it was 120/80, today 192/114','Yesterday, my BP was 120/80, now 192/114','The leaflet says, 120/80 is normal, but today my BP is 192/114','Yesterday it was 120/80, but I just measured 192/114','Yesterday it was 120/80, I just checked my BP, 192/114']){
 assert.deepEqual(bpCurrentVeryHigh([m(1,first)],null),was(192,114,0),`Later current reading: ${first}`);
 assert.ok(is103(await afterFirst(first)),`Current reading then a symptom stays 103: ${first}`);
}
for(const first of ['yesterday it was 192/114','my father has 192/114','his BP was 192/114 last week','the leaflet says 192/114 is high','вчера было 192/114','у папы 192/114','երեկ 192/114 էր','my BP was 192/114 three days ago'])assert.ok(!is103(await afterFirst(first)),`No false 103 after: ${first}`);
assert.ok(!is103(await afterFirst('192/114','sorry, it was 125/85 and I have a mild headache')),'A correction in the same message');
assert.ok(!is103(await afterFirst('192/114','that was a typo')),'Taken back in words');
assert.ok(!is103(await run(J([m(1,'192/114',4),m(2,'sorry, that was wrong',3),m(3,'I have a mild headache')],{answers:[{body:'Thanks.',minutesAgo:2}],conversation:{...chat,answeredThroughSeq:2}}))),'Taken back, then a symptom');
assert.ok(is103(await afterFirst('my BP is 192/114')),'A current reading then a symptom stays 103');
assert.ok(is103(await afterFirst('192/114 now','I have a headache',{health:{bpWeek:null,labs:[],plan:null}})),'Genuine, in another wording');
// In one message too, with the real urgent list on, and a carer's emergency still goes to 103.
const listed=(t:string)=>runPipeline(J([m(1,t)]),{directAnswers:true,env:{NOREON_ZOE_FREE_STYLE:'coach-first',NOREON_ZOE_TEST_LEXICON:'false',NOREON_ZOE_URGENT_PLACEHOLDER:'true'},fixtureRaw:JSON.stringify({reply:'A short answer.',urgency:'none',forward:'none',forward_reason:'none',summary:'s',language:'en'})});
for(const t of ['Yesterday it was 192/114. Today I have a mild headache','my father has 192/114 and I have a headache','the leaflet says 192/114 is dangerous, I have a mild headache','my BP was 192/114 last week, now I have a headache']){assert.ok(!is103(await run(J([m(1,t)]))),`No false 103: ${t}`);assert.ok(!is103(await listed(t)),`No false 103 on the urgent list: ${t}`);}
for(const t of ['my father has 192/114 and he has a bad headache','my BP is 192/114 and I have a headache']){assert.ok(is103(await run(J([m(1,t)]))),`Stays 103: ${t}`);assert.ok(is103(await listed(t)),`Stays 103 on the urgent list: ${t}`);}
for(const t of ['Yesterday, my BP was 192/114, and I have a mild headache','The leaflet says, 192/114 is high, and I have a mild headache']){
 assert.ok(!is103(await run(J([m(1,t)]))),`No false 103 across clauses: ${t}`);
 assert.ok(!is103(await listed(t)),`No false 103 across clauses on the urgent list: ${t}`);
}
for(const t of ['Yesterday it was 120/80, today 192/114 and I have a mild headache','The leaflet says, 120/80 is normal, but now my BP is 192/114 and I have a mild headache']){
 assert.ok(is103(await run(J([m(1,t)]))),`Later current reading stays 103: ${t}`);
 assert.ok(is103(await listed(t)),`Later current reading stays 103 on the urgent list: ${t}`);
}
for(const t of ['yesterday it was 192/114','my father has 192/114','the leaflet says 192/114 is high'])assert.notEqual((await run(J([m(1,t)]))).reason,'bp_remeasure',`Not asked to repeat: ${t}`);

// BP-01: another same-day matter keeps its level and forward beside the repeat step.
// Astra MERGE-01: past chest pain keeps its coming-days floor and forward beside the repeat step; a current one is still 103.
{const lex={NOREON_ZOE_FREE_STYLE:'coach-first',NOREON_ZOE_TEST_LEXICON:'false',NOREON_ZOE_URGENT_PLACEHOLDER:'true'};
 const runLex=(t:string)=>runPipeline(J([m(1,t)]),{directAnswers:true,env:lex,fixtureRaw:JSON.stringify({reply:'A short answer.',urgency:'none',forward:'none',forward_reason:'none',summary:'s',language:'en'})});
 const chest=await runLex('My BP is 170/115. Chest pain last week, not now.');
 assert.equal(chest.finish?.health?.urgency,'doctor_soon','chest past: coming days');assert.equal(chest.finish?.health?.forward,'auto','chest past: forwarded');
 assert.ok(chest.finish?.receipt?.text.includes(bpRemeasureLine('en',r(170,115)).split('\n')[0]!),'chest past: the repeat step stays');
 const quietChest=await runLex('My BP is 190/120. Chest pain last week, not now.');
 assert.equal(quietChest.reason,'bp_remeasure_chest_soon');
 assert.equal(said(quietChest).split(passed.en(false)).length-1,1,'The chest receipt discloses the quiet note once');
 assert.ok(is103(await runLex('My BP is 170/115. I have chest pain right now.')),'a current chest pain is still 103');}
const both=await run(J([m(1,'BP 170/115, glucose 16.8 mmol/L, very thirsty')]));
assert.deepEqual([both.finish?.health?.urgency,both.finish?.health?.forward,both.finish?.health?.forwardReason],['same_day','auto','same_day'],'Same-day stays with a high reading');
assert.ok(said(both).includes(SAME_DAY_LINE.en)&&said(both).includes(bpRemeasureLine('en',r(170,115))),'Both are said');
assert.equal((await run(J([m(1,'BP 170/115, potassium 6.3')]))).finish?.health?.urgency,'same_day','A lab floor too');
for(const test of [
 J([m(1,'BP 190/120, glucose 16.8 mmol/L, very thirsty')]),
 J([m(1,'BP 190/120')],{health:{bpWeek:null,labs:[{marker:'ALT',value:160,unit:'U/L',low:null,high:40,daysAgo:0,reviewed:false,arrivedMinutesAgo:1}],plan:null}}),
]){
 const result=await run(test);
 assert.equal(said(result).split(passed.en(false)).length-1,1,'The same-day and lab receipts already disclose the note exactly once');
 assert.equal(result.finish?.health?.forward,'auto');
}


// Merge regressions: the BP fixed step cannot bypass the batch's lab or statin floors, on either channel.
for(const viaTelegram of [false,true]){
 const labs=(marker:string,value:number,unit:string,high:number|null=null)=>({bpWeek:null,labs:[{marker,value,unit,low:null,high,daysAgo:0,reviewed:false,arrivedMinutesAgo:1,...(marker==='CK'?{muscleSymptoms:true}:{})}],plan:null});
 for(const health of [labs('Sodium',120,'mmol/L'),labs('CK',1100,'U/L',100)]){
  for(const repeat of [false,true]){
   const j=repeat?repeatJob(186,122):J([m(1,'170/115')]);
   const result=await run({...j,viaTelegram,health});
   assert.equal(result.finish?.health?.urgency,'same_day','A critical saved result keeps today');
   assert.equal(result.finish?.health?.forward,'auto');assert.equal(result.providerCalls.length,0);
   if(health.labs[0]!.marker==='CK')assert.ok(said(result).includes(STATIN_PAUSE_LINE.en),'The CK statin sentence survives the BP exit');
  }
 }
 const soon=await run(J([m(1,'170/115')],{viaTelegram,health:labs('ALT',160,'U/L',40)}));
 assert.equal(soon.finish?.health?.urgency,'doctor_soon','The coming-days lab floor survives a re-measure');
 assert.equal(soon.finish?.health?.forward,'auto');assert.equal(soon.finish?.health?.forwardReason,'critical_lab');
 assert.ok(said(soon).includes(bpRemeasureLine('en',r(170,115))));
 const statin=await run(J([m(1,'I take atorvastatin',5),m(2,'BP 170/115, my urine went dark today')],{viaTelegram,conversation:{...chat,answeredThroughSeq:1}}));
 assert.equal(statin.finish?.health?.urgency,'same_day','A statin in an earlier message still raises the floor');
 assert.equal(statin.finish?.health?.forward,'auto');
 const urgent=await run(J([m(1,'170/115 and I have a headache')],{viaTelegram,health:labs('Sodium',120,'mmol/L')}));
 assert.ok(is103(urgent),'The urgent route still precedes the BP and lab steps');
}

// BP-03: the rule's symptoms in all four languages, in the same message and across turns, with denials.
for(const t of ['headache','blurred vision','chest pain','weakness','glxacav unem','glxatsav unem','glkhacav unem','glkhatsav unem','gluxs cavum e','tesoxutyun','tesoxutyuns vatacel e','krcqis cav unem','tulutyun unem','գլխացավ ունեմ','տեսողությունս վատացել է','կրծքիս ցավ ունեմ','թուլություն ունեմ','болит голова','зрение ухудшилось','боль в груди','слабость']){
 assert.ok(bpSymptomAsserted(t),`The rule reads the symptom: ${t}`);
 assert.ok(is103(await run(J([m(1,`170/115 ${t}`)]))),`Same message: ${t}`);
 assert.ok(is103(await run(J([m(1,'170/115',3),m(2,t)],{answers:[{body:bpRemeasureLine('en',r(170,115)),minutesAgo:2}],conversation:{...chat,answeredThroughSeq:1}}))),`Across turns: ${t}`);
}
for(const t of ['no headache','no chest pain','glxacav chka','glxatsav chka','glkhacav chunem','glkhatsav chunem','chunem glxatsav','gluxs chi cavum e','tesoxutyuns chi vatacel','tulutyun chunem','գլխացավ չունեմ','թուլություն չկա','голова не болит','слабости нет','нет боли в груди']){
 assert.ok(!bpSymptomAsserted(t),`The rule reads the denial: ${t}`);
 assert.equal((await run(J([m(1,`170/115 ${t}`)]))).reason,'bp_remeasure',`Denied: ${t}`);
 assert.ok(!is103(await afterFirst('170/115',t)),`No false 103 after a denial: ${t}`);
}

// A saved reading in chat: asked once per reading, never same-day before a repeat; an open alert means it already went.
const saved=(o:Record<string,unknown>={})=>({intake:{...intake,latestReading:{systolic:185,diastolic:115,minutesAgo:60}},health:{bpWeek:{count:1,avgSystolic:185,avgDiastolic:115,latest:{systolic:185,diastolic:115,daysAgo:0}},labs:[],plan:null},...o});
const asked=await run(J([m(1,'thanks')],saved()));
assert.equal(said(asked),bpRemeasureLine('en',r(185,115)));assert.equal(asked.finish?.health?.forward,undefined);
const after=await run(J([m(2,'thanks')],saved({answers:[{body:said(asked),minutesAgo:1}]})));
assert.notEqual(said(after),said(asked),'Once per reading');assert.notEqual(after.finish?.health?.urgency,'same_day');
assert.equal(bpChatTurn({unanswered:[m(1,'thanks')],earlier:[],stored:was(185,115,60),told:[],openAlert:true}),null,'A confirmed saved reading is not asked again');
assert.equal((bpChatTurn({unanswered:[m(1,'now 184/114')],earlier:[],stored:was(185,115,20),told:[],openAlert:false}))?.step,'doctor_today','A typed repeat of a saved reading');
// The replay: while a repeat is awaited the model and the judge are told, and a held reply is not the careful line.
assert.ok(bpAwaitingRepeat([m(1,'185/115',3),m(2,'ok')],null,[{body:bpRemeasureLine('hy',r(185,115)),minutesAgo:2}]));assert.ok(!bpAwaitingRepeat([m(1,'185/115',3),m(2,'now 150/90')],null,[{body:bpRemeasureLine('en',r(185,115)),minutesAgo:2}]));
const pending=await runPipeline(J([m(1,'185/115',3),m(2,'is it ok to walk this evening?')],{answers:[{body:bpRemeasureLine('en',r(185,115)),minutesAgo:2}],conversation:{...chat,answeredThroughSeq:1}}),{directAnswers:true,env,fixtureRaw:JSON.stringify({reply:'Rest first.',urgency:'none',forward:'none',forward_reason:'none',summary:'s',language:'en'})});
assert.ok(pending.providerCalls.some(c=>c.memberBlock.includes('<bp_repeat_pending>')),'The model is told');assert.ok(pending.judgeCalls.every(c=>c.memberBlock.includes('already asked the member to rest')),'The judge is told');
const held=await runPipeline(J([m(1,'185/115',3),m(2,'is it ok to walk?')],{answers:[{body:bpRemeasureLine('en',r(185,115)),minutesAgo:2}],conversation:{...chat,answeredThroughSeq:1}}),{directAnswers:true,env,provider:null});
assert.ok(said(held).endsWith(bpWaitingLine('en')),'A reply that cannot go out keeps the step, never the careful line');
// The replay: the check's own forward reasons are set in code. In the model's list it copied them and failed the schema into the careful line.
assert.ok(!FREE_MODE_CONFIG.autoForwardReasons.some(x=>x.startsWith('bp_')),'Not offered to the model');
const given=await runPipeline(J([m(1,'170/115',9),m(2,'now 172/114',3),m(3,'thanks')],{answers:[{body:bpRemeasureLine('en',r(170,115)),minutesAgo:8},{body:bpSoonLine('en',true),minutesAgo:2}],conversation:{...chat,answeredThroughSeq:2}}),{directAnswers:true,env,fixtureRaw:JSON.stringify({reply:'You are welcome.',urgency:'none',forward:'none',forward_reason:'none',summary:'s',language:'en'})});
assert.ok(given.providerCalls.some(c=>c.memberBlock.includes('<bp_level_given>')),'The level stands after a thanks');
// Doctor mode keeps the fixed floor, and the floor itself still reads a typed reading for the safety lists.
assert.ok(sameDayFloor(['186/122'],null));assert.ok(!sameDayFloor(['186/122'],null,[],{bp:false}));

// 3. The form, the BP week and the cards, in the app and on Telegram: one helper after the save.
const at=new Date('2026-11-02T10:00:00Z'),ago=(min:number)=>new Date(at.getTime()-min*60000).toISOString();
const rows=(...x:[number,number,number][])=>async()=>x.map(([systolic,diastolic,min])=>({systolic,diastolic,measuredAt:ago(min)}));
assert.equal(await bpStepAfterSave(rows([150,90,0]),null,{...r(150,90),measuredAt:ago(0)},at),'routine','Below the rule reads nothing further');
assert.equal(await bpStepAfterSave(rows([185,115,0]),null,{...r(185,115),measuredAt:ago(0)},at),'remeasure','First saved reading');
assert.equal(await bpStepAfterSave(rows([170,115,0],[172,114,10]),null,{...r(170,115),measuredAt:ago(0)},at),'doctor_48h','A saved repeat in the band');
assert.equal(await bpStepAfterSave(rows([190,125,0],[188,121,10]),'member',{...r(190,125),measuredAt:ago(0)},at),'doctor_today','A saved repeat at 180/120');
assert.equal(await bpStepAfterSave(rows(),null,{...r(190,125),measuredAt:ago(25*60)},at),'routine','A back-dated entry is not a reading now');
assert.equal(await bpStepAfterSave(async()=>{throw new Error('down');},null,{...r(190,125),measuredAt:ago(0)},at),'remeasure','Unreadable: still rest and repeat');
for(const l of ['en','hy','ru'] as const){
 assert.ok(bpSavedLine(l,'remeasure',r(185,115))!.includes('185/115'));assert.ok(bpSavedLine(l,'remeasure',r(185,115))!.includes('103'));
 assert.equal(bpSavedLine(l,'doctor_48h',r(170,115)),bpSoonLine(l,false),'A saved route does not claim a send it cannot see');assert.equal(bpSavedLine(l,'doctor_today',r(190,125)),bpTodayLine(l));assert.ok(bpTodayLine(l).includes('103')&&bpSoonLine(l,false).includes('103'),'A saved route names the symptoms');
 assert.equal(bpSavedLine(l,'routine',r(120,80)),null);
}
assert.ok(bpNeedsAction('remeasure'));assert.ok(!bpNeedsAction('routine'));assert.ok(!bpNeedsAction(undefined));
const src=(p:string)=>readFileSync(p,'utf8');
assert.ok(src('components/patient/measurement-form.tsx').includes('bpSavedLine('),'Form shows the check');
assert.ok(src('components/bp-week/week-controls.tsx').includes('bp: r.bp'),'BP week passes it to the form');
assert.ok(src('components/patient/zoe-cards.tsx').includes('bpSavedLine('),'App card shows the check');
assert.ok(src('lib/zoe-chat-actions/telegram.ts').includes('bpSavedLine('),'Telegram card shows the check');
for(const f of ['app/patient/actions.ts','lib/bp-week/actions.ts','lib/telegram-runtime/cards.ts'])assert.ok(src(f).includes('bpStepAfterSave('),`${f} runs the check after saving`);

// 4. The nurse and doctor screens warn, and the reading reaches the doctor (the database's trigger, in the SQL check).
for(const f of ['components/staff/nurse-visit-actions.tsx','components/staff/care-tasks.tsx','components/staff/visit-evidence.tsx','components/staff/doctor-workspace/observations-card.tsx'])assert.ok(src(f).includes('<BpHighWarning'),`${f} warns`);
for(const l of ['en','hy','ru'] as const){assert.ok(BP_STAFF_WARNING[l].includes('103'));assert.match(BP_STAFF_WARNING[l],/5/u);}
assert.ok(alertSources.includes('reading'));
assert.match(alertReason({reason:'bp_doctor_48h',redFlags:['RF-06']},'en'),/within 48 hours/);assert.match(alertReason({reason:'bp_doctor_today',redFlags:['RF-06']},'en'),/today/);

// The note's other half: the database's table and read, the doctor's inbox line, and the nurse wording in one place.
assert.ok(sql.includes('public.bp_check_retries')&&src('lib/care-alerts/server.ts').includes("retry('bp_check_retry')"),'A failed send has a retry on the sweep');
assert.ok(sql.includes('create table public.bp_repeat_notes')&&src('lib/doctor-inbox/day.ts').includes("doctor_bp_repeat_notes"),'The note reaches the doctor\'s day');
const note={id:'bp_repeat:1',lane:'P3',kind:'bp_repeat_pending',rank:3,memberId:'bb000000-0000-4000-8000-000000000001',memberName:'Fictional',at:'2026-11-02T10:00:00Z',confidence:'rule',ai:'none',systolic:185,diastolic:115,sources:[{type:'measurement',ref:'x'}]};
assert.match(itemSummary(inboxItemSchema.parse(note),'en'),/185\/115, repeat pending/);
assert.equal(inboxItemSchema.parse(note).lane,'P3','A quiet note, never P0');
for(const l of ['en','hy'] as const)assert.ok(sql.includes(BP_NURSE_GUIDANCE[l].replaceAll("'","''")),`The checklist row says the same (${l})`);
assert.ok(src('components/staff/nurse-urgent-guidance.tsx').includes('BP_NURSE_GUIDANCE['),'The guidance uses the same words');

// 5. The questionnaire: same range, same window, no "one week".
const rf06=RED_FLAG_REGISTRY.find(x=>x.id==='RF-06')!;
assert.deepEqual(rf06.nextStep,BP_QUESTIONNAIRE_NEXT);
for(const l of ['en','hy','ru'] as const){assert.ok(rf06.nextStep[l]!.includes(BP_SOON[l]));assert.doesNotMatch(rf06.nextStep[l]!,/one week|շաբաթ|недел/u);}

// Armen's message 588: the window line and the next step agree on the same result, for BP and HbA1c; 160/100 is yellow.
const answersOf=(values:Record<string,FieldValue>)=>Object.fromEntries(Object.entries(values).map(([fieldId,value])=>[fieldId,{fieldId,value,source:'manual',answeredAt:'2026-11-02T00:00:00Z'}])) as Answers;
const of=(values:Record<string,FieldValue>)=>evaluate({answers:answersOf(values),observations:[]});
const bpQ=(s:number,d:number,sym:string)=>({'q5.last_reading.systolic':s,'q5.last_reading.diastolic':d,'q5.crisis_symptoms':[sym]});
for(const [s,d] of [[186,112],[170,115],[190,125]] as const){const days=bpDoctorToday(r(s,d))?0:2;const x=of(bpQ(s,d,'none'));assert.equal(x.urgency,'orange');assert.equal(consultationWindowDays(x),days,`${s}/${d} window`);assert.match(consultationWindow(x).en!,days===0?/today/:/48 hours/);}
assert.equal(of(bpQ(190,125,'headache')).urgency,'red','103 only with symptoms');
const a1c=of({'q6.conditions':['diabetes'],'q6.diabetes_years':9,'q6.hba1c':9.5});
assert.equal(consultationWindowDays(a1c),7,'HbA1c 9% or more: one week');assert.match(consultationWindow(a1c).en!,/within 1 week/);
assert.match(a1c.findings.find(f=>f.ruleId==='RF-11')!.nextStep?.en??'',/one week/,'The next step says the same');
assert.equal(consultationWindowDays(of({'q6.conditions':['diabetes'],'q6.diabetes_years':9,'q6.hba1c':9.5,...bpQ(184,104,'none')})),0,'With RF-06 the sooner window wins');
assert.equal(bloodPressureBand(answersOf({'q5.last_reading.systolic':165,'q5.last_reading.diastolic':102}))?.tone,'yellow','160/100 is yellow');
assert.equal(of(bpQ(165,102,'none')).urgency,'yellow');
// P40(e): "no symptoms" is not a symptom.
assert.equal((await run(J([m(1,'185/100, no symptoms, I feel fine')]))).reason,'bp_remeasure','103 only with symptoms');

// 6. History: a real date, and a past one for blood pressure.
const hist=(measuredOn:string,measure='bp',o={})=>valueInputSchema.safeParse({measure,value:measure==='bp'?150:6,value2:measure==='bp'?90:null,unit:measure==='bp'?'mmHg':'%',measuredOn,...o}).success;
assert.ok(!hist(''),'No date, no save');assert.ok(!hist('not a date'));assert.ok(!hist(yerevanToday()),'An old value cannot take today\'s date');assert.ok(hist('2026-01-15'),'A real past date saves');
assert.ok(bpVeryHigh(r(180,109))&&bpVeryHigh(r(179,110))&&!bpVeryHigh(r(179,109)));

// 7. The replays exist with the right expectations.
for(const id of ['en-185-115-remeasure','hy-170-115-remeasure','ru-192-114-headache'])assert.ok(FIXED.some(c=>c.id===id),`Replay ${id}`);
console.log('One BP rule: table, chat and Telegram text, saves, staff screens, questionnaire window and history date all pass.');
