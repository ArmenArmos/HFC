import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {journeyStages,currentStage,programmeDay} from '@/lib/programme/stages';
import {memberTimelineSchema,doctorMemberSchema,checkinCommandSchema} from '@/lib/programme/schema';
import {REPEAT_TEST_RULES} from '@/lib/programme/repeat-tests';
// Programme timeline (J1): one ordered journey, exactly one "now", dates from the database only,
// never a "done" step from a failed read; offsets and repeat intervals are never hard-coded.
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const cp=(kind:'week4_review'|'month3'|'month6',over:Record<string,unknown>={})=>({id:id(kind.length),kind,dueOn:kind==='week4_review'?'2026-02-08':kind==='month3'?'2026-04-11':'2026-07-11',
 state:'scheduled' as const,openedAt:null,completedAt:null,outcome:null,doctorNote:null,checkin:null,...over});
const programme=(cps=[cp('week4_review'),cp('month3'),cp('month6')])=>memberTimelineSchema.parse({version:'programme-v1',enabled:true,today:'2026-01-20',schedulePending:true,opensDaysBefore:3,startedAt:'2026-01-10T22:30:00Z',checkpoints:cps});
const p=programme();
assert.equal(p.enabled,true);

// Before the plan: questionnaire done, tests arranged, nothing at the lab.
{
 const s=journeyStages({questionnaireComplete:true,lab:null,testsArranged:true,planPublishedAt:null,programme:{...p,enabled:true,startedAt:null,checkpoints:[]} as never});
 assert.deepEqual(s.map(x=>x.id),['questionnaire','tests','results','plan']);
 assert.deepEqual(s.map(x=>x.state),['done','now','next','next']);
 assert.match(s[1]!.meaning.en,/arranged/);
}
// A failed lab read is never "done".
{
 const s=journeyStages({questionnaireComplete:true,lab:undefined,testsArranged:false,planPublishedAt:null,programme:{...p,startedAt:null,checkpoints:[]} as never});
 assert.equal(s.find(x=>x.id==='tests')!.state,'now');
}
// Plan published: the six-month steps follow with their Yerevan dates; the plan date is the Yerevan day.
{
 const s=journeyStages({questionnaireComplete:true,lab:'results-received',testsArranged:true,planPublishedAt:'2026-01-10T22:30:00Z',programme:p as never});
 assert.deepEqual(s.map(x=>x.id),['questionnaire','tests','results','plan','week4_review','month3','month6']);
 assert.equal(s.filter(x=>x.state==='now').length,1);
 assert.equal(currentStage(s)!.id,'week4_review');
 assert.equal(s.find(x=>x.id==='plan')!.date!.en,'11 January','02:30 Yerevan on 11 January is 10 January in UTC');
 assert.equal(s.find(x=>x.id==='month3')!.date!.en,'11 April');
 assert.equal(s.find(x=>x.id==='month3')!.date!.hy,'11 ապրիլի');
 assert.equal(programmeDay('2026-02-08','en'),'8 February');
}
// Open checkpoint without a check-in: the check-in is due; with one, it is not.
{
 const open=programme([cp('week4_review',{state:'open',openedAt:'2026-02-05T05:00:00Z'}),cp('month3'),cp('month6')]);
 const s=journeyStages({questionnaireComplete:true,lab:'results-received',testsArranged:true,planPublishedAt:null,programme:open as never});
 assert.equal(s.find(x=>x.id==='week4_review')!.checkinDue,true);
 const answered=programme([cp('week4_review',{state:'open',openedAt:'2026-02-05T05:00:00Z',checkin:{feeling:'same',medicines:'all',note:null,submittedAt:'2026-02-05T06:00:00Z'}}),cp('month3'),cp('month6')]);
 assert.equal(journeyStages({questionnaireComplete:true,lab:'results-received',testsArranged:true,planPublishedAt:null,programme:answered as never}).find(x=>x.id==='week4_review')!.checkinDue,false);
}
// Completed checkpoints say what the doctor did; the next one becomes "now".
{
 const done=programme([cp('week4_review',{state:'completed',openedAt:'2026-02-05T05:00:00Z',completedAt:'2026-02-09T08:00:00Z',outcome:'confirmed',doctorNote:'Keep going.'}),cp('month3',{state:'completed',openedAt:'2026-04-08T05:00:00Z',completedAt:'2026-04-10T08:00:00Z',outcome:'republished'}),cp('month6')]);
 const s=journeyStages({questionnaireComplete:true,lab:'results-received',testsArranged:true,planPublishedAt:null,programme:done as never});
 assert.match(s.find(x=>x.id==='week4_review')!.outcome!.en,/stays the same/);
 assert.match(s.find(x=>x.id==='month3')!.outcome!.en,/updated your plan/);
 assert.equal(currentStage(s)!.id,'month6');
 assert.equal(s.find(x=>x.id==='week4_review')!.date!.en,'9 February','a completed step shows when it was done');
}
// Schemas: strict, refuse unknown fields and answers.
assert.equal(memberTimelineSchema.safeParse({version:'programme-v1',enabled:true,today:'2026-01-20',schedulePending:true,opensDaysBefore:3,startedAt:null,checkpoints:[],extra:1}).success,false);
assert.equal(checkinCommandSchema.safeParse({checkpointId:id(1),feeling:'great',medicines:'all',submissionId:id(2)}).success,false);
assert.equal(doctorMemberSchema.safeParse({version:'programme-member-v1',enabled:false}).success,true);

// Sources: offsets are not hard-coded in the app; repeat intervals come only from the decision tree.
for(const file of['lib/programme/stages.ts','lib/programme/runtime.ts','lib/programme/member.ts','components/patient/programme-timeline.tsx','components/staff/programme-panel.tsx']){
 const src=readFileSync(file,'utf8');
 assert.doesNotMatch(src,/\b(28|90|91|180|182)\s*\*?\s*(days?|\*\s*864e5|\*\s*86_?400)/i,`${file}: no hard-coded checkpoint offsets`);
 assert.doesNotMatch(src,/—/,`${file}: no em dashes in copy`);
 assert.doesNotMatch(src,/#[0-9a-f]{3,8}\b(?![-\w])/i,`${file}: no hex colours`);
}
assert.deepEqual(REPEAT_TEST_RULES.map(r=>r.source.split(' (')[0]),['DT v1.1 P531–533','DT v1.1 P543–545','DT v1.1 P582–584']);
assert.doesNotMatch(readFileSync('lib/programme/repeat-tests.ts','utf8'),/repeatAfterDays/,'the demo catalogue cadence is not a source');
const mig=readFileSync('supabase/migrations/20261017185240_programme_rhythm.sql','utf8');
assert.match(mig,/enabled boolean not null default false/,'switch off by default');
assert.match(mig,/'pending_clinical_signoff'/,'offsets marked pending');
console.log('check-programme-timeline: ok');
