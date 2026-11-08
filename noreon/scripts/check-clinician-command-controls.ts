import * as outcomeCopy from '@/lib/staff-zoe/outcome-copy';
/** Runs real React hooks and review controls; only network/action boundaries are deferred. */
import assert from 'node:assert/strict';
import * as regimenModule from '../lib/patient-care/regimen';
import * as careNoteCopy from '../lib/staff/care-note-copy';import * as staffLocaleCopy from '../lib/staff/staff-locale-copy';import * as staffServerCopy from '../lib/staff/staff-server-copy';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import type {ReactTestRenderer} from 'react-test-renderer';
import {createWorkflow} from '../lib/service-workflow/model';
import {advanceReviewTask} from '../lib/service-workflow/review-task';
import {selectFieldNativeStub} from './select-field-native-stub';
import * as realLocaleModule from '@/lib/locale';
const require = createRequire(import.meta.url);
const {create, act} = require('react-test-renderer') as typeof import('react-test-renderer');
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const actionTimeout=await import('@/lib/patient-care/action-timeout');
let finish: (value: unknown) => void;
let rejectAction: (error: Error) => void;
let calls = 0;
let refreshes = 0;
const action = async () => {calls++; return new Promise((resolve,reject) => {finish = resolve;rejectAction=reject;});};
function load<T>(path: string, modules: Record<string, unknown> = {}, globals: Record<string, unknown> = {}) {
  const exports: Record<string, unknown> = {};
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX}}).outputText;
  new vm.Script(code).runInNewContext({exports, ...globals, require(name: string) {
    if(name==='@/lib/patient-care/action-timeout')return actionTimeout;
    if(name==='@/lib/staff-zoe/outcome-copy')return outcomeCopy;
    if (name in modules) return modules[name];
    if(name === '@/components/ui/select-field') return selectFieldNativeStub;
    if(name === 'react') return React;
    if(name === 'react/jsx-runtime') return jsx;
    if(name === 'next/navigation') return {unstable_rethrow:require('next/navigation').unstable_rethrow,useRouter: () => ({refresh: () => {refreshes++;}}), usePathname: () => '/staff/case/test-case'};
    if(name.endsWith('/service/actions')) return {serviceCommand: action};
    if(name.endsWith('/transport')) return {safeRequest: async (fn: () => Promise<unknown>) => fn()};
    if(name.endsWith('/review-actions')) return {completeReviewNoChange: action};
    if(name.endsWith('/common')) return {stamp: () => '13 October 2026'};
    if(name==='./medicine-checks')return {MedicineChecks:()=>null,MedicineDatalist:()=>null,MEDICINE_LIST_ID:'plan-medicine-list'};
    if(name==='@/lib/staff/care-note-copy')return careNoteCopy;if(name==='@/lib/staff/staff-locale-copy')return staffLocaleCopy;if(name==='@/lib/staff/staff-server-copy')return staffServerCopy;if(name==='@/lib/locale')return realLocaleModule;if(name==='./bp-high-warning')return {BpHighWarning:()=>null};if(name==='./regimen')return {RegimenApproval:()=>null,RegimenEditor:()=>null};if(name==='@/lib/patient-care/regimen')return regimenModule;throw new Error(`Unexpected import ${name}`);
  }});
  return exports as T;
}
const {useWorkflowCommand} = load<typeof import('../components/service-workflow/shared')>('components/service-workflow/shared.tsx');
const workflow = {...createWorkflow([], new Date('2026-10-13T08:00:00Z')), revision:3};
let controls!: ReturnType<typeof useWorkflowCommand>;
function Harness() {
  const current = useWorkflowCommand(workflow);
  React.useLayoutEffect(() => {controls = current;});
  return React.createElement('output', null, current.error);
}
let tree!: ReactTestRenderer;
await act(async () => {tree = create(React.createElement(Harness));});
await act(async () => {
  controls.run({type:'save-draft',draft:workflow.draft});
  controls.run({type:'publish'});
});
assert.equal(calls, 1, 'Two actions in the same event cannot race before React disables controls');
assert.equal(controls.pending, true);
assert.equal(controls.activeCommand, 'save-draft', 'Only the initiated command gets active feedback');
await act(async () => {controls.run({type:'publish'});});
assert.equal(calls, 1, 'A sibling command must not overlap a pending mutation');
await act(async () => {finish({ok: true});});
assert.equal(controls.pending, false);
assert.equal(controls.activeCommand, null);
assert.equal(refreshes, 1);
await act(async () => {controls.run({type:'publish'});});
await act(async () => {finish({ok:false,error:'Evidence changed'});});
assert.equal(controls.activeCommand, null, 'A rejected command releases active feedback');
assert.equal(controls.pending, false);
assert.equal(tree.root.findByType('output').children.join(''), 'Evidence changed');
let finishRefresh: (value: false) => void;
await act(async () => {controls.run({type:'save-draft',draft:workflow.draft}, () => new Promise(resolve => {finishRefresh = resolve;}));});
await act(async () => {finish({ok:true});});
assert.equal(controls.pending, true, 'Refresh remains part of the guarded save operation');
assert.equal(controls.activeCommand, 'save-draft');
await act(async () => {controls.run({type:'publish'});});
assert.equal(calls, 3, 'No new mutation can begin before updated evidence has loaded');
await act(async () => {finishRefresh(false);});
assert.equal(controls.pending, false);
assert.equal(controls.activeCommand, null);
assert.equal(refreshes, 1, 'A handled refresh does not trigger a second router refresh');
await act(async () => {tree.unmount();});
const {ReviewTaskPanel} = load<typeof import('../components/service-workflow/review-task-panel')>('components/service-workflow/review-task-panel.tsx');
const task = advanceReviewTask(null, {id:'review-1',revision:2,ownerId:'doctor',at:'2026-10-13T08:00:00Z',opensTask:true,reason:'New evidence'})!;
let refreshed: (value: boolean) => void;
await act(async () => {tree = create(React.createElement(ReviewTaskPanel, {task,caseId:'test-case',caseRevision:3,evidenceRevision:2,blockedReason:'',refresh: () => new Promise<boolean>(resolve => {refreshed = resolve;})}));});
await act(async () => {tree.root.findByType('textarea').props.onChange({target:{value:'Checked the changed evidence; the approved plan still applies.'}});});
await act(async () => {tree.root.findAllByType('button')[0].props.onClick();});
let submit = tree.root.findAllByType('button')[0];
assert.equal(submit.props.disabled, true);
assert.equal(submit.props['aria-busy'], true, 'Review outcome announces its own pending submission');
assert.match(submit.children.join(''), /Completing/);
await act(async () => {finish({ok:false,error:'Evidence changed'});});
submit = tree.root.findAllByType('button')[0];
assert.equal(submit.props['aria-busy'], false);
assert.equal(submit.props.disabled, true, 'A conflict retains the refresh-before-retry guard');
assert.match(tree.root.findByProps({role:'status'}).children.join(''), /Evidence changed/);
await act(async () => {tree.root.findAllByType('button')[1].props.onClick();});
const buttons = tree.root.findAllByType('button');
assert.equal(buttons[0].props['aria-busy'], false, 'Refreshing does not make the outcome button look submitted');
assert.equal(buttons[1].props['aria-busy'], true);
assert.match(buttons[1].children.join(''), /Refreshing/);
await act(async () => {refreshed(true);});
assert.equal(tree.root.findAllByType('button')[0].props.disabled, false);
await act(async () => {tree.unmount();});
console.log('Clinician commands identify one active operation, prevent overlaps, clear on success/conflict, and review controls distinguish submission from refresh.');

// The renderer has no DOM. This fixture supplies a form's native FormData values
// and reset boundary, while the production component owns all submit/guard logic.
type FixtureForm = {values: FormData; resets: number; reset: () => void};
function form(entries: Record<string, string>): FixtureForm {
  const values = new FormData();
  for (const [name, value] of Object.entries(entries)) values.set(name, value);
  const fixture: FixtureForm = {values, resets:0, reset: () => {fixture.resets++;}};
  return fixture;
}
const measurementForm = form({measuredAt:'2026-10-13T11:00',systolic:'125',diastolic:'80',pulse:'72'});
const noteForm = form({kind:'reached',note:'Reached the member. Discussed measurement recording.'});
let providerRevision = 7;
let releaseProvider: (value: boolean) => void;
let providerLoads = 0;
const requests: Record<string, unknown>[] = [];
const memory = () => ({loaded:true,persistenceError:'',snapshot:{state:{workspaceRevision:providerRevision}},refresh: () => {
  providerLoads++;
  return new Promise<boolean>(resolve => {releaseProvider = resolve;});
}});
const MemoryContext = React.createContext(memory());
const {CareTasks} = load<typeof import('../components/staff/care-tasks')>('components/staff/care-tasks.tsx', {
  '@/components/service-workflow/reports-provider': {useOptionalDemoReports: () => React.useContext(MemoryContext)},
  '@/lib/staff/nurse-actions': {staffCareCommand: async (payload: Record<string, unknown>) => {requests.push(payload); return action();}},
  './shell': {buttonClass:'care-button',fieldClass:'care-field'},
  './bp-high-warning': {BpHighWarning:()=>null},
}, {crypto, FormData: class {constructor(fixture: FixtureForm) {return fixture.values;}}});
const renderCareTasks = () => React.createElement(MemoryContext.Provider, {value:memory()}, React.createElement(CareTasks, {id:'case-current',revision:3}));
await act(async () => {tree = create(renderCareTasks());});
await act(async () => {tree.root.findAllByType('form')[0].props.onSubmit({preventDefault() {},currentTarget:measurementForm});});
assert.equal(requests[0].caseRevision, 7, 'Measurement uses current shared evidence revision rather than stale route props');
assert.equal(requests[0].measuredAt, '2026-10-13T07:00:00.000Z');
assert.equal(requests[0].systolic, 125);
await act(async () => {finish({ok:true});});
assert.equal(providerLoads, 1, 'Saving measurement refreshes the shared provider, not only the route');
assert.equal(measurementForm.resets, 1);
assert.equal(tree.root.findAllByType('button')[0].props.disabled, true, 'Next submission waits until updated evidence loads');
providerRevision = 8;
await act(async () => {tree.update(renderCareTasks()); releaseProvider(true);});
assert.equal(tree.root.findAllByType('button')[0].props.disabled, false);
await act(async () => {tree.root.findAllByType('form')[1].props.onSubmit({preventDefault() {},currentTarget:noteForm});});
assert.equal(requests[1].caseRevision, 8, 'A subsequent same-page note uses the revision loaded after measurement');
assert.equal(requests[1].op, 'note');
assert.equal(requests[1].kind, 'reached');
await act(async () => {finish({ok:true});});
assert.equal(providerLoads, 2);
await act(async () => {releaseProvider(false);});
assert.match(tree.root.findByProps({role:'status'}).children.join(''), /Saved.*could not load/);
assert.equal(tree.root.findAllByType('button')[0].props.disabled, true);
assert.equal(tree.root.findAllByType('button')[1].props.disabled, true);
await act(async () => {tree.root.findAllByType('form')[1].props.onSubmit({preventDefault() {},currentTarget:noteForm});});
assert.equal(requests.length, 2, 'A failed provider refresh blocks writes even if a submit event arrives');
await act(async () => {tree.root.findAllByType('button')[2].props.onClick();});
assert.equal(providerLoads, 3);
providerRevision = 9;
await act(async () => {tree.update(renderCareTasks()); releaseProvider(true);});
assert.equal(tree.root.findAllByType('button')[1].props.disabled, false);
await act(async () => {tree.root.findAllByType('form')[1].props.onSubmit({preventDefault() {},currentTarget:noteForm});});
assert.equal(requests[2].caseRevision, 9, 'Recovery loads new evidence before allowing another note');
await act(async () => {finish({ok:true});});
await act(async () => {releaseProvider(true);});
await act(async () => {tree.unmount();});
console.log('CareTasks uses current provider revisions across same-page measurement and note submissions; failed evidence loads block further writes until recovery.');

const draftRequests: FormData[] = [];
const adoptions: {id:string;fields:string[]}[] = [];
const fakeWindow={confirm:():boolean=>false};
// The form's submit handler builds new FormData(form); the harness hands it a prepared one.
const fakeForm={next:new FormData()};
class FakeFormData{constructor(){return fakeForm.next;}}
let draftAvailable=true;
let draftAvailabilityError:Error|null=null;
const {DraftForm} = load<typeof import('../components/real-review/forms')>('components/real-review/forms.tsx', {
  '@/lib/ai-plan/draft-fields': await import('@/lib/ai-plan/draft-fields'),
  '@hcaptcha/react-hcaptcha': require('@hcaptcha/react-hcaptcha'),
  '@/lib/patient-care/clinical-review-actions': {checkRealClinicalCaseAvailability:async()=>{if(draftAvailabilityError)throw draftAvailabilityError;return {ok:draftAvailable,message:draftAvailable?'':'The current case is unavailable. Your entries are retained.'};}},
  '@/lib/patient-care/clinical-actions': {saveRealDraft: async (_previous: unknown, data: FormData) => {draftRequests.push(data); return action();}},
  '@/lib/ai-plan/actions': {recordAiPlanAdoption: async (id: string, fields: string[]) => {adoptions.push({id,fields}); return true;}},
  '@/lib/ai-plan/contracts': {AI_PLAN_LABEL:{en:'AI-prepared draft – check before publishing',hy:'AI'},DRAFT_FIELDS:['explanation','instructions','followUp']},
},{window:fakeWindow,FormData:FakeFormData});
let nativeSnapshot: import('../lib/patient-care/clinical-case-repository').ClinicalSnapshot = {
  id:'78e98173-e740-40b2-bbfe-2c8edc6dfa07',revision:12,evidenceToken:'evidence-12',
  draft:{...workflow.draft,explanation:'Initial server explanation',instructions:'Initial instructions'},
  draftSavedAt:null,draftStale:false,
  evidence:{visits:[],profile:{name:'Fictional member',birthDate:null,biologicalSex:null},consent:null,assessment:null,measurements:[],reports:[]},
};
const renderDraft = () => React.createElement(DraftForm, {key:nativeSnapshot.id,snapshot:nativeSnapshot});
await act(async () => {tree = create(renderDraft());});
const draftField = (name: string) => tree.root.findAllByType('textarea').find(field => field.props.name === name)!;
await act(async () => {draftField('explanation').props.onChange({target:{value:'Unsaved local explanation after reviewing evidence.'}});});
await act(async () => {draftField('instructions').props.onChange({target:{value:'Unsaved local care instructions.'}});});
function submittedDraft() {
  const data = new FormData();
  for (const field of [...tree.root.findAllByType('input'),...tree.root.findAllByType('textarea')]) {
    data.set(field.props.name, String(field.props.value));
  }
  return data;
}
await act(async () => {React.startTransition(() => {tree.root.findByType('form').props.action(submittedDraft());});});
assert.equal(tree.root.findByType('fieldset').props.disabled, true, 'Draft fields cannot change while their saved version is in flight');
assert.equal(tree.root.findAllByType('button')[0].props['aria-busy'], true);
assert.match(tree.root.findAllByType('button')[0].children.join(''), /Saving/);
assert.equal(tree.root.findAllByType('button')[1].props.disabled, true, 'Reload cannot discard the pending draft');
await act(async () => {finish({ok:false,message:'Current evidence changed. Review and save again.'});});
assert.equal(draftField('explanation').props.value, 'Unsaved local explanation after reviewing evidence.');
assert.equal(draftField('instructions').props.value, 'Unsaved local care instructions.');
assert.match(tree.root.findByProps({role:'alert'}).children.join(''), /evidence changed/);
assert.equal(tree.root.findByType('fieldset').props.disabled, false);
assert.equal(tree.root.findAllByType('button')[0].props.disabled, false);
const saveDraftButton = () => tree.root.findAllByType('button').find(button => /Save private draft|Saving draft/.test(button.children.join('')))!;
const chooseDraftButton = (label: string) => tree.root.findAllByType('button').find(button => button.children.join('') === label)!;
const originalSavedDraft = nativeSnapshot.draft;
nativeSnapshot = {...nativeSnapshot,revision:13};
await act(async () => {tree.update(renderDraft());});
assert.equal(submittedDraft().get('revision'), '13', 'A note-only update can advance CAS when saved draft and evidence are unchanged');
assert.equal(submittedDraft().get('token'), 'evidence-12');
assert.equal(draftField('explanation').props.value, 'Unsaved local explanation after reviewing evidence.');
assert.equal(saveDraftButton().props.disabled, false);
assert.equal(tree.root.findAllByProps({'aria-label':'Draft conflict'}).length, 0);
nativeSnapshot = {...nativeSnapshot,revision:14,draft:{...workflow.draft,explanation:'Another tab saved explanation Y'}};
await act(async () => {tree.update(renderDraft());});
assert.equal(draftField('explanation').props.value, 'Unsaved local explanation after reviewing evidence.', 'Changed server draft cannot silently replace dirty edits');
assert.equal(submittedDraft().get('revision'), '13', 'A conflicting saved draft cannot silently advance the edit CAS');
assert.equal(saveDraftButton().props.disabled, true);
assert.match(tree.root.findByProps({'aria-label':'Draft conflict'}).findByProps({role:'alert'}).children.join(''), /Another draft was saved/);
assert.ok(tree.root.findAllByType('dd').some(value => value.children.join('') === 'Another tab saved explanation Y'), 'Conflict exposes the current server draft for comparison');
await act(async () => {chooseDraftButton('I reviewed the changes, keep my edits').props.onClick();});
assert.equal(submittedDraft().get('revision'), '14');
assert.equal(draftField('instructions').props.value, 'Unsaved local care instructions.');
assert.equal(saveDraftButton().props.disabled, false);
nativeSnapshot = {...nativeSnapshot,revision:15,evidenceToken:'evidence-15'};
await act(async () => {tree.update(renderDraft());});
assert.equal(saveDraftButton().props.disabled, true);
assert.equal(submittedDraft().get('revision'), '14');
assert.equal(submittedDraft().get('token'), 'evidence-12', 'Changed source evidence retains the reviewed token until acknowledgement');
assert.match(tree.root.findByProps({'aria-label':'Draft conflict'}).findByProps({role:'alert'}).children.join(''), /Source evidence changed/);
await act(async () => {chooseDraftButton('Use the current saved draft').props.onClick();});
assert.equal(draftField('explanation').props.value, 'Another tab saved explanation Y');
assert.equal(submittedDraft().get('revision'), '15');
assert.equal(submittedDraft().get('token'), 'evidence-15');
nativeSnapshot = {...nativeSnapshot,revision:16,evidenceToken:'evidence-16',draft:{...workflow.draft,explanation:'Latest clean server explanation Z'}};
await act(async () => {tree.update(renderDraft());});
assert.equal(draftField('explanation').props.value, 'Latest clean server explanation Z', 'An unedited form follows a newer saved server draft');
assert.equal(submittedDraft().get('revision'), '16');
await act(async () => {tree.unmount();});
// Saving receives the resulting CAS revision from the server. Older route props
// must not reset that success or refill the editor from an older saved draft.
nativeSnapshot = {...nativeSnapshot,revision:12,evidenceToken:'evidence-12',draft:originalSavedDraft};
await act(async () => {tree = create(renderDraft());});
await act(async () => {draftField('explanation').props.onChange({target:{value:'Reviewed local explanation saved at revision 13.'}});});
const refreshesBeforeDraftSave = refreshes;
await act(async () => {React.startTransition(() => {tree.root.findByType('form').props.action(submittedDraft());});});
assert.equal(draftRequests[1].get('revision'), '12');
await act(async () => {finish({ok:true,message:'Private draft saved.',revision:13});});
assert.equal(refreshes, refreshesBeforeDraftSave+1);
assert.equal(submittedDraft().get('revision'), '13', 'Confirmed RPC revision advances the editor before route refresh returns');
assert.equal(draftField('explanation').props.value, 'Reviewed local explanation saved at revision 13.');
assert.equal(saveDraftButton().props.disabled, true);
await act(async () => {tree.update(renderDraft());});
assert.equal(draftField('explanation').props.value, 'Reviewed local explanation saved at revision 13.', 'Older route snapshot cannot roll back confirmed saved text');
assert.equal(saveDraftButton().props.disabled, true);
await act(async () => {draftField('explanation').props.onChange({target:{value:'New explanation following another evidence check.'}});});
assert.equal(saveDraftButton().props.disabled, false, 'A new edit after success enables the next save');
await act(async () => {draftField('explanation').props.onChange({target:{value:'Reviewed local explanation saved at revision 13.'}});});
assert.equal(saveDraftButton().props.disabled, true, 'Returning to the saved baseline removes dirty status');
nativeSnapshot = {...nativeSnapshot,revision:13,evidenceToken:'same-revision-new-source',draftStale:true,draft:{...originalSavedDraft!,explanation:'Reviewed local explanation saved at revision 13.'}};
await act(async () => {tree.update(renderDraft());});
assert.equal(submittedDraft().get('revision'), '13');
assert.equal(submittedDraft().get('token'), 'same-revision-new-source', 'An unedited form synchronizes source changes even when the case revision stays the same');
assert.equal(saveDraftButton().props.disabled, false, 'Same-revision stale evidence permits an unchanged saved draft to be reviewed again');
nativeSnapshot = {...nativeSnapshot,revision:14,evidenceToken:'evidence-14',draftStale:true,draft:{...originalSavedDraft!,explanation:'Reviewed local explanation saved at revision 13.'}};
await act(async () => {tree.update(renderDraft());});
assert.equal(saveDraftButton().props.disabled, false, 'New stale evidence allows the unchanged reviewed draft to be saved again');
assert.equal(submittedDraft().get('revision'), '14');
assert.equal(submittedDraft().get('token'), 'evidence-14');
assert.equal(draftField('explanation').props.value, 'Reviewed local explanation saved at revision 13.');
await act(async () => {tree.unmount();});
console.log('Native DraftForm preserves pending edits, safely rebases note-only changes, exposes conflicting draft/source changes until acknowledgement, and synchronizes clean or confirmed saved baselines.');

nativeSnapshot = {...nativeSnapshot,revision:20,evidenceToken:'source-before-member-write',draftStale:false,draft:originalSavedDraft};
await act(async () => {tree = create(renderDraft());});
await act(async () => {draftField('explanation').props.onChange({target:{value:'Local edits retained through member evidence writes.'}});});
nativeSnapshot = {...nativeSnapshot,evidenceToken:'source-after-member-write',draftStale:true};
await act(async () => {tree.update(renderDraft());});
assert.equal(saveDraftButton().props.disabled, true, 'A member source write blocks dirty draft saving even if clinical case revision did not advance');
assert.equal(submittedDraft().get('revision'), '20');
assert.equal(submittedDraft().get('token'), 'source-before-member-write', 'Dirty form retains the reviewed token until explicit acknowledgement');
assert.equal(draftField('explanation').props.value, 'Local edits retained through member evidence writes.');
assert.match(tree.root.findByProps({'aria-label':'Draft conflict'}).findByProps({role:'alert'}).children.join(''), /Source evidence changed/);
await act(async () => {chooseDraftButton('I reviewed the changes, keep my edits').props.onClick();});
assert.equal(submittedDraft().get('token'), 'source-after-member-write');
assert.equal(saveDraftButton().props.disabled, false);
assert.equal(draftField('explanation').props.value, 'Local edits retained through member evidence writes.');
nativeSnapshot = {...nativeSnapshot,revision:21,draft:{...originalSavedDraft!,medicationTimes:['09:00','18:00']}};
await act(async () => {tree.update(renderDraft());});
assert.equal(saveDraftButton().props.disabled, true, 'A medicine schedule change is a conflicting saved draft change');
assert.equal(submittedDraft().get('revision'), '20');
const scheduleComparison = tree.root.findByProps({'aria-label':'Draft conflict'}).findAllByType('div').find(value => value.findAllByType('dt').some(label => label.children.join('') === 'Medicine times'))!;
assert.equal(scheduleComparison.findByType('dd').children.join(''), '09:00, 18:00', 'Schedule-only conflicts expose current medicine times for review');
await act(async () => {chooseDraftButton('Use the current saved draft').props.onClick();});
assert.equal(submittedDraft().get('medicationTimes'), '09:00, 18:00');
assert.equal(submittedDraft().get('revision'), '21');
await act(async () => {tree.unmount();});
console.log('Same-revision member evidence writes synchronize clean drafts and require acknowledgement for dirty drafts; schedule conflicts show current medicine times.');

// A transport exception is not a confirmed failed save. Keep text and wait for
// a fresh server snapshot even when its revision did not change.
nativeSnapshot = {...nativeSnapshot,revision:30,evidenceToken:'outage-source',draftStale:false,draft:originalSavedDraft};
await act(async()=>{tree=create(renderDraft());});
await act(async()=>{draftField('instructions').props.onChange({target:{value:'Fictional doctor edits retained during outage.'}});});
await act(async()=>{React.startTransition(()=>{tree.root.findByType('form').props.action(submittedDraft());});});
await act(async()=>{rejectAction(Error('Simulated server action transport failure'));});
assert.equal(draftField('instructions').props.value,'Fictional doctor edits retained during outage.');
assert.equal(saveDraftButton().props.disabled,true,'Unknown save outcome requires a fresh snapshot');
assert.match(tree.root.findByProps({role:'alert'}).children.join(''),/not confirmed/i);
draftAvailabilityError=Object.assign(Error('auth redirect'),{digest:'NEXT_REDIRECT;replace;/staff/real/login;307;'});
await act(async()=>{await assert.rejects(chooseDraftButton('Refresh evidence').props.onClick(),error=>error===draftAvailabilityError);});
draftAvailabilityError=null;
draftAvailable=false;
const refreshCountBeforeFailure=refreshes;
await act(async()=>{await chooseDraftButton('Refresh evidence').props.onClick();});
assert.equal(refreshes,refreshCountBeforeFailure,'Failed availability must not replace dirty draft');
assert.equal(draftField('instructions').props.value,'Fictional doctor edits retained during outage.');
assert.equal(saveDraftButton().props.disabled,true);
draftAvailable=true;
await act(async()=>{chooseDraftButton('Refresh evidence').props.onClick();});
assert.equal(saveDraftButton().props.disabled,false,'Authenticated availability reread releases retry on unchanged evidence');
nativeSnapshot={...nativeSnapshot};
await act(async()=>{tree.update(renderDraft());});
assert.equal(saveDraftButton().props.disabled,false,'A fresh unchanged snapshot can recover after an unavailable save');
assert.equal(draftField('instructions').props.value,'Fictional doctor edits retained during outage.');
assert.equal(tree.root.findAllByProps({role:'alert'}).length,0,'Fresh snapshot clears obsolete uncertainty feedback');
assert.equal(tree.root.findAllByProps({role:'status'}).length,0,'Fresh snapshot hides obsolete availability feedback from another control');
await act(async()=>{React.startTransition(()=>{tree.root.findByType('form').props.action(submittedDraft());});});
await act(async()=>{finish({ok:false,message:'Draft save not confirmed after RPC outage.',uncertain:true});});
assert.equal(saveDraftButton().props.disabled,true,'Returned uncertain RPC outcomes also require fresh context');
assert.equal(draftField('instructions').props.value,'Fictional doctor edits retained during outage.');
await act(async()=>chooseDraftButton('Refresh evidence').props.onClick());
nativeSnapshot={...nativeSnapshot};
await act(async()=>{tree.update(renderDraft());});
assert.equal(saveDraftButton().props.disabled,false);
assert.equal(tree.root.findAllByProps({role:'alert'}).length,0);
await act(async()=>{tree.unmount();});
console.log('Doctor draft thrown and returned uncertain outcomes preserve edits and block retry until a fresh server snapshot arrives.');

// AI-prepared draft: fills an empty editor, marks each field, blocks saving until each is accepted, edited or rejected,
// never replaces a saved draft without the doctor choosing it, and records which fields were adopted.
{
 const aiDraft={generationId:'0f1d3c55-6a43-4f4e-9d1e-6b5c2a7e9f10',values:{explanation:'AI explanation from code items.',instructions:'- AI step one.',followUp:'AI follow-up.'}};
 const empty={...nativeSnapshot,revision:20,evidenceToken:'evidence-20',draft:null,draftSavedAt:null,draftStale:false};
 await act(async()=>{tree=create(React.createElement(DraftForm,{key:'ai',snapshot:empty,ai:aiDraft}));});
 const field=(name:string)=>tree.root.findAllByType('textarea').find(f=>f.props.name===name)!;
 const button=(label:string)=>tree.root.findAllByType('button').filter(b=>b.children.join('')===label);
 const save=()=>tree.root.findAllByType('button').find(b=>/Save private draft/.test(b.children.join('')))!;
 assert.equal(field('explanation').props.value,'AI explanation from code items.','AI text fills an empty editor');
 assert.equal(button('Accept').length,3,'each AI field is marked');
 assert.equal(save().props.disabled,true,'saving is blocked while AI fields are unchecked');
 await act(async()=>{button('Accept')[0]!.props.onClick();});
 await act(async()=>{field('instructions').props.onChange({target:{value:'- Doctor rewrote this step.'}});});
 assert.equal(button('Accept').length,1,'accepting or editing clears the mark');
 await act(async()=>{button('Reject')[0]!.props.onClick();});
 assert.equal(field('followUp').props.value,'','reject puts back the earlier text');
 assert.equal(save().props.disabled,false,'all fields checked: save allowed');
 await act(async()=>{tree.unmount();});
 await act(async()=>{tree=create(React.createElement(DraftForm,{key:'ai2',snapshot:empty,ai:aiDraft}));});
 await act(async()=>{tree.root.findAllByType('button').find(b=>b.children.join('')==='I checked all, accept all')!.props.onClick();});
 assert.equal(tree.root.findAllByType('button').filter(b=>b.children.join('')==='Accept').length,0,'accept all clears every mark');
 const before=draftRequests.length;
 const data=new FormData();for(const f of [...tree.root.findAllByType('input'),...tree.root.findAllByType('textarea')])data.set(f.props.name,String(f.props.value));
 // The submit handler adds the draft the adopted text came from, so the server can recheck it.
 const submit={preventDefault(){},currentTarget:{}};
 fakeForm.next=data;
 await act(async()=>{tree.root.findByType('form').props.onSubmit(submit);});
 assert.equal(data.get('aiGeneration'),aiDraft.generationId,'the save carries the AI draft id for the freshness check');
 await act(async()=>{finish({ok:true,message:'Draft saved privately.',revision:21});});
 assert.equal(draftRequests.length,before+1);assert.equal(JSON.stringify(adoptions.at(-1)),JSON.stringify({id:aiDraft.generationId,fields:['explanation','instructions','followUp']}),'adopted fields recorded after save');
 await act(async()=>{tree.unmount();});
 const saved={...empty,draft:{...workflow.draft,explanation:'Doctor saved explanation',instructions:'Doctor saved instructions'}};
 await act(async()=>{tree=create(React.createElement(DraftForm,{key:'ai3',snapshot:saved,ai:aiDraft}));});
 assert.equal(field('explanation').props.value,'Doctor saved explanation','a saved doctor draft is never replaced automatically');
 assert.equal(tree.root.findAllByType('button').filter(b=>b.children.join('')==='Accept').length,0);
 fakeWindow.confirm=()=>false;
 await act(async()=>{tree.root.findAllByType('button').find(b=>b.children.join('')==='Put the draft in the editor')!.props.onClick();});
 assert.equal(field('explanation').props.value,'Doctor saved explanation','declining the question keeps the doctor text');
 fakeWindow.confirm=()=>true;
 await act(async()=>{tree.root.findAllByType('button').find(b=>b.children.join('')==='Put the draft in the editor')!.props.onClick();});
 assert.equal(field('explanation').props.value,'AI explanation from code items.');assert.equal(tree.root.findAllByType('button').filter(b=>b.children.join('')==='Accept').length,3);
 await act(async()=>{tree.unmount();});
 // A newer draft never remounts the editor or drops unsaved text (Codex #280 F3).
 const second={generationId:'5a0c1f6e-2b7d-4c39-8e1a-3f9d2c6b7a40',values:{explanation:'Second AI explanation.',instructions:'- Second AI step.',followUp:'Second AI follow-up.'}};
 const el=(snap:typeof empty,ai:typeof aiDraft|null)=>React.createElement(DraftForm,{key:'same',snapshot:snap,ai});
 await act(async()=>{tree=create(el(empty,aiDraft));});
 await act(async()=>{tree.update(el(empty,second));});
 assert.equal(field('explanation').props.value,'Second AI explanation.','untouched editor takes the newer draft by itself');
 await act(async()=>{field('explanation').props.onChange({target:{value:'Doctor typed this.'}});});
 await act(async()=>{tree.root.findAllByType('textarea').find(f=>f.props.name==='medicationDose')!.props.onChange({target:{value:'Doctor dose note'}});});
 fakeWindow.confirm=()=>false;
 await act(async()=>{tree.update(el(empty,aiDraft));});
 assert.equal(field('explanation').props.value,'Doctor typed this.','a newer draft never replaces unsaved doctor text by itself');
 const offer=()=>tree.root.findAllByType('button').find(b=>b.children.join('')==='Put the draft in the editor');
 assert.ok(offer(),'the newer draft is offered beside the editor');
 await act(async()=>{offer()!.props.onClick();});
 assert.equal(field('explanation').props.value,'Doctor typed this.','declining keeps the doctor text');
 fakeWindow.confirm=()=>true;
 await act(async()=>{offer()!.props.onClick();});
 assert.equal(field('explanation').props.value,'AI explanation from code items.','explicit replacement');
 assert.equal(tree.root.findAllByType('textarea').find(f=>f.props.name==='medicationDose')!.props.value,'Doctor dose note','medicine details survive a replacement');
 await act(async()=>{tree.update(el(empty,null));});
 assert.match(tree.root.findAllByProps({role:'alert'}).map(n=>n.children.join('')).join(' '),/changed after this draft was prepared/,'stale AI text is flagged');
 await act(async()=>{tree.unmount();});
 console.log('AI-prepared draft fills only an empty editor, marks fields until accepted, edited or rejected, offers accept all, asks before replacing a saved draft or unsaved text, keeps medicine edits, flags stale AI text and records adopted fields with the draft id.');
}
