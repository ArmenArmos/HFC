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
type Result = { ok: true; revision?: number } | { ok: false; reason: string };
let completion: Result | Promise<Result> = { ok: false, reason: "unavailable" };
let saveFails = false;
let completionCalls = 0;
let refreshes = 0;
const destinations: string[] = [];
const router = { replace: (path: string) => destinations.push(path), push: (path: string) => destinations.push(path), refresh() { refreshes++; } };
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
    window: { innerHeight: 812, addEventListener() {}, removeEventListener() {}, location: { href: "https://test.invalid/patient/questions", origin: "https://test.invalid", reload() {} } },
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
      if (name === "./profile-form") return { ProfileForm: () => null };
      if (name === "./signup-language") return { rememberLocale: () => {}, SignUpLanguage: () => null };
      if (name === "./questionnaire-intro") return { QuestionnaireIntro: () => null };
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
async function mount(locale: "en" | "hy" | "ru", suffix: string, callbacks: { onComplete?: () => void; onLater?: () => void } = {}) {
  const initial: AssessmentDraft = { id: `${locale}-${suffix}`, revision: 7, answers: structuredClone(fixture), assessmentDate: "2026-10-13", completedAt: null, urgentRule: null };
  const fields = activeFields(initial.answers).filter(field => field.topic.id !== "q1");
  assert.ok(fields.every(field => fieldComplete(field, initial.answers)), "Fixture must complete every active field");
  // Short quiet retries (QA M-09): a persistent failure still ends in the visible retry action.
  const session = openQuestionnaireSession(initial, save, [1, 1, 1]);
  const last = fields.at(-1)!;
  session.go(last.id);
  let tree!: ReactTestRenderer;
  await act(async () => { tree = create(React.createElement(Component, { initial, locale, ...callbacks })); });
  return { tree, session, last, previous: fields.at(-2)!, async close() { await act(async () => tree.unmount()); clearQuestionnaireSession(initial.id); } };
}

for (const locale of ["en", "hy", "ru"] as const) {
  completion = { ok: true };
  let completed = 0, paused = 0;
  const labels = locale === "en" ? { finish: "Finish questionnaire", later: "Finish later" }
    : locale === "hy" ? { finish: "Ավարտել հարցաշարը", later: "Ավարտել ավելի ուշ" }
    : { finish: "Завершить анкету", later: "Завершить позже" };
  const success = await mount(locale, "chat-complete", { onComplete: () => completed++, onLater: () => paused++ });
  destinations.length = 0;
  const saveStatus=success.tree.root.findByProps({'aria-live':'polite'});
  assert(saveStatus.props.className.includes('shrink-0')&&saveStatus.props.className.includes('whitespace-nowrap'),'Save status stays whole at narrow chat widths');
  await click(success.tree, labels.finish);
  assert.equal(completed, 1, "Embedded completion stays in its owning conversation");
  assert.deepEqual(destinations, [], "Embedded completion does not open the profile page");
  await success.close();
  const pause = await mount(locale, "chat-pause", { onLater: () => paused++ });
  await click(pause.tree, labels.later);
  assert.equal(paused, 1, "Finish later returns to conversation controls");
  assert.deepEqual(destinations, [], "Embedded pause does not open the dashboard");
  await pause.close();
  completion = { ok: false, reason: "conflict" };
  const conflict = await mount(locale, "chat-stale", { onComplete: () => completed++ });
  await click(conflict.tree, labels.finish);
  assert.equal(completed, 1, "A stale assessment cannot complete the chat step");
  assert.equal(conflict.tree.root.findByType("fieldset").props.disabled, true);
  await conflict.close();
}
for (const locale of ["en", "hy", "ru"] as const) {
  const finish = locale === "en" ? "Finish questionnaire" : locale === "hy" ? "Ավարտել հարցաշարը" : "Завершить анкету";
  const later = locale === "en" ? "Finish later" : locale === "hy" ? "Ավարտել ավելի ուշ" : "Завершить позже";
  let completed = 0, paused = 0;
  completion = {ok:true}; saveFails = true;
  const failed = await mount(locale, "chat-save-failure", {onComplete:()=>completed++,onLater:()=>paused++});
  await act(async()=>failed.tree.root.findByType("fieldset").props.onChange([...failed.session.entries]));
  const before = completionCalls;
  await click(failed.tree, finish);
  await act(async()=>{await failed.session.queue.flush();});
  assert.equal(completionCalls, before, "Failed answer save blocks completion");
  assert.equal(completed, 0);
  await click(failed.tree, later);
  assert.equal(paused, 1, "Failed save can pause in chat without dropping the queued answers");
  assert.ok(failed.session.queue.pending);
  await failed.close(); saveFails = false;
  let settle!: (result:Result)=>void;
  completion = new Promise(resolve=>{settle=resolve;});
  const double = await mount(locale, "chat-double", {onComplete:()=>completed++});
  const action = button(double.tree, finish);
  const called = completionCalls;
  await act(async()=>{action.props.onClick({detail:1});action.props.onClick({detail:1});});
  assert.equal(completionCalls, called + 1, "Two synchronous presses complete once");
  await act(async()=>{settle({ok:true});});
  assert.equal(completed, 1);
  await double.close();
}
for (const locale of ["en", "hy", "ru"] as const) {
  const initial: AssessmentDraft = { id: `chat-urgent-${locale}`, revision: 1, answers: structuredClone(fixture), assessmentDate: "2026-11-01", completedAt: null, urgentRule: null };
  initial.answers["q9.present"].value = "yes";
  initial.answers["q9.right_now"] = { fieldId: "q9.right_now", value: "yes", source: "manual", answeredAt: "2026-11-01T00:00:00Z" };
  let tree!: ReactTestRenderer, escaped = 0;
  await act(async () => { tree = create(React.createElement(Component, { initial, locale, onComplete: () => escaped++, onLater: () => escaped++ })); });
  assert.equal(tree.root.findAllByType("fieldset").length, 0, "Red answer removes questionnaire controls");
  assert.equal(tree.root.findByProps({href:"tel:103"}).type, "a", "Emergency call is immediately available");
  assert.equal(escaped, 0, "Embedded callbacks cannot turn a red answer into completion or pause");
  const urgent = buttons(tree).find(n => n.props.onClick && !n.props.disabled);
  assert.ok(urgent);
  destinations.length = 0;
  await act(async () => urgent.props.onClick());
  assert.deepEqual(destinations, ["/patient/urgent"], "The existing urgent route keeps priority in chat");
  await act(async () => tree.unmount()); clearQuestionnaireSession(initial.id);
}
const { ZoeQuestionnaire: Wrapper } = load<typeof import("../components/patient/zoe-questionnaire")>("components/patient/zoe-questionnaire.tsx");
for (const locale of ["en", "hy", "ru"] as const) {
  const finish = locale === "en" ? "Finish questionnaire" : locale === "hy" ? "Ավարտել հարցաշարը" : "Завершить анкету";
  const later = locale === "en" ? "Finish later" : locale === "hy" ? "Ավարտել ավելի ուշ" : "Завершить позже";
  const resume = locale === "en" ? "Continue my questions" : locale === "hy" ? "Շարունակել իմ հարցերը" : "Продолжить мои вопросы";
  const neutral = locale === "en" ? "You can continue your questions here." : locale === "hy" ? "Կարող եք շարունակել ձեր հարցերն այստեղ։" : "Вы можете продолжить отвечать на вопросы здесь.";
  const initial: AssessmentDraft = {id:`wrapper-exit-${locale}`,revision:7,answers:structuredClone(fixture),assessmentDate:"2026-11-01",completedAt:null,urgentRule:null};
  const session = openQuestionnaireSession(initial, save, [1,1,1]);
  const last = activeFields(initial.answers).filter(f=>f.topic.id!=="q1").at(-1)!;
  session.go(last.id);
  let tree!: ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(Wrapper,{initial,locale}));});
  // A failed queued save must remain recoverable without falsely claiming it was saved.
  saveFails=true;
  await act(async()=>tree.root.findByType("fieldset").props.onChange([...session.entries]));
  await click(tree,finish);
  await act(async()=>{await session.queue.flush();});
  const beforePauseDestinations = destinations.length;
  await click(tree,later);
  assert.equal(tree.root.findAllByType("fieldset").length,0,"Finish later visibly removes the active questionnaire");
  assert.ok(text(tree.root).includes(neutral),"Pause uses neutral wording even when a save failed");
  assert.ok(session.queue.pending,"Pause retains failed saves in browser memory");
  assert.equal(destinations.length,beforePauseDestinations,"Pause remains in the conversation");
  saveFails=false;
  await click(tree,resume);
  assert.equal(tree.root.findByType("fieldset").props["data-field-id"],last.id,"Resume restores the same question");
  await act(async()=>{await session.queue.retry();});
  completion={ok:true};
  const beforeRefresh = refreshes;
  await click(tree,finish);
  assert.equal(tree.root.findAllByType("fieldset").length,0,"Completion seals the form before navigation settles");
  assert.equal(tree.root.findAllByType("button").length,0,"The completed stale form cannot be submitted again");
  assert.equal(destinations.at(-1),"/patient/zoe","Completion removes the questionnaire card URL");
  assert.equal(refreshes,beforeRefresh+1);
  await act(async()=>tree.unmount());clearQuestionnaireSession(initial.id);
  const customInitial = {...initial,id:`${initial.id}-custom`};
  const customSession = openQuestionnaireSession(customInitial,save,[1,1,1]);customSession.go(last.id);
  let customPause=0,customComplete=0;
  const beforeCustomRoutes=destinations.length;
  await act(async()=>{tree=create(React.createElement(Wrapper,{initial:customInitial,locale,onLater:()=>customPause++,onComplete:()=>customComplete++}));});
  await click(tree,later);
  assert.equal(customPause,1,"Custom pause callback is preserved");
  assert.equal(tree.root.findAllByType("fieldset").length,1,"Custom pause owner controls its own visible state");
  await click(tree,finish);
  assert.equal(customComplete,1,"Custom completion callback is preserved");
  assert.equal(tree.root.findAllByType("fieldset").length,0,"Custom completion also seals the stale form");
  assert.equal(destinations.length,beforeCustomRoutes,"Custom callbacks do not trigger default navigation");
  await act(async()=>tree.unmount());clearQuestionnaireSession(customInitial.id);
}
// Editing starts at the first question once; pausing must not restart a saved edit.
{
  const initial: AssessmentDraft = {id:"wrapper-edit-resume",revision:7,answers:structuredClone(fixture),assessmentDate:"2026-11-01",completedAt:"2026-10-31T00:00:00Z",urgentRule:null};
  let tree!: ReactTestRenderer;
  await act(async()=>{tree=create(React.createElement(Wrapper,{initial,locale:"en",startAtFirst:true}));});
  await click(tree,"Continue");
  const position = tree.root.findByType("fieldset").props["data-field-id"];
  await click(tree,"Finish later");
  await click(tree,"Continue my questions");
  assert.equal(tree.root.findByType("fieldset").props["data-field-id"],position,"Pausing an edit does not apply startAtFirst twice");
  await act(async()=>tree.unmount());clearQuestionnaireSession(initial.id);
}
console.log("Chat Questionnaire EN/HY/RU: visible pause/resume preserves failed queues; completion seals the old form and clears its URL; custom callbacks, double press, stale completion and urgent priority pass. Existing clinical/session engine, mocked action/router/field rendering.");
