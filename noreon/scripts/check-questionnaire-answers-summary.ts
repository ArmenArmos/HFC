/** QA 175: a completed questionnaire opens as a read-only summary, and editing starts at the first question. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { answerSummary } from "@/lib/patient/answer-summary";
import { QuestionnaireSession, startQuestionnaireAtFirst } from "@/lib/patient/questionnaire-session";
import { QuestionnaireAnswers } from "@/components/patient/questionnaire-answers";
import { activeFields } from "@/lib/patient/questionnaire";
import { UNKNOWN, type Answers, type FieldValue } from "@/lib/clinical/types";

const at = "2026-10-20T08:00:00Z";
const answer = (fieldId: string, value: FieldValue) => ({ fieldId, value, source: "manual" as const, answeredAt: at });
const answers: Answers = Object.fromEntries([
  answer("q1.age", 52), answer("q1.sex", "female"),
  answer("q2.height", 168), answer("q2.waist", UNKNOWN),
  answer("q5.diagnosed", "treated"), answer("q5.last_reading.systolic", 135), answer("q5.last_reading.diastolic", 85),
].map((a) => [a.fieldId, a]));

const sections = answerSummary(answers, "en");
assert.ok(sections.length > 0);
assert.ok(sections.every((s) => s.id !== "q1"), "The profile section stays on the profile page, as in the form");
assert.deepEqual(sections.map((s) => s.index), [...sections.map((s) => s.index)].sort((a, b) => a - b), "Sections follow the form order");
const rows = Object.fromEntries(sections.flatMap((s) => s.rows).map((r) => [r.id, r.value]));
assert.equal(rows["q2.height"], "168 cm");
assert.equal(rows["q2.waist"], "I don't know", "UNKNOWN reads as its own answer, never as normal");
assert.equal(rows["q5.diagnosed"], "Yes, and I take medication for it", "Options show their label, not the stored code");
assert.match(rows["q5.last_reading"], /^135\/85/, "A blood pressure reading shows both numbers");
assert.equal(answerSummary(answers, "ru").flatMap((s) => s.rows).find((r) => r.id === "q5.diagnosed")?.value, "Да, и я принимаю лекарства от давления");

for (const locale of ["en", "hy", "ru"] as const) {
  const html = renderToStaticMarkup(createElement(QuestionnaireAnswers, { answers, locale }));
  assert.ok(html.includes('href="/patient/questions?edit=1"'), "The summary offers an explicit edit entry");
  assert.ok(!/<input|<textarea|<select/.test(html), "The summary is read-only");
  assert.ok(!html.includes("—"), "No em dashes in member copy");
}
const en = renderToStaticMarkup(createElement(QuestionnaireAnswers, { answers, locale: "en" }));
assert.match(en, /Your doctor will see your changes\./);
assert.ok(!/review(s|ed)? (each|every)/i.test(en), "No promise of per-change review");

// Editing starts at the first question of the form, unless this tab holds an unsaved draft.
const draft = { id: "a1", revision: 4, assessmentDate: "2026-10-20", answers, completedAt: at, urgentRule: null };
const first = activeFields(answers).find((f) => f.topic.id !== "q1")!.id;
const session = new QuestionnaireSession(draft, async () => null, []);
session.go("q5.diagnosed");
startQuestionnaireAtFirst(session);
assert.equal(session.fieldId, first);
session.go("q5.diagnosed");
session.edit([{ fieldId: "q5.diagnosed", value: "no" }]);
startQuestionnaireAtFirst(session);
assert.equal(session.fieldId, "q5.diagnosed", "An unsaved edit keeps its place");

// The page routes a completed questionnaire to the summary and keeps the edit path open.
const page = readFileSync("app/patient/questions/page.tsx", "utf8");
assert.match(page, /assessment\.completedAt && !editing/);
assert.match(page, /startAtFirst=\{edit === "1"\}/);
console.log("questionnaire answers summary ok");
