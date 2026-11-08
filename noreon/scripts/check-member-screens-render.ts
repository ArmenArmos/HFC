import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToReadableStream } from "react-dom/server";
import { DEFAULT_REMINDERS } from "@/lib/patient-care/reminder-preferences";
import type { CareData } from "@/lib/patient-care/types";

// Actual pages and components; only IO, the surrounding shell and browser navigation
// are substituted. No Supabase, provider, network or hosted data access is permitted.
const nativeRequire = createRequire(import.meta.url);
const root = process.cwd();
let enabled = false;
let careUnavailable = false;
let ldlUnavailable = false;
let weekEnabled = true;
let locale: "en" | "hy" | "ru" = "en";
let care: CareData = { tests: [], results: [], plan: null, appointments: [], events: [] };
let urgentRule: string | null = null;
let answers: Record<string, unknown> = {};
let history: unknown = null;
let documents: unknown = [];
let ldl: unknown = undefined;
let publication: unknown = null;
let completedAt: string | null = "2026-10-13T10:00:00Z";
const fixedNow = new Date("2026-10-31T08:00:00Z");
class RenderDate extends Date {
  constructor(value: string | number | Date = fixedNow) { super(value); }
  static now() { return fixedNow.getTime(); }
}
const fixtures: Record<string, string> = {};
const recorded = (en: string, hy: string) => locale === "hy" ? hy : en;
// Keep one module graph across cases; only request fixtures and the flag change.
// Recreating every VM context per render exhausts the Verify worker heap.
const cache = new Map<string, Record<string, unknown>>();
const noWrite = () => { throw Error("A render must not write"); };
const child = ({ children }: { children: React.ReactNode }) => React.createElement("div", {}, children);
const mocks: Record<string, unknown> = {
  "next/link": { __esModule: true, useLinkStatus: () => ({ pending: false }), default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => React.createElement("a", { ...props, href }, children) },
  "next/navigation": { useRouter: () => ({ refresh() {}, push: noWrite, replace: noWrite, prefetch() {} }), redirect: (href: string) => { throw Error(`Redirect:${href}`); }, notFound: () => { throw Error("Not found"); }, usePathname: () => "/patient/progress", useSearchParams: () => new URLSearchParams() },
  "server-only": {},
  "@/lib/patient/repository": { requireRegistered: async () => ({ profile: { locale } }) },
  // Base UI portals have no server HTML. Surface its popup for the offline initial-layout fixture.
  "@/components/ui/dialog": {
    Dialog: child,
    DialogContent: (props: React.HTMLAttributes<HTMLElement> & { initialFocus?: unknown; showCloseButton?: boolean }) => {
      const domProps = { ...props };
      delete domProps.initialFocus; delete domProps.showCloseButton;
      return React.createElement("section", { ...domProps, role: "dialog" }, props.children);
    },
    DialogTitle: ({ children, ...props }: { children: React.ReactNode }) => React.createElement("h2", props, children),
    DialogDescription: ({ children, ...props }: { children: React.ReactNode }) => React.createElement("p", props, children),
  },
  "@/components/patient/patient-shell": { PatientShell: child },
  "@/lib/patient-care/repository": { carePageData: async () => { if (careUnavailable) throw Error("Care records unavailable"); return ({ profile: { locale }, assessment: { answers, completedAt, urgentRule }, care, measurements: [], chartMeasurements: [], reminders: { preferences: DEFAULT_REMINDERS } }); } },
  "@/lib/patient-care/current-published-review": { currentPatientPublishedReview: async () => publication },
  "@/lib/real-booking/repository": { getMemberBookingData: async () => null },
  "@/lib/doctor-completion/config": { doctorCompletionEnabled: () => true },
  "@/lib/supabase/server": { createClient: async () => ({}) },
  "@/lib/doctor-completion/document-runtime": { readMemberDocuments: async () => documents, readMemberPlanVersions: async () => [{ planId: "plan", version: 2, changeSummary: recorded("RECORDED CHANGE", "Գրանցված փոփոխություն") }] },
  "@/lib/patient-care/regimen-config": { multiMedicineEnabled: () => true },
  "@/lib/patient-care/regimen-runtime": { readMemberRegimens: async () => [] },
  "@/lib/member-history/server": { readOwnHistory: async () => history },
  "@/lib/ldl/member": { memberLdl: async () => { if (ldlUnavailable) throw Error("LDL unavailable"); return ldl; } },
  "@/lib/bp-week/server": { readMemberBpWeek: async () => weekEnabled ? ({ version: "bp-week-v1", enabled: true, today: "2026-10-31", currentDevice: null, weeks: [{ id: "week", startsOn: "2026-10-31", days: 7, readingsPerSlot: 2, morningTime: "08:00", eveningTime: "20:00", reminders: true, startedByRole: "doctor", createdAt: fixedNow.toISOString(), stoppedAt: null, stopReason: null, device: null, readings: [] }] }) : ({ version: "bp-week-v1", enabled: false }) },
  "@/lib/programme/member": { memberProgramme: async () => null },
  "@/lib/member-medicines/server": { readMemberMedicines: async () => ({ enabled: true }) },
  "@/lib/reports/enabled": { reportsEnabled: () => true },
  "@/lib/lessons/catalogue": { lessonsShowDrafts: () => false, visibleLessons: () => [] },
};
function load(file: string): Record<string, unknown> {
  if (cache.has(file)) return cache.get(file)!;
  const exports: Record<string, unknown> = {};
  const vmModule = { exports };
  cache.set(file, exports);
  const code = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const require = (name: string): unknown => {
    if (name in mocks) return mocks[name];
    if (name.endsWith(".css")) return {};
    if (/(?:\/actions|\/[\w-]+-actions)$/.test(name)) return new Proxy({}, { get: () => noWrite });
    if (name.startsWith("@/") || name.startsWith(".")) {
      const base = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(file), name);
      const path = [base, base + ".ts", base + ".tsx", base + "/index.ts"].find(p => existsSync(p) && /\.[cm]?[jt]sx?$/.test(p));
      assert.ok(path, `Module exists: ${name} from ${file}`);
      return load(path);
    }
    assert.ok(!name.includes("supabase"), "No database dependency in rendering");
    return nativeRequire(name);
  };
  new vm.Script(code, { filename: file }).runInNewContext({ exports, module: vmModule, require, console, crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000001" }, Date: RenderDate, URL, URLSearchParams, setTimeout, clearTimeout, process: { env: { get NOREON_MEMBER_SCREENS_PROTOTYPE() { return enabled ? "true" : undefined; } } } });
  cache.set(file, vmModule.exports);
  return vmModule.exports;
}
async function render(route: string, prototype: boolean, query: Record<string, string> = {}, embedded = false) {
  enabled = prototype;
  const file = embedded ? `components/patient-care/member-${route}-content.tsx` : `app/patient/${route}/page.tsx`;
  const page = load(resolve(root, file)).default as (p: { searchParams: Promise<Record<string, string>>; embedded?: boolean }) => Promise<React.ReactNode>;
  const stream = await renderToReadableStream(await page({ searchParams: Promise.resolve(query), embedded }));
  await stream.allReady;
  return new Response(stream).text();
}
function paragraphs(html: string) {
  return [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
}
function links(html: string) { return [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]); }
let comparisons = 0;
async function parity(route: string, query: Record<string, string> = {}) {
  const before = await render(route, false, query);
  const after = await render(route, true, query);
  assert.ok(!before.includes("data-member-screens-prototype"));
  assert.ok(after.includes("data-member-screens-prototype"));
  // Every paragraph includes safety, hold, source, empty and unavailable notices.
  for (const notice of paragraphs(before)) assert.ok(paragraphs(after).includes(notice), `${route}/${locale}: dropped notice: ${notice}`);
  for (const href of links(before)) assert.ok(links(after).includes(href), `${route}/${locale}: dropped route ${href}`);
  if (["progress", "care", "results"].includes(route)) {
  const embedded = await render(route, false, query, true);
  assert.ok(embedded.includes(`data-member-chat-card="${route}"`));
  assert.ok(embedded.includes(`href="/patient/${route}"`), "Chat reader links to full page");
  assert.ok(!embedded.includes("data-member-screens-prototype"), "No nested screen fallback in a chat card");
  for (const notice of paragraphs(after)) assert.ok(paragraphs(embedded).includes(notice), `${route}/${locale}: chat dropped ${notice}`);
  fixtures[`embedded-${route}-${locale}`] = embedded;
  }
  const classic = await render(route, true, { ...query, view: "classic" });
  assert.equal(classic, before, "Classic override returns the old page even while flag is on");
  fixtures[`${route.replaceAll("/", "-")}-${locale}-${comparisons}`] = after;
  comparisons++;
  return after;
}
function reset() {
  care = { tests: [], results: [], plan: null, appointments: [], events: [] };
  urgentRule = null; answers = {}; completedAt = null; history = null; documents = []; ldl = undefined; publication = null;
}
for (locale of ["en", "hy"] as const) {
  reset();
  const medication = { id: "medicine", planId: "plan", name: "RECORDED MEDICINE", dose: "RECORDED DOSE", instructions: recorded("RECORDED PRESCRIPTION CAUTION", "Դեղի ընդունման գրանցված զգուշացում"), times: ["23:59"], startDate: "2026-10-01", endDate: null, active: true };
  for (const route of ["progress", "care", "results"]) await parity(route);
  await parity("measurements/new");
  await parity("bp-week/record", { slot: "morning" });
  await parity("bp-week/record", { slot: "evening" });
  for (const flag of [false, true]) await assert.rejects(render("bp-week/record", flag, { slot: "invalid" }), /Not found/);
  weekEnabled = false;
  for (const flag of [false, true]) await assert.rejects(render("bp-week/record", flag, { slot: "morning" }), /Not found/);
  weekEnabled = true;
  completedAt = "2026-10-13T10:00:00Z";
  await parity("progress", { section: "habits" });
  history = { values: [], clinic: { bp: [], observations: [] } };
  for (const route of ["progress", "results"]) await parity(route);
  history = { values: [{ id: "unreviewed", source: "ai_read", measure: "ldl_c", value: 4.9, value2: null, unit: "mmol/L", measuredOn: "2026-10-20" }], clinic: { bp: [], observations: [] } };
  const chartHtml = await parity("progress");
  assert.ok(chartHtml.includes(locale === "en" ? "From you, not verified" : "Ձեզնից, չստուգված"), "Unreviewed chart values retain their source qualification");
  assert.ok(chartHtml.includes("4.9"), "Recorded value remains in the accessible chart table");
  assert.ok(chartHtml.includes(locale === "en" ? "Show my charts" : "Ցույց տալ իմ գրաֆիկները"));
  care.plan = { id: "plan", clinician: "RECORDED DOCTOR", publishedAt: "2026-10-23T10:00:00Z", acknowledgedAt: null, instructions: recorded("RECORDED INSTRUCTIONS", "Գրանցված ցուցումներ"), explanation: recorded("RECORDED WHY", "Գրանցված բացատրություն"), medications: [medication], publishedReview: { instructions: recorded("RECORDED RELEASED INSTRUCTIONS", "Հրապարակված ցուցումներ"), explanation: recorded("RECORDED RELEASED WHY", "Հրապարակված բացատրություն"), followUp: recorded("RECORDED FOLLOW UP", "Գրանցված հետագա քայլեր") } };
  care.pendingReview = { openedAt: "2026-10-24T10:00:00Z" };
  care.appointments = [{ id: "visit", clinician: null, specialty: "RECORDED VISIT", location: null, startsAt: null, status: "requested", needsReview: true }];
  let html = await parity("care");
  for (const text of [recorded("RECORDED RELEASED INSTRUCTIONS", "Հրապարակված ցուցումներ"), recorded("RECORDED RELEASED WHY", "Հրապարակված բացատրություն"), recorded("RECORDED FOLLOW UP", "Գրանցված հետագա քայլեր"), recorded("RECORDED PRESCRIPTION CAUTION", "Դեղի ընդունման գրանցված զգուշացում"), recorded("RECORDED CHANGE", "Գրանցված փոփոխություն")]) assert.ok(html.includes(text));
  assert.ok(html.includes(locale === "en" ? "Check-in opens at the scheduled time." : "Գրառումը հասանելի կլինի նշանակված ժամին։"));
  care.planHistory = [{ ...care.plan, id: "old-plan", instructions: recorded("RECORDED OLD PLAN", "Գրանցված նախկին պլան"), publishedAt: "2026-10-01T09:00:00Z" }];
  care.medicationHistory = [{ ...medication, active: false, endDate: "2026-10-22" }];
  care.monitoring = [{ id: "monitoring", instructions: recorded("RECORDED MONITORING", "Գրանցված հսկողության ցուցումներ"), startsAt: "2026-10-10T09:00:00Z", endsAt: "2026-10-20T09:00:00Z", requiredCount: 4, status: "active", doctor: "RECORDED DOCTOR", createdAt: "2026-10-01T09:00:00Z", acknowledgedAt: null, received: 1, missing: 3, late: 0 }];
  html = await parity("care");
  assert.ok(html.includes(recorded("RECORDED OLD PLAN", "Գրանցված նախկին պլան")) && html.includes(recorded("RECORDED MONITORING", "Գրանցված հսկողության ցուցումներ")));
  care.plan.acknowledgedAt = "2026-10-24T11:00:00Z";
  await parity("care");
  documents = null;
  html = await parity("results");
  assert.ok(html.includes(locale === "en" ? "Your lab documents are unavailable right now." : "Ձեր լաբորատոր փաստաթղթերն այս պահին անհասանելի են։"));
  care.results = [{ id: "result", testId: null, marker: "RECORDED MARKER", value: 2.3, unit: "mmol/L", referenceLow: null, referenceHigh: null, collectedAt: "2026-10-20T09:00:00Z", receivedAt: "2026-10-21T09:00:00Z", reviewedAt: "2026-10-23T09:00:00Z", reviewedBy: "RECORDED REVIEWER", source: "laboratory", sourceLabel: "RECORDED LAB", explanation: "RECORDED RESULT NOTE" }];
  html = await parity("results");
  assert.ok(html.includes("data-results-glance"), "Released results have a real-data glance card");
  const glance = load(resolve(root, "components/patient-care/member-screens.tsx")).MemberResultsGlance as (props: { sourceRows: []; results: CareData["results"]; locale: string }) => React.ReactNode;
  assert.equal(glance({ sourceRows: [], results: [{ ...care.results[0], reviewedAt: null, reviewedBy: null }], locale }), null, "The glance never labels an unreviewed value as approved");
  publication = { planId: "plan", publishedAt: "2026-10-23T09:00:00Z", sourceRows: [{ reportId: "report", rowIndex: 0, source: { name: "RECORDED SOURCE MARKER", literal: "<0.1", unit: "mmol/L", reference: "0–1", uncertain: false }, laboratory: "RECORDED SOURCE LAB", reportDate: "2026-10-20", notes: ["RECORDED SOURCE NOTE"] }] };
  html = await parity("results");
  assert.ok(html.includes("&lt;0.1") && html.includes("RECORDED SOURCE NOTE") && html.includes("2026-10-20"), "Released literals, notes and report date stay intact");
  assert.ok(!html.includes("RECORDED MARKER"), "The current released literal takes precedence over old numeric projections");
  answers = Object.fromEntries(Object.entries({ "q5.last_reading.systolic": 180, "q5.crisis_symptoms": ["none"] }).map(([fieldId, value]) => [fieldId, { fieldId, value, source: "manual", answeredAt: fixedNow.toISOString() }]));
  html = await parity("results");
  assert.ok(html.includes(locale === "en" ? "A medical consultation comes first" : "Առաջնահերթը բժշկի խորհրդատվությունն է"));
  answers = {};
  ldl = { version: "ldl-member-v1", enabled: true, inPathway: true, goal: null, observations: [], withDoctor: { since: "2026-10-25T09:00:00Z", doctorName: "RECORDED DOCTOR" } };
  html = await parity("progress");
  assert.ok(html.includes("data-ldl-with-doctor"), "A result with the doctor is not exposed as a released value");
  await parity("care");
  // The prototype reports recorded facts; threshold-only legacy classification must not become a goal badge.
  const goalCard = load(resolve(root, "components/patient-care/ldl-goal-card.tsx")).LdlGoalCard as (p: Record<string, unknown>) => React.ReactNode;
  const recordedGoal = { version: 1, category: "very_high", thresholdMmol: 1.4, reductionRule: true, reductionPct: 50,
    baseline: { kind: "unknown", mmol: null, on: null, source: null }, nextTestOn: null, doctorName: "RECORDED DOCTOR", setAt: "2026-10-20T09:00:00Z" };
  for (const baseline of [recordedGoal.baseline, { kind: "on_treatment", mmol: 2, on: "2026-10-01", source: "document" }, { kind: "pre_treatment", mmol: 4, on: "2026-10-01", source: "document" }]) {
    const data = { version: "ldl-member-v1", enabled: true, inPathway: true, goal: { ...recordedGoal, baseline }, observations: [
      { id: "hidden", value: 9.9, unit: "mmol/L", on: "2026-10-30", source: "clinic_result", name: null, memberVisible: false },
      { id: "future", value: 8.8, unit: "mmol/L", on: "2026-11-05", source: "clinic_result", name: null, memberVisible: true },
      { id: "checked", value: 1.3, unit: "mmol/L", on: "2026-10-25", source: "upload_checked", name: null, memberVisible: true },
    ], withDoctor: { since: "2026-10-28T09:00:00Z", doctorName: "RECORDED DOCTOR" } };
    const stream = await renderToReadableStream(goalCard({ data, locale, prototype: true }));
    const facts = await new Response(stream).text();
    assert.match(facts, /data-ldl-facts/, "Recorded goal uses the prototype fact tiles");
    assert.doesNotMatch(facts, /9\.9|8\.8/, "Hidden and future results are not released facts");
    assert.match(facts, /1\.3/); assert.match(facts, /1\.4/);
    // Task 19: the second goal part is shown only with a documented pre-treatment baseline.
    assert.equal(facts.includes("50%"), baseline.kind === "pre_treatment", "No estimated before-treatment reduction goal");
    assert.match(facts, /data-ldl-with-doctor/);
    assert.doesNotMatch(facts, /Below your goal|Above your goal|at goal|at target|Ձեր նպատակից ցածր է|Ձեր նպատակից բարձր է/i);
    fixtures[`goal-${locale}-${baseline.kind}`] = `<div class="zk ms-screen">${facts}</div>`;
    assert.equal(facts.includes("68%"), baseline.kind === "pre_treatment", "Reduction is shown only with a documented untreated baseline");
  }
  const retest = { id: "retest", dueFrom: "2026-11-10", dueTo: "2026-11-17", state: "scheduled", overdue: false, request: null };
  const visitTerms = { provider: "RECORDED NURSE", startsAt: "2026-11-12T08:00:00Z", endsAt: "2026-11-12T09:00:00Z", preparation: recorded("RECORDED LDL PREPARATION", "Հետազոտության նախապատրաստման գրանցված ցուցումներ") };
  const request = { id: "request", revision: 1, algorithmVersion: "recorded", status: "provider-proposed", proposal: visitTerms, arrangement: null };
  for (const followup of [null, retest, { ...retest, overdue: true }, { ...retest, request }, { ...retest, request: { ...request, status: "change-pending", arrangement: visitTerms, proposal: null } }]) {
    ldl = { version: "ldl-member-v1", enabled: true, inPathway: true, goal: recordedGoal, observations: [], retest: followup };
    const preserved = await parity("progress");
    assert.match(preserved, /data-ldl-facts/);
    if (followup?.request) assert.ok(preserved.includes(visitTerms.preparation));
  }
  ldlUnavailable = true;
  await parity("care");
  ldlUnavailable = false;
  urgentRule = "RF-01";
  html = await parity("progress");
  assert.ok(html.includes('href="/patient/urgent"'));
  assert.ok(!html.includes("ms-charts"));
  await parity("results");
  urgentRule = null;
  await parity("progress", { section: "habits" });
  careUnavailable = true;
  for (const route of ["progress", "care", "results"]) for (const flag of [false, true]) {
    await assert.rejects(render(route, flag), /Care records unavailable/, "A failed care read propagates to the existing error boundary, never an empty record");
  }
  careUnavailable = false;
}
locale = "ru";
for (const route of ["progress", "care", "results"]) {
  const card = await render(route, false, {}, true);
  assert.ok(card.includes(`data-member-chat-card="${route}"`));
  assert.ok(card.includes("Открыть полную страницу"));
  fixtures[`embedded-${route}-ru`] = card;
}
if (process.env.MEMBER_SCREEN_FIXTURES) {
  mkdirSync(process.env.MEMBER_SCREEN_FIXTURES, { recursive: true });
  for (const [name, html] of Object.entries(fixtures)) writeFileSync(resolve(process.env.MEMBER_SCREEN_FIXTURES, `${name}.html`), html);
}
console.log(`Member screens: ${comparisons} actual-page EN/HY old/new notice and route parity cases; classic bypass; recorded plan, prescription caution, review-pending, upcoming-dose hold, missing visit details, failed documents, empty/failed history, approved results, urgent and habits states.`);
