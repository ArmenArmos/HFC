import * as textLanguage from '@/lib/text-language';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import * as icons from "lucide-react";
import * as common from "@/components/patient-care/common";
import * as dates from "@/lib/patient/date-format";
import type { ReminderOccurrence } from "@/lib/patient-care/reminders";

let passedDose: unknown;
let passedDoses: unknown[] = [];
function loadComponent(path: string): Record<string, unknown> {
const exports: Record<string, unknown> = {};
const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new vm.Script(code).runInNewContext({ exports, require: (name: string) => {
  if (name === '@/lib/text-language') return textLanguage;
  if (name === "react/jsx-runtime") return jsx;
  if (name === "react") return React;
  if (name === "lucide-react") return icons;
  // Keep framework navigation effects outside this component interaction check.
  if (name === "./common") return { ...common, CareLink: ({ href, children }: { href: string; children: React.ReactNode }) => React.createElement("a", { href }, children) };
  if (name === "@/lib/patient/date-format") return dates;
  if (name === "./daily-routine") return loadComponent("components/patient-care/daily-routine.tsx");
  if (name === "./controls") return { DoseButtons: ({ dose }: { dose: unknown }) => { passedDose = dose; passedDoses.push(dose); return React.createElement("button", {}, "Dose action"); } };
  throw new Error(name);
}});
return exports;
}
const exports = loadComponent("components/patient-care/habits-progress.tsx");
type Day = { day: string; schedule: "scheduled" | "not-scheduled" | "unknown"; taken: number; skipped: number };
const Habits = exports.HabitsProgress as (props: { days: Day[]; occurrences: ReminderOccurrence[]; locale: "en" | "hy"; hasPlan?: boolean }) => React.ReactNode;
const days: Day[] = Array.from({ length: 7 }, (_, i) => ({ day: `2026-10-${String(i + 6).padStart(2, "0")}`, schedule: "scheduled", taken: 0, skipped: 0 }));
days[0] = { ...days[0], taken: 1, skipped: 1 };
days[1].schedule = "not-scheduled";
days[2].schedule = "unknown";
const occurrence: ReminderOccurrence = { id: "dose", kind: "medication", dueAt: "2026-10-12T08:00:00Z", reminderAt: "2026-10-12T07:45:00Z", status: "upcoming", dose: { dueAt: "2026-10-12T08:00:00Z", status: "upcoming", medication: { id: "med", planId: "plan", name: "Example medicine", dose: "5 mg", instructions: "Take with water.\nRetain full instructions.", times: ["12:00"], startDate: "2026-10-12", endDate: null, active: true } } };
for (const locale of ["en", "hy"] as const) {
  const localizedOccurrence: ReminderOccurrence = { ...occurrence, dose: { ...occurrence.dose!, medication: { ...occurrence.dose!.medication, instructions: locale === "en" ? occurrence.dose!.medication.instructions : "Ընդունեք ջրով։\nՊահպանեք նշանակված ամբողջական ցուցումները։" } } };
  const html = renderToStaticMarkup(React.createElement(Habits, { days, occurrences: [localizedOccurrence], locale, hasPlan: true }));
  const medicineIndex = html.indexOf(locale === "en" ? "Your medicine reports" : "Դեղերի ընդունման նշումները");
  const routineIndex = html.indexOf('id="daily-routine"');
  assert.ok(medicineIndex >= 0 && routineIndex >= 0, "Medicine evidence and check-ins are both rendered");
  assert.ok(routineIndex < medicineIndex, "Today’s check-ins precede supporting medicine evidence");
  assert.equal(passedDose, localizedOccurrence.dose, "Original guarded dose object reaches DoseButtons");
  assert.ok(html.includes(localizedOccurrence.dose!.medication.instructions), "Full prescription instructions are retained");
  for (const phrase of locale === "en" ? ["reported taken", "reported skipped", "No doses scheduled", "Schedule unavailable", "No reports", "Self-reported, not proof", "Recorded dose time"] : ["ընդունված", "բաց թողնված", "Ընդունում նախատեսված չէ", "Ժամանակացույցը հասանելի չէ", "Նշումներ չկան", "Ձեր նշումներն են, ոչ ընդունման ապացույց", "Գրանցված ընդունման ժամը"]) assert.ok(html.includes(phrase), phrase);
  let depth = 0;
  for (const tag of html.match(/<details\b[^>]*>|<\/details>/g) ?? []) {
    depth += tag.startsWith("</") ? -1 : 1;
    assert.ok(depth <= 1, "Disclosure depth never exceeds one");
  }
  assert.equal(depth, 0);
  const sameTime = renderToStaticMarkup(React.createElement(Habits, { days, occurrences: [{ ...localizedOccurrence, reminderAt: localizedOccurrence.dueAt }], locale, hasPlan: true }));
  assert.ok(!sameTime.includes(locale === "en" ? "Recorded dose time" : "Գրանցված ընդունման ժամը"), "Identical reminder/dose timestamps are not repeated");
  const rollover = { ...localizedOccurrence, reminderAt: "2026-10-12T19:55:00Z", dueAt: "2026-10-12T20:10:00Z", dose: { ...localizedOccurrence.dose!, dueAt: "2026-10-12T20:10:00Z" } };
  const rolloverHtml = renderToStaticMarkup(React.createElement(Habits, { days, occurrences: [rollover], locale, hasPlan: true }));
  assert.ok(rolloverHtml.includes(common.stamp(rollover.dueAt,locale)), "Armenia-midnight dose rollover retains its full date and time");
  assert.ok(html.includes('12:00'), "Same-day recorded dose time remains exact while avoiding the repeated date");
  const empty = renderToStaticMarkup(React.createElement(Habits, { days: days.map(d => ({ ...d, taken: 0, skipped: 0, schedule: "not-scheduled" as const })), occurrences: [], locale, hasPlan: true }));
  assert.ok(empty.includes(locale === "en" ? "No medicine doses scheduled this week" : "Այս շաբաթ դեղի ընդունումներ նախատեսված չեն"));
  assert.ok(empty.includes(locale === "en" ? "No check-ins scheduled today" : "Այսօր գրառումներ նախատեսված չեն"));
  const unknown = renderToStaticMarkup(React.createElement(Habits, { days: days.map(d => ({ ...d, taken: 0, skipped: 0, schedule: "unknown" as const })), occurrences: [], locale, hasPlan: true }));
  assert.ok(unknown.includes(locale === "en" ? "Medicine schedule unavailable" : "Դեղերի ժամանակացույցը հասանելի չէ"));
  // Gohar D-003: without a published plan nothing points to one.
  const noPlan = renderToStaticMarkup(React.createElement(Habits, { days: days.map(d => ({ ...d, taken: 0, skipped: 0, schedule: "unknown" as const })), occurrences: [], locale, hasPlan: false }));
  assert.ok(noPlan.includes(locale === "en" ? "No medicines to report yet" : "Նշելու դեղեր դեռ չկան"));
  assert.ok(!noPlan.includes(locale === "en" ? "care plan" : "խնամքի պլան") && !noPlan.includes('href="/patient/care"'), "No care-plan wording or link without a plan");
  const noDays = renderToStaticMarkup(React.createElement(Habits, { days: [], occurrences: [], locale, hasPlan: true }));
  assert.ok(!noDays.includes(locale === "en" ? "Daily reports for this week" : "Այս շաբաթվա օրական նշումները"), "Empty day input does not offer an empty history disclosure");
  const bp: ReminderOccurrence = { id: "bp", kind: "blood-pressure", dueAt: localizedOccurrence.dueAt, reminderAt: localizedOccurrence.dueAt, status: "completed" };
  const completedBp = renderToStaticMarkup(React.createElement(Habits, { days, occurrences: [bp], locale, hasPlan: true }));
  assert.ok(!completedBp.includes('/patient/measurements/new'), "A completed BP check-in does not offer another entry action");
  const pendingBp = renderToStaticMarkup(React.createElement(Habits, { days, occurrences: [{ ...bp, status: "due" }], locale, hasPlan: true }));
  assert.ok(pendingBp.includes('/patient/measurements/new'), "A due BP check-in opens measured-reading entry");
}
// One visible instruction block per exact order; clock slots retain every guarded dose action.
const secondDose: ReminderOccurrence = { ...occurrence, id: "second-dose", dueAt: "2026-10-12T16:00:00Z", reminderAt: "2026-10-12T16:00:00Z", dose: { ...occurrence.dose!, dueAt: "2026-10-12T16:00:00Z", revision: 3 } };
for (const locale of ["en", "hy"] as const) {
  passedDoses = [];
  const grouped = renderToStaticMarkup(React.createElement(Habits, { days, occurrences: [occurrence, secondDose], locale, hasPlan: true }));
  assert.ok(grouped.indexOf('aria-label="11:45"') < grouped.indexOf('aria-label="20:00"'), "Clock slots follow reminder chronology");
  const instructionLabel = locale === "en" ? "Prescription instructions" : "Դեղի ընդունման ցուցումներ";
  assert.equal(grouped.split(instructionLabel).length - 1, 1, "Complete prescription instructions are shown once per order");
  assert.deepEqual(passedDoses, [occurrence.dose, secondDose.dose], "Each original guarded dose/revision reaches its own action");
  for (const medication of [
    { ...occurrence.dose!.medication, id: "different-order" },
    { ...occurrence.dose!.medication, planId: "different-plan" },
    { ...occurrence.dose!.medication, instructions: "Different complete instructions" },
  ]) {
    const distinct = renderToStaticMarkup(React.createElement(Habits, { days, occurrences: [occurrence, { ...secondDose, dose: { ...secondDose.dose!, medication } }], locale, hasPlan: true }));
    assert.equal(distinct.split(instructionLabel).length - 1, 2);
  }
  const separateBp = renderToStaticMarkup(React.createElement(Habits, { days, occurrences: [occurrence, secondDose, { id: "bp", kind: "blood-pressure", dueAt: occurrence.dueAt, reminderAt: occurrence.reminderAt, status: "due" }], locale, hasPlan: true }));
  assert.equal(separateBp.split('aria-label="11:45"').length - 1, 1, "Medicine and BP at the same instant share a clock slot");
  assert.ok(separateBp.includes('/patient/measurements/new'));
}
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
for (const locale of ["en", "hy"] as const) {
  let renderer!: ReturnType<typeof create>;
  await act(async () => { renderer = create(React.createElement(Habits, { days, occurrences: [], locale, hasPlan: true })); });
  const buttons = renderer.root.findAllByType("button");
  assert.equal(buttons.length, 1, "A seven-day input has one selectable week");
  assert.equal(buttons[0].props['aria-pressed'], true);
  const historyDays = Array.from({ length: 28 }, (_, i) => ({ day: `2026-09-${String(i + 1).padStart(2, "0")}`, schedule: "scheduled" as const, taken: i < 7 ? 2 : 0, skipped: i >= 7 && i < 14 ? 1 : 0 }));
  await act(async () => { renderer.update(React.createElement(Habits, { days: historyDays, occurrences: [], locale, hasPlan: true })); });
  const weeks = renderer.root.findAllByType("button");
  assert.equal(weeks.length, 4, "Four actual weeks are selectable");
  for (const index of [0, 1, 2, 3]) {
    await act(async () => { weeks[index].props.onClick(); });
    assert.equal(weeks[index].props['aria-pressed'], true);
    const selected = renderer.root.findByProps({ 'aria-live': 'polite' });
    const text = JSON.stringify(selected.children.map(child => typeof child === 'string' ? child : child.children));
    assert.ok(text.includes(index === 0 ? '14' : index === 1 ? '7' : '0'), "Selecting a week shows its actual report count");
    const rows = renderer.root.findAllByProps({ 'data-report-day': true });
    assert.equal(rows.length, 7);
    assert.ok(JSON.stringify(rows[0].children.map(child => typeof child === 'string' ? child : child.children)).includes(historyDays[index * 7].day.slice(-2).replace(/^0/, '')), "Daily evidence belongs to selected week");
  }
  const partialSchedule = historyDays.map((day, i) => ({...day, schedule: i < 7 ? "not-scheduled" as const : i < 14 ? "unknown" as const : "scheduled" as const, taken:0, skipped:i >= 21 ? 1 : 0}));
  await act(async () => { renderer.update(React.createElement(Habits, { days:partialSchedule, occurrences:[], locale, hasPlan: true })); });
  const scheduleWeeks = renderer.root.findAllByType("button");
  assert.ok(scheduleWeeks[0].props['aria-label'].includes(locale === 'en' ? 'No doses scheduled' : 'Ընդունում նախատեսված չէ'), 'Week before medicine start has schedule context rather than misleading zero reports');
  for (const index of [0, 1]) {
    await act(async () => { scheduleWeeks[index].props.onClick(); });
    const selected = renderer.root.findByProps({'aria-live':'polite'});
    const text = JSON.stringify(selected.children.map(child => typeof child === 'string' ? child : child.children));
    assert.ok(text.includes(index === 0 ? (locale === 'en' ? 'No doses scheduled' : 'Ընդունում նախատեսված չէ') : (locale === 'en' ? 'Schedule unavailable' : 'Ժամանակացույցը հասանելի չէ')));
    assert.ok(!text.includes(locale === 'en' ? 'reported taken' : 'նշված է ընդունված'), 'An empty unscheduled or unknown week must not imply missed reporting');
  }
  const skipped = renderToStaticMarkup(React.createElement(Habits,{days:partialSchedule,occurrences:[],locale,hasPlan:true}));
  assert.ok(skipped.includes('bg-[var(--status-warning-fg)]'), 'Literal skipped reports use the caution token, rather than the primary-success-looking navy');
  await act(async () => { renderer.unmount(); });
}
console.log("Habits EN/HY week selection and renders retain evidence distinctions, instructions, reminder timing and guarded dose props; empty/unknown schedules and BP actions remain honest.");
// PWA7: empty schedules retain one actionable explanation, not seven repeated rows.
for (const locale of ['en','hy'] as const) {
 for (const schedule of ['not-scheduled','unknown'] as const) {
  const emptyDays=Array.from({length:7},(_,i)=>({day:`2026-10-${String(i+6).padStart(2,'0')}`,schedule,taken:0,skipped:0}));
  const html=renderToStaticMarkup(React.createElement(Habits,{days:emptyDays,occurrences:[],locale,hasPlan:true}));
  assert.ok(!html.includes('data-report-day'),'PWA7: no evidence means no repeated daily report strip');
  assert.ok(html.includes('/patient/care'),'PWA7: empty schedule retains its care-plan action');
  assert.ok(html.includes(locale==='en'?(schedule==='unknown'?'Medicine schedule unavailable':'No medicine doses scheduled this week'):(schedule==='unknown'?'Դեղերի ժամանակացույցը հասանելի չէ':'Այս շաբաթ դեղի ընդունումներ նախատեսված չեն')),'PWA7: unavailable and unscheduled remain distinct');
 }
}
console.log('PWA7 empty Habits retains truthful schedule text and Care action without repeated daily rows.');
