import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname, isAbsolute } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToReadableStream } from "react-dom/server";
import type { CareData } from "@/lib/patient-care/types";
import type { CareAlertMemberStatus } from "@/lib/care-alerts/member";
import type { MemberOverview } from "@/lib/member-history/ai-reading";
import type { MemberResults } from "@/lib/member-history/lab-results";
import type { ReportedDocument } from "@/lib/member-history/measures";

// Production pages and their real content; substitute only render IO, shell,
// router and action boundaries. No database, network, effects or action calls.
const root = process.cwd(), nativeRequire = createRequire(import.meta.url);
const fixtureDir = process.env.MEMBER_SCREEN_FIXTURES;
if (fixtureDir) {
  assert.ok(isAbsolute(fixtureDir) && (fixtureDir.startsWith("/tmp/") || fixtureDir.startsWith("/private/tmp/")), "Fixtures must be explicitly directed under /tmp");
  mkdirSync(fixtureDir, { recursive: true });
}
let enabled = false, reviewEnabled = true, signedIn = true, failedIdentity = false, failedState = false;
let locale: "en" | "hy" = "en";
let status: CareAlertMemberStatus | null = null;
let urgentRule: string | null = "RF-01";
let answers: Record<string, unknown> = {};
let history: { values: []; documents: ReportedDocument[] } | null = null;
let readings: MemberOverview | null = null, results: MemberResults | null = null;
let contactFails = false, consentFails = false, consentPresent = false, contactPresent = false;
let publication: unknown = null;
let care: CareData = { tests: [], results: [], plan: null, appointments: [], events: [] };
const fixedNow = new Date("2026-10-31T08:00:00Z");
class RenderDate extends Date {
  constructor(value: string | number | Date = fixedNow) { super(value); }
  static now() { return fixedNow.getTime(); }
}
const noWrite = () => { throw Error("A support render must not perform an action"); };
const registered = () => ({ profile: { locale, name: "RECORDED MEMBER" }, assessment: { urgentRule, answers, revision: 1, completedAt: fixedNow.toISOString() } });
const shell = ({ children }: { children: React.ReactNode }) => React.createElement("div", { className: "member-journey" }, children);
const mocks: Record<string, unknown> = {
  "next/link": { __esModule: true, default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => React.createElement("a", { ...props, href }, children) },
  "next/navigation": { useRouter: () => ({ refresh() {}, push: noWrite, replace: noWrite }), usePathname: () => "/patient/help", useSearchParams: () => new URLSearchParams(), redirect: (href: string) => { throw Error(`Redirect: ${href}`); } },
  "next/headers": { cookies: async () => ({ get: () => ({ value: locale }) }) },
  "server-only": {},
  "@/components/patient/patient-shell": { PatientShell: shell },
  "@/lib/patient/repository": { requireRegistered: async () => registered(), getPatientState: async () => { if (failedState) throw Error("State unavailable"); return signedIn ? { ...registered(), consentAccepted: true } : null; } },
  "@/lib/patient/render-data": { requireRegisteredForRender: async () => registered() },
  "@/lib/patient/auth": { patientIdentity: async () => { if (failedIdentity) throw Error("Identity unavailable"); return signedIn ? { userId: "member" } : null; } },
  "@/lib/care-alerts/member": { careAlertMemberStatus: async () => status },
  "@/lib/member-history/server": { readOwnHistory: async () => history },
  "@/lib/member-history/ai-server": { readOwnUploadReadings: async () => readings, readOwnLabResults: async () => results, readOwnUploadReading: async () => null },
  "@/lib/patient/member-preferences": { readMemberTextSize: async () => "large", readMemberContactStatus: async () => { if (contactFails) throw Error("Contact unavailable"); return contactPresent ? { mode: "member", contactChannel: "phone", contactTimes: [], callbacksEnabled: true, openRequest: null } : null; } },
  "@/lib/zoe/member": { readZoeConsents: async () => { if (consentFails) throw Error("Consent unavailable"); return consentPresent ? { ok: true, available: true, readsMessages: true, scheduledQuestions: false, canGrant: true, directAnswers: false } : null; } },
  "@/lib/patient-care/member-contact": { memberContact: async () => ({ mode: "none" }) },
  "@/lib/telegram-runtime/config": { telegramEnabled: () => false },
  "@/lib/patient-care/repository": { carePageData: async () => ({ ...registered(), care }) },
  "@/lib/patient-care/current-published-review": { currentPatientPublishedReview: async () => publication },
};
const cache = new Map<string, Record<string, unknown>>();
function load(file: string): Record<string, unknown> {
  if (cache.has(file)) return cache.get(file)!;
  const exports: Record<string, unknown> = {}, vmModule = { exports };
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
    assert.ok(!/(supabase|node:(?:https?|net|tls|child_process))/.test(name), `No external IO dependency: ${name}`);
    return nativeRequire(name);
  };
  new vm.Script(code, { filename: file }).runInNewContext({ exports, module: vmModule, require, console, Date: RenderDate, URL, URLSearchParams, setTimeout, clearTimeout, process: { env: { NOREON_MEMBER_SCREENS_PROTOTYPE: enabled ? "true" : undefined, NOREON_URGENT_ANSWER_REVIEW_ENABLED: reviewEnabled ? "true" : undefined } } });
  cache.set(file, vmModule.exports);
  return vmModule.exports;
}
async function render(route: string, flag: boolean, query: Record<string, string> = {}) {
  enabled = flag; cache.clear();
  const page = load(resolve(root, `app/patient/${route}/page.tsx`)).default as (props: { searchParams: Promise<Record<string, string>> }) => Promise<React.ReactNode>;
  const stream = await renderToReadableStream(await page({ searchParams: Promise.resolve(query) }));
  await stream.allReady;
  return new Response(stream).text();
}
const paragraphs = (html: string) => [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean).sort();
const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]).sort();
let comparisons = 0;
async function parity(route: string, scenario: string, query: Record<string, string> = {}) {
  const before = await render(route, false, query), after = await render(route, true, query);
  assert.ok(!before.includes("data-member-screens-prototype"));
  assert.ok(after.includes("data-member-screens-prototype"));
  assert.deepEqual(paragraphs(after), paragraphs(before), `${route}/${scenario}/${locale}: all notices retained exactly`);
  const classicQuery = { ...query, ...(query.view === "trends" ? { section: "trends" } : {}), view: "classic" };
  const classic = await render(route, true, classicQuery);
  assert.equal(classic, before, `${route}/${scenario}/${locale}: classic is the original output`);
  // Emergency screens keep their exact action set, without a presentation-switch exit.
  if (route === "urgent" || route === "zoe/urgent") {
    assert.doesNotMatch(after, /class="ms-classic"/);
    assert.deepEqual(links(after), links(before), `${route}/${scenario}/${locale}: no additional emergency navigation`);
  } else {
    // The one additional link must really preserve the route's contextual state.
    const match = after.match(/<a\b[^>]*class="ms-classic"[^>]*href="([^"]+)"/);
    assert.ok(match, "Previous view remains reachable");
    const afterLinks = links(after), classicIndex = afterLinks.indexOf(match[1]);
    assert.ok(classicIndex >= 0); afterLinks.splice(classicIndex, 1);
    assert.deepEqual(afterLinks, links(before), `${route}/${scenario}/${locale}: same links and call actions`);
    const target = new URL(match[1].replaceAll("&amp;", "&"), "https://offline.invalid");
    assert.equal(target.pathname, `/patient/${route}`);
    assert.equal(target.searchParams.get("view"), "classic");
    if (query.request) assert.equal(target.searchParams.get("request"), query.request);
    if (query.changed) assert.equal(target.searchParams.get("changed"), query.changed);
    if (query.view === "trends") assert.equal(target.searchParams.get("section"), "trends");
  }
  if (fixtureDir) for (const [mode, html] of [["prototype", after], ["classic", before]]) writeFileSync(resolve(fixtureDir, `${route.replaceAll("/", "-")}-${scenario}-${locale}-${mode}.html`), html);
  comparisons++;
  return after;
}
const text = (en: string, hy: string) => locale === "en" ? en : hy;
const contains = (html: string, en: string, hy: string) => assert.ok(html.includes(text(en, hy)), `Expected independent notice: ${text(en, hy)}`);
const alert = (alerted: boolean): CareAlertMemberStatus => ({ ok: true, alertsEnabled: true, alerted, alertedAt: null, zoe: { alerted, pending: false } });
const file: ReportedDocument = { id: "11111111-1111-4111-8111-111111111111", fileName: "RECORDED FILE.pdf", mime: "application/pdf", sizeBytes: 100, resultDate: "2026-10-29", createdAt: fixedNow.toISOString() };
for (locale of ["en", "hy"] as const) {
  answers = { "q9.right_now": { fieldId: "q9.right_now", value: "yes", source: "manual", answeredAt: fixedNow.toISOString() } };
  for (const state of ["alerted", "unalerted", "unavailable", "corrected"] as const) {
    status = state === "unavailable" ? null : alert(state === "alerted");
    const html = await parity("urgent", state, state === "corrected" ? { changed: "1" } : {});
    assert.ok(html.includes('href="tel:103"'));
    assert.ok(html.indexOf('href="tel:103"') < html.indexOf("<h1"), "Call stays ahead of the longer recorded reason at enlarged text sizes");
    contains(html, "Sit down. Do not stay alone. Do not drive.", "Նստեք, մի մնացեք մենակ, մի վարեք մեքենա։");
    if (state === "alerted") contains(html, "Emergency services have not been called through this service.", "Շտապ օգնությունը այս ծառայության միջոցով չի կանչվել։");
    if (state === "unalerted") contains(html, "A doctor or emergency service has not been notified through this service.", "Բժիշկը կամ շտապ օգնությունը այս ծառայության միջոցով չեն ծանուցվել։");
    if (state === "unavailable") contains(html, "Call 103 now. Do not wait for this service.", "Զանգահարեք 103 հիմա։ Մի սպասեք այս ծառայությանը։");
    if (state === "corrected") contains(html, "Your change was saved.", "Ձեր փոփոխությունը պահպանվել է։");
    assert.equal(html.includes('href="/patient/urgent/review"'), state !== "unavailable", "Review requires confirmed alerts enabled and a reviewable answer");
  }
  status = alert(false); reviewEnabled = false;
  assert.ok(!(await parity("urgent", "review-off")).includes('href="/patient/urgent/review"'));
  reviewEnabled = true; status = { ...alert(false), alertsEnabled: false };
  assert.ok(!(await parity("urgent", "alerts-off")).includes('href="/patient/urgent/review"'));
  status = alert(false); answers = {};
  assert.ok(!(await parity("urgent", "not-reviewable")).includes('href="/patient/urgent/review"'));
  urgentRule = null;
  for (const flag of [false, true]) await assert.rejects(render("urgent", flag, { changed: "1" }), /Redirect: \/patient\/questions\?changed=1/);
  urgentRule = "RF-01";
  for (const state of ["alerted", "unalerted", "unavailable", "pending", "no-request"] as const) {
    status = state === "unavailable" ? null : alert(state === "alerted");
    if (state === "pending") status = { ...alert(false), zoe: { alerted: false, pending: true } };
    const html = await parity("zoe/urgent", state, state === "no-request" ? {} : { request: "recorded-request" });
    assert.ok(html.includes("data-zoe-emergency-content") && html.includes('href="tel:103"'));
    contains(html, "Call 103 now. Do not wait for this service.", "Զանգահարեք 103 հիմա։ Մի սպասեք այս ծառայությանը։");
    assert.equal(html.includes(text("We have told the Noreon", "Մենք տեղեկացրել ենք Noreon")), state === "alerted");
    assert.equal(html.includes(text("A doctor or emergency service has not been notified", "Բժիշկը կամ շտապ օգնությունը այս ծառայության միջոցով չեն ծանուցվել")), state === "unalerted", "Unknown, pending and unrelated requests make no notification claim");
  }
  history = null; readings = null; results = null;
  contains(await parity("progress/earlier", "unavailable"), "Your earlier results are unavailable right now.", "Ձեր նախկին արդյունքներն այս պահին անհասանելի են։");
  history = { values: [], documents: [] };
  let html = await parity("progress/earlier", "empty");
  const uploadTitle = text("Upload an earlier result", "Վերբեռնեք նախկին արդյունքը");
  const manualTitle = text("Add a value by hand", "Ավելացրեք արժեք ձեռքով");
  assert.ok(html.indexOf(uploadTitle) >= 0 && html.indexOf(uploadTitle) < html.indexOf(manualTitle), "Prototype puts file upload before manual values");
  readings = { version: "member-upload-ai-v1", enabled: true, documents: [] };
  html = await parity("progress/earlier", "ai-unavailable");
  contains(html, "Your results are unavailable right now.", "Ձեր արդյունքներն այս պահին անհասանելի են։");
  history.documents = [file];
  for (const review of ["waiting", "approved"] as const) {
    readings.documents = [{ documentId: file.id, createdAt: fixedNow.toISOString(), job: { jobId: "job", state: "done", outcome: null, createdAt: fixedNow.toISOString(), finishedAt: fixedNow.toISOString(), identityStatus: "match", sampleDate: "2026-10-29", confirmation: { identityAnswer: "mine", valuesSaved: 1, valuesCharted: 1, at: fixedNow.toISOString() }, valueCount: 1, review: { state: review, approvedAt: review === "approved" ? fixedNow.toISOString() : null } } }];
    results = { version: "member-upload-results-v1", enabled: true, approvalRequired: true, documents: [{ documentId: file.id, fileName: file.fileName, resultDate: file.resultDate, state: review, approvedAt: review === "approved" ? fixedNow.toISOString() : null, doctorName: "RECORDED DOCTOR", interpretation: review === "approved" ? { en: "RECORDED INTERPRETATION", hy: "RECORDED INTERPRETATION" } : null }], values: [] };
    html = await parity("progress/earlier", review);
    assert.ok(html.includes(file.fileName));
    if (review === "waiting") {
      contains(html, "We read this file. You will see the values here once your doctor has checked them.", "Մենք կարդացել ենք այս ֆայլը։ Արժեքները այստեղ կտեսնեք, երբ ձեր բժիշկը ստուգի դրանք։");
      assert.ok(!html.includes("RECORDED INTERPRETATION") && !html.includes('id="lab-results"'), "Waiting uploads do not expose checked results");
    } else {
      assert.ok(html.includes("RECORDED INTERPRETATION") && html.includes("RECORDED DOCTOR"), "Approved interpretation and source remain visible");
      assert.ok(html.includes('href="#lab-results"'));
    }
    assert.ok(!html.includes(`href="/patient/progress/earlier?edit=${file.id}`), "Doctor review retains the edit restriction");
  }
  for (const state of ["null", "failed", "normal"] as const) {
    consentFails = contactFails = state === "failed";
    consentPresent = contactPresent = state === "normal";
    html = await parity("account", state);
    contains(html, "Telegram and Zoe are not for emergencies.", "Telegram-ը և Zoe-ն շտապ օգնության համար չեն։");
    assert.equal(html.includes('id="my-consents"'), state === "normal");
    assert.ok(html.includes('aria-pressed="true"'), "Saved language/text preferences remain selected");
  }
  for (const state of ["signed-in", "signed-out", "identity-failed", "state-failed"] as const) {
    signedIn = state !== "signed-out"; failedIdentity = state === "identity-failed"; failedState = state === "state-failed";
    html = await parity("help", state);
    contains(html, "This app does not notify a doctor or emergency service when you open this page.", "Այս էջը բացելը չի ծանուցում բժշկին կամ շտապ օգնությանը։");
    assert.equal(html.includes('href="tel:103"'), state !== "signed-in", "Signed-out help retains its own emergency call action");
    if (state === "signed-in") contains(html, "Messaging your care team in the app is not switched on yet.", "Հավելվածում խնամքի թիմին գրելը դեռ միացված չէ։");
    else contains(html, "Sign in to write to your care team.", "Մուտք գործեք՝ ձեր խնամքի թիմին գրելու համար։");
  }
  signedIn = true; failedIdentity = failedState = false;
  care = { tests: [], results: [], plan: null, appointments: [], events: [] }; publication = null;
  contains(await parity("results/history", "empty"), "No past test orders recorded.", "Նախկին հետազոտությունների նշանակումներ գրանցված չեն։");
  care.results = [{ id: "result", testId: null, marker: "RECORDED MARKER", value: 2.3, unit: "mmol/L", referenceLow: 1, referenceHigh: 3, collectedAt: "2026-10-20T09:00:00Z", receivedAt: "2026-10-21T09:00:00Z", reviewedAt: "2026-10-23T09:00:00Z", reviewedBy: "RECORDED REVIEWER", source: "laboratory", sourceLabel: "RECORDED LAB", explanation: "RECORDED RESULT NOTE" }];
  publication = { planId: "plan", publishedAt: fixedNow.toISOString(), sourceRows: [{ reportId: "report", rowIndex: 0, source: { name: "RECORDED SOURCE", literal: "2.3", unit: "mmol/L", reference: "1–3", uncertain: false }, laboratory: "RECORDED LAB", reportDate: "2026-10-20", notes: [] }] };
  html = await parity("results/history", "released");
  assert.ok(html.includes("RECORDED MARKER") && html.includes('href="/patient/review"'));
  html = await parity("results/history", "trends", { view: "trends" });
  contains(html, "A value outside an interval does not by itself establish a diagnosis.", "Միջակայքից դուրս արժեքն ինքնին ախտորոշում չէ։");
}
console.log(`Member support: ${comparisons} actual-page EN/HY notice/link parity cases, exact classic fallbacks, guarded urgent actions, real Zoe content, upload holds, consent failures, signed-out help and contextual history trends.`);
