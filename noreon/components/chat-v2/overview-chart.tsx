"use client";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import type { BpRange, OverviewData } from "@/lib/patient/overview";

const CONFIG: ChartConfig = { morning: { color: "var(--cv2-blue)" }, evening: { color: "var(--cv2-avatar)" } };
const LINES = [
  { key: "morningSystolic", stroke: "var(--cv2-blue)" },
  { key: "morningDiastolic", stroke: "var(--cv2-blue)" },
  { key: "eveningSystolic", stroke: "var(--cv2-avatar)", dash: "5 4" },
  { key: "eveningDiastolic", stroke: "var(--cv2-avatar)", dash: "5 4" },
] as const;

function summary(range: BpRange, days: 7 | 14, l: PatientLocale) {
  const part = (name: string, s: BpRange["morning"]) => s.latest
    ? tx(l, `${name}՝ ${s.count} ստուգված չափում, վերջինը ${s.latest.systolic}/${s.latest.diastolic}։`, `${name}: ${s.count} verified readings, latest ${s.latest.systolic}/${s.latest.diastolic}.`, `${name}: проверенных измерений ${s.count}, последнее ${s.latest.systolic}/${s.latest.diastolic}.`)
    : tx(l, `${name}՝ ստուգված չափումներ չկան։`, `${name}: no verified readings.`, `${name}: проверенных измерений нет.`);
  return `${tx(l, `Վերջին ${days} օրը։`, `Last ${days} days.`, `Последние ${days} дней.`)} ${part(tx(l, "Առավոտ", "Morning", "Утро"), range.morning)} ${part(tx(l, "Երեկո", "Evening", "Вечер"), range.evening)}`;
}

/** Draws the server's points. The text below says the same for anyone who can't see the chart. */
export function OverviewBpChart({ locale: l, ranges }: { locale: PatientLocale; ranges: OverviewData["bp"]["ranges"] }) {
  const [days, setDays] = useState<7 | 14>(7);
  const range = ranges[days];
  const text = summary(range, days, l);
  return <div className="cv2-ov-chart-box">
    <div className="cv2-ov-range" role="group" aria-label={tx(l, "Ժամանակահատված", "Period", "Период")}>
      {([7, 14] as const).map(option => <button type="button" key={option} aria-pressed={days === option} onClick={() => setDays(option)}>{tx(l, `${option} օր`, `${option} days`, `${option} дней`)}</button>)}
    </div>
    <div role="img" aria-label={text}>
      <ChartContainer config={CONFIG} className="cv2-ov-chart">
        <LineChart data={range.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--cv2-hair)" />
          <XAxis dataKey="day" tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} tick={{ fontSize: 11, fill: "var(--cv2-muted)" }} />
          <YAxis domain={["dataMin - 10", "dataMax + 10"]} width={30} tickLine={false} axisLine={false} allowDecimals={false} tick={{ fontSize: 11, fill: "var(--cv2-muted)" }} />
          {LINES.map(line => <Line key={line.key} dataKey={line.key} stroke={line.stroke} strokeDasharray={"dash" in line ? line.dash : undefined} strokeWidth={2} dot={{ r: 2.5, fill: line.stroke, strokeWidth: 0 }} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ChartContainer>
    </div>
    <ul className="cv2-ov-legend" aria-hidden>
      <li data-series="morning"><i />{tx(l, "Առավոտ", "Morning", "Утро")}</li>
      <li data-series="evening"><i />{tx(l, "Երեկո", "Evening", "Вечер")}</li>
    </ul>
    <p className="cv2-ov-note" data-chart-summary>{text}</p>
  </div>;
}
