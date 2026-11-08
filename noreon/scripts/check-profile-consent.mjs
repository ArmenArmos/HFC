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
for (const locale of ['en','hy']) {
  calls = []; routes = []; refreshes = 0;
  let tree;
  const attention = [];
  const nodeMock = {createNodeMock: el => ({focus(){attention.push(`focus:${el.props.id ?? el.props.type}`);},scrollIntoView(options){attention.push(JSON.parse(JSON.stringify(options)));}})};
  await act(async () => {tree = create(React.createElement(exports.ProfileForm,{profile:null,expectedRevision:-1,today:'2026-10-15',initialLocale:locale}),nodeMock);});
  const checkbox = () => tree.root.findByProps({type:'checkbox'});
  const alerts = () => tree.root.findAllByProps({role:'alert'});
  const dots = () => tree.root.find(n => n.props['data-onboarding-step'] !== undefined).props['data-onboarding-step'];
  // Sign-up step 3: details only; the consent is its own screen (step 4).
  assert.equal(dots(),3,'Details is sign-up step 3');
  assert.equal(tree.root.findAllByProps({type:'checkbox'}).length,0,'No consent on the details screen');
  // Gohar D-002: no browser validation (its tooltips are English); our own inline messages instead.
  assert.equal(tree.root.findByType('form').props.noValidate,true,'Form opts out of browser validation');
  const field = id => tree.root.find(node => typeof node.type === 'string' && node.props.id === id);
  const errorText = id => tree.root.findAll(n => typeof n.type === 'string' && n.props.id === id).map(n => n.children.join(''))[0];
  await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(dots(),3,'Empty details stay on step 3');
  assert.match(errorText('patient-name-error'),locale === 'en' ? /Enter your name/ : /անունը/);
  assert.match(errorText('patient-sex-error'),locale === 'en' ? /Choose one/ : /Ընտրեք/);
  assert.equal(field('patient-name').props['aria-invalid'],true);
  assert.equal(field('patient-name').props['aria-describedby'],'patient-name-error');
  assert.equal(attention.at(-1),'focus:patient-name','The first field needing attention gets focus');
  // Gohar D-001: digits, symbols, one letter and over 60 characters are refused with a clear message.
  for (const [value,pattern] of [['12345',/letters only|միայն տառեր/],['   ',/Enter your name|անունը/],['A',/at least 2|առնվազն 2/],['a'.repeat(61),/up to 60|60 նիշ/],['Aram!',/letters only|միայն տառեր/]]) {
    await act(async () => field('patient-name').props.onChange({target:{value}}));
    await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
    assert.match(errorText('patient-name-error') ?? '',pattern,`Name ${JSON.stringify(value)} refused`);
    assert.equal(dots(),3);
  }
  for (const [id,value] of [['patient-name','Fictional consent check'],['birth-date','01/01/1980'],['patient-sex','female']]) {
    await act(async () => tree.root.find(node => typeof node.type === 'string' && node.props.id === id).props.onChange({target:{value}}));
  }
  await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(calls.length,0,'Continue on details saves nothing');
  assert.equal(dots(),4,'Consent is sign-up step 4');
  assert.equal(checkbox().props.checked,false,'New members must explicitly opt in');
  assert.equal(checkbox().props.required,undefined,'No browser required validation (Gohar D-002)');
  assert.equal(checkbox().props['aria-required'],'true');
  attention.length = 0;
  await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.deepEqual(attention,['focus:checkbox',{block:'center'}],'Missing consent focuses then centers the checkbox once, leaving room for its inline error');
  assert.equal(calls.length,0,'Missing consent never calls the write action');
  assert.equal(alerts().length,1);
  assert.match(alerts()[0].children.join(''),locale === 'en' ? /agree.*continue/i : /համաձայն/i);
  assert.equal(checkbox().props['aria-invalid'],true);
  assert.equal(checkbox().props['aria-describedby'],alerts()[0].props.id,'Error is associated with the checkbox');
  await act(async () => checkbox().props.onChange({target:{checked:true}}));
  assert.equal(alerts().length,0,'Checking consent clears feedback');
  assert.ok(!checkbox().props['aria-invalid']);
  await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(calls.length,1,'Corrected submission writes once');
  assert.equal(calls[0][1],true);
  assert.equal(calls[0][2],-1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0][0])),{name:'Fictional consent check',birthDate:'1980-01-01',biologicalSex:'female',locale});
  assert.deepEqual(routes,['/patient/ready']);
  assert.equal(refreshes,1);
  assert.equal(calls[0][3],undefined,'Without the Zoe statement no Zoe choice is sent');
  assert.equal(tree.root.findAll(n => n.props['data-zoe-statement'] !== undefined && typeof n.type === 'string').length,0,'No Zoe statement unless offered');
  await act(async () => tree.unmount());
  // Zoe consent at enrolment: the statement is shown with the consent text, Agree is still the
  // one explicit tick (never pre-ticked), and the save says the statement was shown.
  calls = []; routes = [];
  await act(async () => {tree = create(React.createElement(exports.ProfileForm,{profile:null,expectedRevision:-1,today:'2026-10-15',initialLocale:locale,zoeStatement:true}));});
  assert.equal(tree.root.findAll(n => typeof n.type === 'string' && n.props['data-zoe-statement'] !== undefined).length,0,'Statement is on the consent screen, not the details screen');
  for (const [id,value] of [['patient-name','Fictional consent check'],['birth-date','01/01/1980'],['patient-sex','female']]) {
    await act(async () => tree.root.find(node => typeof node.type === 'string' && node.props.id === id).props.onChange({target:{value}}));
  }
  await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  const statement = tree.root.findAll(n => typeof n.type === 'string' && n.props['data-zoe-statement'] !== undefined);
  assert.equal(statement.length,1,'Zoe statement shown at enrolment');
  assert.match(statement[0].children.join(''),locale === 'en' ? /Zoe.*reads your messages.*turn this off/ : /Zoe.*հաղորդագրությունները.*անջատել/);
  assert.equal(checkbox().props.checked,false,'Zoe statement does not pre-tick Agree');
  await act(async () => checkbox().props.onChange({target:{checked:true}}));
  // Fable F1: two choices, nothing pre-ticked. "Continue without Zoe" enrols without Zoe.
  const buttons = tree.root.findAll(n => n.type === 'button' && n.props.type === 'submit');
  assert.equal(buttons.length,3,'Hidden default, Agree and continue, and Continue without Zoe');
  // Fable N2: the first submit button (used by Enter) is a hidden "without Zoe".
  assert.equal(buttons[0].props.value,'without-zoe','Implicit submit defaults to without Zoe');
  assert.equal(buttons[0].props['aria-hidden'],'true');
  assert.equal(buttons[1].props.value,'with-zoe','The visible main button is the explicit yes');
  const without = buttons.find(b => b.props.value === 'without-zoe' && b.props['aria-hidden'] === undefined);
  assert.match(without.children.join(''),locale === 'en' ? /Continue without Zoe/ : /առանց Zoe/);
  await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){},nativeEvent:{submitter:{value:'without-zoe'}}}));
  assert.equal(calls.length,1);
  assert.equal(calls[0][1],true,'Without Zoe still records the enrolment consent');
  assert.equal(calls[0][3],false,'Continue without Zoe sends a no (recorded server-side when due)');
  calls = [];
  await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){},nativeEvent:{submitter:null}}));
  assert.equal(calls.length,1);
  assert.equal(calls[0][3],false,'A submit without the explicit button is a no, never a yes');
  calls = [];
  await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){},nativeEvent:{submitter:{value:'with-zoe'}}}));
  assert.equal(calls.length,1);
  assert.equal(calls[0][1],true);
  assert.equal(calls[0][3],true,'Agree and continue asks for the Zoe enrolment grant');
  await act(async () => tree.unmount());
  // Editing an existing profile never shows the statement or records Zoe consent.
  calls = [];
  await act(async () => {tree = create(React.createElement(exports.ProfileForm,{profile:{name:'Fictional',birthDate:'1980-01-01',biologicalSex:'female',locale},expectedRevision:3,today:'2026-10-15',initialLocale:locale,zoeStatement:true}));});
  assert.equal(tree.root.findAll(n => typeof n.type === 'string' && n.props['data-zoe-statement'] !== undefined).length,0,'No Zoe statement on profile edits');
  await act(async () => tree.root.findByType('form').props.onSubmit({preventDefault(){}}));
  assert.equal(calls[0][3],undefined,'Profile edits never send a Zoe choice');
  await act(async () => tree.unmount());
}
console.log('ProfileForm EN/HY: explicit consent, invalid feedback association, correction clearing, unchanged payload and one successful write passed; Zoe statement shown only at enrolment, Agree not pre-ticked, Zoe grant requested only with the statement shown. Browser focus/native keyboard behavior requires UI verification.');
