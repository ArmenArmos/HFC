"use client";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { copy } from "@/components/patient-care/common";
import type { PatientLocale } from "@/lib/patient/copy";
import { formatMemberDate } from "@/lib/patient/date-format";
import { axisDateLabel, chartTimeDomain } from "@/lib/member-history/axis-date";
import { measureIds, measures, type ChartPoint, type MeasureId } from "@/lib/member-history/measures";

const measureNamesRu: Record<MeasureId, string> = {
  bp: "Артериальное давление",
  total_cholesterol: "Общий холестерин",
  ldl_c: "Холестерин ЛПНП (LDL)",
  hba1c: "Гликированный гемоглобин (HbA1c)",
  fasting_glucose: "Глюкоза натощак",
  weight: "Вес",
  waist: "Окружность талии",
};

/** Display only: no thresholds, ranges or judgements are drawn. Source is shown by line and
 * marker shape (solid and filled for the clinic, dashed and hollow for the member), so it never
 * depends on colour alone. */
const sourceLabel = (s: ChartPoint["source"], l: PatientLocale) => (s === "clinic" ? copy(l, "Measured at the clinic", "Չափված կլինիկայում", "Измерено в клинике") : s === "checked" ? copy(l, "From your file, checked by your doctor", "Ձեր ֆայլից, ստուգել է ձեր բժիշկը", "Из вашего файла, проверено вашим врачом") : copy(l, "From you, not verified", "Ձեզնից, չստուգված", "Добавлено вами, не проверено"));
/** Line pattern per source: solid for the clinic, dotted for checked files, dashed for the member. */
const dash = (s: ChartPoint["source"]) => (s === "member" ? "5 4" : s === "checked" ? "1.5 3" : undefined);
const day = (at: number, l: PatientLocale) => formatMemberDate(new Date(at), l, { timeZone: "Asia/Yerevan", dateStyle: "medium" });

function SourceKey({ source }: { source: ChartPoint["source"] }) {
  return (
    <svg width="28" height="12" viewBox="0 0 28 12" aria-hidden className="shrink-0">
      <path d="M1 6H27" stroke="var(--foreground)" strokeWidth="2" strokeDasharray={dash(source)} />
      {source === "checked" ? <rect x="10" y="2" width="8" height="8" fill="var(--foreground)" /> : <circle cx="14" cy="6" r="4" fill={source === "clinic" ? "var(--foreground)" : "var(--card)"} stroke="var(--foreground)" strokeWidth="2" />}
    </svg>
  );
}
/** Upper readings are circles and lower readings diamonds, so the two read apart without colour (a11y audit B4-6);
 *  squares stay for values from a checked file. */
function ColorKey({ color, diamond = false }: { color: string; diamond?: boolean }) {
  return <span aria-hidden className={`inline-block size-3 shrink-0${diamond ? " rotate-45 scale-75" : " rounded-full"}`} style={{ background: color }} />;
}

/** Rounded ticks that always include every point, at most six of them. */
function yTicks(points: ChartPoint[], bp: boolean) {
  const values = points.flatMap((p) => (bp && p.value2 !== undefined ? [p.value, p.value2] : [p.value]));
  const min = Math.min(...values), max = Math.max(...values);
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  const step = steps.find((s) => Math.ceil(max / s) - Math.floor(min / s) <= 5) ?? 100;
  let lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  if (lo === hi) { lo -= step; hi += step; }
  const ticks: number[] = [];
  for (let i = 0; lo + i * step <= hi + step / 2; i++) ticks.push(Math.round((lo + i * step) * 10) / 10);
  return { ticks, domain: [ticks[0], ticks.at(-1)!] as [number, number] };
}

function MeasureChart({ id, points, locale: l }: { id: MeasureId; points: ChartPoint[]; locale: PatientLocale }) {
  const m = measures[id];
  const bp = id === "bp";
  const lines = (["clinic", "checked", "member"] as const).flatMap((source) => {
    const data = points.filter((p) => p.source === source);
    if (!data.length) return [];
    const keys = bp ? ([["value", "var(--chart-1)", copy(l, "Upper", "Վերին", "Верхнее")], ["value2", "var(--chart-2)", copy(l, "Lower", "Ստորին", "Нижнее")]] as const) : ([["value", "var(--chart-1)", copy(l, m.en, m.hy, measureNamesRu[id])]] as const);
    return keys.map(([key, color, label]) => ({ key: `${source}-${key}`, source, data, dataKey: key, color, name: `${label} · ${sourceLabel(source, l)}` }));
  });
  const sources = [...new Set(points.map((p) => p.source))];
  const latest = points.at(-1)!;
  const y = yTicks(points, bp);
  const first = points[0].at, last = latest.at;
  const xDomain = chartTimeDomain(first, last);
  const xTicks = [0, 1, 2, 3].map((i) => Math.round(xDomain[0] + ((xDomain[1] - xDomain[0]) * i) / 3));
  return (
    <article className="min-w-0 space-y-3 rounded-2xl border bg-card p-5 sm:p-6" aria-labelledby={`chart-${id}`}>
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id={`chart-${id}`} className="text-h3">{copy(l, m.en, m.hy, measureNamesRu[id])}</h3>
        <p className="text-caption text-muted-foreground">
          {points.length} {copy(l, points.length === 1 ? "value" : "values", "արժեք", "знач.")} · {m.chartUnit}
        </p>
      </header>
      <div className="h-52" role="img" aria-label={copy(l, `${m.en} over time. The values are also in the table below.`, `${m.hy}՝ ըստ ժամանակի։ Արժեքները նաև ստորև աղյուսակում են։`, `${measureNamesRu[id]}: изменение со временем. Значения также есть в таблице ниже.`)}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 10, right: 28, left: -12, bottom: 4 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" strokeDasharray="3 4" />
            <XAxis dataKey="at" type="number" scale="time" domain={xDomain} ticks={xTicks} interval={0} tickFormatter={(v) => axisDateLabel(Number(v), xTicks, l)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} stroke="var(--border)" />
            <YAxis domain={y.domain} ticks={y.ticks} interval={0} width={52} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} stroke="var(--border)" />
            <Tooltip
              labelFormatter={(v) => day(Number(v), l)}
              formatter={(value, name) => [`${value} ${m.chartUnit}`, name]}
              contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: "var(--radius-lg)", color: "var(--foreground)" }}
            />
            {lines.map((line) => (
              <Line
                key={line.key}
                data={line.data}
                dataKey={line.dataKey}
                name={line.name}
                type="linear"
                stroke={line.color}
                strokeWidth={2}
                strokeDasharray={dash(line.source)}
                dot={line.source === "checked"
                  ? ({ cx, cy, index }) => <rect key={index} x={(cx ?? 0) - 5} y={(cy ?? 0) - 5} width={10} height={10} fill={line.color} />
                  : line.dataKey === "value2"
                    ? ({ cx, cy, index }: { cx?: number; cy?: number; index?: number }) => cx == null || cy == null ? <g key={index} /> : <polygon key={index} points={`${cx},${cy - 6} ${cx + 6},${cy} ${cx},${cy + 6} ${cx - 6},${cy}`} strokeWidth={2} stroke={line.color} fill={line.source === "clinic" ? line.color : "var(--card)"} />
                    : { r: 5, strokeWidth: 2, stroke: line.color, fill: line.source === "clinic" ? line.color : "var(--card)" }}
                activeDot={{ r: 7 }}
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex flex-wrap gap-x-5 gap-y-2 text-caption" aria-label={copy(l, "Legend", "Պայմանական նշաններ", "Условные обозначения")}>
        {sources.map((s) => (
          <li key={s} className="flex items-center gap-2"><SourceKey source={s} />{sourceLabel(s, l)}</li>
        ))}
        {bp && (
          <>
            <li className="flex items-center gap-2"><ColorKey color="var(--chart-1)" />{copy(l, "Upper (systolic)", "Վերին (սիստոլիկ)", "Верхнее (систолическое)")}</li>
            <li className="flex items-center gap-2"><ColorKey color="var(--chart-2)" diamond />{copy(l, "Lower (diastolic)", "Ստորին (դիաստոլիկ)", "Нижнее (диастолическое)")}</li>
          </>
        )}
      </ul>
      <details className="text-body2">
        <summary className="min-h-11 cursor-pointer py-2">{copy(l, "Show as a table", "Ցույց տալ աղյուսակով", "Показать в таблице")}</summary>
        <table className="mt-2 w-full text-left text-caption">
          <thead><tr><th className="py-1 pr-3 font-medium">{copy(l, "Date", "Ամսաթիվ", "Дата")}</th><th className="py-1 pr-3 font-medium">{copy(l, "Value", "Արժեք", "Значение")}</th><th className="py-1 font-medium">{copy(l, "Source", "Աղբյուր", "Источник")}</th></tr></thead>
          <tbody>
            {[...points].reverse().map((p, i) => (
              <tr key={i} className="border-t"><td className="py-1 pr-3">{day(p.at, l)}</td><td className="py-1 pr-3 tabular-nums">{bp ? `${p.value}/${p.value2}` : p.value} {m.chartUnit}</td><td className="py-1">{sourceLabel(p.source, l)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </article>
  );
}

export function ProgressCharts({ series, locale: l }: { series: Record<MeasureId, ChartPoint[]>; locale: PatientLocale }) {
  const shown = measureIds.filter((id) => series[id].length);
  if (!shown.length) return null;
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {shown.map((id) => <MeasureChart key={id} id={id} points={series[id]} locale={l} />)}
    </div>
  );
}
