import assert from "node:assert/strict";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToReadableStream } from "react-dom/server";
import type { MemberBookingData, BookingRequest } from "@/lib/real-booking/schema";
import type { Appointment, PilotBookingData } from "@/lib/real-booking/appointment-schema";

// Actual service page, booking components and clinical helpers. Only IO, shell,
// routing and write actions are substituted. This does not test booking writes.
const nativeRequire = createRequire(import.meta.url), root = process.cwd();
let enabled = false, locale: "en" | "hy" = "en", completedAt: string | null = null;
let answers: Record<string, unknown> = {}, urgentRule: string | null = null;
let data: MemberBookingData = { available: false, requirements: [], homeTasks: [], requests: [] };
let pilotFailure: "unavailable" | "profile-mismatch" | null = null;
let uuid = 0, comparisons = 0;
const cache = new Map<string, Record<string, unknown>>();
const fixedNow = new Date("2026-10-31T08:00:00Z");
class RenderDate extends Date {
  constructor(value: string | number | Date = fixedNow) { super(value); }
  static now() { return fixedNow.getTime(); }
}
const recorded = (en: string, hy: string) => locale === "hy" ? hy : en;
const noWrite = () => { throw Error("A render must not write"); };
const mocks: Record<string, unknown> = {
  "server-only": {},
  "next/link": { __esModule: true, useLinkStatus: () => ({ pending: false }), default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => React.createElement("a", { ...props, href }, children) },
  "next/navigation": { redirect: (href: string) => { throw Error(`REDIRECT:${href}`); }, unstable_rethrow: () => {}, useRouter: () => ({ refresh() {}, push: noWrite, replace: noWrite }), usePathname: () => "/patient/service", useSearchParams: () => new URLSearchParams() },
  "@/components/patient/patient-shell": { PatientShell: ({ children }: { children: React.ReactNode }) => React.createElement("div", {}, children) },
  "@/lib/patient/repository": { requireRegistered: async () => ({ profile: { locale }, assessment: { answers, completedAt, urgentRule } }) },
  "@/lib/real-booking/repository": { getMemberBookingData: async () => data },
  "@/lib/real-booking/appointment-repository": { getMemberAppointmentData: async () => { if (pilotFailure) throw Error(pilotFailure === "profile-mismatch" ? "Profile and questionnaire context disagree." : "Fixture read failure"); return emptyPilot(); } },
  "@/lib/pilot-commerce/member": { getMemberPricing: async () => undefined },
  "@/lib/patient-care/lab-stage-repository": { getMemberLabStages: async () => null },
  "@/lib/patient-care/repository": { getCareData: async () => null },
  "@/lib/patient-care/journey-reads": { readJourneyExtras: async () => ({ nurseVisit: undefined, released: null }) },
};
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
    assert.ok(!name.includes("supabase"), "No database dependency in rendering");
    return nativeRequire(name);
  };
  new vm.Script(code, { filename: file }).runInNewContext({ exports, module: vmModule, require, console, Error, SyntaxError, Date: RenderDate, URL, URLSearchParams, setTimeout, clearTimeout, crypto: { randomUUID: () => `00000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}` }, process: { env: { NOREON_MEMBER_SCREENS_PROTOTYPE: enabled ? "true" : undefined } } });
  cache.set(file, vmModule.exports);
  return vmModule.exports;
}
async function render(prototype: boolean, classic = false) {
  enabled = prototype; uuid = 0; cache.clear();
  const page = load(resolve(root, "app/patient/service/page.tsx")).default as (p: { searchParams: Promise<{ view?: string }> }) => Promise<React.ReactNode>;
  const stream = await renderToReadableStream(await page({ searchParams: Promise.resolve(classic ? { view: "classic" } : {}) }));
  await stream.allReady;
  return new Response(stream).text();
}
const paragraphs = (html: string) => [...html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/g)].map(m => m[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
const links = (html: string) => [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
async function parity(name: string, literals: string[] = []) {
  const before = await render(false), after = await render(true);
  assert.ok(!before.includes("data-member-screens-prototype"));
  assert.ok(after.includes("data-member-screens-prototype"), name);
  for (const notice of paragraphs(before)) assert.ok(paragraphs(after).includes(notice), `${locale}/${name}: dropped notice ${notice}`);
  for (const href of links(before)) assert.ok(links(after).includes(href), `${locale}/${name}: dropped route ${href}`);
  assert.equal(await render(true, true), before, `${locale}/${name}: exact classic bypass`);
  for (const literal of literals) assert.ok(after.includes(literal), `${name}: missing ${literal}`);
  if (process.env.MEMBER_SCREEN_FIXTURES) {
    const directory = resolve(process.env.MEMBER_SCREEN_FIXTURES);
    assert.ok(directory.startsWith("/tmp/") || directory.startsWith("/private/tmp/"), "Fixtures must be under /tmp");
    mkdirSync(directory, { recursive: true });
    writeFileSync(resolve(directory, `visit-${locale}-${name}.html`), after);
  }
  comparisons++;
  return after;
}
const id = "00000000-0000-4000-8000-000000000001", clinicId = "00000000-0000-4000-8000-000000000002";
const startsAt = "2026-11-12T08:00:00+04:00", endsAt = "2026-11-12T09:00:00+04:00";
function emptyPilot(): PilotBookingData { return { available: false, unavailableReason: "unavailable", program: [], offers: [], appointments: [] }; }
function reset() { answers = {}; urgentRule = null; completedAt = null; pilotFailure = null; data = { available: false, requirements: [], homeTasks: [], requests: [] }; }
for (locale of ["en", "hy"] as const) {
  reset();
  const program = [{ id: "test", title: "RECORDED TEST", method: "lab" as const, preparation: recorded("RECORDED PROGRAM PREPARATION", "Ծրագրի նախապատրաստման գրանցված ցուցումներ") }];
  const terms = { mode: "clinic" as const, startsAt, endsAt, timezone: "Asia/Yerevan" as const, location: recorded("Noreon, 12 Abovyan Street", "Noreon, Աբովյան 12") };
  const arrangement = { provider: "RECORDED PROVIDER", terms, obtainedAt: startsAt, channel: "phone" as const, source: recorded("RECORDED SOURCE", "Գրանցված աղբյուր"), preparation: recorded("RECORDED PREPARATION", "Գրանցված նախապատրաստման ցուցումներ"), replacesExisting: false, recordedBy: id, recordedAt: startsAt };
  const pilotTerms = { offerId: id, offerVersion: "v1", clinicId, ...terms, preparation: recorded("RECORDED PREPARATION", "Գրանցված նախապատրաստման ցուցումներ"), preparationVersion: "v1", coveredTestIds: ["test"], followUps: [] };
  function request(): BookingRequest { return { id, revision: 1, status: "requested", requestedTerms: terms, requirements: program, algorithmVersion: "NRN-CLIN-ALG-001", contextToken: "fixture", contextStale: false, proposal: null, currentArrangement: null, pendingChange: null, createdAt: startsAt }; }
  function appointment(): Appointment { return { version: "email-pilot-v1", id, memberId: id, revision: 1, status: "confirmed", noticePurpose: "booking", program, current: pilotTerms, proposed: pilotTerms, noticeId: id, createdAt: startsAt }; }
  // Real clinical helpers: a saved crisis reading with its symptom answer missing.
  completedAt = fixedNow.toISOString();
  answers = { "q5.last_reading.systolic": { fieldId: "q5.last_reading.systolic", value: 180, source: "manual", answeredAt: completedAt } };
  await parity("incomplete-crisis", ['href="tel:103"', 'href="/patient/questions"']);
  answers = {};
  await parity("incomplete", ['href="/patient/questions"']);
  completedAt = null;
  data.legacyCreationAvailable = true;
  await parity("legacy-unavailable");
  data.available = true;
  await parity("legacy-empty");
  for (const status of ["provider-proposed", "confirmed", "change-pending"] as const) {
    const row = request(); row.status = status; row.proposal = arrangement;
    if (status !== "provider-proposed") row.currentArrangement = arrangement;
    if (status === "change-pending") row.pendingChange = { kind: "cancel" };
    data.requests = [row];
    await parity(`legacy-${status}`, ["RECORDED PROVIDER", terms.location, recorded("RECORDED PREPARATION", "Գրանցված նախապատրաստման ցուցումներ")]);
    if (status === "change-pending") { row.pendingChange = { kind: "reschedule", terms }; await parity("legacy-reschedule-pending"); }
  }
  reset(); data.pilot = emptyPilot();
  await parity("pilot-unavailable");
  delete data.pilot;
  for (pilotFailure of ["unavailable", "profile-mismatch"] as const) await parity(`pilot-${pilotFailure}`, pilotFailure === "profile-mismatch" ? ['href="/patient/profile"'] : []);
  pilotFailure = null;
  data.pilot = { ...emptyPilot(), available: true, unavailableReason: null, program, appointments: [appointment()], canChange: true, canCancel: true, clinics: { [clinicId]: "Noreon" } };
  await parity("pilot-confirmed", ["Noreon", terms.location, recorded("RECORDED PREPARATION", "Գրանցված նախապատրաստման ցուցումներ")]);
  data.pilot.appointments[0].portal = { channel: "portal", noticeState: "pending", portalRevisions: [], decline: null, checkin: null, proposal: { id, startsAt: "2026-11-13T08:00:00+04:00", endsAt: "2026-11-13T09:00:00+04:00", note: recorded("RECORDED PROPOSAL NOTE", "Կլինիկայի առաջարկի գրանցված նշում"), clinicId, clinicName: "Noreon", clinicAddress: "Noreon, 14 Abovyan Street", createdAt: startsAt } };
  await parity("pilot-proposal", [recorded("RECORDED PROPOSAL NOTE", "Կլինիկայի առաջարկի գրանցված նշում"), "Noreon, 14 Abovyan Street"]);
  data.clinicalHold = true;
  await parity("pilot-clinical-hold", [recorded("RECORDED PREPARATION", "Գրանցված նախապատրաստման ցուցումներ"), locale === "en" ? "Your assigned program needs clinical review before booking." : "Մինչև այցը գրանցելը նշանակված ծրագիրը պետք է վերանայի բժիշկը։"]);
  urgentRule = "RF-01";
  for (const flag of [false, true]) await assert.rejects(render(flag), /REDIRECT:\/patient\/urgent/);
}
console.log(`Visit: ${comparisons} actual-page EN/HY notice/link parity and exact classic fallback cases; real crisis/incomplete gates, legacy proposals/current/change/cancel, pilot read failures/clinical hold/current/proposal; urgent redirects. Render-only, no booking writes.`);
