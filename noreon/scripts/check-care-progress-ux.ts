import * as textLanguage from '@/lib/text-language';
import assert from 'node:assert/strict';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import * as common from '@/components/patient-care/common';
import * as icons from 'lucide-react';
import * as dateFormat from '@/lib/patient/date-format';
import type {ReminderOccurrence} from '@/lib/patient-care/reminders';
import {ProgressRings} from '@/components/patient-care/progress-rings';
import {JourneyTimeline} from '@/components/patient-care/journey-overview';
import {EMPTY_CARE} from '@/lib/patient-care/types';

for (const locale of ['en', 'hy'] as const) {
  for (const readings of [0, 2, 30]) {
    const html = renderToStaticMarkup(createElement(ProgressRings, {locale, readings, taken: 1, doses: 2}));
    assert.ok(html.includes('href="/patient/health"'));
    assert.ok(html.includes('href="/patient/progress?section=habits"'));
    const readingLink = html.slice(html.indexOf('<a'), html.indexOf('</a>'));
    assert.ok(!readingLink.includes('<circle'), 'Reading count must not be drawn as a completion ring');
    assert.ok(readingLink.includes(`>${readings}<`), 'The actual reading count remains visible');
    const medicationLink = html.slice(html.indexOf('</a>') + 4);
    assert.match(medicationLink, /stroke-dasharray="50 100"/, 'Only medicine reports have a completion ratio');
  }
  const journey = renderToStaticMarkup(createElement(JourneyTimeline, {care: {...EMPTY_CARE, appointments:[{id:'visit',clinician:null,specialty:'Example',location:null,startsAt:null,status:'requested'}], events: [{medicationId:'m', dueAt:'2026-10-14T08:00:00Z', status:'taken', recordedAt:'2026-10-14T08:10:00Z'}]}, complete:true, locale}));
  const unavailable = locale === 'en' ? 'Stage status unavailable' : 'Փուլի կարգավիճակը հասանելի չէ';
  assert.ok(!journey.includes(unavailable), 'Journey does not expose internal stage-tracking diagnostics');
  assert.ok(journey.includes('href="/patient/care#appointments"') && journey.includes('href="/patient/progress?section=habits"'), 'Later journey activities offer their real destinations rather than completion states');
}
console.log('EN/HY progress counts, unchanged destinations, medicine ratios and actionable journey activities passed.');

// Render the actual routine, mocking only its mutation control boundary.
const routineExports: Record<string, unknown> = {};
let forwardedDose: unknown;
const compiled = ts.transpileModule(readFileSync('components/patient-care/daily-routine.tsx', 'utf8'), {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX}}).outputText;
new vm.Script(compiled).runInNewContext({exports:routineExports, require:(name:string)=> {
  if (name === '@/lib/text-language') return textLanguage;
  if (name === 'react/jsx-runtime') return jsx;
  if (name === './common') return common;
  if (name === 'lucide-react') return icons;
  if (name === '@/lib/patient/date-format') return dateFormat;
  if (name === './controls') return {DoseButtons:({dose}:{dose:unknown})=>{forwardedDose=dose; return createElement('span', {}, 'Medicine control');}};
  throw new Error(name);
}});
const Routine = routineExports.RoutineCheckIns as (props:{occurrences:ReminderOccurrence[];locale:'en'|'hy'})=>ReturnType<typeof createElement>;
const medication: ReminderOccurrence = {id:'med', kind:'medication', dueAt:'2026-10-14T14:00:00Z', reminderAt:'2026-10-14T14:00:00Z', status:'upcoming', dose:{dueAt:'2026-10-14T14:00:00Z',status:'upcoming',medication:{id:'m',planId:'plan',name:'Example medicine',dose:'Example dose',instructions:'Follow prescription',times:['18:00'],startDate:'2026-10-10',endDate:null,active:true}}};
const bp: ReminderOccurrence = {id:'bp',kind:'blood-pressure',dueAt:medication.dueAt,reminderAt:medication.reminderAt,status:'upcoming'};
for (const locale of ['en', 'hy'] as const) {
  const mixed = renderToStaticMarkup(createElement(Routine,{occurrences:[bp,medication],locale}));
  assert.ok(mixed.includes(locale === 'en' ? 'Reminder later' : 'Հիշեցումն ավելի ուշ'), 'Upcoming BP timing is labelled as a reminder, rather than action gating');
  assert.ok(mixed.includes('href="/patient/measurements/new"'), 'Upcoming BP reminder retains immediate Record destination');
  assert.ok(mixed.includes(locale === 'en' ? 'Medicine check-ins open at the scheduled dose times. You can record blood pressure at any time.' : 'Դեղերի ընդունումը կարող եք նշել նշանակված ժամերին։ Արյան ճնշումը կարող եք գրանցել ցանկացած պահի։'));
  assert.equal(forwardedDose, medication.dose, 'Scheduled medicine action receives unchanged dose eligibility');
  const bpOnly = renderToStaticMarkup(createElement(Routine,{occurrences:[bp],locale}));
  assert.ok(!bpOnly.includes(locale === 'en' ? 'scheduled dose times' : 'նշանակված ժամերին'), 'BP-only routine must not imply scheduled action gating');
}
console.log('Actual mixed EN/HY routines distinguish immediate BP recording from scheduled medicine controls.');

for (const locale of ['en', 'hy'] as const) {
  const next = renderToStaticMarkup(createElement(ProgressRings, {locale, readings:2,taken:0,doses:2,nextDoseAt:'2026-10-14T14:00:00Z'}));
  assert.ok(next.includes(locale === 'en' ? 'Next dose at 18:00' : 'Հաջորդ ընդունումը՝ 18:00'));
  const firstCard = next.slice(next.indexOf('<a'),next.indexOf('</div>',next.indexOf('</a>')));
  assert.ok(firstCard.includes(locale === 'en' ? 'A count, not a treatment target.' : 'Քանակ է, ոչ բուժման թիրախ։'), 'Reading explanation belongs in its own card');
}
