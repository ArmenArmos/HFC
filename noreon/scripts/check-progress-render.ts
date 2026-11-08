import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import { patientPresentation } from "@/lib/patient/presentation";
const source = readFileSync(
  process.env.NOREON_PROGRESS_TEST_SOURCE ?? "components/patient-care/member-progress-content.tsx",
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    jsx: ts.JsxEmit.ReactJSX,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
let historyReads = 0;
let assessment = {
  answers: {},
  urgentRule: null as string | null,
  completedAt: null as string | null,
};
const exports: Record<string, unknown> = {};
const require = (name: string) => {
  if (name === "react/jsx-runtime") return jsx;
  if (name.endsWith("/member-screens-config")) return { memberScreensPrototypeEnabled: () => false };
  if (name.endsWith("/presentation")) return { patientPresentation };
  // Programme rhythm ships dark: off means the existing journey view stays.
  if (name.endsWith("/programme/member")) return { memberProgramme: async () => null };
  if (name.endsWith("/lab-stage-repository")) return { getMemberLabStages: async () => null };
  if (name.endsWith("/real-booking/repository")) return { getMemberBookingData: async () => null };
  if (name.endsWith("/repository"))
    return {
      carePageData: async () => ({
        profile: { locale: "en" },
        assessment,
        care: { events: [] },
        measurements: [],
        chartMeasurements: [],
        reminders: { preferences: {} },
        demo: false,
      }),
    };
  if (name.endsWith("/overview"))
    return { measurementOverview: () => ({ count: 0 }) };
  if (name.endsWith("/journey-evidence"))
    return { medicineReportDays: () => [] };
  if (name.endsWith("/model")) return { dosesForDay: () => [] };
  if (name.endsWith("/reminders")) return { dailyReminders: () => [] };
  if (name.endsWith("/member-history/server"))
    return {
      readOwnHistory: async () => {
        historyReads++;
        return { values: [], documents: [], clinic: { bp: [], observations: [] } };
      },
    };
  if (name.endsWith("/ldl/member")) return { memberLdl: async () => undefined };
  if (name.endsWith("/member-history/measures"))
    return { chartSeries: () => ({ bp: [] }) };
  if (name.endsWith("/common"))
    return {
      CareLink: "CareLink",
      CareSection: "CareSection",
      copy: (_l: string, en: string) => en,
    };
  return new Proxy({}, { get: (_target, key) => String(key) });
};
new vm.Script(code).runInNewContext({ exports, require });
const page = exports.default as (props: {
  searchParams: Promise<{ section: string }>;
}) => Promise<unknown>;
function types(value: unknown): string[] {
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap(types);
  const e = value as { type?: unknown; props?: { children?: unknown } };
  return [
    typeof e.type === "string" ? e.type : "",
    ...types(e.props?.children),
  ];
}
for (const engineRed of [false, true])
  for (const section of ["overview", "habits"]) {
    assessment = {
      answers: engineRed
        ? {
            "q9.right_now": {
              fieldId: "q9.right_now",
              value: "yes",
              source: "manual",
              answeredAt: "2026-10-12T00:00:00Z",
            },
          }
        : {},
      urgentRule: engineRed ? null : "RF-01",
      completedAt: "2026-10-12",
    };
    const tree = await page({ searchParams: Promise.resolve({ section }) });
    assert.ok(!types(tree).includes("DailyRoutine"));
    assert.ok(!types(tree).includes("ProgressRings"));
    assert.ok(!types(tree).includes("MedicineCalendar"));
    assert.ok(!types(tree).includes("FutureHabits"));
    assert.ok(!types(tree).includes("HabitsProgress"));
    assert.ok(!types(tree).includes("JourneyTimeline"));
    assert.match(JSON.stringify(tree), /Open urgent guidance/);
  }
assessment = { answers: {}, urgentRule: null, completedAt: null };
assert.ok(
  !types(
    await page({ searchParams: Promise.resolve({ section: "habits" }) }),
  ).includes("HabitsProgress"),
);
assessment.completedAt = "2026-10-12";
const eligibleHabits = types(await page({ searchParams: Promise.resolve({ section: "habits" }) }));
assert.equal(eligibleHabits.filter(type => type === "HabitsProgress").length, 1, "The actual Habits page uses one integrated weekly evidence and check-in view");
assert.ok(!eligibleHabits.includes("MedicineCalendar") && !eligibleHabits.includes("DailyRoutine"), "The obsolete duplicate calendars and routine panels are absent");
assert.equal(historyReads, 0, "Urgent and habits views never read member-reported history");
const overviewTree = await page({ searchParams: Promise.resolve({ section: "overview" }) });
const overview = types(overviewTree);
assert.equal(historyReads, 1, "Overview reads member-reported history once");
assert.match(JSON.stringify(overviewTree), /Your numbers over time[\s\S]*No numbers yet[\s\S]*Add earlier results/, "Overview shows the empty chart state and the way to add earlier results");
assert.ok(overview.includes("ProgressRings") && overview.includes("JourneyTimeline"), "Overview retains both evidence rings and the journey timeline");
assert.ok(overview.indexOf("ProgressRings") < overview.indexOf("JourneyTimeline"), "Overview preserves rings followed by the journey timeline");
assert.ok(!overview.includes("DailyRoutine"));
assert.ok(!overview.includes("HabitsProgress"));
assert.ok(
  types(
    await page({ searchParams: Promise.resolve({ section: "habits" }) }),
  ).includes("HabitsProgress"),
);
console.log(
  "Actual Progress page: urgent overview/habits withhold routine and summary; incomplete habits withhold routine; eligible habits render.",
);
