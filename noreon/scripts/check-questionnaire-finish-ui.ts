/** Actual Questionnaire hooks, clinical fields, browser-document session and save queue.
 * Action/router and field/button rendering boundaries are mocked; this is not browser proof.
 */
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
import type { Questionnaire } from "../components/patient/questionnaire";
import type { QuestionField } from "../components/patient/question-field";
import type { Button } from "../components/ui/button";

const nodeRequire = createRequire(import.meta.url);
const { create, act } = nodeRequire("react-test-renderer") as typeof import("react-test-renderer");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Result = { ok: true; revision?: number } | { ok: false; reason: string; missing?: string };
let completion: Result | Promise<Result> = { ok: false, reason: "unavailable" };
let saveFails = false;
let completionCalls = 0;
let reloads = 0;
const destinations: string[] = [];
const router = { replace: (path: string) => destinations.push(path), push: (path: string) => destinations.push(path), refresh() {} };
const save = async (revision: number) => saveFails ? { ok: false as const, reason: "unavailable" } : { ok: true as const, revision: revision + 1 };
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
    window: { innerHeight: 812, addEventListener() {}, removeEventListener() {}, location: { href: "https://test.invalid/patient/questions", origin: "https://test.invalid", reload() { reloads++; } } },
    document: { addEventListener() {}, removeEventListener() {} },
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0),
    cancelAnimationFrame: clearTimeout,
    require(name: string): unknown {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/navigation") return { useRouter: () => router };
      if (name === "@/app/patient/actions") return { completeAssessment: async () => { completionCalls++; return completion; } };
      if (name === "@/lib/patient/answer-transport") return { saveQuestionnaireAnswers: ({ expectedRevision }: { expectedRevision: number }) => save(expectedRevision) };
      if (name === "@/components/ui/button") return { Button: ({ children, ...props }: React.ComponentProps<typeof Button>) => React.createElement("button", props, children) };
      if (name === "./question-field") return { QuestionField: (props: React.ComponentProps<typeof QuestionField>) => React.createElement("fieldset", { ...props, "data-field-id": props.field.id }) };
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
const { Questionnaire: Component } = load<{ Questionnaire: typeof Questionnaire }>("components/patient/questionnaire.tsx");
const { activeFields, fieldComplete } = load<typeof import("../lib/patient/questionnaire")>("lib/patient/questionnaire.ts");
const { openQuestionnaireSession, clearQuestionnaireSession } = load<typeof import("../lib/patient/questionnaire-session")>("lib/patient/questionnaire-session.ts");
const fixture = JSON.parse(readFileSync("scripts/fixtures/patient-answers.json", "utf8")) as AssessmentDraft["answers"];
const failures: string[] = [];
function check(name: string, assertion: () => void) {
  try { assertion(); } catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === "string" ? child : text(child)).join("");
function buttons(tree: ReactTestRenderer) { return tree.root.findAllByType("button"); }
function button(tree: ReactTestRenderer, label: string) {
  const found = buttons(tree).find(node => text(node) === label);
  assert.ok(found, `Missing action: ${label}`);
  return found;
}
async function click(tree: ReactTestRenderer, label: string) {
  const node = button(tree, label);
  assert.ok(!node.props.disabled, `Action must be enabled: ${label}`);
  await act(async () => { node.props.onClick({ detail: 1 }); });
}
async function mount(locale: "en" | "hy", suffix: string) {
  const initial: AssessmentDraft = { id: `${locale}-${suffix}`, revision: 7, answers: structuredClone(fixture), assessmentDate: "2026-10-13", completedAt: null, urgentRule: null };
  const fields = activeFields(initial.answers).filter(field => field.topic.id !== "q1");
  assert.ok(fields.every(field => fieldComplete(field, initial.answers)), "Fixture must complete every active field");
  // Short quiet retries (QA M-09): a persistent failure still ends in the visible retry action.
  const session = openQuestionnaireSession(initial, save, [1, 1, 1]);
  const last = fields.at(-1)!;
  session.go(last.id);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(Component, { initial, locale })); });
  return { tree, session, last, previous: fields.at(-2)!, async close() { await act(async () => tree.unmount()); clearQuestionnaireSession(initial.id); } };
}
for (const locale of ["en", "hy"] as const) {
  const labels = locale === "en"
    ? { finish: "Finish questionnaire", retry: "Try again", back: "Back", next: "Continue", later: "Finish later", reopen: "Reopen saved version", save: "Retry saving answers" }
    : { finish: "Ավարտել հարցաշարը", retry: "Փորձել կրկին", back: "Հետ", next: "Շարունակել", later: "Ավարտել ավելի ուշ", reopen: "Վերաբացել պահված տարբերակը", save: "Կրկին պահել պատասխանները" };
  completion = { ok: false, reason: "unavailable" };
  saveFails = false;
  const recovery = await mount(locale, "completion-recovery");
  check(`${locale}: final action names its outcome`, () => button(recovery.tree, labels.finish));
  await click(recovery.tree, labels.finish);
  check(`${locale}: completion failure offers retry`, () => button(recovery.tree, labels.retry));
  assert.equal(recovery.tree.root.findAllByProps({ role: "alert" }).length, 1);
  let settle!: (result:Result)=>void;
  completion = new Promise<Result>(resolve=>{settle=resolve;});
  await click(recovery.tree, labels.retry);
  const waiting = button(recovery.tree, locale === "en" ? "Finishing…" : "Ավարտվում է…");
  assert.equal(waiting.props.disabled,true,"Completion cannot be submitted twice while pending");
  check(`${locale}: retry waiting state removes the previous failure`,()=>assert.equal(recovery.tree.root.findAllByProps({role:"alert"}).length,0));
  await act(async()=>{settle({ok:false,reason:"unavailable"});});

  await click(recovery.tree, labels.back);
  const previousField = recovery.tree.root.findByType("fieldset");
  assert.equal(previousField.props["data-field-id"], recovery.previous.id, "Back actually returns to the previous field");
  check(`${locale}: Back clears stale completion error`, () => assert.equal(recovery.tree.root.findAllByProps({ role: "alert" }).length, 0));
  check(`${locale}: Back restores editing`, () => assert.equal(previousField.props.disabled, false));
  await click(recovery.tree, labels.next);
  assert.equal(recovery.tree.root.findByType("fieldset").props["data-field-id"], recovery.last.id);
  completion = { ok: true };
  const finalAction = buttons(recovery.tree).some(node => text(node) === labels.finish) ? labels.finish : labels.retry;
  await click(recovery.tree, finalAction);
  assert.equal(destinations.at(-1), "/patient/health/profile", "Recovery retry reaches the profile through the actual handler");
  await recovery.close();

  // A finish that fails because details answers are missing says so and links to the details page; missing answers say how to fix them.
  completion = { ok: false, reason: "incomplete", missing: "profile" };
  const missingDetails = await mount(locale, "completion-details");
  await click(missingDetails.tree, labels.finish);
  check(`${locale}: missing details are named with a way forward`, () => {
    const alert = missingDetails.tree.root.findAllByProps({ role: "alert" }).map(text).join(" ");
    assert.match(alert, locale === "en" ? /date of birth or sex is missing/ : /ծննդյան ամսաթիվը կամ սեռը/);
    assert.ok(missingDetails.tree.root.findAll(node => node.type === "a" && node.props.href === "/patient/profile").length >= 1, "a link to the details page");
  });
  await missingDetails.close();
  completion = { ok: false, reason: "incomplete", missing: "answers" };
  const missingAnswers = await mount(locale, "completion-answers");
  await click(missingAnswers.tree, labels.finish);
  check(`${locale}: missing answers say to go back through the sections`, () => {
    const alert = missingAnswers.tree.root.findAllByProps({ role: "alert" }).map(text).join(" ");
    assert.match(alert, locale === "en" ? /answers are missing or no longer count/ : /որոշ պատասխաններ բացակայում են/);
  });
  await missingAnswers.close();

  completion = { ok: false, reason: "conflict" };
  const conflict = await mount(locale, "completion-conflict");
  await click(conflict.tree, labels.finish);
  check(`${locale}: conflict offers only reopen as enabled recovery`, () => {
    const enabled = buttons(conflict.tree).filter(node => !node.props.disabled).map(text);
    assert.deepEqual(enabled, [labels.reopen]);
  });
  check(`${locale}: conflict disables Back`, () => assert.equal(button(conflict.tree, labels.back).props.disabled, true));
  assert.equal(button(conflict.tree, labels.later).props.disabled, true);
  const beforeReload = reloads;
  await click(conflict.tree, labels.reopen);
  assert.equal(reloads, beforeReload, "Reopen must warn before discarding any local answers");
  const cancelLabel = locale === "en" ? "Keep my answers" : "Պահել իմ պատասխանները";
  const discardLabel = locale === "en" ? "Discard unsaved answers and reopen" : "Հեռացնել չպահված պատասխանները և վերաբացել";
  assert.ok(text(conflict.tree.root).includes(locale === "en" ? "unsaved answers" : "չպահված պատասխանները"));
  await click(conflict.tree, cancelLabel);
  assert.equal(reloads,beforeReload,"Cancel preserves the local conflict and answers");
  await click(conflict.tree, labels.reopen);
  await click(conflict.tree, discardLabel);
  assert.equal(reloads, beforeReload + 1, "Confirmed reopen invokes browser-document session recovery");
  await conflict.close();

  completion = { ok: true };
  saveFails = true;
  const saving = await mount(locale, "answer-save-failure");
  const entries = saving.session.entries.map(entry => ({ ...entry }));
  await act(async () => saving.tree.root.findByType("fieldset").props.onChange(entries));
  const beforeCompletion = completionCalls;
  await click(saving.tree, labels.finish);
  await act(async () => { await saving.session.queue.flush(); });
  assert.equal(completionCalls, beforeCompletion, "Failed answer saves must block final completion");
  check(`${locale}: failed save exposes retry`, () => button(saving.tree, labels.save));
  check(`${locale}: failed save has no dead enabled finish/continue`, () => assert.ok(!buttons(saving.tree).some(node => !node.props.disabled && [labels.next, labels.finish, labels.retry].includes(text(node)))));
  // Review item 8: a recorded failure no longer traps the member. Finish later leaves, and the
  // failed batch stays in this tab's memory for the retry on return.
  check(`${locale}: failed save keeps Finish later enabled`, () => assert.equal(button(saving.tree, labels.later).props.disabled, false));
  await click(saving.tree, labels.later);
  assert.equal(destinations.at(-1), "/patient/dashboard", "Finish later leaves after a failed save");
  assert.notEqual(saving.session.queue.failure, undefined, "Leaving keeps the failure for the retry");
  assert.equal(saving.session.queue.pending, true, "Leaving keeps the unsaved batch");
  saveFails = false;
  await click(saving.tree, labels.save);
  assert.equal(saving.session.queue.failure, undefined);
  assert.equal(saving.session.queue.pending, false, "Retry really flushes retained answers");
  await click(saving.tree, labels.finish);
  assert.equal(completionCalls, beforeCompletion + 1);
  assert.equal(destinations.at(-1), "/patient/health/profile");
  await saving.close();
}
// Blank optional waist continues as explicit UNKNOWN, never as a normal measurement.
for (const locale of ["en", "hy"] as const) for (const cleared of [false,true]) {
  saveFails = false;
  const initial: AssessmentDraft = {id:`${locale}-blank-waist-${cleared}`,revision:7,answers:structuredClone(fixture),assessmentDate:"2026-10-13",completedAt:null,urgentRule:null};
  if (!cleared) delete initial.answers["q2.waist"];
  // Short quiet retries (QA M-09): a persistent failure still ends in the visible retry action.
  const session = openQuestionnaireSession(initial, save, [1, 1, 1]);
  session.go("q2.waist");
  let tree!: ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(Component,{initial,locale}));});
  if (cleared) await act(async()=>tree.root.findByType("fieldset").props.onChange([{fieldId:"q2.waist",value:null}]));
  await click(tree,locale === "en" ? "Continue" : "Շարունակել");
  assert.equal(session.answers["q2.waist"]?.value,"unknown","Blank optional waist Continue stores UNKNOWN");
  assert.notEqual(tree.root.findByType("fieldset").props["data-field-id"],"q2.waist","Blank optional waist advances");
  assert.match(text(tree.root),locale === "en" ? /Question 5 in this section/ : /Հարց 5 այս բաժնում/,"Skip reports the actual next position within the section");
  await act(async()=>tree.unmount());
  clearQuestionnaireSession(initial.id);
}
// Required measurements and entered-invalid waist still block continuation.
for (const [fieldId, value] of [["q2.height",null],["q2.weight",null],["q2.waist",39]] as const) {
  const initial: AssessmentDraft = {id:`invalid-${fieldId}`,revision:7,answers:structuredClone(fixture),assessmentDate:"2026-10-13",completedAt:null,urgentRule:null};
  delete initial.answers[fieldId];
  const session=openQuestionnaireSession(initial,save);session.go(fieldId);
  let tree!: ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(Component,{initial,locale:"en"}));});
  if(value !== null) await act(async()=>tree.root.findByType("fieldset").props.onChange([{fieldId,value}]));
  await click(tree,"Continue");
  assert.equal(tree.root.findByType("fieldset").props["data-field-id"],fieldId,`${fieldId} cannot skip a required or entered-invalid measurement`);
  assert.equal(session.answers[fieldId],undefined);
  await act(async()=>tree.unmount());clearQuestionnaireSession(initial.id);
}
for (const locale of ["en","hy"] as const) {
 const initial:AssessmentDraft={id:`feedback-${locale}`,revision:1,answers:structuredClone(fixture),assessmentDate:"2026-10-15",completedAt:null,urgentRule:null};
 delete initial.answers["q2.height"];
 const session=openQuestionnaireSession(initial,save);session.go("q2.height");
 let reveals=0;
 const scrollOptions:unknown[]=[];
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(Component,{initial,locale}),{createNodeMock:element=>(element.props as {role?:string}).role==="alert"?{
   getBoundingClientRect:()=>({top:900,bottom:940}),
   scrollIntoView:(options:unknown)=>{reveals++;scrollOptions.push(options);},
 }:null});});
 const content=()=>text(tree.root);
 assert.match(content(),locale==="en"?/Section 2 of 10/:/Բաժին 2՝ 10-ից/,"Progress names sections, not a fixed screen total");
 assert.ok(!content().includes(locale==="en"?"profile was section 1":"տվյալները բաժին 1-ն էին"),"The profile explanation does not repeat on later questions");
 const slot=tree.root.findByProps({"data-questionnaire-feedback":true});
 assert.equal(tree.root.findAllByProps({role:"alert"}).length,0);
 await act(async()=>tree.root.findByType("fieldset").props.onChange([{fieldId:"q2.height",value:1}]));
 let prevented=false;
 await act(async()=>tree.root.findByProps({"data-questionnaire-answer":true}).props.onKeyDown({key:"Enter",target:{tagName:"INPUT",getAttribute:()=>"number"},preventDefault(){prevented=true;}}));
 assert.ok(prevented,"Numeric Enter uses the same validation action as Continue");
 assert.equal(session.entries[0].value,1,"Invalid feedback retains the typed draft");
 assert.equal(session.answers["q2.height"],undefined,"Invalid draft is never stored as an answer");
 assert.equal(tree.root.findByProps({"data-questionnaire-feedback":true}),slot,"Validation uses the pre-existing feedback region");
 assert.equal(tree.root.findAllByProps({role:"alert"}).length,1,"Validation is announced");
 assert.equal(reveals,1,"First invalid Enter reveals an offscreen error");
 const revisionBeforeRepeat=session.queue.revision;
 await act(async()=>tree.root.findByProps({"data-questionnaire-answer":true}).props.onKeyDown({key:"Enter",target:{tagName:"INPUT",getAttribute:()=>"number"},preventDefault(){}}));
 assert.equal(reveals,2,"Repeated identical invalid Enter reveals the offscreen error again");
 assert.ok(scrollOptions.every(options=>JSON.stringify(options)===JSON.stringify({block:"nearest"})),"Validation reveals without moving input focus");
 assert.equal(session.entries[0].value,1);
 assert.equal(session.answers["q2.height"],undefined);
 assert.equal(session.queue.revision,revisionBeforeRepeat,"Repeated invalid draft does not write an answer");
 assert.equal(session.queue.pending,false);
 await act(async()=>tree.root.findByType("fieldset").props.onChange([{fieldId:"q2.height",value:170}]));
 await click(tree,locale==="en"?"Continue":"Շարունակել");
 assert.equal(Object.values(session.answers).find(answer=>answer.fieldId==="q2.height")?.value,170);
 assert.equal(tree.root.findByType("fieldset").props["data-field-id"],"q2.weight");
 await click(tree,locale==="en"?"Back":"Հետ");
 assert.equal(tree.root.findByType("fieldset").props["data-field-id"],"q2.height");
 assert.equal(session.entries[0].value,170,"Back restores the actual chosen answer");
 await click(tree,locale==="en"?"Back":"Հետ");
 assert.match(content(),locale==="en"?/profile was section 1/:/տվյալները բաժին 1-ն էին/,"The first question in section 2 explains the completed profile");
 await act(async()=>tree.unmount());clearQuestionnaireSession(initial.id);
}
for (const locale of ["en","hy"] as const) for (const choice of ["never","former"] as const) {
 const initial:AssessmentDraft={id:`branch-progress-${locale}-${choice}`,revision:1,answers:structuredClone(fixture),assessmentDate:"2026-10-15",completedAt:null,urgentRule:null};
 for(const id of Object.keys(initial.answers).filter(id=>id.startsWith("q3."))) delete initial.answers[id];
 const session=openQuestionnaireSession(initial,save);session.go("q3.status");
 let tree!:ReactTestRenderer;
 await act(async()=>{tree=create(React.createElement(Component,{initial,locale}));});
 assert.match(text(tree.root),locale==="en"?/Section 3 of 10/:/Բաժին 3՝ 10-ից/);
 assert.equal(tree.root.findAllByProps({"data-questionnaire-feedback":true}).length,0,"Single-choice without an error adds no empty feedback gap");
 await act(async()=>tree.root.findByType("fieldset").props.onSave([{fieldId:"q3.status",value:choice}],true));
 const destination=tree.root.findByType("fieldset").props["data-field-id"];
 assert.equal(destination,choice==="never"?"q4.frequency":"q3.years","Clinical branch still determines the next field");
 assert.match(text(tree.root),choice==="never"?(locale==="en"?/Section 4 of 10/:/Բաժին 4՝ 10-ից/):(locale==="en"?/Question 2 in this section/:/Հարց 2 այս բաժնում/));
 await act(async()=>tree.unmount());
 await act(async()=>{tree=create(React.createElement(Component,{initial,locale}));});
 assert.equal(tree.root.findByType("fieldset").props["data-field-id"],destination,"Resume retains the actual branch position");
 await click(tree,locale==="en"?"Back":"Հետ");
 assert.equal(tree.root.findByType("fieldset").props["data-field-id"],"q3.status");
 assert.match(text(tree.root),locale==="en"?/Question 1 in this section/:/Հարց 1 այս բաժնում/);
 await act(async()=>tree.unmount());clearQuestionnaireSession(initial.id);
}
assert.equal(failures.length, 0, `Questionnaire finish/recovery regressions:\n${failures.join("\n")}`);
console.log("EN/HY actual Questionnaire completion, recovery, conflict and failed-answer-save flows pass with mocked network/router/rendering boundaries. Browser verification remains separate.");
