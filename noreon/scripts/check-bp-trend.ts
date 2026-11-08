import assert from 'node:assert/strict';
import {bpWeeklyTrend, bpWeeklyTrendsEnabled, type BpTrendReading} from '@/lib/clinical/rules/bp-trend';
import {readFileSync,readdirSync} from 'node:fs';
import {bpWeeklySummaryLine, BP_WEEKLY_WORDS} from '@/lib/clinical/rules/bp-words';
import {THRESHOLD} from '@/lib/clinical/rules/thresholds';

const now = new Date('2026-11-09T06:00:00Z'); // Monday, 10:00 Yerevan
const reading = (day: number, systolic = 135, diastolic = 85, time = '08:00'): BpTrendReading => ({
  systolic, diastolic, measured_at: `2026-11-${String(day).padStart(2, '0')}T${time}:00+04:00`,
});
const week = (s: number, d = 80, count = 4, previous = false) => Array.from({length: count}, (_, i) => previous ? {...reading(1,s,d),measured_at:`2026-10-${28+i%4}T08:00:00+04:00`} : reading(5+i%4,s,d));
const result = (s = 135, d = 85, before = 125, count = 4, prevCount = 4) => bpWeeklyTrend([...week(s,d,count), ...week(before,80,prevCount,true)],now)!;
assert.equal(bpWeeklyTrendsEnabled({}),false);
for(const value of ['false','TRUE','1','true ']) assert.equal(bpWeeklyTrendsEnabled({NOREON_ZOE_BP_TRENDS:value}),false);
assert.equal(bpWeeklyTrendsEnabled({NOREON_ZOE_BP_TRENDS:'true'}),true);
assert.equal(THRESHOLD.bpTrendChangeSystolic,10);
assert.equal(THRESHOLD.bpTrendMinReadings,4);
assert.equal(bpWeeklyTrend([],now),null);
assert.equal(bpWeeklyTrend(week(135,85,2),now),null);
assert.equal(bpWeeklyTrend([reading(5),reading(5),reading(5)],now),null);
assert.ok(bpWeeklyTrend(week(135,85,3),now));
assert.equal(result(135,85,126).trend,'stable');
assert.equal(result(135,85,125).trend,'worsening');
assert.equal(result(134,84,124).trend,'stable');
assert.equal(result(135,84,125).trend,'worsening');
assert.equal(result(134,85,124).trend,'worsening');
assert.equal(result(135,85,125,3).trend,'stable');
assert.equal(result(135,85,125,4,3).trend,'stable');
assert.equal(result(115,75,125).trend,'improving');
assert.equal(result(116,75,125).trend,'stable');
assert.equal(result(115,75,125,4,3).trend,'stable');
assert.equal(result(135,85,125,4,2).change,null);
assert.deepEqual(result(135,85,125,4,3).change,{systolic:10,diastolic:5});
assert.equal(result().weekStart,'2026-11-09');
assert.equal(result().daysMeasured,4);
assert.equal(result().nextStep,'twice_daily');
const sparseWorsening=bpWeeklyTrend([...week(135,85,3),reading(5,135,85),...week(125,80,4,true)],now)!;
assert.equal(sparseWorsening.trend,'worsening'); assert.equal(sparseWorsening.nextStep,'mornings');
assert.equal(result(135,85,125,3).nextStep,'mornings');
assert.equal(result(125,80,125).nextStep,'keep');
// Fractions do not round a 9.75 rise into worsening, or 134.75 into the elevated range.
assert.equal(bpWeeklyTrend([...week(140).slice(1),reading(5,139,80),...week(130,80,4,true)],now)!.trend,'stable');
assert.equal(bpWeeklyTrend([...week(135,84).slice(1),reading(5,134,84),...week(124,80,4,true)],now)!.trend,'stable');
// Exact rational changes must not fall below 10 through floating-point subtraction.
const fractional=bpWeeklyTrend([...week(135,85,5).map((r,i)=>({...r,systolic:i===0?136:135})),...week(125,80,5,true).map((r,i)=>({...r,systolic:i===0?126:125}))],now)!;
assert.equal(fractional.trend,'worsening');
// Current window Nov 3..9, previous Oct 27..Nov 2, including the exact UTC+4 edges.
const edges = bpWeeklyTrend([...week(130),
 {...reading(3,140),measured_at:'2026-11-02T20:00:00Z'},
 {...reading(3,200),measured_at:'2026-11-02T19:59:59Z'},
 {...reading(1,220),measured_at:'2026-10-26T19:59:59Z'},
 {...reading(9,250),measured_at:'2026-11-09T20:00:00Z'}],now)!;
assert.equal(edges.readingsThis,5); assert.equal(edges.readingsPrevious,1);
assert.equal(edges.thisMean.systolic,132); assert.equal(edges.daysMeasured,5);
assert.equal(bpWeeklyTrend(week(130),new Date('2026-11-08T19:59:59Z'))!.weekStart,'2026-11-02');
assert.equal(bpWeeklyTrend(week(130),new Date('2026-11-08T20:00:00Z'))!.weekStart,'2026-11-09');
for(const date of ['2026-03-29','2026-10-25']) {
 const rs = ['00:00','08:00','16:00'].map(time=>({systolic:130,diastolic:80,measured_at:`${date}T${time}:00+04:00`}));
 rs.push({...rs[0],measured_at:`${date}T00:00:00Z`});
 rs.push({...rs[0],measured_at:new Date(Date.parse(`${date}T00:00:00+04:00`)-86400000).toISOString()});
 assert.equal(bpWeeklyTrend(rs,new Date(`${date}T20:00:00+04:00`))!.daysMeasured,2);
}
const periods = bpWeeklyTrend([reading(5,140,90,'11:59'),reading(6,142,88,'00:00'),reading(5,130,80,'16:00'),reading(6,132,82,'23:59'),reading(7,200,100,'12:00'),reading(8,200,100,'15:59')],now)!;
assert.deepEqual(periods.morning,{systolic:141,diastolic:89});
assert.deepEqual(periods.evening,{systolic:131,diastolic:81});
assert.equal(bpWeeklyTrend([reading(5),reading(6),reading(7,130,80,'16:00')],now)!.morning,null);
const noPrevious = bpWeeklyTrend(week(130),now)!;
assert.equal(noPrevious.change,null); assert.equal(noPrevious.previousMean,null);
const unsafe = /—|!|103|diagnos|hypertens|doctor|care team|patient|ախտորոշ|հիպերտ|բժիշկ|брач|врач|диагноз|гипертон/iu;
for(const lang of ['en','hy','ru'] as const) {
 for(const summary of [noPrevious,result(),result(115,75,125),result(125,80,125),result(135,85,125,3),sparseWorsening,periods]) {
  const text=bpWeeklySummaryLine(lang,summary);
  assert.ok(text.length>50); assert.ok(!unsafe.test(text),text);
  assert.ok(text.includes(`${summary.thisMean.systolic}/${summary.thisMean.diastolic}`));
  assert.ok(!/[{}]/.test(text));
 }
 const without=bpWeeklySummaryLine(lang,noPrevious);
 assert.ok(!/last week|անցած շաբաթ|прошлой недел/u.test(without));
}
console.log('BP weekly trend: windows, boundaries, periods and EN/HY/RU branches passed');

// Pin SQL transcriptions without treating source parity as a database execution check.
const migration=readdirSync('supabase/migrations').find(n=>n.endsWith('_bp_weekly_summary.sql'))!;
const sql=readFileSync(`supabase/migrations/${migration}`,'utf8');
const sqlJson=(name:string)=>JSON.parse(sql.match(new RegExp(`${name} constant jsonb:='((?:[^']|'')*)'::jsonb`))![1].replaceAll("''", "'"));
assert.deepEqual(sqlJson('cuts'),Object.fromEntries(Object.entries(THRESHOLD).filter(([k])=>k.startsWith('bpTrend')||k==='elevatedSystolic'||k==='elevatedDiastolic')));
assert.deepEqual(sqlJson('words'),BP_WEEKLY_WORDS);
// The shared notice helper must retain every existing decision, with exactly one locale change.
const old=readFileSync('supabase/migrations/20261101212925_member_notices_in_chat.sql','utf8');
const original=old.slice(old.indexOf('create or replace function public._member_notice('),old.indexOf('-- Proposal acceptance')).trim();
const copied=sql.slice(sql.indexOf('create or replace function public._member_notice('),sql.indexOf('-- A new urgent alert closes')).trim();
assert.equal(copied.replace(/loc:=case when p_template='app.bp_weekly_summary'[\s\S]*?else public\._telegram_auth_locale\(p_member\) end;/,"loc:=public._telegram_auth_locale(p_member);"),original);
for(const [lang,w] of Object.entries(BP_WEEKLY_WORDS)) {
 const body=w.average.replaceAll('{sys}','{bp_sys}').replaceAll('{dia}','{bp_dia}')+'{bp_change}{bp_pattern}'+w.days.replaceAll('{days}','{bp_days}').replaceAll('{window}',String(THRESHOLD.bpTrendWindowDays))+'{bp_next}';
 assert.ok(sql.includes(`('app.bp_weekly_summary',1,'${lang}','${body.replaceAll("'","''")}')`));
}
console.log('BP weekly SQL cuts, copy, templates and preserved notice safeguards match TypeScript');
const originalClosed=old.slice(old.indexOf('create function public._member_notice_closed('),old.indexOf('-- Binding and quiet-hours decisions')).trim().replace('create function','create or replace function');
const weeklyClosed=sql.slice(sql.indexOf('create or replace function public._member_notice_closed('),sql.indexOf('create function public.bp_weekly_summary_run')).trim();
assert.equal(weeklyClosed.replace(/ if part\[1\]='bp_weekly'then[\s\S]*? elsif part\[1\]in/," if part[1]in"),originalClosed,'Only weekly urgent closure is added to existing read/claim rules');
const sweep=sql.slice(sql.indexOf('create function public.bp_weekly_summary_run'));
const loop=sweep.slice(sweep.indexOf('\n loop'));
assert.ok(loop.indexOf("pg_try_advisory_xact_lock(hashtextextended('member-notice:'")<loop.indexOf('public._member_reminder_held'),'Cap is checked while holding the member notice lock');
assert.ok(loop.indexOf('public.care_alerts')<loop.indexOf('perform public._member_notice('),'Urgency is freshly checked before publication');
assert.ok(sql.includes(`jsonb_build_object('next_days','${THRESHOLD.bpTrendNextDays}')`));
