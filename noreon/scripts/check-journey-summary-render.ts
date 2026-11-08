import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PressureSummary, HomeWeekSummary } from "@/components/patient-care/journey-overview";
import type { CareData } from "@/lib/patient-care/types";
import { ProgressRings } from "@/components/patient-care/progress-rings";
import type { Measurement } from "@/lib/patient/types";

const now = new Date("2026-10-12T10:00:00Z");
const row = (systolic: number, diastolic: number): Measurement => ({
  id: "reading", submissionId: "submission", source: "manual",
  systolic, diastolic, measuredAt: "2026-10-12T09:00:00Z",
});
const care: CareData = {tests:[], results:[], appointments:[], events:[], plan:null};
for (const locale of ["en", "hy"] as const) {
  const home = renderToStaticMarkup(createElement(HomeWeekSummary, {measurements:[row(128,80), {...row(200,100),id:"future",measuredAt:"2026-10-13T09:00:00Z"}],care,locale,now}));
  assert.equal(home.split("128/80").length-1,2,"Latest and 7-day average retain actual past readings");
  assert.ok(!home.includes("200/100"),"Future readings cannot enter the combined Home summary");
  assert.ok(home.includes(locale === "en" ? "Recorded values, not a diagnosis" : "Գրանցված արժեքներ, ոչ ախտորոշում"));
  const emptyHome = renderToStaticMarkup(createElement(HomeWeekSummary, {measurements:[],care,locale,now}));
  assert.ok(!emptyHome.includes("0/0"),"No medicine order does not become a fabricated completion denominator");
}
// A higher average must never appear shorter by moving a decorative denominator.
// No target is published, so show numbers without any inferred position/scale.
for (const locale of ["en", "hy"] as const) {
  for (const systolic of [149, 151, 201]) {
    const html = renderToStaticMarkup(createElement(PressureSummary, {
      locale, now, measurements: [row(systolic, 81)],
    }));
    assert.ok(html.includes(`<strong>${systolic}/81</strong>`));
    assert.ok(html.includes(`<strong>${systolic}</strong>`));
    assert.ok(html.includes("<strong>81</strong>"));
    assert.ok(!/width:\s*[^;\"]*%/.test(html), "Pressure summary must not imply position on an unpublished scale");
    assert.ok(!/Scale|Սանդղակ/.test(html), "No inferred pressure scale");
    assert.ok(html.includes(locale === "en" ? "Target: coming soon" : "Թիրախը՝ շուտով"));
  }
  const empty = renderToStaticMarkup(createElement(PressureSummary, { locale, now, measurements: [] }));
  assert.ok(empty.includes("<strong>–</strong>"), "Missing pressure remains unknown");
}
// Counts have no expected denominator and remain separate from medicine ratios.
for (const locale of ["en", "hy"] as const) {
  for (const readings of [0, 1, 7, 100]) {
    const html = renderToStaticMarkup(createElement(ProgressRings, {
      locale, readings, taken: 1, doses: 2,
    }));
    const readingCard = html.match(/<a\b[^>]*href="\/patient\/health"[^>]*>([\s\S]*?)<\/a>/)?.[1];
    assert.ok(readingCard, "Reading count links to its real pressure destination");
    assert.ok(readingCard.includes(`>${readings}</strong>`), "The exact count remains visible at every magnitude");
    assert.ok(readingCard.includes(locale === "en" ? "Readings saved" : "Գրանցված չափումներ"));
    assert.ok(!readingCard.includes("<circle"), "A reading count never appears as a goal or completion ring");
    const medicineCard = html.match(/<a\b[^>]*href="\/patient\/progress\?section=habits"[^>]*>([\s\S]*?)<\/a>/)?.[1];
    assert.ok(medicineCard, "Medicine reports link to their real check-in destination");
    assert.match(medicineCard, /stroke-dasharray="50 100"/, "Real medicine denominator still drives its ring");
    assert.ok(medicineCard.includes("1/2"), "The exact report numerator and scheduled denominator remain visible");
  }
  for (const doses of [0, 2]) {
    const emptyReports = renderToStaticMarkup(createElement(ProgressRings, {locale, readings:0, taken:0, doses}));
    assert.ok(!emptyReports.includes("stroke-dasharray"), "No taken reports create no completed medicine segment");
    assert.ok(!emptyReports.includes("0/0"), "No medicine schedule cannot become a fabricated denominator");
    assert.ok(emptyReports.includes(doses ? "0/2" : "–"));
  }
}
console.log("Pressure summaries preserve exact values without implied scale; reading counts have no completion ring, while medicine reports retain their real ratios and destinations.");
