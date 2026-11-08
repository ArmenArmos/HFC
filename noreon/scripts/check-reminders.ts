import assert from 'node:assert/strict';
import { DEFAULT_REMINDERS, parseReminderPreferences, dailyReminders, nextReminderAction, updateReminderPreferences } from '@/lib/patient-care/reminders';
import { canReportDose } from '@/lib/patient-care/model';
import type { CareData } from '@/lib/patient-care/types';
import type { Measurement } from '@/lib/patient/types';
const now = new Date('2026-10-10T10:00:00+04:00');
const care: CareData = {tests:[], results:[], appointments:[],events:[],plan:{id:'plan',clinician:'Fictional GP',publishedAt:'2026-10-09T00:00:00+04:00',acknowledgedAt:null,instructions:'Keep instructions',medications:[{id:'medicine',planId:'plan',name:'Fictional medicine',dose:'Example dose',instructions:'Keep dose time',times:['08:00'],startDate:'2026-10-09',endDate:null,active:true}]}};
const snapshot = structuredClone(care);
assert.deepEqual(parseReminderPreferences(DEFAULT_REMINDERS).bpTimes,['08:00','20:00']);
for (const patch of [{bpTimes:['25:00']},{bpTimes:['08:00','08:00']},{bpTimes:[]},{bpTimes:['01:00','02:00','03:00','04:00','05:00']},{medicationOffsetMinutes:60},{quietStart:'8:00'},{unexpected:true}]) assert.throws(()=>parseReminderPreferences({...DEFAULT_REMINDERS,...patch}));
const enabled={...DEFAULT_REMINDERS,bpEnabled:true};
let rows=dailyReminders(care,[],enabled,now);
assert.equal(rows.length,3);
assert.equal(nextReminderAction(rows)?.kind,"measurement");
assert.equal(nextReminderAction(rows.filter(r=>r.kind==="medication"))?.kind,"medication");
assert.equal(nextReminderAction(rows.map(r=>({...r,status:"completed" as const}))),null);
assert.deepEqual(rows.map(r=>r.status),['due','due','upcoming']);
assert.equal(rows.find(r=>r.kind==='medication')?.dose?.dueAt,'2026-10-10T04:00:00.000Z');
const reading: Measurement={id:'reading',submissionId:'submission',systolic:130,diastolic:82,measuredAt:'2026-10-10T09:00:00+04:00',source:'manual'};
rows=dailyReminders(care,[reading],enabled,now);
assert.deepEqual(rows.filter(r=>r.kind==='blood-pressure').map(r=>r.status),['completed','upcoming']);
assert.equal(dailyReminders(care,[{...reading,measuredAt:'2026-10-10T07:00:00+04:00'}],enabled,now).filter(r=>r.kind==='blood-pressure')[0].status,'due');
assert.equal(dailyReminders(care,[{...reading,measuredAt:'2026-10-10T21:00:00+04:00'}],enabled,now).filter(r=>r.kind==='blood-pressure')[1].status,'upcoming');
// A reading up to 15 minutes before a BP reminder belongs to that reminder.
assert.equal(dailyReminders(care,[{...reading,measuredAt:'2026-10-10T07:50:00+04:00'}],enabled,now).filter(r=>r.kind==='blood-pressure')[0].status,'completed');
assert.equal(dailyReminders(care,[{...reading,measuredAt:'2026-10-10T19:30:00+04:00'}],enabled,now).filter(r=>r.kind==='blood-pressure')[0].status,'due');
assert.equal(dailyReminders(care,[{...reading,measuredAt:'2026-10-10T09:00:00+04:00'}],enabled,now).filter(r=>r.kind==='blood-pressure')[0].status,'completed');
assert.equal(dailyReminders(care,[{...reading,measuredAt:'2026-10-10T09:01:00+04:00'}],enabled,now).filter(r=>r.kind==='blood-pressure')[0].status,'due');
// Closely spaced reminders partition the early window deterministically, so one
// reading can complete at most one of them.
const closeBp={...enabled,bpTimes:['08:00','08:10']};
let closeRows=dailyReminders(care,[{...reading,measuredAt:'2026-10-10T07:54:00+04:00'}],closeBp,now).filter(r=>r.kind==='blood-pressure');
assert.deepEqual(closeRows.map(r=>r.status),['completed','due']);
closeRows=dailyReminders(care,[{...reading,measuredAt:'2026-10-10T07:55:00+04:00'}],closeBp,now).filter(r=>r.kind==='blood-pressure');
assert.deepEqual(closeRows.map(r=>r.status),['completed','due']);
// At the midpoint the tie goes to the later reminder.
closeRows=dailyReminders(care,[{...reading,measuredAt:'2026-10-10T08:05:00+04:00'}],closeBp,now).filter(r=>r.kind==='blood-pressure');
assert.deepEqual(closeRows.map(r=>r.status),['due','completed']);
// The first slot is clamped to local midnight; yesterday's late reading cannot
// satisfy today's first reminder.
const midnightBp={...enabled,bpTimes:['00:05','23:55']};
assert.equal(dailyReminders(care,[{...reading,measuredAt:'2026-10-09T23:55:00+04:00'}],midnightBp,new Date('2026-10-10T00:10:00+04:00')).filter(r=>r.kind==='blood-pressure')[0].status,'due');
assert.equal(dailyReminders(care,[{...reading,measuredAt:'2026-10-10T00:00:00+04:00'}],midnightBp,new Date('2026-10-10T00:10:00+04:00')).filter(r=>r.kind==='blood-pressure')[0].status,'completed');
assert.equal(dailyReminders(care,[],{...DEFAULT_REMINDERS,medicationEnabled:false},now).length,0);
assert.deepEqual(care,snapshot,"Reminder generation cannot mutate clinical data");
care.events=[{medicationId:'medicine',dueAt:'2026-10-10T04:00:00Z',status:'skipped',recordedAt:now.toISOString()}];
assert.equal(dailyReminders(care,[],DEFAULT_REMINDERS,now)[0].status,'skipped');
care.events=[];

const early=dailyReminders(care,[],{...DEFAULT_REMINDERS,medicationOffsetMinutes:-15},new Date('2026-10-10T07:50:00+04:00'))[0];
assert.equal(early.status,'due');assert.equal(early.dose?.status,'upcoming');
const later=dailyReminders(care,[],{...DEFAULT_REMINDERS,medicationOffsetMinutes:15},new Date('2026-10-10T08:05:00+04:00'))[0];
assert.equal(later.status,'upcoming');assert.equal(later.dose?.status,'due');
care.plan!.medications[0].times=['00:05'];
const cross=dailyReminders(care,[],{...DEFAULT_REMINDERS,medicationOffsetMinutes:-15},new Date('2026-10-09T23:55:00+04:00'));
assert.equal(cross.length,1); // group by reminder date without repeating the dose on both days
assert.ok(cross.some(r=>r.dueAt==='2026-10-09T20:05:00.000Z'&&r.reminderAt==='2026-10-09T19:50:00.000Z'));
care.plan!.medications[0].times=['23:50'];
const afterMidnight=new Date('2026-10-10T00:10:00+04:00');
assert.equal(canReportDose(care,'medicine','2026-10-09T23:50:00+04:00',afterMidnight,15),true);
assert.equal(canReportDose(care,'medicine','2026-10-09T23:50:00+04:00',afterMidnight,0),false);
assert.equal(canReportDose(care,'medicine','2026-10-09T23:50:00+04:00',afterMidnight,-15),false);
care.plan!.medications[0].active=false;
assert.equal(dailyReminders(care,[],DEFAULT_REMINDERS,now).length,0);
assert.deepEqual(snapshot.plan!.medications[0].times,['08:00']);
const saved={revision:0,preferences:structuredClone(DEFAULT_REMINDERS)};
const changed=updateReminderPreferences(saved,enabled,0);
assert.equal(changed.revision,1);assert.equal(changed.preferences.bpEnabled,true);assert.equal(saved.preferences.bpEnabled,false);
assert.throws(()=>updateReminderPreferences(changed,DEFAULT_REMINDERS,0),/conflict/);
assert.throws(()=>updateReminderPreferences(saved,enabled,-1),/invalid/);
console.log('Reminder checks passed: defaults, validation, original dose identities, midnight, BP slots, skipped states, inactive plans and revision conflicts.');
