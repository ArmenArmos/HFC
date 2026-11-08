import * as textLanguage from '@/lib/text-language';
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as common from "@/components/patient-care/common";
import * as icons from "lucide-react";
import * as dateFormat from "@/lib/patient/date-format";
import { ResultHistory } from "@/components/patient-care/result-history";
import type { CareResult } from "@/lib/patient-care/types";
import type { ReminderOccurrence } from "@/lib/patient-care/reminders";

// Mock only the action boundary; inspect the actual routine render and the
// exact DueDose passed to the unchanged working control.
const exports: Record<string, unknown> = {};
let passedDose: unknown;
const code = ts.transpileModule(readFileSync("components/patient-care/daily-routine.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new vm.Script(code).runInNewContext({ exports, require: (name: string) => {
  if (name === '@/lib/text-language') return textLanguage;
  if (name === "react/jsx-runtime") return jsx;
  if (name === "./common") return common;
  if (name === "lucide-react") return icons;
  if (name === "@/lib/patient/date-format") return dateFormat;
  if (name === "./controls") return { DoseButtons: ({ dose }: { dose: unknown }) => { passedDose = dose; return createElement("button", {}, "Dose action"); } };
  throw new Error(name);
}});
const Routine = exports.DailyRoutine as (props: { occurrences: ReminderOccurrence[]; locale: "en" | "hy"; compact?: boolean }) => ReturnType<typeof createElement>;
const instructions = "Take with water.\nKeep the complete prescribed instructions visible when opened.";
const occurrence: ReminderOccurrence = { id: "dose", kind: "medication", dueAt: "2026-10-12T08:00:00Z", reminderAt: "2026-10-12T08:00:00Z", status: "upcoming", dose: { dueAt: "2026-10-12T08:00:00Z", status: "upcoming", medication: { id: "med", planId: "plan", name: "Example medicine", dose: "5 mg", instructions, times: ["12:00"], startDate: "2026-10-12", endDate: null, active: true } } };
for (const locale of ["en", "hy"] as const) {
  const localizedOccurrence: ReminderOccurrence = { ...occurrence, dose: { ...occurrence.dose!, medication: { ...occurrence.dose!.medication, instructions: locale === "en" ? occurrence.dose!.medication.instructions : "Ընդունեք ջրով։\nՊահպանեք նշանակված ամբողջական ցուցումները։" } } };
  const html = renderToStaticMarkup(createElement(Routine, { occurrences: [localizedOccurrence], locale, compact: true }));
  assert.ok(html.includes(localizedOccurrence.dose!.medication.instructions), "Compact routine retains full multiline prescription instructions");
  assert.equal(passedDose, localizedOccurrence.dose, "Dose status and action eligibility pass through unchanged");
  const doseLabel = locale === "en" ? "Recorded dose time" : "Գրանցված ընդունման ժամը";
  assert.ok(!html.includes(doseLabel), "Identical reminder/dose timestamps are not repeated");
  const shifted = renderToStaticMarkup(createElement(Routine, { occurrences: [{ ...localizedOccurrence, reminderAt: "2026-10-12T07:45:00Z" }], locale, compact: true }));
  assert.ok(shifted.includes(doseLabel), "A reminder offset retains the actual prescribed dose time");
  const home = renderToStaticMarkup(createElement(Routine, { occurrences: [localizedOccurrence], locale }));
  assert.ok(!home.includes(doseLabel), "Home also avoids repeating identical reminder/dose timestamps");
  const result: CareResult = { id: "r", testId: null, marker: "Example marker", value: 8, unit: "mmol/L", referenceLow: null, referenceHigh: null, collectedAt: "2026-10-12T08:00:00Z", receivedAt: "2026-10-12T09:00:00Z", source: "laboratory", sourceLabel: "Full laboratory provenance", reviewedAt: "2026-10-12T10:00:00Z", reviewedBy: "Example clinician", explanation: "Full review explanation" };
  const lab = renderToStaticMarkup(createElement(ResultHistory, { results: [result], locale }));
  const summary = lab.slice(lab.indexOf("<summary"), lab.indexOf("</summary>"));
  const visibleResult = lab.slice(0, lab.indexOf("<details"));
  assert.ok(visibleResult.includes("Example marker") && visibleResult.includes("8"), "The value is visible before the source-history disclosure");
  assert.ok(visibleResult.includes(result.reviewedBy!), "Latest reviewer attribution is visible without opening history");
  assert.ok(!summary.includes(result.sourceLabel), "Provenance stays in its labelled disclosure rather than displacing the value");
  assert.ok(lab.includes(result.sourceLabel) && lab.includes(result.explanation!) && lab.includes(result.reviewedBy!));
  assert.ok(!lab.includes(locale === "en" ? "Within the lab range" : "Լաբորատոր միջակայքում"), "Missing bounds never become a normal result");
  const second = {...result, id:"second", marker:"Second marker"};
  const sharedNotes = renderToStaticMarkup(createElement(ResultHistory, {results:[result, second], locale}));
  assert.equal(sharedNotes.split(result.explanation!).length - 1, 1, "An identical reviewer, review time and explanation appears once across markers");
  assert.ok(sharedNotes.includes("Example marker (mmol/L) · Second marker (mmol/L)"), "Shared notes explicitly identify every covered marker and unit");
  assert.equal(sharedNotes.split(result.sourceLabel).length - 1, 2, "Both results retain their own provenance");
  const separateNotes = renderToStaticMarkup(createElement(ResultHistory, {results:[result, {...second, reviewedAt:"2026-10-13T10:00:00Z"}], locale}));
  assert.equal(separateNotes.split(result.explanation!).length - 1, 2, "Different review times retain distinct notes even when the text matches");
}
console.log("Actual EN/HY compact routines retain full instructions, distinct times and unchanged dose props; marker rows retain provenance/review while unknown ranges remain unknown.");
