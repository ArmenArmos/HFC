import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { act, create } from 'react-test-renderer';
import * as validation from '../lib/patient/validation.ts';

// Local component check only: no auth, database, provider, or network calls.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const require = createRequire(import.meta.url);
const calls = [];
const router = { replace: href => calls.push(href), refresh: () => calls.push('refresh') };
const exports = {};
const ui = name => ({ [name]: name });
const deps = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  'next/navigation': { useRouter: () => router },
  '@/app/patient/actions': { saveProfile: async () => { throw Error('Unexpected real save'); } },
  '@/lib/patient/validation': validation,
  '@/lib/patient/transport': { safeRequest: action => action() },
  '@/lib/patient/copy': { tx: (_locale, _hy, en) => en },
  '@/lib/locale': { clinicalLocale: locale => locale },
  './patient-shell': ui('PatientShell'),
  './birth-date-picker': ui('BirthDatePicker'),
  '@/components/ui/button': ui('Button'),
  '@/components/ui/input': ui('Input'),
  '@/components/ui/label': ui('Label'),
  'lucide-react': { ArrowLeft: 'ArrowLeft', ShieldCheck: 'ShieldCheck', UserRound: 'UserRound' },
  '@/components/patient-care/common': { CareLink: 'CareLink', IconTile: 'IconTile' },
  '@/components/ui/select-field': ui('SelectField'),
  '@/lib/zoe/consent-copy': { zoeStatement: () => '' },
  './onboarding-steps': ui('OnboardingSteps'),
  '@/lib/patient/signup-draft': {},
};
vm.runInNewContext(ts.transpileModule(readFileSync('components/patient/profile-form.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, require: name => { assert.ok(name in deps, name); return deps[name]; } });

const profile = { name: 'Example', birthDate: '1990-01-01', biologicalSex: 'female', locale: 'en' };
async function exercise({ enabled = false, embedded = false, existing = false, ok = true }) {
  calls.length = 0;
  let saves = 0;
  let renderer;
  await act(async () => { renderer = create(React.createElement(exports.ProfileForm, {
    profile: existing ? profile : null, expectedRevision: -1, today: '2026-11-01', initialLocale: 'en',
    memberChatV2: enabled, embedded,
    ...(embedded ? { onSaved: () => calls.push('embedded-saved') } : {}),
    saveAction: async (_input, consent) => { assert.equal(consent, true); saves++; return { ok }; },
  })); });
  if (!existing) {
    await act(async () => {
      renderer.root.findByProps({ id: 'patient-name' }).props.onChange({ target: { value: 'Example' } });
      renderer.root.findByType('BirthDatePicker').props.onChange('01/01/1990');
      renderer.root.findByProps({ id: 'patient-sex' }).props.onValueChange('female');
    });
  }
  const submit = async () => { await act(async () => { renderer.root.findByType('form').props.onSubmit({ preventDefault() {} }); }); };
  if (!existing) {
    await submit();
    assert.equal(saves, 0, 'Details step never saves or navigates');
    assert.deepEqual(calls, []);
    await submit();
    assert.equal(saves, 0, 'Consent is required before saving or navigating');
    assert.deepEqual(calls, []);
    await act(async () => { renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }); });
  }
  await submit();
  assert.equal(saves, 1);
  const expected = !ok ? [] : !existing && enabled ? ['/patient/chat', 'refresh']
    : embedded ? ['embedded-saved'] : [existing ? '/patient/account' : '/patient/ready', 'refresh'];
  assert.deepEqual(calls, expected);
  await act(async () => renderer.unmount());
}
for (const enabled of [false, true]) for (const embedded of [false, true]) {
  await exercise({ enabled, embedded });
  await exercise({ enabled, embedded, existing: true });
  await exercise({ enabled, embedded, ok: false });
}
console.log('Profile routing: consent, flag on/off, embedded, edits and failed save pass.');

// Run both server entry points with synthetic member state, including the legacy
// chat-only redirect to embedded onboarding. Only the exact string enables v2.
function loadPage(path, flag) {
  const result = {};
  const serverDeps = {
    '@/lib/patient/member-chat-config': { memberChatOnlyEnabled: () => path.includes('/zoe/') },
    '@/lib/patient/repository': { getPatientState: async () => ({ profile: null, assessment: null, consentAccepted: false }) },
    '@/lib/patient/auth': { patientIdentity: async () => ({ userId: 'synthetic-member' }) },
    'next/headers': { cookies: async () => ({ get: () => undefined }) },
    '@/lib/locale': { parseLocale: () => 'en' },
    '@/lib/patient/validation': { dateInArmenia: () => '2026-11-01' },
    '@/lib/zoe/member': { readZoePrompt: async () => ({ due: false }) },
    '@/components/patient/profile-form': { ProfileForm: 'ProfileForm' },
    '@/components/patient/zoe-questionnaire': { ZoeQuestionnaireOnboarding: 'ZoeQuestionnaireOnboarding' },
    '@/lib/zoe-chat-actions/everyday-contract': { isMemberCardTarget: () => false },
    '@/components/patient-care/common': { copy: (_locale, en) => en },
    'react/jsx-runtime': require('react/jsx-runtime'),
    react: React,
    'next/navigation': { redirect: href => { throw Error(`Unexpected redirect: ${href}`); } },
  };
  vm.runInNewContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports: result, process: { env: { NOREON_MEMBER_CHAT_V2: flag } },
    require: name => serverDeps[name] ?? new Proxy({}, { get: (_target, key) => key }),
  });
  return result.default;
}
function findOnboarding(element) {
  if (!React.isValidElement(element)) return null;
  if (element.type === 'ProfileForm' || element.type === 'ZoeQuestionnaireOnboarding') return element;
  for (const child of React.Children.toArray(element.props.children)) {
    const match = findOnboarding(child);
    if (match) return match;
  }
  return null;
}
for (const path of ['app/patient/profile/page.tsx', 'app/patient/zoe/page.tsx']) {
  for (const flag of [undefined, '', 'false', 'TRUE', '1', 'true']) {
    const element = findOnboarding(await loadPage(path, flag)());
    assert.ok(element, `${path} renders onboarding`);
    assert.equal(element.props.memberChatV2, flag === 'true', `${path}, flag=${flag}`);
  }
}
console.log('Both server onboarding entry points enable chat v2 only for exact true.');
