import assert from 'node:assert/strict';
// @ts-expect-error Node 26 runtime API; project types target Node 20.
import { registerHooks } from 'node:module';
// Ignore the server-only marker for static component rendering; no action is executed.
registerHooks({resolve(specifier:string,context:object,next:(specifier:string,context:object)=>object){
 if(specifier==='server-only')return {url:'data:text/javascript,export {}',shortCircuit:true};
 if(specifier==='@/app/patient/care/actions')return {url:'data:text/javascript,export async function saveReminderPreferences(){};export async function reportDose(){};export async function acknowledgePlan(){}',shortCircuit:true};
 return next(specifier,context);
}});
const {createElement}=await import('react');const {renderToStaticMarkup}=await import('react-dom/server');
const {DEFAULT_REMINDERS}=await import('@/lib/patient-care/reminders');
const {AppRouterContext}=await import('next/dist/shared/lib/app-router-context.shared-runtime.js');
const render=(child:ReturnType<typeof createElement>)=>renderToStaticMarkup(createElement(AppRouterContext.Provider,{value:{refresh(){}} as never},child));
const {ReminderSettings,ReminderConflictRecovery,reminderSaveError}=await import('@/components/patient-care/reminder-settings');
const {DailyRoutine}=await import('@/components/patient-care/daily-routine');
for(const locale of ['en','hy'] as const){
 assert.ok(reminderSaveError(locale, 'unknown').includes(locale==='en'?'confirm':'հաստատել'), 'An absent save response is uncertain, not a confirmed failure');
 assert.equal(reminderSaveError(locale, 'invalid').includes('HH:mm'),true, 'Invalid time choices explain the time format');
 for(const reason of ['unavailable', undefined] as const){
  const error=reminderSaveError(locale,reason);
  assert.equal(error.includes('HH:mm'),false, 'Network/storage failures do not falsely blame valid times');
  assert.ok(error.includes(locale==='en'?'try again':'փորձեք կրկին'));
 }
 const settings=render(createElement(ReminderSettings,{saved:{revision:0,preferences:{...DEFAULT_REMINDERS,bpEnabled:true,medicationEnabled:true}},locale}));
 assert.ok(settings.includes('08:00'));assert.ok(settings.includes('20:00'));
 assert.ok(!settings.includes('review-instructions'));
 assert.equal((settings.match(/role="switch"/g) ?? []).length, 2, 'Both reminder toggles expose switch semantics');
 assert.equal((settings.match(/aria-pressed=/g) ?? []).length, 3, 'Medicine offset offers three explicit choices');
 assert.ok(!settings.includes('type="time"'), 'Time display does not depend on browser 12-hour locale formatting');
 assert.ok(settings.includes('value="23"') && settings.includes('value="59"'), '24-hour choices retain every hour and minute');
 for (const offset of [-15, 0, 15] as const) {
  const choices=render(createElement(ReminderSettings,{saved:{revision:0,preferences:{...DEFAULT_REMINDERS,medicationEnabled:true,medicationOffsetMinutes:offset}},locale}));
  const label=offset===-15 ? (locale==='en'?'15 minutes before':'15 րոպե առաջ') : offset===0 ? (locale==='en'?'At the recorded dose time':'Գրանցված ընդունման ժամին') : (locale==='en'?'15 minutes after':'15 րոպե հետո');
  assert.ok(choices.includes(`aria-label="${label}" aria-pressed="true"`), 'The saved offset selects the corresponding accessible choice');
 }
 const exactMinutes=render(createElement(ReminderSettings,{saved:{revision:0,preferences:{...DEFAULT_REMINDERS,bpEnabled:true,bpTimes:['09:17','19:43'],quietStart:'22:59',quietEnd:'06:01'}},locale}));
 assert.ok(exactMinutes.includes('09:17') && exactMinutes.includes('19:43') && exactMinutes.includes('22:59') && exactMinutes.includes('06:01'), 'Full-minute saved times retain exact values');
 assert.ok(exactMinutes.includes(locale==='en'?'Blood-pressure reminder 1 — Hour':'Ճնշման հիշեցում 1 — Ժամ'), 'Reminder hour controls have index-specific accessible names');
 assert.ok(exactMinutes.includes(locale==='en'?'Quiet hours end — Minute':'Լուռ ժամերի ավարտ — Րոպե'), 'Quiet-hour controls have distinct accessible names');
 const disabledPreferences={...DEFAULT_REMINDERS,medicationEnabled:false,bpEnabled:false,bpTimes:['09:15','19:45']};
 const disabled=render(createElement(ReminderSettings,{saved:{revision:7,preferences:disabledPreferences},locale}));
 assert.ok(!disabled.includes('aria-pressed='), 'Disabled medicine reminders hide their dose offset choices');
 assert.ok(!disabled.includes('09:15')&&!disabled.includes('19:45'), 'Disabled BP reminders hide their saved times');
 assert.ok(!disabled.includes(locale==='en'?'Add reminder time':'Ավելացնել հիշեցման ժամ'), 'Disabled BP reminders hide the add-time action');
 assert.ok(!disabled.includes(locale==='en'?'Choose times that fit your routine':'Ընտրեք ձեր առօրյային համապատասխան ժամերը'), 'Disabled BP reminders hide their scheduling help');
 const enabled=render(createElement(ReminderSettings,{saved:{revision:7,preferences:{...disabledPreferences,medicationEnabled:true,bpEnabled:true}},locale}));
 assert.ok(enabled.includes('aria-pressed=')&&enabled.includes('09:15')&&enabled.includes('19:45'), 'Enabled reminders expose their existing saved choices');
 const medicineOnly=render(createElement(ReminderSettings,{saved:{revision:7,preferences:{...disabledPreferences,medicationEnabled:true}},locale}));
 assert.ok(medicineOnly.includes('aria-pressed=')&&!medicineOnly.includes('09:15'), 'Medicine reminders do not expose disabled BP settings');
 const pressureOnly=render(createElement(ReminderSettings,{saved:{revision:7,preferences:{...disabledPreferences,bpEnabled:true}},locale}));
 assert.ok(!pressureOnly.includes('aria-pressed=')&&pressureOnly.includes('09:15'), 'BP reminders do not expose disabled medicine settings');
 assert.deepEqual(disabledPreferences.bpTimes,['09:15','19:45'], 'Rendering disabled reminders retains the saved times');
 const conflictRecovery=render(createElement(ReminderConflictRecovery,{conflict:true,locale}));
 assert.ok(conflictRecovery.includes(locale==='en'?'Reload settings':'Վերբեռնել կարգավորումները'), 'A stale revision offers a contextual recovery action');
 assert.equal(render(createElement(ReminderConflictRecovery,{conflict:false,locale})), '', 'Ordinary errors do not offer an action that discards the form');
 const routine=render(createElement(DailyRoutine,{occurrences:[{id:'bp',kind:'blood-pressure',dueAt:'2026-10-10T04:00:00Z',reminderAt:'2026-10-10T04:00:00Z',status:'completed'}],locale,hasPlan:false}));
 assert.ok(routine.includes(locale==='en'?'Recorded':'Գրանցված'));
}
const settings=render(createElement(ReminderSettings,{saved:{revision:0,preferences:DEFAULT_REMINDERS},locale:'en'}));
assert.ok(settings.includes('does not change'));assert.ok(settings.includes('reminders are not available yet'));
console.log('Reminder UI checks passed: enabled saved times, hidden disabled controls, clinical separation, completion labels and honest delivery in both languages.');
