import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as jsx from "react/jsx-runtime";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as common from "@/components/patient-care/common";
import * as dates from "@/lib/patient/date-format";
import * as model from "@/lib/patient-care/model";
import * as provenance from "@/lib/patient/bp-provenance";
import * as icons from "lucide-react";
import type { Measurement } from "@/lib/patient/types";
import type { CareResult } from "@/lib/patient-care/types";

// This verifies the actual component's chart data and render decisions at the
// Recharts boundary. It does not verify browser SVG geometry or visible dots.
type Props = Record<string, unknown> & { children?: React.ReactNode };
const charts: Props[] = [], axes: Props[] = [], areas: Props[] = [], yAxes: Props[] = [];
const keepChildren = (props: Props) => React.createElement(React.Fragment, {}, props.children);
const chartBoundary = {
  ResponsiveContainer: keepChildren,
  AreaChart: (props: Props) => { charts.push(props); return keepChildren(props); },
  XAxis: (props: Props) => { axes.push(props); return null; },
  Area: (props: Props) => { areas.push(props); return null; },
  YAxis: (props: Props) => { yAxes.push(props); return null; }, CartesianGrid: () => null, Tooltip: () => null, Legend: () => null,
};
const exports: Record<string, unknown> = {};
const code = ts.transpileModule(readFileSync("components/patient-care/trends.tsx", "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
new vm.Script(code).runInNewContext({ exports, require: (name: string) => {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return jsx;
  if (name === "recharts") return chartBoundary;
  if (name === "lucide-react") return icons;
  if (name.endsWith("date-format")) return dates;
  if (name.endsWith("/model")) return model;
  if (name === "./common") return common;
  if (name.endsWith("/bp-provenance")) return provenance;
  if (name.endsWith("ui/button")) return { Button: ({ children }: Props) => React.createElement("button", {}, children) };
  throw new Error(name);
}});
const Trends = exports.HealthTrends as typeof import("@/components/patient-care/trends").HealthTrends;
const now = "2026-10-12T10:00:00Z";
const reading: Measurement = { id: "one", submissionId: "one", source: "manual", systolic: 128, diastolic: 80, measuredAt: "2026-10-12T08:00:00Z" };
for (const locale of ["en", "hy"] as const) {
  for (const count of [0, 1, 2]) {
    charts.length = axes.length = areas.length = yAxes.length = 0;
    const measurements = count === 0 ? [] : count === 1 ? [reading] : [reading, { ...reading, id: "two", systolic: 131, measuredAt: "2026-10-12T09:00:00Z" }];
    const html = renderToStaticMarkup(React.createElement(Trends, { measurements, results: [], locale, now, mode: "pressure" }));
    assert.equal(charts.length, count ? 1 : 0, "Empty values do not produce a chart; actual single/multiple values do");
    if (!count) continue;
    const plotted = charts[0].data as { at: number; systolic: number; diastolic: number }[];
    assert.equal(plotted.length, count, "No fabricated observations enter the chart");
    assert.equal(plotted[0].at, Date.parse(reading.measuredAt));
    assert.equal(plotted[0].systolic, 128);
    assert.equal(plotted[0].diastolic, 80);
    if (count === 1) {
      assert.ok(html.includes(locale === "en" ? "One reading. No trend yet." : "Մեկ չափում։ Փոփոխության միտում դեռ չկա։"));
      assert.equal(JSON.stringify(axes[0].ticks), JSON.stringify([Date.parse(reading.measuredAt)]), "Single axis labels only its actual timestamp");
      const domain = axes[0].domain as number[];
      assert.equal((domain[0] + domain[1]) / 2, plotted[0].at);
      assert.ok(areas.every(a => a.stroke === "none" && a.fill === "none"), "Single observations have dots without a trend line or filled area");
      const yDomain = yAxes[0].domain as ((n: number) => number)[];
      assert.ok(yDomain[0](80) < 80 && yDomain[1](128) > 128, "Single points sit inside a padded scale, clear of axes");
    } else {
      assert.ok(areas.every(a => a.stroke !== "none"), "Multiple actual observations retain connecting series");
      const formatter = axes[0].tickFormatter as (n: number) => string;
      assert.notEqual(formatter(plotted[0].at), formatter(plotted[1].at), "Same-day measurements use distinct time labels rather than repeated dates");
      assert.equal(JSON.stringify(axes[0].ticks), JSON.stringify(plotted.map(row => row.at)), "Same-day tick labels use actual timestamps");
    }
  }
  const lab: CareResult = { id: "lab1", testId: null, marker: "Same marker", value: 5, unit: "mmol/L", referenceLow: null, referenceHigh: null, collectedAt: reading.measuredAt, receivedAt: reading.measuredAt, source: "laboratory", sourceLabel: "Actual lab", reviewedAt: null, reviewedBy: null, explanation: null };
  charts.length = 0;
  const labHtml = renderToStaticMarkup(React.createElement(Trends, { measurements: [], results: [lab, { ...lab, id: "lab2", unit: "mg/dL", value: 90 }], locale, now, mode: "labs" }));
  assert.equal(charts.length, 2, "Same markers with different units stay in separate charts");
  assert.ok(labHtml.includes("mmol/L") && labHtml.includes("mg/dL"));
  charts.length = yAxes.length = 0;
  renderToStaticMarkup(React.createElement(Trends, {measurements:[{...reading,pulse:68},{...reading,id:"pulse2",measuredAt:"2026-10-12T09:00:00Z",pulse:76}],results:[],locale,now,mode:"pressure"}));
  const pulseDomain = yAxes[1].domain as number[];
  assert.ok(pulseDomain[1]-pulseDomain[0] >= 40,"Small pulse changes use at least a 40-bpm visual span");
  assert.ok(pulseDomain[0] < 68 && pulseDomain[1] > 76,"Observed pulse values stay inside the display extent");
  assert.equal((charts[1].data as {pulse:number}[])[0].pulse,68,"Visual scaling never changes the recorded value");
  charts.length = yAxes.length = 0;
  renderToStaticMarkup(React.createElement(Trends, {measurements:[{...reading,pulse:20},{...reading,id:"pulse-wide",measuredAt:"2026-10-12T09:00:00Z",pulse:250}],results:[],locale,now,mode:"pressure"}));
  const widePulseDomain = yAxes[1].domain as number[];
  assert.ok(widePulseDomain[0] >= 0 && widePulseDomain[0] <= 20 && widePulseDomain[1] >= 250,"Valid extreme pulse records remain visible without a negative display extent");
}
console.log("Actual EN/HY trends send only recorded empty/single/multi observations, single-point timestamps/dots without lines/fill, and separate lab units to the mocked Recharts boundary. Browser SVG visibility still requires inspection.");
