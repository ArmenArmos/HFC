import assert from "node:assert/strict";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { evaluate, needsAttention } from "@/lib/clinical/rules/engine";
import type { Answers } from "@/lib/clinical/types";
import { UNKNOWN } from "@/lib/clinical/types";
import { THRESHOLD } from "@/lib/clinical/rules/rules";

const answers: Answers = Object.fromEntries(
  Object.entries({
    "q9.at_rest": "yes",
    "q10.syncope": "rest",
    "q10.episode_duration": "over_30",
  }).map(([fieldId, value]) => [
    fieldId,
    { fieldId, value, source: "manual", answeredAt: "2026-10-07T00:00:00Z" },
  ]),
);
const findings = evaluate({ answers, observations: [] }).findings.filter(
  (f) => f.urgency === "orange" && f.ruleId.startsWith("RF-"),
);
assert.equal(findings.length, 3);
const source = await readFile("components/patient/profile-summary.tsx", "utf8");
const temporary = "scripts/.patient-summary-check.mjs";
await writeFile(
  temporary,
  ts.transpileModule(source, {
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText,
);
try {
  const { ProfileSummary } = await import(
    pathToFileURL(process.cwd() + "/" + temporary).href
  );
  const makeAnswers = (values: Record<string, string | number | string[]>): Answers => Object.fromEntries(
    Object.entries(values).map(([fieldId, value]) => [fieldId, { fieldId, value, source: "manual", answeredAt: "2026-10-07T00:00:00Z" }]),
  );
  const raised = makeAnswers({ "q5.last_reading.systolic": 155, "q5.last_reading.diastolic": 95 });
  const raisedMarkup = renderToStaticMarkup(createElement(ProfileSummary, { answers: raised, locale: "en" }));
  assert.ok(raisedMarkup.includes("Repeated blood pressure measurement"));
  assert.ok(raisedMarkup.includes("155/95 mmHg"));
  assert.ok(!raisedMarkup.includes("148/92"), "Do not reuse seeded BP rationale");
  assert.ok(!raisedMarkup.includes("father with a heart attack at 52"), "Do not reuse fictional family history");
  assert.ok(raisedMarkup.includes("Confirm the suggested tests with your clinician"), "Suggested tests require clinician confirmation");
  assert.match(raisedMarkup, /<details[^>]*open=""[^>]*>[\s\S]*Tests and measurements to discuss/, "Existing test suggestions are expanded on entry");
  const corrected = makeAnswers({ "q5.last_reading.systolic": 120, "q5.last_reading.diastolic": 80 });
  const correctedMarkup = renderToStaticMarkup(createElement(ProfileSummary, { answers: corrected, locale: "en" }));
  assert.ok(!correctedMarkup.includes("Repeated blood pressure measurement"), "Changing answers removes an inapplicable test");
  const urgent = makeAnswers({ "q5.last_reading.systolic": 190, "q5.last_reading.diastolic": 115, "q5.crisis_symptoms": ["headache"] });
  const urgentMarkup = renderToStaticMarkup(createElement(ProfileSummary, { answers: urgent, locale: "en" }));
  assert.ok(urgentMarkup.includes("Call 103 now"));
  assert.ok(!urgentMarkup.includes("Tests and measurements to discuss"), "Emergency guidance suppresses the routine plan");
  const unknown = makeAnswers({ "q5.last_reading.systolic": UNKNOWN, "q5.last_reading.diastolic": UNKNOWN });
  const unknownMarkup = renderToStaticMarkup(createElement(ProfileSummary, { answers: unknown, locale: "en" }));
  assert.ok(unknownMarkup.includes("Information still to clarify"));
  assert.ok(!unknownMarkup.includes("Repeated blood pressure measurement"), "Unknown BP is not elevated BP");
  for (const locale of ["en", "hy"] as const) {
    const kidneyMarkup=renderToStaticMarkup(createElement(ProfileSummary,{answers:makeAnswers({"q6.conditions":["kidney"]}),locale}));
    assert.ok(kidneyMarkup.includes(locale==='en'?'You reported kidney disease':'Դուք նշել եք երիկամների հիվանդություն'),'Reported kidney history has a dedicated visible summary');
    assert.ok(!correctedMarkup.includes('You reported kidney disease'),'Absent history must not acquire a kidney diagnosis');
    assert.ok(!kidneyMarkup.includes('potassium-enriched salt'),'No potassium-salt advice is supplied for kidney disease');
    const unknownWaistMarkup = renderToStaticMarkup(createElement(ProfileSummary, { answers: makeAnswers({ "q2.waist": UNKNOWN }), locale }));
    const unknownLabel = locale === "en" ? "Unknown" : "Անհայտ";
    assert.ok(unknownWaistMarkup.includes(`text-right">${unknownLabel}</dd>`), "Explicitly unknown saved waist is labeled Unknown");
    assert.ok(!unknownWaistMarkup.includes(" cm</dd>"), "Unknown waist must not display a numeric measurement");
  }
  const nextAction = createElement("a", { href: "/patient/dashboard" }, "Go to Today");
  const orangeMarkup = renderToStaticMarkup(createElement(ProfileSummary, { answers, locale: "en", nextAction }));
  for (const finding of findings) {
    assert.ok(orangeMarkup.indexOf(finding.nextStep!.en!) < orangeMarkup.indexOf("Go to Today"), "Full orange consultation guidance precedes routine navigation");
  }
  assert.ok(!orangeMarkup.includes("Your health profile"));
  assert.ok(!orangeMarkup.includes("From your answers to your next steps"));
  assert.ok(raisedMarkup.includes("Tests and measurements to discuss"));
  assert.ok(!orangeMarkup.includes("Your saved answers"), "Do not show an empty saved measurements section");
  const measurementsMarkup = renderToStaticMarkup(createElement(ProfileSummary, { answers: makeAnswers({ "q2.height": 180, "q2.weight": 80 }), locale: "en" }));
  assert.ok(measurementsMarkup.includes("Your saved answers"));
  assert.ok(measurementsMarkup.includes("180 cm"));
  const actionMarkup = renderToStaticMarkup(createElement(ProfileSummary, { answers: raised, locale: "en", nextAction }));
  assert.ok(actionMarkup.includes("Go to Today"));
  assert.ok(actionMarkup.includes("Tests and measurements to discuss"), "Questionnaire suggestions stay available to discuss");
  assert.ok(!actionMarkup.includes('href="/patient/service"'), "The summary does not claim a current test plan");
  const emergencyWithAction = renderToStaticMarkup(createElement(ProfileSummary, { answers: urgent, locale: "en", nextAction }));
  assert.ok(!emergencyWithAction.includes("Go to Today"), "Emergency suppresses routine navigation");
  assert.ok(emergencyWithAction.includes('href="tel:103"'), "Emergency has an immediate call action");
  for (const finding of evaluate({ answers: urgent, observations: [] }).findings.filter((f) => f.urgency === "red")) {
    if (finding.detail) assert.ok(emergencyWithAction.includes(finding.detail.en!));
    if (finding.nextStep) assert.ok(emergencyWithAction.includes(finding.nextStep.en!));
  }
  for (const locale of ["en", "hy"] as const) {
    const markup = renderToStaticMarkup(
      createElement(ProfileSummary, { answers, locale }),
    );
    for (const finding of findings) {
      assert.ok(
        markup.includes(finding.reason[locale]!),
        `Missing reason ${finding.ruleId}`,
      );
      assert.ok(
        markup.includes(finding.nextStep![locale]!),
        `Missing next step ${finding.ruleId}`,
      );
    }
    const empty = renderToStaticMarkup(
      createElement(ProfileSummary, { answers: {}, locale }),
    );
    assert.ok(
      !empty.includes("RF-"),
      "Missing answers must not invent registry findings",
    );
    for (const scenario of [
      { name: "red", answers: urgent },
      { name: "orange", answers },
      { name: "routine", answers: raised },
    ]) {
      const decision = evaluate({ answers: scenario.answers, observations: [] });
      const shown = scenario.name === "red"
        ? decision.findings.filter((finding) => finding.urgency === "red")
        : needsAttention(decision);
      assert.ok(shown.length > 0, `${scenario.name} fixture must exercise guidance`);
      const summary = renderToStaticMarkup(createElement(ProfileSummary, { answers: scenario.answers, locale, nextAction }));
      assert.ok(!/RF-\d+|NRN-[A-Z0-9-]+|Rule source|Կանոնի աղբյուրը/.test(summary), `${scenario.name}/${locale}: member guidance omits internal provenance labels and identifiers`);
      for (const finding of shown) {
        if (finding.source) assert.ok(!summary.includes(finding.source), `${scenario.name}/${locale}: internal source is omitted`);
        for (const text of [finding.reason, finding.detail, finding.nextStep]) {
          if (!text) continue;
          const expected = renderToStaticMarkup(createElement("span", null, text[locale] ?? text.hy)).replace(/^<span>|<\/span>$/g, "");
          assert.ok(summary.includes(expected), `${scenario.name}/${locale}: exact clinical guidance retained for ${finding.ruleId}`);
        }
      }
      if (scenario.name === "red") {
        assert.ok(summary.includes('href="tel:103"'));
        assert.ok(summary.includes('href="/patient/urgent"'));
        assert.ok(!summary.includes("Go to Today"), "Emergency precedence suppresses routine navigation");
        assert.ok(!summary.includes(locale === "en" ? "Tests and measurements to discuss" : "Հետազոտություններ՝ քննարկման համար"));
      } else {
        assert.ok(summary.includes("Go to Today"), "Non-emergency next action remains available");
      }
    }
  }
  const pageSource = await readFile("app/patient/health/profile/page.tsx", "utf8");
  const pageTemporary = "scripts/.patient-summary-page-check.mjs";
  try {
    const scenarios = [
      { name: "completed", answers: raised, completedAt: "2026-10-07T00:00:00Z" },
      { name: "orange", answers, completedAt: "2026-10-07T00:00:00Z" },
      { name: "red", answers: urgent, completedAt: "2026-10-07T00:00:00Z" },
      { name: "partial", answers: raised, completedAt: null },
      { name: "empty", answers: {}, completedAt: null },
    ];
    for (const scenario of scenarios) {
      const fixture = { profile: { locale: "en" }, assessment: scenario };
      const mockedPage = pageSource
        .replace(/import \{ getServiceWorkflow \} from [^;]+;/, "const getServiceWorkflow = async () => ({});")
        .replace(/import \{ requireRegistered \} from [^;]+;/, `const requireRegistered = async () => (${JSON.stringify(fixture)});`)
        .replace(/import \{ PatientShell \} from [^;]+;/, "const PatientShell = ({ children }) => children;")
        .replace(/import \{ ProfileSummary \} from [^;]+;/, 'import { ProfileSummary } from "./.patient-summary-check.mjs";');
      await writeFile(pageTemporary, ts.transpileModule(mockedPage, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      }).outputText);
      const { default: HealthProfile } = await import(pathToFileURL(process.cwd() + "/" + pageTemporary).href + "?" + scenario.name);
      const markup = renderToStaticMarkup(await HealthProfile());
      assert.equal((markup.match(/<h1 /g) ?? []).length, 1);
      assert.ok(markup.includes("Your health summary"));
      if (scenario.name === "red") {
        assert.ok(markup.includes('href="tel:103"'));
        assert.ok(!markup.includes("Go to Today"));
        assert.ok(!markup.includes("Review answers"));
        assert.ok(!markup.includes("Tests and measurements to discuss"));
      } else if (scenario.name === "orange") {
        for (const finding of findings) assert.ok(markup.indexOf(finding.nextStep!.en!) < markup.indexOf("Go to Today"));
      } else if (scenario.name === "partial" || scenario.name === "empty") {
        assert.ok(markup.includes("Continue questionnaire"));
        assert.ok(!markup.includes("Go to Today"));
      } else {
        assert.ok(markup.includes("Your answers are saved."));
        assert.ok(markup.includes("Go to Today"));
        assert.ok(markup.includes("Review answers"));
      }
    }
  } finally {
    await unlink(pageTemporary);
  }

} finally {
  await unlink(temporary);
}
for (const file of [
  "components/patient/questionnaire.tsx",
  "app/patient/urgent/page.tsx",
]) {
  assert.match(
    await readFile(file, "utf8"),
    /href="tel:103"/,
    `${file} must offer an immediate emergency call`,
  );
}
assert.match(
  await readFile("components/patient/patient-shell.tsx", "utf8"),
  /lang=\{locale\}/,
);
assert.match(
  await readFile("components/patient/birth-date-picker.tsx", "utf8"),
  /<DialogContent\s+lang=\{locale\}/,
);
assert.match(
  await readFile("app/patient/measurements/page.tsx", "utf8"),
  /Armenia time \(UTC\+4\)/,
);
assert.match(
  await readFile("components/patient/sign-out-button.tsx", "utf8"),
  /safeSignOut\(signOut\)/,
);
assert.match(
  await readFile("app/patient/account/page.tsx", "utf8"),
  /<SignOutButton/,
);
console.log(
  "Patient review: exact red/orange/routine guidance renders bilingually without internal provenance UI; urgent calls, language ancestry, and timezone labels are retained.",
);

const crisisAnswers: Answers = Object.fromEntries(
  Object.entries({
    "q5.last_reading.systolic": THRESHOLD.crisisSystolic,
    "q5.last_reading.diastolic": THRESHOLD.crisisDiastolic,
    "q5.crisis_symptoms": UNKNOWN,
  }).map(([fieldId, value]) => [
    fieldId,
    { fieldId, value, source: "manual", answeredAt: "2026-10-07T00:00:00Z" },
  ]),
);
assert.ok(
  !evaluate({ answers: crisisAnswers, observations: [] }).findings.some(
    (f) => f.ruleId === "RF-06",
  ),
  "Unknown symptoms must not be interpreted as explicitly absent symptoms",
);
crisisAnswers["q5.crisis_symptoms"].value = ["none"];
assert.ok(
  evaluate({ answers: crisisAnswers, observations: [] }).findings.some(
    (f) => f.ruleId === "RF-06",
  ),
);
