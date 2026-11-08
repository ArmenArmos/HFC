import * as memberStaffNames from "@/lib/member-staff-name.mjs";
/* eslint-disable @typescript-eslint/no-explicit-any -- Render the production component with only framework/action boundaries replaced. */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as React from "react";
import * as jsx from "react/jsx-runtime";
import * as icons from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import * as common from "@/components/patient-care/common";
import * as dates from "@/lib/patient/date-format";
import * as model from "@/lib/patient-care/home-dashboard";
import {
  EMPTY_CARE,
  type CareData,
  type DueDose,
} from "@/lib/patient-care/types";
import { DEFAULT_REMINDERS } from "@/lib/patient-care/reminder-preferences";
const exports: Record<string, any> = {};
let forwarded: DueDose | undefined;
const compiled = ts.transpileModule(
  readFileSync("components/patient-care/home-dashboard.tsx", "utf8"),
  {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  },
).outputText;
new vm.Script(compiled).runInNewContext({
  exports,
  Date,
  Math,
  Intl,
  require: (name: string) => {
    if (name === "react/jsx-runtime") return jsx;
    if (name === "@/lib/member-staff-name.mjs") return memberStaffNames;
    if (name === "lucide-react") return icons;
    if (name === "next/link") return {default:({children,...props}:any)=>React.createElement("a",props,children)};
    if (name === "next/image")
      return {
        default: ({ children, ...props }: any) => {
          delete props.unoptimized;
          return React.createElement("img", props, children);
        },
      };
    if (name === "@/lib/patient-care/home-dashboard") return model;
    if (name === "@/lib/patient/date-format") return dates;
    if (name === "./common") return common;
    if (name === "./controls")
      return {
        DoseButtons: ({ dose }: any) => {
          forwarded = dose;
          return React.createElement("button", null, "Mutation boundary");
        },
      };
    if (name === "./trends")
      return {
        HealthTrends: () => React.createElement("div", null, "Chart boundary"),
      };
    if (name === "./home-wellbeing")
      return new Proxy({}, { get: (_target, key) => key === "MovementTip" ? () => React.createElement("p", null, "Movement tip boundary") : () => null });
    if (name === "./exercise-pause-notice")
      return { ExercisePauseNotice: () => React.createElement("p", null, "Exercise paused boundary") };
    throw Error("Unexpected dependency " + name);
  },
});
const care: CareData = {
  ...EMPTY_CARE,
  plan: {
    id: "real-published",
    publishedAt: "2026-10-01T00:00:00Z",
    clinician: "Actual reviewer",
    acknowledgedAt: null,
    instructions: "Actual plan",
    medications: [
      {
        id: "actual-order",
        planId: "real-published",
        name: "Exact prescription",
        dose: "Exact dose",
        instructions: "Full instructions END-INSTRUCTION",
        times: ["08:00", "20:00"],
        startDate: "2026-10-01",
        endDate: null,
        active: true,
      },
    ],
  },
};
for (const locale of ["en", "hy"] as const) {
  const props = {
    care,
    measurements: [],
    preferences: DEFAULT_REMINDERS,
    locale,
    now: "2026-10-15T05:00:00Z",
  };
  const html = renderToStaticMarkup(
    React.createElement(exports.ComingUpNext, props),
  );
  assert.ok(
    html.includes("Exact prescription") &&
      html.includes("Exact dose") &&
      html.includes("END-INSTRUCTION"),
  );
  assert.equal(forwarded?.medication.planId, "real-published");
  assert.equal(forwarded?.dueAt, "2026-10-15T04:00:00.000Z");
  assert.ok(
    html.includes("/patient/measurements/new") &&
      html.includes("/patient/account/reminders"),
  );
  assert.ok(
    html.includes(
      locale === "en" ? "Blood pressure" : "Արյան ճնշում",
    ),
  );
  const empty = renderToStaticMarkup(
    React.createElement(exports.ComingUpNext, { ...props, care: EMPTY_CARE }),
  );
  assert.ok(
    !empty.includes("Exact prescription") &&
      !empty.includes("Mutation boundary"),
  );
  assert.ok(!empty.includes(locale === "en" ? "Next medicine" : "Դեղի հաջորդ ընդունումը"), "No prescription must not create an empty medication task");
  assert.equal((empty.match(/<li\b/g)??[]).length,1,"Without a prescription only the BP task is rendered");
  assert.ok(!empty.includes('href="/patient/care"'),"No prescription must not create an empty medicine action");
  const later=renderToStaticMarkup(React.createElement(exports.ComingUpNext,{...props,care:{...care,plan:{...care.plan!,medications:care.plan!.medications.map(m=>({...m,startDate:'2026-10-20'}))}}}));
  assert.equal((later.match(/<li\b/g)??[]).length,2,"An existing prescription with no immediate dose retains its schedule context");
  assert.ok(later.includes('href="/patient/care"'));
  assert.equal((empty.match(/href="\/patient\/account\/reminders"/g)??[]).length,1,"Settings must have one discoverable control, not duplicate status buttons");
  const bpOnly=renderToStaticMarkup(React.createElement(exports.ComingUpNext,{...props,care:EMPTY_CARE,preferences:{...DEFAULT_REMINDERS,bpEnabled:true,bpTimes:['08:30']}}));
  assert.ok(bpOnly.includes('<time')&&bpOnly.includes('08:30'),'Actual reminder time stays explicit');
  assert.ok(!bpOnly.includes(locale==='en'?'Scheduled time reached':'Նշանակված ժամը հասել է'),'A personal BP reminder must not imply a missed clinical action');
  assert.ok(bpOnly.includes(locale==='en'?'Your reminder time':'Ձեր հիշեցման ժամը'));
  const summary = renderToStaticMarkup(
    React.createElement(exports.HomeHealthAndRhythm, props),
  );
  assert.ok(
    summary.includes(locale === "en" ? "Recorded pulse" : "Գրանցված զարկերակ"),
  );
  assert.ok(
    !summary.includes("Resting heart rate") &&
      !summary.includes("Health score"),
  );
  const demoHistorySummary = renderToStaticMarkup(
    React.createElement(exports.HomeHealthAndRhythm, {
      ...props,
      preferences: { ...DEFAULT_REMINDERS, bpEnabled: true },
      actionMeasurements: [],
      measurements: [
        {
          id: "sample-only",
          submissionId: "sample",
          source: "manual",
          systolic: 120,
          diastolic: 80,
          measuredAt: "2026-10-15T04:00:00Z",
        },
      ],
    }),
  );
  assert.ok(
    !demoHistorySummary.includes(">1/2<"),
    "A separate chart fixture must not complete a real reminder slot",
  );
  assert.ok(
    demoHistorySummary.includes("120/80"),
    "Chart fixture is still visible in the separately supplied chart summary",
  );
  const careHtml = renderToStaticMarkup(
    React.createElement(exports.HomeCareAndTeam, {
      care: { ...care, pendingReview: { openedAt: props.now } },
      locale,
      demo: false,
      now: props.now,
    }),
  );
  assert.ok(careHtml.includes("Actual reviewer"));
  assert.ok(
    careHtml.includes(
      locale === "en"
        ? "Care review in progress"
        : "Խնամքի վերանայումն ընթացքի մեջ է",
    ),
  );
  const withDoctor = renderToStaticMarkup(
    React.createElement(exports.HomeCareAndTeam, { care, locale, now: props.now, doctorShown: true }),
  );
  assert.ok(!withDoctor.includes("Actual reviewer"), "The named-doctor card already shows the doctor; no second reviewer row");
  assert.ok(withDoctor.includes("/patient/reports"), "Report history stays");
  assert.ok(
    !careHtml.includes("Plan active") &&
      !careHtml.includes("care team has been informed"),
  );
}
// DT P389: the Home movement tip follows the exercise gate (the prop is required; suggest is the old behaviour).
const lifestyle = (exercise?: string) => renderToStaticMarkup(React.createElement(exports.HomeLifestyle, { locale: "en", ...(exercise ? { exercise } : {}) }));
assert.match(lifestyle("suggest"), /Movement tip boundary/);
assert.doesNotMatch(lifestyle("suggest"), /Exercise paused boundary/);
assert.match(lifestyle("paused"), /Exercise paused boundary/);
assert.doesNotMatch(lifestyle("paused"), /Movement tip boundary/);
assert.doesNotMatch(lifestyle("withheld"), /Movement tip boundary|Exercise paused boundary/);
console.log(
  "Home component EN/HY render checks passed: actual guarded-dose identity, full prescription instructions, honest empty/pulse states and pending review. Action/chart boundaries mocked; browser exercises actual controls.",
);
