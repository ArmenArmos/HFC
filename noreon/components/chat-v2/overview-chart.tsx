"use client";
import { useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
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

/** WP T, DRAFT wording: the physician-set home target in plain words. The numbers come from the server; nothing is compared here. */
const targetText = (goal: string, l: PatientLocale) => tx(l, `Ձեր թիրախը՝ ${goal}-ից ցածր, նշված է կետագծերով։`, `Your target, below ${goal}, is shown as dashed lines.`, `Ваша цель, ниже ${goal}, показана пунктирными линиями.`);
const targetExplain = (goal: string, l: PatientLocale) => tx(l,
  `Ձեր բժիշկը ձեզ համար սահմանել է տնային ճնշման թիրախ՝ ${goal}-ից ցածր։ Վերին թիվը լավ է, երբ առաջին կետագծից ցածր է, ստորինը՝ երկրորդից։`,
  `Your doctor set a home blood pressure target for you: below ${goal}. Your upper number is on target when it stays under the first dashed line, and your lower number when it stays under the second.`,
  `Ваш врач поставил вам цель для домашнего давления: ниже ${goal}. Верхнее число в пределах цели, когда оно ниже первой пунктирной линии, нижнее, когда ниже второй.`);

/** Draws the server's points. The text below says the same for anyone who can't see the chart. */
export function OverviewBpChart({ locale: l, ranges, target = null }: { locale: PatientLocale; ranges: OverviewData["bp"]["ranges"]; target?: OverviewData["bp"]["target"] }) {
  const [days, setDays] = useState<7 | 14>(7);
  const range = ranges[days];
  const goal = target ? `${target.systolic}/${target.diastolic}` : null;
  const text = `${summary(range, days, l)}${goal ? ` ${targetText(goal, l)}` : ""}`;
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
          {target && <ReferenceLine y={target.systolic} stroke="var(--cv2-muted)" strokeDasharray="6 4" ifOverflow="extendDomain" />}
          {target && <ReferenceLine y={target.diastolic} stroke="var(--cv2-muted)" strokeDasharray="2 4" ifOverflow="extendDomain" />}
          {LINES.map(line => <Line key={line.key} dataKey={line.key} stroke={line.stroke} strokeDasharray={"dash" in line ? line.dash : undefined} strokeWidth={2} dot={{ r: 2.5, fill: line.stroke, strokeWidth: 0 }} connectNulls isAnimationActive={false} />)}
        </LineChart>
      </ChartContainer>
    </div>
    <ul className="cv2-ov-legend" aria-hidden>
      <li data-series="morning"><i />{tx(l, "Առավոտ", "Morning", "Утро")}</li>
      <li data-series="evening"><i />{tx(l, "Երեկո", "Evening", "Вечер")}</li>
      {goal && <li data-series="target"><i />{tx(l, "Ձեր թիրախը", "Your target", "Ваша цель")}</li>}
    </ul>
    {goal && <p className="cv2-ov-note" data-target-explain>{targetExplain(goal, l)}</p>}
    <p className="cv2-ov-note" data-chart-summary>{text}</p>
  </div>;
}
