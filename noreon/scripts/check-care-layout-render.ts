import * as memberStaffNames from "@/lib/member-staff-name.mjs";
import * as textLanguage from "@/lib/text-language";
import {MEMBER_LANGUAGE} from "@/lib/patient/copy";
import {NEXT_STEP} from "@/lib/zoe-chat-actions/next-step-copy";
/* eslint-disable @typescript-eslint/no-explicit-any -- The isolated VM supplies framework module boundaries for rendering actual page and control code. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { renderToStaticMarkup } from "react-dom/server";
import { dosesForDay, careActions, appointmentIsCurrent } from "@/lib/patient-care/model";
import type { CareData } from "@/lib/patient-care/types";
import * as realLocaleModule from "@/lib/locale";
const longInstructions =
  "Follow the nutrition and activity plan agreed in the consultation.\n" +
  "Keep every doctor instruction, including this final instruction. ".repeat(
    24,
  ) +
  "END-INSTRUCTIONS";
const longExplanation =
  "Your doctor explained your results. ".repeat(30) + "END-EXPLANATION";
let care: CareData = {
  tests: [],
  results: [],
  appointments: [],
  events: [],
  pendingReview: { openedAt: "2026-10-01T10:00:00Z" },
  plan: {
    id: "approved-1",
    clinician: "Dr Actual",
    publishedAt: "2026-01-01T00:00:00Z",
    instructions: longInstructions,
    explanation: longExplanation,
    publishedReview: { instructions: longInstructions, explanation: longExplanation, followUp: "FULL-FOLLOWUP" },
    acknowledgedAt: null,
    medications: [
      {
        id: "dose-1",
        planId: "approved-1",
        name: "Actual medicine",
        dose: "5 mg",
        instructions: "FULL-MEDICINE-INSTRUCTION",
        times: ["08:00", "20:00"],
        startDate: "2026-01-01",
        endDate: null,
        active: true,
      },
    ],
  },
};
let locale = "en";
let completedAt: string | null = null;
const browser = new EventTarget() as EventTarget & { location: URL; history: { state: { marker: string }; replaceState: (state: unknown, title: string, url: URL) => void } };
browser.location = new URL("https://example.test/patient/care?source=home");
browser.history = { state: { marker: "next-state" }, replaceState(state, _title, url) {
  assert.deepEqual(state, { marker: "next-state" }, "Tab changes preserve Next history state");
  browser.location = new URL(url);
} };

const load = (path: string): Record<string, any> => {
  const exports: Record<string, any> = {};
  const code = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const require = (name: string): any => {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/member-staff-name.mjs") return memberStaffNames;
    if (name === "@/lib/text-language") return textLanguage;
    if (name === "@/lib/zoe-chat-actions/next-step-copy") return {NEXT_STEP};
    if (name.endsWith("/member-screens-config")) return { memberScreensPrototypeEnabled: () => false };
    if (name.endsWith("/member-screens")) return { MemberScreen: ({ children }: { children: React.ReactNode }) => children };
    if (name === "react") return React;
    if (name === "next/navigation")
      return { useRouter: () => ({ refresh() {} }) };
    if (name === "next/link")
      return {
        default: ({ children, ...props }: any) =>
          React.createElement("a", props, children),
      };
    if (name.endsWith("/repository"))
      return { carePageData: async () => ({ profile: { locale }, assessment: { completedAt }, care }) };
    if (name.endsWith("/model")) return { dosesForDay, appointmentIsCurrent };
    if (name.endsWith("/date-format"))
      return {
        formatMemberDate: (v: any, _l: string, o: any) =>
          new Intl.DateTimeFormat("en-GB", o).format(new Date(v)),
      };
    if (name.endsWith("/common"))
      return load("components/patient-care/common.tsx");
    if (name.endsWith("/member-page-frame")) return { MemberPageFrame: ({ children }: { children: React.ReactNode }) => React.createElement("main", null, children) };
    if (name.endsWith("/patient-shell"))
      return {
        PatientShell: ({ children }: any) =>
          React.createElement("main", null, children),
      };
    if (name.endsWith("/controls"))
      return load("components/patient-care/controls.tsx");
    if (name.endsWith("/member-monitoring"))
      return load("components/patient-care/member-monitoring.tsx");
    if (name.endsWith("/care-sections"))
      return load("components/patient-care/care-sections.tsx");
    if (name.endsWith("/care-layout"))
      return load("components/patient-care/care-layout.tsx");
    if (name.endsWith("/button"))
      return {
        Button: ({ children, ...props }: any) =>
          React.createElement("button", props, children),
      };
    if (name.endsWith("/lessons/catalogue"))
      return { lessonsShowDrafts: () => true, visibleLessons: () => [{ id: "bp-numbers" }] };
    if (name.endsWith("/reports-provider"))
      return { useDemoReports: () => ({ clear() {} }) };
    if (name.endsWith("/transport"))
      return {
        safeRequest: async (fn: any) => fn(),
        lockUnavailableMessage: () => "",
      };
    if (name.endsWith("/care/actions"))
      return {
        acknowledgePlan: async () => ({ ok: true }),
        reportDose: async () => ({ ok: true }),
      };
    if (name === "@/lib/locale") return realLocaleModule;
    return new Proxy({}, { get: () => () => null });
  };
  new vm.Script(code).runInNewContext({ exports, require, Date, Intl, window: browser, URL, Event });
  return exports;
};
const page = load("components/patient-care/member-care-content.tsx").default;
for (locale of ["en", "hy"]) {
  const html = renderToStaticMarkup(await page());
  if(locale==='en'){
  assert.ok(
    html.includes(longInstructions),
    "Every doctor instruction is retained verbatim",
  );
  assert.ok(
    html.includes(longExplanation),
    "The complete doctor explanation is retained verbatim",
  );
  assert.match(html, /FULL-MEDICINE-INSTRUCTION/);
  }else{
    assert.ok(html.includes(MEMBER_LANGUAGE.pendingInstruction.hy));
    assert.ok(!html.includes(longInstructions));
    assert.ok(!html.includes(longExplanation));
    assert.ok(!html.includes('FULL-MEDICINE-INSTRUCTION'));
  }
  assert.match(html, /href="\/patient\/learn"/, "Plan links to the lessons while any are visible");
  const heroStart = html.indexOf('<section id="plan"');
  const hero = html.slice(heroStart, html.indexOf('<section id="medicines"', heroStart));
  const approval = html.slice(0, heroStart);
  assert.match(approval, /Dr Actual/);
  assert.match(approval, /role="status"/, "Pending review stays visible outside collapsed metadata");
  assert.ok(approval.indexOf("</details>") < approval.indexOf('role="status"'));
  if(locale==='en'){
  assert.match(hero, /<button[^>]*>[^<]+<\/button>/, "Readable unread plan retains its read action");
  assert.ok(hero.indexOf("END-INSTRUCTIONS") < hero.indexOf("<details"), "Full instructions precede the optional explanation disclosure");
  assert.ok(hero.indexOf("FULL-FOLLOWUP") < hero.indexOf("<details"), "Clinical follow-up remains fully visible");
  assert.ok(hero.indexOf("<details") < hero.indexOf("END-EXPLANATION"), "Full explanatory wording is retained behind Why this plan");
  const acknowledgement = locale === "en" ? "I have read my plan" : "Կարդացել եմ պլանը";
  assert.ok(hero.indexOf("END-INSTRUCTIONS") < hero.indexOf(acknowledgement));

  assert.ok(hero.indexOf("FULL-FOLLOWUP") < hero.indexOf(acknowledgement));
  assert.ok(hero.includes(acknowledgement), "The visible approved instructions retain their acknowledgement action");
  assert.ok(hero.includes("END-EXPLANATION"), "The full doctor explanation remains available with the plan");
  }else{
    assert.ok(!hero.includes('Կարդացել եմ պլանը'),'Withheld instructions have no read acknowledgement');
    assert.ok(hero.includes('/patient/team?section=contact'));
  }
  assert.ok(
    html.indexOf('role="tablist"') < html.indexOf('id="plan"'),
    "Section navigation is available before the long approved plan",
  );
}
locale = "en";
care.plan!.acknowledged = true;
let html = renderToStaticMarkup(await page());
assert.ok(!html.includes("I have read my plan"));
assert.match(html, /Date not recorded|Ամսաթիվը գրանցված չէ/);
const DoseButtons = load("components/patient-care/controls.tsx").DoseButtons;
const medication = care.plan!.medications[0];
for (const status of ["upcoming", "due"] as const) {
  html = renderToStaticMarkup(
    React.createElement(DoseButtons, {
      dose: { medication, dueAt: "2026-10-12T16:00:00Z", status },
      locale: "en",
    }),
  );
  if (status === "upcoming") {
    assert.match(html, /Check-in opens at the scheduled time/);
    assert.ok(!html.includes("<button"));
  } else {
    assert.match(html, />Mark as taken<\/button>/);
    assert.match(html, />Mark as missed<\/button>/);
  }
}
for (const compactLocale of ["en", "hy"] as const) {
  for (const status of ["upcoming", "due", "taken", "skipped"] as const) {
    const compactHTML = renderToStaticMarkup(React.createElement(DoseButtons, {
      dose: { medication, dueAt: "2026-10-12T16:00:00Z", status }, locale: compactLocale, compact: true,
    }));
    assert.equal((compactHTML.match(/<button/g) ?? []).length, status === "upcoming" ? 0 : status === "due" ? 2 : 1,
      "Compact check-ins keep due choices and correction, without a duplicate disabled status action");
    if (status === "taken") assert.ok(compactHTML.includes(compactLocale === "en" ? "Change to skipped" : "Փոխել՝ բաց թողնված"));
    if (status === "skipped") assert.ok(compactHTML.includes(compactLocale === "en" ? "Change to taken" : "Փոխել՝ ընդունված"));
  }
}
care = { tests: [], results: [], appointments: [], events: [], plan: null, monitoring: [] };
for (locale of ["en", "hy"]) {
  html = renderToStaticMarkup(await page());
  assert.match(
    html,
    /No clinician-approved plan|Բժշկի հաստատած պլան դեռ հրապարակված չէ/,
  );
  assert.match(html, /href="\/patient\/questions"/, "Incomplete empty care must give a next action");
  assert.match(html, locale === "en" ? /Continue health questions/ : /Շարունակել առողջության հարցերը/);
  assert.doesNotMatch(html, /No monitoring requirement recorded|Չափումների պահանջ չի գրանցվել/);
  assert.match(html, /No medicines have been published|Խնամքի պլանում դեղեր դեռ հրապարակված չեն/);
  assert.doesNotMatch(html, /href="#medicines"|href="#appointments"/);
  assert.doesNotMatch(html, /Your published plan, medicines and appointments|Ձեր հրապարակված պլանը, դեղերն ու այցերը/);
  completedAt = "2026-10-13T00:00:00Z";
  const waiting = renderToStaticMarkup(await page());
  assert.match(waiting, /href="\/patient\/dashboard"/);
  assert.match(waiting, locale === "en" ? /See your next step/ : /Դիտել հաջորդ քայլը/);
  assert.doesNotMatch(waiting, /href="\/patient\/questions"/);
  completedAt = null;
  assert.ok(!html.includes("I have read my plan"));
  assert.ok(!html.includes("Կարդացել եմ պլանը"));
}
const MemberMonitoring = load(
  "components/patient-care/member-monitoring.tsx",
).MemberMonitoring;
const requirement: NonNullable<CareData["monitoring"]>[number] = {
  id: "monitor-1",
  instructions: "MONITORING-START " + longInstructions + " MONITORING-END",
  startsAt: "2026-10-01T00:00:00Z",
  endsAt: "2026-10-15T00:00:00Z",
  createdAt: "2026-09-30T00:00:00Z",
  doctor: "Dr Actual",
  requiredCount: 6,
  received: 2,
  missing: 4,
  late: 1,
  status: "active",
  acknowledgedAt: null,
};
care.monitoring = [requirement];
care.appointments = [{ id: "real-appointment", clinician: "Dr Recorded", specialty: "Recorded consultation", location: "Recorded clinic", startsAt: "2027-01-15T09:00:00+04:00", status: "requested" }];
for (locale of ["en", "hy"]) {
  const sparseRecorded = renderToStaticMarkup(await page());
  assert.ok(sparseRecorded.includes(locale==='en'?'MONITORING-END':MEMBER_LANGUAGE.pendingInstruction.hy), "Monitoring uses the language boundary without a plan");
  assert.match(sparseRecorded, /Dr Recorded/);
  assert.match(sparseRecorded, /id="appointments"/);
  assert.match(sparseRecorded, /role="tablist"/);
}
html = renderToStaticMarkup(
  React.createElement(MemberMonitoring, {
    requirements: [requirement],
    now: Date.parse("2026-10-13T00:00:00Z"),
    locale: "en",
  }),
);
assert.match(
  html,
  /MONITORING-END/,
  "Full active monitoring instructions remain visible",
);
assert.ok(!html.includes("<details"), "Current monitoring instructions are not hidden behind a disclosure");
assert.match(html, /2[\s\S]*6/);
for (const l of ["en", "hy"] as const) {
  const rendered = renderToStaticMarkup(React.createElement(MemberMonitoring, { requirements: [requirement], now: Date.parse("2026-10-13T00:00:00Z"), locale: l }));
  const acknowledgement = l === "en" ? "I have read these instructions" : "Ես կարդացել եմ այս ցուցումները";
  assert.ok(rendered.includes(acknowledgement), "Acknowledgement follows the visible full monitoring instructions");
  assert.ok(rendered.indexOf(l==='en'?'MONITORING-END':MEMBER_LANGUAGE.pendingInstruction.hy) < rendered.indexOf(acknowledgement), "Instruction or language notice precedes acknowledgement");
  if(l==='hy')assert.match(rendered,/<button[^>]*disabled=""/,'Unavailable monitoring cannot be acknowledged');
}
html = renderToStaticMarkup(
  React.createElement(MemberMonitoring, {
    requirements: [{ ...requirement, status: "cancelled" }],
    now: Date.parse("2026-10-16T00:00:00Z"),
    locale: "en",
  }),
);
assert.match(html, /cancelled/);
assert.ok(!html.includes("I have read these instructions"));
console.log(
  "Care plan retains complete doctor content, disclosed explanation, pending review and read authority; scheduled doses remain unavailable and sparse care stays truthful in EN/HY.",
);

const appointmentNow = new Date("2026-10-13T00:00:00Z");
const recentVisit = {id:"recent",clinician:"Recorded doctor",specialty:"Review",location:"Recorded clinic",startsAt:"2026-10-12T23:45:00Z",status:"confirmed" as const};
const CareAppointments = load("components/patient-care/care-layout.tsx").CareAppointments;
for (const l of ["en", "hy"] as const) {
 const currentVisitHtml = renderToStaticMarkup(React.createElement(CareAppointments,{appointments:[recentVisit],locale:l,now:appointmentNow}));
 assert.ok(!currentVisitHtml.includes("<details"), "The recently started visit linked from Home stays visible in Care");
 assert.ok(currentVisitHtml.includes(l==='en'?"Recorded clinic":MEMBER_LANGUAGE.pendingInstruction.hy));
}
const visitAction = careActions({...care,plan:null,appointments:[recentVisit]}, {complete:true,urgent:false,measuredToday:true,now:appointmentNow}).find(a=>a.kind==="appointment");
assert.equal(visitAction?.title.en,"Your appointment", "A started appointment is not described as next");
const oldVisitHtml = renderToStaticMarkup(React.createElement(CareAppointments,{appointments:[{...recentVisit,startsAt:"2026-10-12T20:00:00Z"}],locale:"en",now:appointmentNow}));
assert.ok(oldVisitHtml.includes("<details"), "Older visits remain accessible in history");

// The end boundary is exclusive: current readings cannot fill an ended window.
for (const l of ["en", "hy"] as const) {
  const ended = renderToStaticMarkup(React.createElement(MemberMonitoring, {requirements:[requirement],locale:l,now:Date.parse(requirement.endsAt)}));
  assert.ok(ended.includes(l === "en" ? "Window ended" : "Ժամանակահատվածն ավարտվել է"));
  assert.ok(ended.includes(l === "en" ? "Add a reading from this window" : "Ավելացնել այս ժամանակահատվածի չափումը"));
  assert.match(ended, /href="\/patient\/team\?section=contact"/);
  assert.ok(!ended.includes(l === "en" ? "Record a blood pressure reading" : "Գրանցել զարկերակային ճնշման չափում"));
  const filled = renderToStaticMarkup(React.createElement(MemberMonitoring, {requirements:[{...requirement,received:6,missing:0}],locale:l,now:Date.parse(requirement.endsAt)}));
  assert.ok(filled.includes(l === "en" ? "No readings missing" : "Բացակայող չափումներ չկան"));
  assert.equal(filled.includes("/patient/team?section=contact"),l==='hy','Unavailable language retains care-team recovery');
  assert.ok(!filled.includes("/patient/measurements/new"), "A filled ended window has no unnecessary recording action");
  assert.ok(filled.includes(l==='en'?'MONITORING-END':MEMBER_LANGUAGE.pendingInstruction.hy));
}
const cancelledEnded = renderToStaticMarkup(React.createElement(MemberMonitoring, {requirements:[{...requirement,status:"cancelled"}],locale:"en",now:Date.parse(requirement.endsAt)}));
assert.ok(!cancelledEnded.includes("Window ended"));
assert.ok(!cancelledEnded.includes("/patient/measurements/new"));

// Before the inclusive start boundary, do not suggest a reading that cannot count.
for (const l of ["en", "hy"] as const) {
 const future = renderToStaticMarkup(React.createElement(MemberMonitoring,{requirements:[requirement],locale:l,now:Date.parse(requirement.startsAt)-1}));
 assert.ok(future.includes(l === "en" ? "Starts " : "Սկսվում է "));
 assert.ok(!future.includes("/patient/measurements/new"), "Future monitoring does not prompt an out-of-window reading");
 assert.ok(future.includes(l==='en'?'MONITORING-END':MEMBER_LANGUAGE.pendingInstruction.hy), "Instructions use the language boundary before the start");
 assert.ok(future.includes(l === "en" ? "I have read these instructions" : "Ես կարդացել եմ այս ցուցումները"));
 const started = renderToStaticMarkup(React.createElement(MemberMonitoring,{requirements:[requirement],locale:l,now:Date.parse(requirement.startsAt)}));
 assert.ok(started.includes("/patient/measurements/new"), "Recording becomes available exactly at the inclusive start");
 const cancelledFuture = renderToStaticMarkup(React.createElement(MemberMonitoring,{requirements:[{...requirement,status:"cancelled"}],locale:l,now:Date.parse(requirement.startsAt)-1}));
 assert.ok(!cancelledFuture.includes(l === "en" ? "Starts " : "Սկսվում է "));
}

// Exercise the actual client component with real React subscriptions and event handlers.
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const CareSections = load("components/patient-care/care-sections.tsx").CareSections;
for (const l of ["en", "hy"] as const) {
  browser.location = new URL("https://example.test/patient/care?source=home");
  let mounted!: ReactTestRenderer;
  const focused: number[] = [];
  await act(async () => {
    mounted = create(React.createElement(CareSections, { locale: l,
      plan: React.createElement("p", null, "FULL-PLAN"),
      medicines: React.createElement("p", null, "FULL-MEDICINES"),
      visits: React.createElement("p", null, "FULL-VISITS"),
    }), { createNodeMock(element) {
      if (element.type === "button") return { focus() { focused.push(1); } };
      return null;
    } });
  });
  const tabs = () => mounted.root.findAllByProps({ role: "tab" });
  const panels = () => mounted.root.findAllByProps({ role: "tabpanel" });
  function selected(index: number) {
    assert.deepEqual(tabs().map(tab => tab.props["aria-selected"]), [0, 1, 2].map(i => i === index));
    assert.deepEqual(panels().map(panel => panel.props.hidden), [0, 1, 2].map(i => i !== index));
    assert.equal(tabs()[index].props.tabIndex, 0);
    assert.equal(tabs()[index].props["aria-controls"], panels()[index].props.id);
    assert.equal(panels()[index].props["aria-labelledby"], tabs()[index].props.id);
  }
  selected(0);
  await act(async () => tabs()[1].props.onClick());
  selected(1);
  assert.equal(browser.location.hash, "#medicines");
  assert.equal(browser.location.search, "?source=home");
  let prevented = false;
  await act(async () => tabs()[1].props.onKeyDown({ key: "ArrowRight", preventDefault() { prevented = true; } }));
  selected(2);
  assert.ok(prevented && focused.length > 0, "Arrow navigation moves selection and focus");
  await act(async () => tabs()[2].props.onKeyDown({ key: "ArrowRight", preventDefault() {} }));
  selected(0);
  await act(async () => tabs()[0].props.onKeyDown({ key: "End", preventDefault() {} }));
  selected(2);
  await act(async () => tabs()[2].props.onKeyDown({ key: "Home", preventDefault() {} }));
  selected(0);
  for (const [hash, index] of [["#medicines", 1], ["#appointments", 2], ["#reminders", 1], ["#care-history", 0], ["#plan", 0]] as const) {
    await act(async () => { browser.location.hash = hash; browser.dispatchEvent(new Event("hashchange")); });
    selected(index);
  }
  await act(async () => { browser.location.hash = "#appointments"; browser.dispatchEvent(new Event("popstate")); });
  selected(2);
  assert.deepEqual(panels().map(panel => panel.findByType("p").children.join("")), ["FULL-PLAN", "FULL-MEDICINES", "FULL-VISITS"], "Panel navigation retains all server content");
  await act(async () => mounted.unmount());
}
console.log("Actual Care segments: EN/HY default, click, arrow wrapping, Home/End, focus, ARIA relationships, legacy deep links, popstate, query/history preservation and retained panel content passed.");

// Real booking requests can originate from questionnaire decisions, without a clinician test order.
// Care must always expose the authoritative service page instead of treating care.tests as booking state.
care.tests = [];
care.appointments = [];
for (locale of ["en", "hy"]) {
  const questionnaireBooking = renderToStaticMarkup(await page());
  assert.match(questionnaireBooking, /href="\/patient\/service"/, "Real test arrangements stay reachable with no clinician test orders or appointments");
  assert.ok(questionnaireBooking.includes(locale === "en" ? "Tests and bookings" : "Հետազոտություններ և ամրագրումներ"));
  assert.ok(questionnaireBooking.includes(locale === "en" ? "No clinician appointments recorded." : "Բժշկի այցեր գրանցված չեն։"));
  assert.doesNotMatch(questionnaireBooking, /No appointments recorded\. A confirmed visit/,
    "An empty clinician list cannot imply that a separately accepted test arrangement is absent");
  assert.doesNotMatch(questionnaireBooking, locale === "en" ? />Confirmed</ : />Հաստատված</,
    "Navigation to arrangements does not invent provider or member acceptance status");
}
for (const l of ["en", "hy"] as const) {
 const reviewed = renderToStaticMarkup(React.createElement(CareAppointments, { appointments: [{ ...recentVisit, needsReview: true }], locale: l, now: appointmentNow }));
 assert.ok(reviewed.includes(l==='en'?"Recorded clinic":MEMBER_LANGUAGE.pendingInstruction.hy) && reviewed.includes("Recorded doctor"));
 assert.ok(reviewed.includes(l === "en" ? "Confirmed" : "Հաստատված"));
 assert.ok(reviewed.includes(l === "en" ? "Your test requirements need review" : "Ձեր հետազոտությունների ցանկը վերանայման կարիք ունի"));
}
console.log("Care Visits: questionnaire-based real arrangements remain reachable without clinician orders, distinct empty clinician list and review qualifier pass in EN/HY.");
