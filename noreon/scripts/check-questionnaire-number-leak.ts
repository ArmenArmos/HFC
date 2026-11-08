/** Real questionnaire/anamnesis, controls, hooks, session and queue in React's client renderer.
 * Only network/router and browser APIs are doubled. This is not browser gesture proof. */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import type { ReactTestInstance, ReactTestRenderer } from "react-test-renderer";
import type { AssessmentDraft } from "../lib/patient/types";
import type { PatientLocale } from "../lib/patient/copy";

const require = createRequire(import.meta.url);
const { create, act } = require("react-test-renderer") as typeof import("react-test-renderer");
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const browser = new EventTarget();
const documentEvents = new EventTarget();
const router = { push() {}, replace() {}, refresh() {} };
const save = async (revision: number) => ({ ok: true as const, revision: revision + 1 });
const modules = new Map<string, Record<string, unknown>>();
function load<T>(path: string): T {
  const absolute = resolve(path);
  if (modules.has(absolute)) return modules.get(absolute) as T;
  const exports: Record<string, unknown> = {};
  modules.set(absolute, exports);
  const code = ts.transpileModule(readFileSync(absolute, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new vm.Script(code, { filename: absolute }).runInNewContext({
    exports, Date, Intl, URL, performance, setTimeout, clearTimeout,
    process: { env: { NEXT_PUBLIC_PATIENT_DEMO: "false" } },
    window: Object.assign(browser, { innerHeight: 812, localStorage: { getItem: () => null },
      location: { href: "https://test.invalid/patient/questions", origin: "https://test.invalid" } }),
    document: Object.assign(documentEvents, { getElementById: () => null }),
    requestAnimationFrame: (callback: () => void) => setTimeout(callback, 0), cancelAnimationFrame: clearTimeout,
    require(name: string): unknown {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return jsx;
      if (name === "next/navigation") return { useRouter: () => router };
      if (name === "@/app/patient/actions") return { completeAssessment: save };
      if (name === "@/lib/patient/answer-transport") return {
        saveQuestionnaireAnswers: ({ expectedRevision }: { expectedRevision: number }) => save(expectedRevision),
      };
      if (name === "@/components/patient/zoe-emergency-card") return { ZoeEmergencyCard: () => null };
      if (name.startsWith("@/") || name.startsWith(".")) {
        const stem = name.startsWith("@/") ? resolve(name.slice(2)) : resolve(dirname(absolute), name);
        const file = [stem, `${stem}.ts`, `${stem}.tsx`].find(existsSync);
        assert.ok(file, `Cannot load ${name} from ${absolute}`);
        return load(file);
      }
      return require(name);
    },
  });
  return exports as T;
}
const { Questionnaire } = load<typeof import("../components/patient/questionnaire")>("components/patient/questionnaire.tsx");
const { Anamnesis } = load<typeof import("../components/chat-v2/anamnesis")>("components/chat-v2/anamnesis.tsx");
const { openQuestionnaireSession, clearQuestionnaireSession } = load<typeof import("../lib/patient/questionnaire-session")>("lib/patient/questionnaire-session.ts");
const fixture = JSON.parse(readFileSync("scripts/fixtures/patient-answers.json", "utf8")) as AssessmentDraft["answers"];
const failures: string[] = [];
async function check(name: string, run: () => Promise<void>) {
  try { await run(); console.log(`PASS ${name}`); }
  catch (error) { failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`); }
}
let sequence = 0;
async function mount(chat: boolean, fieldId: string, locale: PatientLocale = "en") {
  const answers = structuredClone(fixture);
  answers["q3.status"].value = "current";
  delete answers["q3.years"];
  delete answers["q3.per_day"];
  if (fieldId === "q5.last_reading") {
    delete answers["q5.last_reading.systolic"];
    delete answers["q5.last_reading.diastolic"];
  }
  const initial: AssessmentDraft = { id: `number-leak-${++sequence}`, revision: 0, answers,
    assessmentDate: "2026-11-05", completedAt: null, urgentRule: null };
  const session = openQuestionnaireSession(initial, save);
  session.go(fieldId);
  // Preserve the selected field through the chat controller's initial resume logic.
  session.edit(session.entries);
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(chat ? React.createElement(Anamnesis, { initial, locale, emergencyCard: true, onTurn() {} })
      : React.createElement(Questionnaire, { initial, locale }));
  });
  return { tree, session, async close() { await act(async () => tree.unmount()); clearQuestionnaireSession(initial.id); } };
}
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === "string" ? child : text(child)).join("");
const input = (tree: ReactTestRenderer, id: string) => tree.root.findAllByType("input").find(node => node.props.id === id)!;
function value(tree: ReactTestRenderer, id: string, expected: string | number) {
  assert.equal(input(tree, id)?.props.value, expected, `${id} box`);
}
async function type(node: ReactTestInstance, raw: string) {
  await act(async () => node.props.onChange({ target: { value: raw }, currentTarget: { value: raw }, nativeEvent: { defaultPrevented: false } }));
}
async function click(tree: ReactTestRenderer, label: string) {
  const button = tree.root.findAllByType("button").find(node => text(node) === label);
  assert.ok(button, `Missing action ${label}`);
  assert.ok(!button.props.disabled, `${label} enabled`);
  await act(async () => button.props.onClick({ detail: 1, currentTarget: { isConnected: false } }));
}
async function next(tree: ReactTestRenderer, chat: boolean) {
  if (chat) await act(async () => tree.root.findByType("form").props.onSubmit({ preventDefault() {} }));
  else await click(tree, "Continue");
}
async function back(tree: ReactTestRenderer, chat: boolean) { await click(tree, chat ? "Change my last answer" : "Back"); }
function unset(tree: ReactTestRenderer, id: string) {
  const slider = tree.root.findByProps({ id: `${id}-slider-unset` });
  assert.equal(slider.props["aria-valuenow"], undefined, "Unanswered slider has no committed value");
  return slider;
}
function pointer(type: string, clientX: number) {
  browser.dispatchEvent(Object.assign(new Event(type), { clientX }));
}
async function touch(tree: ReactTestRenderer, id: string, x: number, pointerType = "touch") {
  await act(async () => unset(tree, id).props.onPointerDown({ pointerType, button: 0, clientX: x,
    preventDefault() {}, currentTarget: { getBoundingClientRect: () => ({ left: 0, width: 100 }) } }));
}

for (const chat of [false, true]) {
  const path = chat ? "chat" : "web";
  await check(`${path}: typed answers, empty next box/slider, own answers on Back`, async () => {
    const view = await mount(chat, "q3.years");
    try {
      await type(input(view.tree, "q3.years"), "7");
      value(view.tree, "q3.years", 7);
      assert.equal(input(view.tree, "q3.years-slider").props.value, 7);
      await next(view.tree, chat);
      value(view.tree, "q3.per_day", "");
      assert.equal(unset(view.tree, "q3.per_day").findAllByType("span")[1].props.style.left, "10.00%");
      await type(input(view.tree, "q3.per_day"), "12");
      await next(view.tree, chat);
      await back(view.tree, chat);
      value(view.tree, "q3.per_day", 12);
      await back(view.tree, chat);
      value(view.tree, "q3.years", 7);
      assert.equal(view.session.answers["q3.per_day"].value, 12);
    } finally { await view.close(); }
  });
  await check(`${path}: BP upper and lower remain independent`, async () => {
    const view = await mount(chat, "q5.last_reading");
    try {
      value(view.tree, "q5.last_reading.systolic", "");
      value(view.tree, "q5.last_reading.diastolic", "");
      await type(input(view.tree, "q5.last_reading.systolic"), "125");
      value(view.tree, "q5.last_reading.diastolic", "");
      await type(input(view.tree, "q5.last_reading.diastolic"), "85");
      value(view.tree, "q5.last_reading.systolic", 125);
      value(view.tree, "q5.last_reading.diastolic", 85);
      await next(view.tree, chat);
      await back(view.tree, chat);
      value(view.tree, "q5.last_reading.systolic", 125);
      value(view.tree, "q5.last_reading.diastolic", 85);
    } finally { await view.close(); }
  });
  await check(`${path}: a late edit on the previous control cannot fill the next question`, async () => {
    const view = await mount(chat, "q3.years");
    try {
      const previousBox = input(view.tree, "q3.years");
      await type(previousBox, "7");
      await next(view.tree, chat);
      // Model an input event still arriving on the previous native control.
      // Detached controls receive no further browser events. A reused control
      // instead dispatches through the new question's handler.
      if (view.tree.root.findAllByType("input").includes(previousBox)) await type(previousBox, "7");
      value(view.tree, "q3.per_day", "");
      unset(view.tree, "q3.per_day");
      assert.equal(view.session.answers["q3.per_day"], undefined);
    } finally { await view.close(); }
  });
  await check(`${path}: first touch commits, old gesture cannot overwrite a revisited answer`, async () => {
    const view = await mount(chat, "q3.years");
    try {
      await touch(view.tree, "q3.years", 20, "mouse");
      value(view.tree, "q3.years", 16);
      await next(view.tree, chat);
      value(view.tree, "q3.per_day", "");
      await back(view.tree, chat);
      value(view.tree, "q3.years", 16);
      // A gesture begun on the old question must be over after navigation,
      // even when the member returns before its final browser event arrives.
      await act(async () => pointer("pointermove", 50));
      value(view.tree, "q3.years", 16);
    } finally { await act(async () => pointer("pointercancel", 50)); await view.close(); }
  });
  await check(`${path}: touch tap commits its landing point and scroll cancellation stays blank`, async () => {
    const view = await mount(chat, "q3.per_day");
    try {
      await touch(view.tree, "q3.per_day", 7);
      value(view.tree, "q3.per_day", "");
      await act(async () => pointer("pointercancel", 7));
      value(view.tree, "q3.per_day", "");
      await touch(view.tree, "q3.per_day", 7);
      await act(async () => pointer("pointerup", 7));
      value(view.tree, "q3.per_day", 7);
    } finally { await view.close(); }
  });
}
for (const locale of ["hy", "ru"] as const) {
  await check(`${locale}: comma decimal in chat stays local and saves numerically`, async () => {
    const view = await mount(true, "q8.sleep_hours", locale);
    try {
      await type(input(view.tree, "q8.sleep_hours"), "7,");
      value(view.tree, "q8.sleep_hours", "7,");
      await type(input(view.tree, "q8.sleep_hours"), "7,5");
      value(view.tree, "q8.sleep_hours", "7,5");
      await next(view.tree, true);
      assert.equal(view.session.answers["q8.sleep_hours"].value, 7.5);
      assert.equal(input(view.tree, "q8.sleep_hours"), undefined, "The next question has no decimal draft");
      await click(view.tree, locale === "hy" ? "Փոխել վերջին պատասխանը" : "Изменить последний ответ");
      value(view.tree, "q8.sleep_hours", 7.5);
    } finally { await view.close(); }
  });
}

if (failures.length) { console.error(failures.join("\n")); process.exitCode = 1; }
else console.log("Questionnaire number isolation passes. Real controls/state; synthetic IO and pointer events, not browser proof.");
