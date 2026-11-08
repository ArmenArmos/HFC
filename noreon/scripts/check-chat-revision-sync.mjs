/** Actual hook/menu + ordered queue, with local synthetic session/action boundaries. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';
import { AnswerSaveQueue } from '../lib/patient/answer-save-queue.ts';
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const field = { id: 'q2.example', topic: { id: 'q2', index: 2 }, kind: 'single' };
let lastExpected, release, session, state, completionRevision;
let wait;
const deps = {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  'next/navigation': { useRouter: () => ({ replace() {}, refresh() {} }) },
  '@/app/patient/actions': { completeAssessment: async revision => ({ ok: true, revision: revision + 1 }) },
  '@/lib/patient/questionnaire': {
    activeFields: () => [field], assessmentProgress: () => ({ complete: true }), fieldComplete: () => true,
    mergeAnswers: (answers, entries) => ({ ...answers, example: entries[0]?.value }), inputConsistencyIssue: () => null,
    QuestionnaireInputError: class extends Error {},
  },
  '@/lib/patient/answer-transport': {},
  '@/lib/patient/questionnaire-session': {
    openQuestionnaireSession: initial => {
      const queue = new AnswerSaveQueue(initial.revision, async revision => {
        lastExpected = revision;
        if (wait) await wait;
        return { ok: true, revision: revision + 1 };
      });
      session = { id: initial.id, answers: {}, entries: [], fieldId: field.id, dirty: false, queue,
        go(id) { this.fieldId = id; }, edit(entries) { this.entries = entries; },
        accept(entries) { this.answers = { example: entries[0]?.value }; queue.enqueue(entries); return this.answers; },
      };
      return session;
    },
    clearQuestionnaireSession() {}, reopenSavedQuestionnaire() {}, startQuestionnaireAtFirst() {},
  },
  '@/lib/clinical/rules/rules': { firesEmergency: () => null },
  '@/lib/clinical/types': { UNKNOWN: 'unknown' },
  '@/lib/patient/transport': { safeRequest: fn => fn() },
  '@/lib/patient/copy': { tx: (_locale, _hy, en) => en },
  '@/components/ui/button': { Button: 'button' },
};
function load(path, dependencies, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, { exports, Date, performance, requestAnimationFrame: () => 1, cancelAnimationFrame() {}, ...globals,
    require: name => { assert.ok(name in dependencies, name); return dependencies[name]; } });
  return exports;
}
const { useQuestionnaire } = load('components/patient/use-questionnaire.tsx', deps);
function Harness({ externalRevision }) {
  state = useQuestionnaire({ initial: { id: 'synthetic', revision: 2 }, locale: 'en', contained: true, externalRevision,
    onComplete: () => { completionRevision = session.queue.revision; } });
  return null;
}
let tree;
await act(async () => { tree = create(React.createElement(Harness, { externalRevision: 3 })); });
assert.equal(state.revision, 3, 'Confirmed idle language save advances answer revision');
await act(async () => { await state.save([{ fieldId: field.id, value: 'yes' }]); await session.queue.flush(); });
assert.equal(lastExpected, 3, 'Next answer uses language save revision');
assert.equal(state.revision, 4, 'Answer save revision reaches chat');
wait = new Promise(resolve => { release = resolve; });
await act(async () => { void state.save([{ fieldId: field.id, value: 'no' }]); });
await act(async () => { tree.update(React.createElement(Harness, { externalRevision: 7 })); });
assert.equal(session.queue.revision, 4, 'External revision never overwrites pending answer request');
await act(async () => { release(); await session.queue.flush(); });
wait = undefined;
assert.equal(state.revision, 7, 'Higher known revision adopted after pending batch settles');
await act(async () => { tree.update(React.createElement(Harness, { externalRevision: 1 })); });
assert.equal(state.revision, 7, 'Old external revision never rolls back queue');
assert.ok(!Number.isNaN(Date.parse(state.fieldOpenedAt)), 'Question prompt has opening timestamp');
await act(async () => { await state.next([{ fieldId: field.id, value: 'yes' }]); });
assert.equal(completionRevision, 9, 'Completion revision is advanced before onComplete');
assert.equal(state.revision, 9);
await act(async () => tree.unmount());

let languageCalls = 0;
let languageWait;
const { ChatMenu } = load('components/chat-v2/menu.tsx', {
  react: React, 'react/jsx-runtime': require('react/jsx-runtime'),
  '@/app/patient/account/locale-actions': { saveLanguagePreference: async () => { languageCalls++; if (languageWait) await languageWait; return { ok: true, revision: 10 }; } },
  '@/app/patient/actions': { signOut: async () => ({ ok: true }) },
  '@/lib/patient/copy': deps['@/lib/patient/copy'],
}, { document: { activeElement: null } });
await act(async () => { tree = create(React.createElement(ChatMenu, {
  locale: 'en', revision: 9, disabled: true, onLocale() {}, onClose() {}, onSignedOut() {},
})); });
const languageButtons = tree.root.findAllByType('button').filter(button => button.props['aria-pressed'] !== undefined);
assert.ok(languageButtons.every(button => button.props.disabled), 'Language writes unavailable while questionnaire pending');
await act(async () => languageButtons[0].props.onClick());
assert.equal(languageCalls, 0, 'Disabled language action cannot submit even if handler invoked');
await act(async () => tree.unmount());
let releaseLanguage;
languageWait = new Promise(resolve => { releaseLanguage = resolve; });
const languageEvents = [];
await act(async () => { tree = create(React.createElement(ChatMenu, {
  locale: 'en', revision: 9, onLocale: (_locale, revision) => languageEvents.push(revision),
  onClose() {}, onSignedOut() {}, onBusy: busy => languageEvents.push(busy),
})); });
await act(async () => tree.root.findAllByType('button').find(button => button.props['aria-pressed'] === false).props.onClick());
assert.deepEqual(languageEvents, [true], 'Parent locks questionnaire before language request');
await act(async () => tree.unmount());
assert.deepEqual(languageEvents, [true], 'Closing menu keeps in-flight questionnaire lock');
await act(async () => releaseLanguage());
assert.deepEqual(languageEvents, [true, 10, false], 'Confirmed revision reaches parent before questionnaire unlocks');
console.log('Chat revision synchronization, completion ordering and menu write lock pass.');
