/** Actual Anamnesis/useQuestionnaire, clinical fields, session and save queue.
 * Rendering/action/router boundaries are mocked. This is not browser verification. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import type { ReactTestRenderer, ReactTestInstance } from "react-test-renderer";
import type { AssessmentDraft } from "../lib/patient/types";
import type { FieldValue } from "../lib/clinical/types";
import type { Anamnesis, QuestionnaireTurn, answerText as AnswerText } from "../components/chat-v2/anamnesis";
import type { QuestionField } from "../components/patient/question-field";
import type { Button } from "../components/ui/button";
const nodeRequire=createRequire(import.meta.url);
const {create,act}=nodeRequire("react-test-renderer") as typeof import("react-test-renderer");
(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
type Entry={fieldId:string;value:FieldValue|null};
type Result={ok:true;revision:number}|{ok:false;reason:string};
let completionCalls=0, failures=0, attempts=0, effectiveSaves=0;
let persisted!:AssessmentDraft;
let hold:Promise<void>|undefined;
const destinations:string[]=[];
let refreshes=0;
const router={replace:(path:string)=>destinations.push(path),push:(path:string)=>destinations.push(path),refresh() {refreshes++;}};
const onTurn=()=>{};
async function save(revision:number,entries:Entry[]):Promise<Result> {
  attempts++;
  if(hold) await hold;
  if(failures>0) { failures--; return {ok:false,reason:"unavailable"}; }
  assert.equal(revision,persisted.revision,"Save queue must use the latest persisted revision");
  persisted={...persisted,answers:mergeAnswers(persisted.answers,entries),revision:revision+1};
  effectiveSaves++;
  return {ok:true,revision:persisted.revision};
}
const modules = new Map<string, Record<string, unknown>>();
function load<T>(path: string): T {
  const absolute = resolve(path);
  const cached = modules.get(absolute);
  if (cached) return cached as T;
  const exports: Record<string, unknown> = {};
  modules.set(absolute, exports);
  const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new vm.Script(code, { filename: absolute }).runInNewContext({
    exports, Date, Intl, URL, performance, setTimeout, clearTimeout,
    process: { env: { NEXT_PUBLIC_PATIENT_DEMO: "false" } },
    window: { innerHeight: 812, addEventListener() {}, removeEventListener() {}, location: { href: "https://test.invalid/patient/questions", origin: "https://test.invalid", reload() {} } },
    document: { addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    require(name: string): unknown {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/navigation") return { useRouter: () => router };
      if (name === "@/app/patient/actions") return { completeAssessment: async (revision:number) => { completionCalls++; return {ok:true,revision:revision+1}; } };
      if (name === "@/lib/patient/answer-transport") return { saveQuestionnaireAnswers: ({ expectedRevision, entries }: { expectedRevision: number; entries: Entry[] }) => save(expectedRevision, entries) };
      if (name === "@/components/ui/button") return { Button: ({ children, ...props }: React.ComponentProps<typeof Button>) => React.createElement("button", props, children) };
      if (name === "@/components/patient/zoe-emergency-card") return { ZoeEmergencyCard: () => React.createElement("button", {"data-zoe-emergency-card": true}, "Call 103 now") };
      if (name === "./profile-form") return { ProfileForm: () => null };
      if (name === "./questionnaire-intro") return { QuestionnaireIntro: () => null };
      if (name === "./question-field" || name === "@/components/patient/question-field") return { QuestionField: (props: React.ComponentProps<typeof QuestionField>) => React.createElement("fieldset", { ...props, "data-field-id": props.field.id }) };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const stem = name.startsWith("@/") ? resolve(name.slice(2)) : resolve(dirname(absolute), name);
        const file = [stem, `${stem}.ts`, `${stem}.tsx`].find(existsSync);
        if (!file) throw new Error(`Cannot load ${name} from ${absolute}`);
        return load(file);
      }
      throw new Error(`Unexpected module boundary: ${name}`);
    },
  });
  return exports as T;
}
const {Anamnesis:Component,answerText}=load<{Anamnesis:typeof Anamnesis;answerText:typeof AnswerText}>("components/chat-v2/anamnesis.tsx");
const {activeFields,fieldComplete,mergeAnswers}=load<typeof import("../lib/patient/questionnaire")>("lib/patient/questionnaire.ts");
const {openQuestionnaireSession,clearQuestionnaireSession}=load<typeof import("../lib/patient/questionnaire-session")>("lib/patient/questionnaire-session.ts");
const prefix:Record<string,FieldValue>={
  'q2.weight_perception':'ok','q2.height':165,'q2.weight':60,'q2.waist':'unknown',
  'q2.activity':'sedentary','q2.diet':['none'],'q3.status':'never','q4.frequency':'never',
  'q5.diagnosed':'no','q5.last_reading.systolic':120,'q5.last_reading.diastolic':80,
  'q6.conditions':['none'],'q7.relatives':['none'],'q8.sleep_quality':8,'q8.sleep_hours':7,'q8.stress':'no',
};
let nextId=0;
const draft=(values:Record<string,FieldValue>={}):AssessmentDraft=>({
  id:`anamnesis-check-${++nextId}`,revision:0,assessmentDate:'2026-11-01',completedAt:null,urgentRule:null,
  answers:Object.fromEntries(Object.entries({'q1.age':40,'q1.sex':'female',...values}).map(([fieldId,value])=>[
    fieldId,{fieldId,value,source:'manual' as const,answeredAt:'2026-11-01T12:00:00Z'},
  ])),
});
const text=(node:ReactTestInstance):string=>node.children.map(child=>typeof child==='string'?child:text(child)).join('');
const fields=(tree:ReactTestRenderer)=>tree.root.findAllByType('fieldset');
const current=(tree:ReactTestRenderer)=>{assert.equal(fields(tree).length,1,'Exactly one active question');return fields(tree)[0];};
const question=(tree:ReactTestRenderer,id:string)=>assert.equal(current(tree).props.field.id,id);
async function click(tree:ReactTestRenderer,label:string) {
  const button=tree.root.findAllByType('button').find(node=>text(node)===label);
  assert.ok(button,`Missing action ${label}`);assert.ok(!button.props.disabled,`${label} must be enabled`);
  await act(async()=>{await button.props.onClick?.({detail:1});});
}
async function mount(initial=draft(),emergencyCard=true,threadTurns:QuestionnaireTurn[]=[],refreshOnComplete=false) {
  refreshes=0;
  persisted=structuredClone(initial);failures=0;attempts=0;effectiveSaves=0;hold=undefined;destinations.length=0;
  const session=openQuestionnaireSession(initial,save,[1,1,1]);
  let tree!:ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(Component,{initial,locale:'en',emergencyCard,onTurn,threadTurns,refreshOnComplete}));});
  return {tree,session,async close(){await act(async()=>tree.unmount());clearQuestionnaireSession(initial.id);}};
}
async function select(tree:ReactTestRenderer,id:string,value:FieldValue) {
  question(tree,id);
  const field=current(tree);
  assert.ok(field.props.field.options?.some((option:{value:string})=>option.value===value),`Use a real option for ${id}`);
  const entries=[{fieldId:id,value}];
  await act(async()=>{field.props.onChange(entries);await field.props.onSave(entries,true);});
}
async function confirm(tree:ReactTestRenderer) {
  await act(async()=>{await tree.root.findByType('form').props.onSubmit({preventDefault(){}});});
}
const answer=(tree:ReactTestRenderer,id:string)=>tree.root.findAll(node=>node.props['data-answer-id']===id);

{
  const reversed=draft({'q5.last_reading.diastolic':80,'q5.last_reading.systolic':120});
  const field=activeFields(reversed.answers).find(field=>field.id==='q5.last_reading')!;
  assert.equal(answerText(field,reversed.answers,'en'),'120 / 80','Blood pressure remains systolic/diastolic despite database insertion order');
}
{
  const initial=draft({'q2.weight_perception':'ok','q2.height':169});
  initial.answers['q2.weight_perception'].answeredAt='2026-01-01T12:00:00Z';
  initial.answers['q2.height'].answeredAt='2026-01-01T12:02:00Z';
  const view=await mount(initial,true,[{key:'ordinary',at:'2026-01-01T12:01:00Z',node:React.createElement('p',{'data-ordinary-message':true},'Ordinary care-team message')}]);
  await click(view.tree,'Later');
  const timeline=view.tree.root.findAll(node=>!!node.props['data-answer-id']||!!node.props['data-ordinary-message']||(node.type==='article'&&text(node)==='Later'));
  assert.deepEqual(timeline.map(node=>node.props['data-answer-id']??(node.props['data-ordinary-message']?'ordinary':'later')),
    ['q2.weight_perception','ordinary','q2.height','later'],'Saved answers, ordinary thread messages and later choice keep chronological order');
  await view.close();
}

{
  const view=await mount();
  assert.equal(fields(view.tree).length,0,'Questionnaire requires opt-in');
  assert.ok(text(view.tree.root).includes('Would you like to answer a few health questions now?'));
  await click(view.tree,'Later');
  assert.equal(fields(view.tree).length,0);assert.equal(effectiveSaves,0);
  await click(view.tree,'Continue my questions');
  question(view.tree,'q2.weight_perception');
  await select(view.tree,'q2.weight_perception','ok');
  question(view.tree,'q2.height');assert.ok(text(answer(view.tree,'q2.weight_perception')[0]).includes('I think it is normal'));
  assert.equal(view.tree.root.findAllByType('a').length,0,'Anamnesis never renders a leaving link');
  await view.close();
}
{
  const view=await mount();
  await click(view.tree,'Yes, answer now');
  await select(view.tree,'q2.weight_perception','over');
  const before=effectiveSaves;
  await act(async()=>current(view.tree).props.onChange([{fieldId:'q2.height',value:20}]));
  await confirm(view.tree);question(view.tree,'q2.height');
  assert.equal(effectiveSaves,before,'Out-of-bounds numeric answer is never saved');
  assert.ok(view.tree.root.findAllByProps({role:'alert'}).length);
  await act(async()=>current(view.tree).props.onChange([{fieldId:'q2.height',value:169}]));
  assert.equal(effectiveSaves,before,'Changing number alone does not save it');
  await confirm(view.tree);question(view.tree,'q2.weight');
  await act(async()=>{await view.session.queue.flush();});
  assert.equal(persisted.answers['q2.height'].value,169);
  const restored=structuredClone(persisted);
  await view.close();
  const reopened=await mount(restored);
  question(reopened.tree,'q2.weight');
  assert.ok(text(answer(reopened.tree,'q2.height')[0]).includes('169'));
  assert.ok(text(answer(reopened.tree,'q2.weight_perception')[0]).includes('I think I am overweight'));
  assert.ok(!reopened.tree.root.findAllByType('button').some(node=>text(node)==='Yes, answer now'));
  await reopened.close();
}
{
  const view=await mount(draft(prefix));
  question(view.tree,'q9.present');
  await select(view.tree,'q9.present','no');question(view.tree,'q10.symptoms');
  assert.equal(answer(view.tree,'q9.right_now').length,0);
  await click(view.tree,'Change my last answer');question(view.tree,'q9.present');
  await select(view.tree,'q9.present','yes');question(view.tree,'q9.right_now');
  assert.equal(answer(view.tree,'q9.frequency').length,0,'Right-now gate precedes clarifiers');
  await select(view.tree,'q9.right_now','no');question(view.tree,'q9.frequency');
  assert.equal(view.tree.root.findAllByProps({'data-zoe-emergency-card':true}).length,0);
  assert.deepEqual(destinations,[]);
  await view.close();
}
{
  const view=await mount();
  failures=4;
  await click(view.tree,'Yes, answer now');
  await select(view.tree,'q2.weight_perception','ok');
  await act(async()=>{await view.session.queue.flush();});
  assert.equal(effectiveSaves,0);assert.equal(attempts,4);
  assert.equal(view.session.queue.pending,true);
  assert.equal(current(view.tree).props.disabled,true,'Failure disables further answers until retry');
  await click(view.tree,'Retry saving answers');
  assert.equal(effectiveSaves,1);assert.equal(attempts,5);
  assert.equal(persisted.answers['q2.weight_perception'].value,'ok');
  await act(async()=>{await view.session.queue.flush();});
  assert.equal(effectiveSaves,1,'Flushing a retried batch does not write it again');
  await view.close();
}
for(const emergencyCard of [true,false]) {
  const view=await mount(draft(prefix),emergencyCard);
  await select(view.tree,'q9.present','yes');
  await act(async()=>{await view.session.queue.flush();});
  let release!:()=>void;
  hold=new Promise<void>(resolve=>{release=resolve;});
  await select(view.tree,'q9.right_now','yes');
  assert.equal(fields(view.tree).length,0,'Red removes questionnaire controls immediately');
  assert.equal(view.tree.root.findAllByProps({'data-zoe-emergency-card':true}).length,1,'Urgent guidance is immediate while save is pending');
  assert.deepEqual(destinations,[],'Full urgent route waits for recorded answer');
  if(!emergencyCard) failures=4;
  await act(async()=>{release();await view.session.queue.flush();});
  if(!emergencyCard) {
    assert.deepEqual(destinations,[],'Failed urgent save cannot open a route without its recorded answer');
    assert.equal(view.tree.root.findAllByProps({'data-zoe-emergency-card':true}).length,1,'Failed urgent save keeps call guidance');
    await click(view.tree,'Retry saving answers');
  }
  assert.equal(persisted.answers['q9.right_now'].value,'yes');
  assert.deepEqual(destinations,emergencyCard?[]:['/patient/urgent']);
  await view.close();
}
for(const refreshOnComplete of [false,true]) {
  const view=await mount(draft({...prefix,'q9.present':'no'}),true,[],refreshOnComplete);
  const active=activeFields(persisted.answers).filter(field=>!fieldComplete(field,persisted.answers));
  assert.deepEqual(Array.from(active,field=>field.id),['q10.symptoms']);
  const before=completionCalls;
  await select(view.tree,'q10.symptoms','no');
  assert.equal(completionCalls,before+1);
  assert.equal(fields(view.tree).length,0);
  assert.ok(text(view.tree.root).includes('Your questionnaire is complete.'));
  assert.deepEqual(destinations,[],'Completion stays inside chat');
  assert.equal(refreshes,refreshOnComplete?1:0,'Only V3 refreshes the saved assessment and next step after successful completion');
  await view.close();
  const completed=draft({...prefix,'q9.present':'no','q10.symptoms':'no'});
  completed.completedAt='2026-11-01T12:00:00Z';
  const reopened=await mount(completed);
  assert.equal(fields(reopened.tree).length,0);
  assert.ok(text(answer(reopened.tree,'q10.symptoms')[0]).includes('No'));
  await reopened.close();
}
// The Q9.1 app clarifier must enter the new member chat via the shared seed,
// remain required, save, and survive a remount without a chat-specific field list.
for(const symptoms of ['yes','palpitations_only']) {
  const view=await mount(draft({...prefix,'q9.present':'no','q10.symptoms':symptoms,
    ...(symptoms==='yes'?{'q10.right_now':'no'}:{})}));
  question(view.tree,'q10.breathless');
  assert.equal(current(view.tree).props.field.label.en,'Was shortness of breath part of this?');
  const before=completionCalls;
  await confirm(view.tree);
  assert.equal(completionCalls,before,'Missing breathlessness answer blocks completion');
  question(view.tree,'q10.breathless');
  await select(view.tree,'q10.breathless','yes');
  await act(async()=>{await view.session.queue.flush();});
  assert.equal(persisted.answers['q10.breathless'].value,'yes');
  await select(view.tree,'q10.syncope','never');
  await select(view.tree,'q10.rhythm','fast_regular');
  await select(view.tree,'q10.episode_duration','seconds');
  assert.equal(completionCalls,before+1);
  const restored=structuredClone(persisted);
  await view.close();
  restored.completedAt='2026-11-02T00:00:00Z';
  const reopened=await mount(restored);
  assert.ok(text(answer(reopened.tree,'q10.breathless')[0]).includes('Yes'));
  await reopened.close();
}
console.log('Anamnesis: opt-in, pause/resume, validated confirmation, saved history/remount, chest branching/edit, breathlessness required/save/remount, urgent inline/full route, ordered failure/retry and completion pass. Real hooks/clinical/session/queue; mocked rendering/action/router boundaries, no browser proof.');
