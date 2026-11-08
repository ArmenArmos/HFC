import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import { renderToReadableStream } from "react-dom/server";
import { EMPTY_CARE, type CareData } from "@/lib/patient-care/types";
import { DEFAULT_REMINDERS } from "@/lib/patient-care/reminder-preferences";
import type { MemberSafetyView } from "@/lib/member-safety/contract";
import type { ConsultationArrangement } from "@/lib/doctor-completion/consultation-schema";
import type { MemberBookingData } from "@/lib/real-booking/schema";

// Render the real dashboard, cards and models. Replace only IO, framework context,
// mutation controls and the unrelated chart. No credentials or database are used.
const now = new Date("2026-10-31T08:00:00Z");
class Clock extends Date {
  constructor(value: string | number = now.getTime()) { super(value); }
  static now() { return now.getTime(); }
}
let locale: "en" | "hy" | "ru" = "en";
let care: CareData = EMPTY_CARE;
let safety: MemberSafetyView = { state: "off" };
let arrangement: ConsultationArrangement | null = null;
let hold = false, bookingsFailed = false, statusFailed = false, urgent = false;
let extras = false, homeFacts = false;
let resultsReceived = false, planPreparing = false;
let medicineReadEnabled = true;
let medicineAsk: "pending" | "closed" | "disabled" | "failed" = "pending";
let answers = {};
let screens = false;
let doctor: string | null = null;
let booking: MemberBookingData = { available: false, requirements: [], homeTasks: [], requests: [] };
const nurse = {
  startsAt: "2026-10-30T08:00:00Z", mode: "home", completedAt: null,
  samplesTaken: 1, samplesPlanned: 1,
  steps: [{ step: "confirmed", at: "2026-10-30T08:00:00Z" }],
};
const samples = [{ entryId: "sample", visitId: "visit", testId: "lipid-panel", title: "Recorded sample", collectedAt: "2026-10-30T08:00:00Z", stages: [] }];
const bpWeek = () => extras ? {
  version: "bp-week-v1", enabled: true, today: "2026-10-31", currentDevice: null,
  weeks: [{ id: "week", startsOn: "2026-10-31", days: 7, readingsPerSlot: 2,
    morningTime: "08:00", eveningTime: "20:00", reminders: true, startedByRole: "doctor",
    createdAt: now.toISOString(), stoppedAt: null, stopReason: null, device: null, readings: [] }],
} : { version: "bp-week-v1", enabled: false };
const unavailable = () => { throw new Error("Unexpected mutation in render check"); };
const io: Record<string, object> = {
  "next/headers": { cookies: async () => ({ has: () => false }) },
  "next/navigation": { useRouter: () => ({ refresh() {} }), usePathname: () => "/patient/zoe", useSearchParams: () => new URLSearchParams() },
  "next/link": { __esModule: true, useLinkStatus: () => ({ pending: false }), default: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children) },
  "next/image": { __esModule: true, default: (props: React.ComponentProps<"img"> & { unoptimized?: boolean; priority?: boolean }) => {
    const imageProps = { ...props };
    delete imageProps.unoptimized;
    delete imageProps.priority;
    return React.createElement("img", imageProps);
  } },
  "@/components/patient/patient-shell": { PatientShell: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children) },
  "@/components/patient-care/controls": { CareRefresh: () => null, DoseButtons: () => React.createElement("button", { type: "button", disabled: true }, "Dose mutation boundary") },
  "@/components/patient-care/trends": { HealthTrends: () => null },
  "@/lib/patient/auth": { requirePatient: async () => ({ id: "synthetic-member" }) },
  "@/lib/patient-care/repository": {
    carePageData: async () => ({ profile: { locale, name: "Test Member" },
      assessment: { answers, completedAt: "2026-10-20T08:00:00Z", urgentRule: urgent ? "RF-01" : null },
      care, measurements: [], chartMeasurements: homeFacts ? [{ id: "r", submissionId: "s", source: "manual", systolic: 128, diastolic: 82, measuredAt: "2026-10-30T08:00:00Z" }] : [], reminders: { preferences: DEFAULT_REMINDERS } }),
    getCareData: async () => care,
  },
  "@/lib/real-booking/actions": { memberBookingCommand: unavailable },
  "@/lib/real-booking/repository": { getMemberBookingData: async () => bookingsFailed
    ? { available: false, requirements: [], homeTasks: [], requests: [], clinicalHold: false, message: "Test requests are unavailable. Please try again." } satisfies MemberBookingData
    : booking },
  "@/lib/patient-care/lab-stage-repository": { getMemberLabStages: async () => resultsReceived ? [{ ...samples[0], stages: [{ stage: "results-received", at: now.toISOString() }] }] : extras ? samples : [] },
  "@/lib/doctor-completion/config": { doctorCompletionEnabled: () => true },
  "@/lib/patient-care/clinical-case-repository": { readRealMemberStatus: async () => {
    if (statusFailed) throw new Error("Synthetic status read failure");
    return { enabled: true, status: hold ? { status: "consultation_needed", consultation: arrangement } : null };
  } },
  "@/lib/patient-care/care-team-repository": { readMemberCareTeam: async () => extras || homeFacts ? { doctor } : null },
  "@/lib/supabase/server": { createClient: async () => ({}) },
  "@/lib/doctor-completion/document-runtime": { readMemberDocuments: async () => null },
  "@/lib/member-safety/member": { readMemberSafety: async () => safety },
  "@/lib/member-safety/actions": { hideChestPainCardToday: unavailable },
  "@/lib/ai-plan/member": { readPlanPreparing: async () => planPreparing },
  "@/lib/nurse-visit/runtime": { readMemberNurseVisit: async () => extras ? nurse : null },
  "@/lib/bp-week/server": { readMemberBpWeek: async () => bpWeek() },
  "@/lib/member-medicines/server": {
    readMemberMedicines: async () => ({ version: "member-medicines-v1", enabled: extras && medicineReadEnabled, medicines: [] }),
    readMemberMedicineAsks: async () => medicineAsk === "disabled" || medicineAsk === "failed"
      ? { enabled: false } : { enabled: true, asks: medicineAsk === "pending" ? [{}] : [] },
  },
  "@/lib/first-note/member": { memberFirstNote: async () => extras ? { textEn: "Recorded first note", textHy: "Գրանցված առաջին գրառում", doctorName: "Recorded doctor", approvedAt: "2026-10-20T08:00:00Z" } : null },
  "@/lib/ldl/member": { memberLdl: async () => extras || homeFacts ? { version: "ldl-member-v1", enabled: true, inPathway: true, goal: null, observations: homeFacts ? [{ id: "l", value: 1.36, unit: "mmol/L", on: "2026-10-29", source: "upload_checked", name: null, memberVisible: true }] : [] } : undefined },
  "@/lib/member-history/server": { countOwnDoctorApprovedValues: async () => null },
  "@/lib/zoe/member": { readZoePrompt: async () => ({ due: extras, directAnswers: false }) },
  "@/app/patient/account/telegram/zoe-actions": { acceptZoePrompt: unavailable, postponeZoePrompt: unavailable },
  "@/lib/programme/member": { memberProgramme: async () => extras ? { schedulePending: false, stages: [{ id: "week4", state: "now", title: { en: "Week-4 review", hy: "Չորրորդ շաբաթ", ru: "Пересмотр на 4-й неделе" }, meaning: { en: "Recorded programme stage", hy: "Գրանցված փուլ", ru: "Записанный этап" }, date: { en: "10 November 2026", hy: "10 նոյեմբերի 2026", ru: "10 ноября 2026" } }] } : null },
  "@/lib/patient/member-screens-config": { memberScreensPrototypeEnabled: () => screens },
  "@/lib/patient/member-home-config": { memberHomeEnabled: () => true },
};

if (process.env.HOME_RENDER_SHELL === "true" || process.env.CHAT_RENDER_OUTPUT) delete io["@/components/patient/patient-shell"];

// The repository's render checks use isolated transpilation for framework boundaries.
// Fail closed on dependencies: all production components are loaded, never replaced
// by stand-in cards. VM Date fixes the page and self-loading cards to the same day.
const cache = new Map<string, Record<string, unknown>>();
async function load(path: string): Promise<Record<string, unknown>> {
  const existing = cache.get(path);
  if (existing) return existing;
  const exports: Record<string, unknown> = {};
  cache.set(path, exports);
  const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText;
  const modules: Record<string, unknown> = {};
  for (const [, name] of code.matchAll(/require\("([^"]+)"\)/g)) {
    const local = name.startsWith(".") ? resolve(dirname(path), name) : resolve(name.replace(/^@\//, ""));
    const key = name.startsWith(".") ? `@/${local.slice(process.cwd().length + 1)}` : name;
    if (name.endsWith(".css")) modules[name] = {};
    else if (io[key]) modules[name] = io[key];
    else if (!key.startsWith("@/components/") && /(?:\/actions|\/[\w-]+-actions)$/.test(name)) modules[name] = new Proxy({}, { get: () => unavailable });
    else if (name === "react") modules[name] = React;
    else if (name === "react/jsx-runtime") modules[name] = jsx;
    else if (key.startsWith("@/components/")) modules[name] = await load(existsSync(`${local}.tsx`) ? `${local}.tsx` : `${local}.ts`);
    else modules[name] = await import(name);
  }
  new vm.Script(code, { filename: path }).runInNewContext({ exports, Date: Clock, Intl, Math,
    require: (name: string) => {
      if (!(name in modules)) throw new Error(`Unconfigured dependency: ${name}`);
      return modules[name];
    },
  });
  return exports;
}
const Dashboard = (await load(resolve("components/patient/member-home-content.tsx"))).MemberHomeContent as (props: { searchParams: Promise<{ view?: string }>; chat?: boolean }) => Promise<React.ReactNode>;
async function render(view?: string) {
  const stream = await renderToReadableStream(await Dashboard({ searchParams: Promise.resolve({ view }) }));
  const html = (await new Response(stream).text()).replace(/<!--.*?-->/g, "");
  if (!urgent && view !== "classic") {
    const chatStream = await renderToReadableStream(await Dashboard({ chat: true, searchParams: Promise.resolve({}) }));
    const chat = (await new Response(chatStream).text()).replace(/<!--.*?-->/g, "");
    // Dashboard chrome goes; every clinical/consent notice retains its real content and actions.
    for (const [, id, fragment] of html.matchAll(/<div data-home-notice="([^"]+)">([\s\S]*?)<\/div>/g)) {
      if (id !== "care-team") assert.ok(chat.includes(fragment), `Chat retains ${id}`);
    }
    assert.doesNotMatch(chat, /data-member-home[ =]|member-home-menu|member-home-greeting|member-home-next|member-home-team|home-team-title|journey-unwell-line|data-member-chat-today|128\/82|1\.36/);
    assert.equal(chat.includes('id="consultation-hold-title"'), hold && !statusFailed, "Chat retains a known hold even when Home's next step replaces its card");
    // Render the notice slot in the real conversation, not just in isolation.
    const { ZoeChat } = await load(resolve("components/patient/zoe-chat.tsx"));
    const history = { ok: true, version: 0, ack: null, zoeReplies: false, settledSeq: 0, messages: [], answers: [],
      replies: Array.from({ length: 60 }, (_, i) => ({ id: `reply-${i}`, text: `Saved doctor reply ${i}`, doctorName: "Recorded doctor", at: now.toISOString() })) };
    const threadStream = await renderToReadableStream(React.createElement(ZoeChat as React.ComponentType<Record<string, unknown>>, {
      locale, initial: history, upload: false, chatOnly: true,
      intro: await Dashboard({ chat: true, searchParams: Promise.resolve({}) }),
    }));
    const threadHtml = await new Response(threadStream).text();
    for (const marker of ["data-home-notice", "data-chat-results-notice", "lab-stage-card-title"]) {
      if (chat.includes(marker)) {
        assert.ok(threadHtml.indexOf(marker) > threadHtml.indexOf("Saved doctor reply 59"), `${locale}: ${marker} follows all 60 replies`);
        assert.ok(threadHtml.lastIndexOf(marker) < threadHtml.indexOf("data-zoe-composer"), `${locale}: ${marker} precedes the input`);
      }
    }
    snapshots[`chat-${locale}`] = chat;
  }
  return html;
}
const published: CareData = { ...EMPTY_CARE, plan: {
  id: "plan", clinician: "Recorded doctor", publishedAt: "2026-10-20T08:00:00Z", acknowledgedAt: null,
  instructions: "Recorded instructions", medications: [{ id: "medicine", planId: "plan", name: "Recorded medicine", dose: "Recorded dose", instructions: "Recorded instructions", times: ["08:00"], startDate: "2026-10-20", endDate: null, active: true }],
} };
const snapshots: Record<string, string> = {};
for (locale of ["en", "hy", "ru"] as const) {
  for (const [state, exercisePaused, walking] of [["paused", true, false], ["cleared", false, true], ["unreadable", null, false]] as const) {
    safety = exercisePaused === null ? { state: "unknown" } : { state: "on", card: null, exercisePaused };
    const html = await render();
    assert.equal((html.match(/data-exercise-paused/g) ?? []).length, state === "paused" ? 1 : 0, `${locale}: pause notice ${state}`);
    const invitation = { en: "Food and walking tips", hy: "Սննդի և քայլքի խորհուրդներ", ru: "Советы по питанию и ходьбе" }[locale];
    assert.equal(html.includes(invitation), walking, `${locale}: walking invitation ${state}`);
    const movement = { en: "A comfortable movement break", hy: "Հարմար շարժման ընդմիջում", ru: "Перерыв для комфортного движения" }[locale];
    assert.equal(html.includes(movement), false, `${locale}: movement lives behind the wellbeing link, ${state}`);
    assert.match(html, /href="\/patient\/learn"/, "Nutrition remains accessible");
    snapshots[`${locale}-${state}`] = html;
  }
}
safety = { state: "off" };
locale = "en";
care = published;
hold = true;
for (bookingsFailed of [false, true]) {
  for (arrangement of [null, { scheduledAt: "2026-11-05T09:30:00Z", channel: "phone", clinic: null }] as const) {
    const html = await render();
    assert.equal((html.match(/id="consultation-hold-title"/g) ?? []).length, 1, "Published plan retains exactly one consultation hold");
    assert.match(html, /Your current plan stays as it is until then/);
    assert.match(html, /Before your new results and plan are shared/);
    if (arrangement) {
      assert.match(html, /5 Nov|5 November/);
      assert.match(html, /13:30/);
      assert.match(html, /Your doctor will call you/);
    }
    else assert.match(html, /contact you to arrange a time/);
    snapshots[`hold-${bookingsFailed ? "booking-failed" : "booking-ok"}-${arrangement ? "scheduled" : "unscheduled"}`] = html;
  }
}
care = EMPTY_CARE;
bookingsFailed = false;
assert.doesNotMatch(await render(), /id="consultation-hold-title"/, "No duplicate when the consultation next step leads");
bookingsFailed = true;
assert.match(await render(), /Your doctor would like to talk with you/, "Booking outage cannot erase a known consultation next step");
statusFailed = true;
assert.doesNotMatch(await render(), /id="consultation-hold-title"/, "Failed status read makes no hold claim");
statusFailed = false;
hold = false;
bookingsFailed = false;

// Removing the next-step dashboard must not remove held-result wording.
for (locale of ["en", "hy", "ru"] as const) {
  resultsReceived = true;
  for (care of [EMPTY_CARE, published]) {
    await render();
    const chat = snapshots[`chat-${locale}`];
    assert.match(chat, /data-chat-results-notice|lab-stage-card-title/, "Held results reach the thread with or without an earlier plan");
  }
  care = EMPTY_CARE;
  planPreparing = true;
  await render();
  assert.match(snapshots[`chat-${locale}`], /data-chat-results-notice/, "Plan preparation wording from the removed next step stays");
}
resultsReceived = false; planPreparing = false; care = EMPTY_CARE;
// With no records or notices there is no dashboard content, even after async cards resolve.
for (locale of ["en", "hy", "ru"] as const) {
  await render();
  assert.equal(snapshots[`chat-${locale}`].replace(/<[^>]*>/g, "").trim(), "");
}

// A saved orange finding remains visible even when the journey owns the next step.
answers = {
  "q5.last_reading.systolic": { fieldId: "q5.last_reading.systolic", value: 185, source: "manual", answeredAt: now.toISOString() },
  "q5.crisis_symptoms": { fieldId: "q5.crisis_symptoms", value: ["none"], source: "manual", answeredAt: now.toISOString() },
};
for (locale of ["en", "hy", "ru"] as const) {
  const html = await render();
  assert.match(html, /data-home-attention/, "Journey does not swallow the orange guidance");
  assert.ok(html.indexOf("data-home-attention") < html.indexOf("member-home-next-title"), "Orange notice stays visible before the action");
}
answers = {};
care = published;
homeFacts = true;
doctor = "Recorded doctor";
for (locale of ["en", "hy", "ru"] as const) {
  const html = await render();
  assert.match(html, /128\/82/);
  assert.match(html, /1\.36/);
  assert.doesNotMatch(html, /data-home-review|data-zoe-consent-prompt|data-first-note|data-exercise-paused/);
  assert.match(html, /<details id="member-home-menu"(?![^>]*open)/, "The full menu starts closed");
  snapshots[`compact-${locale}`] = html;
}
homeFacts = false;
doctor = null;
locale = "en";
// Published-plan cards bypass journey-step suppression, so each recorded state
// can be compared with the corresponding classic Home output.
extras = true;
care = { ...published, pendingReview: { openedAt: now.toISOString() } };
const prototype = await render(), classic = await render("classic");
assert.match(classic, /Your health at a glance/, "Classic keeps its full dashboard");
for (const marker of ["Your health at a glance", 'id="daily-routine"', "Diet and nutrition", "A moment for yourself", "Get the Noreon app", 'id="bp-week-home"', 'id="medicines-home"']) {
  assert.ok(!prototype.includes(marker), `Compact Home does not mount ${marker}`);
}
assert.doesNotMatch(prototype, /id="consultation-hold-title"/, "A cleared consultation hold stays absent");
for (const marker of ["Zoe has a quick question", "data-zoe-consent-prompt", "Care review in progress", "Your previously published plan remains available", "Your doctor is being assigned", "Feeling unwell right now?"]) {
  assert.ok(classic.includes(marker), `Classic fixture exercises ${marker}`);
  assert.ok(prototype.includes(marker), `Prototype retains notice ${marker}`);
}
for (const marker of ["data-programme-now", 'id="nurse-visit-steps-title"', 'id="lab-stage-card-title"', "data-ldl-goal"]) {
  assert.ok(prototype.includes(marker), `Care details retain ${marker}`);
  assert.ok(prototype.indexOf(marker) > prototype.indexOf('data-member-home-details'), `${marker} is in optional care details`);
}
for (const destination of ["service", "medicines", "bp-week", "learn", "care", "account", "dashboard?view=classic#daily-routine"]) {
  assert.ok(prototype.includes(`href="/patient/${destination}"`), `Moved content reachable: ${destination}`);
}
for (medicineAsk of ["pending", "closed", "disabled", "failed"] as const) {
  const html = await render();
  assert.equal(html.includes("Zoe has a quick question"), medicineAsk === "pending", `Medicine follow-up: ${medicineAsk}`);
  if (medicineAsk === "pending") assert.ok(html.indexOf("Zoe has a quick question") < html.indexOf("member-home-next-title"), "Medicine notice stays visible");
}
medicineAsk = "pending";
medicineReadEnabled = false;
assert.doesNotMatch(await render(), /data-home-medicine-ask/, "Disabled medicines cannot expose a follow-up notice");
medicineReadEnabled = true;
const savedCare = care;
care = EMPTY_CARE;
assert.doesNotMatch(await render(), /data-home-medicine-ask/, "No daily doses keeps the original eligibility guard");
care = savedCare;
snapshots["supporting-cards"] = prototype;
snapshots["supporting-cards-classic"] = classic;
doctor = "Recorded doctor";
for (const view of [undefined, "classic"]) {
  const html = await render(view);
  assert.ok(html.includes(doctor), "Assigned doctor fixture is visible");
  assert.ok(html.indexOf(doctor) < html.indexOf("Feeling unwell right now?"), "Assigned doctor precedes the unwell line in both layouts");
}
doctor = null;
booking = { ...booking, available: true, requirements: [{ id: "lipid-panel", title: "Recorded test requirement", method: "lab" }] };
for (const view of [undefined, "classic"]) assert.match(await render(view), /href="\/patient\/service"/, "Test coordination remains reachable");
safety = { state: "on", exercisePaused: false, card: { id: "synthetic-hold", startedAt: "2026-10-20T08:00:00Z", expiresAt: "2026-11-19T08:00:00Z", hiddenToday: false } };
for (const view of [undefined, "classic"]) assert.match(await render(view), /data-safety-card="chest-pain"/, "Chest-pain notice stays");
safety = { ...safety, card: { ...safety.card!, hiddenToday: true } };
assert.doesNotMatch(await render(), /data-safety-card="chest-pain"/, "A hidden chest-pain card stays hidden");
safety = { state: "off" };
care = EMPTY_CARE;
for (const view of [undefined, "classic"]) assert.match(await render(view), /data-first-note/, "First note before plan stays");
// Third group: presentation flag is independent of Home; supporting operational facts move up intact.
screens = true;
for (locale of ["en", "hy"] as const) {
 const html = await render();
 assert.ok(html.indexOf("data-first-note") < html.indexOf("data-member-home-details"), "Doctor note stays visible");
 assert.match(html, /data-member-home-details/, "Operational details have a compact disclosure");
 for (const marker of ["data-programme-now", 'id="nurse-visit-steps-title"', 'id="lab-stage-card-title"']) {
  assert.match(html, new RegExp(marker));
  assert.ok(html.indexOf(marker) > html.indexOf("data-member-home-details"), `${marker} stays in optional details`);
 }
 assert.doesNotMatch(await render("classic"), /data-member-next-details|data-member-screens-prototype/, "Classic Home bypasses third-group presentation");
 snapshots[`${locale}-next-details`] = html;
}
locale = "en";
const terms = { startsAt: "2026-11-05T08:00:00Z", endsAt: "2026-11-05T09:00:00Z", timezone: "Asia/Yerevan" as const, mode: "home" as const, location: "Recorded address" };
const arranged = { provider: "Recorded provider", terms, obtainedAt: now.toISOString(), channel: "phone" as const, source: "Recorded agreement", preparation: "Recorded preparation", replacesExisting: false, recordedBy: "staff", recordedAt: now.toISOString() };
booking = { ...booking, requests: [{ id: "request", revision: 1, status: "change-pending", requestedTerms: terms, requirements: [], algorithmVersion: "recorded", contextToken: "recorded", contextStale: false, proposal: arranged, currentArrangement: arranged,
 pendingChange: { kind: "reschedule", memberAccepted: true }, createdAt: now.toISOString() }] };
let visitHtml = await render();
assert.ok(visitHtml.includes("Replacement awaiting confirmation"), "Accepted replacement does not ask again");
assert.ok(visitHtml.includes("Your acceptance is saved."), "Recorded acceptance is retained on Home");
booking.requests[0].pendingChange = { kind: "cancel" };
visitHtml = await render();
assert.ok(visitHtml.includes("Cancellation requested. The provider has not accepted it yet."));
assert.ok(visitHtml.includes("Recorded preparation"));
snapshots["home-pending-cancel"] = visitHtml;
booking.requests = [];
urgent = true;
for (locale of ["en", "hy", "ru"] as const) {
  const html = await render();
  assert.equal(html, await render("classic"), `${locale}: prototype selection preserves the exact classic emergency Home`);
  assert.match(html, /id="next-step-title"/);
  assert.match(html, /href="\/patient\/urgent"/, `${locale}: urgent guidance is available`);
  assert.doesNotMatch(html, /data-member-home|data-exercise-paused|consultation-hold-title|home-team-title|home-zoe-title|daily-routine|member-home-menu|href="\/patient\/learn"/, `${locale}: emergency Home suppresses routine content`);
  snapshots[`${locale}-urgent`] = html;
}

// Optional offline chat layout fixture: production components, synthetic IO, no hydration or sends.
if (process.env.CHAT_RENDER_OUTPUT) {
  const { PatientShell } = await load(resolve("components/patient/patient-shell.tsx"));
  const { MemberChatModeProvider } = await load(resolve("components/patient/member-chat-mode.tsx"));
  const { ZoeChat } = await load(resolve("components/patient/zoe-chat.tsx"));
  type Component = React.ComponentType<Record<string, unknown>>;
  urgent = false; extras = false; homeFacts = true; care = published; doctor = "Recorded doctor";
  safety = { state: "off" }; answers = {}; hold = false;
  mkdirSync(process.env.CHAT_RENDER_OUTPUT, { recursive: true });
  for (locale of ["en", "hy", "ru"] as const) for (const scenario of ["empty", "history", "exercise", "safety", "hold", "first-note", "consent", "results"] as const) {
    safety = scenario === "exercise" ? { state: "on", exercisePaused: true, card: null }
      : scenario === "safety" ? { state: "on", exercisePaused: false, card: { id: "synthetic-hold", startedAt: now.toISOString(), expiresAt: "2026-11-19T08:00:00Z", hiddenToday: false } } : { state: "off" };
    hold = scenario === "hold"; resultsReceived = scenario === "results";
    extras = scenario === "first-note" || scenario === "consent";
    care = scenario === "first-note" ? EMPTY_CARE : published;
    const intro = await Dashboard({ chat: true, searchParams: Promise.resolve({}) });
    const initial = { ok: true, version: 0, ack: null, zoeReplies: false, settledSeq: 0, messages: [], answers: [],
      replies: scenario === "empty" ? [] : Array.from({ length: 60 }, (_, i) => ({ id: `reply-${i}`, text: `Saved doctor reply ${i}`, doctorName: "Recorded doctor", at: now.toISOString() })) };
    const chat = React.createElement(ZoeChat as Component, { locale, initial, upload: false, chatOnly: true, intro });
    const page = React.createElement("div", { "data-zoe-page": true, "data-chat-only-page": true }, chat);
    const shell = React.createElement(PatientShell as Component, { locale, memberName: "Test Member" }, page);
    const stream = await renderToReadableStream(React.createElement(MemberChatModeProvider as Component, { enabled: true }, shell));
    await stream.allReady;
    writeFileSync(resolve(process.env.CHAT_RENDER_OUTPUT, `chat-${locale}-${scenario}.html`), await new Response(stream).text());
  }
}

// Optional local-only visual fixtures use the same real page render as the checks.
if (process.env.HOME_RENDER_OUTPUT) {
  mkdirSync(process.env.HOME_RENDER_OUTPUT, { recursive: true });
  for (const [name, html] of Object.entries(snapshots)) writeFileSync(resolve(process.env.HOME_RENDER_OUTPUT, `${name}.html`), html);
}
console.log("Member Home notices: exercise paused/cleared/unreadable in EN/HY/RU; consultation hold with a published plan, scheduled/unscheduled and booking failure; compact section/destination parity and dated saved facts; emergency and read-failure guards. Synthetic reads, real page/cards; mutation and chart boundaries replaced.");
