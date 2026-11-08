import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { medicineReportDays } from "@/lib/patient-care/journey-evidence";
import { MedicineCalendar } from "@/components/patient-care/medicine-calendar";
import type { CareData, Medication } from "@/lib/patient-care/types";

const now = new Date("2026-10-12T10:00:00Z");
const empty: CareData = { plan: null, tests: [], results: [], appointments: [], events: [] };
const medicine: Medication = { id: "m", planId: "p", name: "Recorded medicine", dose: "5 mg", instructions: "Recorded instructions", active: true, startDate: "2026-10-01", endDate: null, times: ["12:00"] };
const plan = (medications: Medication[], publishedAt = "2026-10-11T07:00:00Z"): CareData => ({ ...empty, plan: { id: "p", clinician: "Recorded clinician", publishedAt, acknowledgedAt: null, instructions: "Plan instructions", medications } });
const daysFor = (care: CareData) => medicineReportDays(care.events, now, care);
const missingDays = (care: CareData) => daysFor(care).filter(d => d.schedule === "scheduled" && !d.taken && !d.skipped);
assert.ok(daysFor(empty).every(d => d.schedule === "not-scheduled"));
assert.equal(missingDays(empty).length, 0);
const current = plan([medicine]);
assert.equal(missingDays(current).length, 2, "Publication excludes pre-publication days even if the start date is earlier");
assert.ok(daysFor(current).filter(d => d.day < "2026-10-11").every(d => d.schedule === "not-scheduled"));
assert.equal(missingDays(plan([{ ...medicine, startDate: "2026-10-13" }])).length, 0, "A future start does not invent missing reports");
assert.equal(missingDays(plan([{ ...medicine, endDate: "2026-10-11" }])).length, 1, "The recorded end date is inclusive and later days are not scheduled");
assert.equal(missingDays(plan([{ ...medicine, active: false }])).length, 0, "Cancelled medicines do not create inferred no-report days");
assert.equal(missingDays(plan([{ ...medicine, planId: "other" }])).length, 0, "A medicine from another plan does not schedule doses here");
assert.equal(missingDays(plan([medicine], "2026-10-11T09:00:00Z")).length, 1, "A same-day dose before publication is not scheduled");
assert.equal(missingDays(plan([{ ...medicine, effectiveAt: "2026-10-12T09:00:00Z" }])).length, 0, "Medicine effective time uses the same boundary as dose entry");
const unknown = plan([{ ...medicine, startDate: "" }]);
assert.ok(daysFor(unknown).every(d => d.schedule === "unknown"), "An unavailable start date does not invent a prescribed range");
assert.equal(missingDays(unknown).length, 0);
for (const bad of [{ ...medicine, times: ["25:00"] }, { ...medicine, endDate: "invalid" }, { ...medicine, startDate: "2026-02-30" }]) assert.ok(daysFor(plan([bad])).every(d => d.schedule === "unknown"));
const report = { medicationId: "m", dueAt: "2026-10-10T08:00:00Z", recordedAt: "2026-10-10T09:00:00Z", status: "taken" as const, revision: 1 };
const historical = { ...plan([{ ...medicine, active: false }]), events: [report, { ...report, status: "skipped" as const, revision: 2, recordedAt: "2026-10-10T10:00:00Z" }] };
assert.equal(daysFor(historical).find(d => d.day === "2026-10-10")?.skipped, 1, "Real corrected historical reports survive cancellation and absent inferred schedules");
assert.equal(daysFor(historical).find(d => d.day === "2026-10-10")?.taken, 0);
assert.equal(daysFor({ ...empty, events: [report] }).find(d => d.day === "2026-10-10")?.taken, 1, "Real reports survive an absent current plan");
const statusDays: ReturnType<typeof medicineReportDays> = [
  { day: "2026-10-07", schedule: "scheduled", taken: 2, skipped: 0 },
  { day: "2026-10-08", schedule: "scheduled", taken: 0, skipped: 1 },
  { day: "2026-10-09", schedule: "scheduled", taken: 1, skipped: 1 },
  { day: "2026-10-10", schedule: "scheduled", taken: 0, skipped: 0 },
  { day: "2026-10-11", schedule: "not-scheduled", taken: 0, skipped: 0 },
  { day: "2026-10-12", schedule: "unknown", taken: 0, skipped: 0 },
];
for (const locale of ["en", "hy"] as const) {
  const statusHtml = renderToStaticMarkup(createElement(MedicineCalendar, { days: statusDays, locale, compact: true }));
  const cells = [...statusHtml.matchAll(/<button[^>]*aria-label="([^"]+)"[^>]*>[\s\S]*?<strong>([^<]+)<\/strong><\/button>/g)];
  assert.equal(cells.length, 6, "All reporting and schedule states remain selectable");
  assert.equal(new Set(cells.map(cell => cell[1])).size, 6, "Every state retains a distinct accessible description");
  assert.deepEqual(cells.map(cell => cell[2]), ["✓", "!", "✓!", "○", "–", "?"], "Mixed reports and scheduled missing reports do not masquerade as skipped/unknown schedule");
  assert.ok(statusHtml.includes(locale === "en" ? "3 reported taken" : "3 նշված է ընդունված"));
  assert.ok(statusHtml.includes(locale === "en" ? "2 reported skipped" : "2 նշված է բաց թողնված"));
  assert.ok(statusHtml.includes(locale === "en" ? "1 scheduled days with no report" : "1 նախատեսված օր առանց նշման"));

  const render = (care: CareData) => renderToStaticMarkup(createElement(MedicineCalendar, { days: daysFor(care), locale, compact: true }));
  const noPlan = render(empty);
  assert.ok(noPlan.includes(locale === "en" ? "No medicine doses are scheduled in this period." : "Այս ժամանակահատվածում դեղի ընդունումներ նախատեսված չեն։"));
  assert.ok(!noPlan.includes("<button") && !noPlan.includes("28"), "No-plan renders one empty state without an unknown-day grid/count");
  const html = render(current);
  assert.ok(html.includes(locale === "en" ? "2 scheduled days with no report" : "2 նախատեսված օր առանց նշման"));
  assert.ok(html.includes("<strong>–</strong>"), "Pre-schedule days render a dash");
  const past = render(historical);
  assert.ok(past.includes(locale === "en" ? "1 reported skipped" : "1 նշված է բաց թողնված") && past.includes("<strong>!</strong>"));
  assert.ok(render(unknown).includes(locale === "en" ? "Medicine schedule dates are not available yet." : "Դեղերի ժամանակացույցի ամսաթվերը դեռ հասանելի չեն։"));
}
console.log("Medicine calendar excludes no-plan/pre-start/pre-publication/post-end/cancelled days from no-report counts, retains corrected real history, and renders honest empty/unknown/dash states in EN/HY.");
