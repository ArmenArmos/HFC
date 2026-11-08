// Real ProfileForm hooks and handlers; IO and unrelated presentational controls are isolated.
// If the optional renderer is outside the repo, set NODE_PATH to its node_modules directory.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const rendererPath = require.resolve('react-test-renderer');
const rendererRequire = createRequire(rendererPath);
const React = rendererRequire('react');
const jsx = rendererRequire('react/jsx-runtime');
const {act, create} = require(rendererPath);
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const validation = await import('../lib/patient/validation.ts');
const {tx} = await import('../lib/patient/copy.ts');
const exports = {};
let calls = [], routes = [], refreshes = 0;
const host = tag => function FixtureControl({children, ...props}) { return React.createElement(tag, props, children); };
const modules = {
  react: React, 'react/jsx-runtime': jsx,
  'next/navigation': {useRouter: () => ({replace: path => routes.push(path),refresh: () => refreshes++})},
  '@/app/patient/actions': {saveProfile: async (...args) => {calls.push(args);return {ok:true};}},
  '@/lib/patient/validation': validation,
  '@/lib/patient/transport': {safeRequest: fn => fn(),lockUnavailableMessage: () => 'Unavailable'},
  '@/lib/patient/copy': {tx},
  '@/lib/zoe/consent-copy': await import('../lib/zoe/consent-copy.ts'),
  '@/lib/locale': await import('../lib/locale.ts'),
  './patient-shell': {PatientShell: host('main')},
  './onboarding-steps': {OnboardingSteps: ({step}) => React.createElement('div',{'data-onboarding-step':step})},
  './birth-date-picker': {BirthDatePicker: ({onChange,value}) => React.createElement('input', {id:'birth-date',value,onChange:e => onChange(e.target.value)})},
  '@/components/ui/button': {Button: host('button')},
  '@/components/ui/input': {Input: host('input')},
  '@/components/ui/label': {Label: host('label')},
  'lucide-react': {ArrowLeft: host('i'),ShieldCheck: host('i'),UserRound: host('i')},
  '@/components/patient-care/common': {CareLink: host('a'),IconTile: host('i')},
  '@/lib/patient/signup-draft': {SIGNUP_DRAFT_PREFIX:'noreon.signup.profile.',SIGNUP_DRAFT_MAX_AGE_MS:14*24*3600*1000,sweepSignupDrafts(){}},
  // SelectField's form contract as the native select it keeps underneath (see scripts/select-field-native-stub.ts).
  '@/components/ui/select-field': {SelectField: ({options,value,onValueChange,placeholder,id,name,required,disabled}) => React.createElement('select',{id,name,required,disabled,value,onChange:e => onValueChange?.(e.target.value)},
    ...(placeholder !== undefined ? [React.createElement('option',{key:'placeholder',value:''},placeholder)] : []),
    ...options.map(o => React.createElement('option',{key:o.value,value:o.value,disabled:o.disabled},o.label)))},
};
const code = ts.transpileModule(readFileSync('components/patient/profile-form.tsx','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
new vm.Script(code).runInNewContext({exports,process,require(name){assert.ok(name in modules, name);return modules[name];}});

for (const locale of ['en','hy','ru']) {
  calls=[]; routes=[]; refreshes=0;
  let saved=0, finish, tree;
  const saveAction=(...args)=>{calls.push(args);return new Promise(resolve=>{finish=resolve;});};
  await act(async()=>{tree=create(React.createElement(exports.ProfileForm,{profile:null,expectedRevision:-1,today:'2026-11-01',initialLocale:locale,zoeStatement:true,embedded:true,saveAction,onSaved:()=>saved++}));});
  assert.equal(tree.root.findAllByType('main').length,0,'Embedded consent has no nested app shell');
  for(const [id,value] of [['patient-name','Synthetic member'],['birth-date','01/01/1980'],['patient-sex','female']]) {
    await act(async()=>tree.root.find(n=>typeof n.type==='string'&&n.props.id===id).props.onChange({target:{value}}));
  }
  const submit=(value)=>tree.root.findByType('form').props.onSubmit({preventDefault(){},nativeEvent:{submitter:{value}}});
  await act(async()=>submit());
  assert.equal(calls.length,0,'Moving from details to consent writes nothing');
  const checkbox=tree.root.findByProps({type:'checkbox'});
  assert.equal(checkbox.props.checked,false,'Consent remains explicit');
  await act(async()=>submit('with-zoe'));
  assert.equal(calls.length,0,'Unchecked data consent blocks every Zoe choice');
  await act(async()=>checkbox.props.onChange({target:{checked:true}}));
  await act(async()=>{submit('without-zoe');submit('with-zoe');});
  assert.equal(calls.length,1,'Two synchronous submissions save once');
  assert.equal(calls[0][1],true);
  assert.equal(calls[0][3],false,'Continue without Zoe remains independent from enrolment');
  await act(async()=>finish({ok:true,revision:1}));
  assert.equal(saved,1,'Success goes back to chat');
  assert.deepEqual(routes,[],'No onboarding page redirect');
  await act(async()=>tree.unmount());
}
console.log('Embedded ProfileForm EN/HY/RU: original explicit consent, separate Zoe choice, synchronous double press guarded, custom saved callback and no nested app shell. Mocked actions and controls; browser verification separate.');
