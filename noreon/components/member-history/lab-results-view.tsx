"use client";
import { ArrowDown, ArrowRight, ArrowUp, CheckCircle2, CircleDashed, Stethoscope, TriangleAlert } from "lucide-react";
import { CartesianGrid, Line, LineChart, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge } from "@/components/ui/badge";
import type { PatientLocale } from "@/lib/patient/copy";
import { clinicalLocale } from "@/lib/locale";
import { formatMemberDate } from "@/lib/patient/date-format";
import { axisDateLabel } from "@/lib/member-history/axis-date";
import { analyteDisplayName } from "@/lib/lab-ai/analyte-names";
import { analytes, changeText, formatResult, type Analyte, type AnalytePoint, type MemberResults, type RangeStatus } from "@/lib/member-history/lab-results";
import { resultsCopy } from "@/lib/member-history/lab-results-copy";

/**
 * The member's results from their own files, after their doctor checked them (Armen, 20 Oct 2026): what the
 * doctor says, a summary bar, and one card per analyte with value, unit, date and range status (colour and
 * words, never colour alone), where the value sits in the printed range, the change since the date before,
 * and a chart once there are two dates. Display only.
 */
const tone: Record<RangeStatus, "success" | "attention" | "danger" | "muted"> = { in: "success", borderline: "attention", out: "danger", none: "muted" };
const fill: Record<RangeStatus, string> = { in: "var(--marker-optimal-fg)", borderline: "var(--marker-attention-fg)", out: "var(--marker-out-fg)", none: "var(--muted-foreground)" };
const StatusIcon = ({ s }: { s: RangeStatus }) => s === "in" ? <CheckCircle2 aria-hidden className="size-3.5" /> : s === "none" ? <CircleDashed aria-hidden className="size-3.5" /> : <TriangleAlert aria-hidden className="size-3.5" />;
const day = (iso: string | null, l: PatientLocale) => (iso ? formatMemberDate(new Date(`${iso.slice(0, 10)}T12:00:00Z`), l, { timeZone: "UTC", dateStyle: "medium" }) : null);
const num = formatResult;
/** Axis ticks are computed positions, not results: three significant digits. */
const tick = (x: number) => new Intl.NumberFormat("en-GB", { maximumSignificantDigits: 3 }).format(x);
const rangeText = (p: AnalytePoint) => p.refText ?? (p.refLow !== null && p.refHigh !== null ? `${num(p.refLow)}–${num(p.refHigh)}` : p.refHigh !== null ? `< ${num(p.refHigh)}` : p.refLow !== null ? `> ${num(p.refLow)}` : null);

export function LabResultsView({ data, locale: l }: { data: MemberResults; locale: PatientLocale }) {
  const t = resultsCopy(l);
  const shown = data.documents.filter((d) => d.state !== "waiting");
  if (!shown.length) return null;
  const list = analytes(data.values);
  const counts = (["in", "borderline", "out"] as const).map((s) => [s, list.filter((a) => a.latest.status === s).length] as const).filter(([, n]) => n > 0);
  const ranged = counts.reduce((n, [, c]) => n + c, 0);
  return (
    <section id="lab-results" aria-labelledby="lab-results-title" className="scroll-mt-24 space-y-4">
      <header className="space-y-1">
        <h2 id="lab-results-title" className="text-h2">{t.title}</h2>
        <p className="text-body2 text-muted-foreground">{data.approvalRequired ? t.intro : t.introNotChecked}</p>
      </header>
      {shown.filter((d) => d.interpretation).map((d) => (
        <article key={d.documentId} className="space-y-2 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" aria-labelledby={`says-${d.documentId}`}>
          <h3 id={`says-${d.documentId}`} className="flex items-start gap-2 text-h3"><Stethoscope aria-hidden className="mt-1 size-5 shrink-0" />{t.doctorSays}</h3>
          <p className="whitespace-pre-line text-body1">{clinicalLocale(l) === "hy" ? d.interpretation!.hy : d.interpretation!.en}</p>
          <p className="text-caption text-muted-foreground">{t.checkedBy(d.doctorName, day(d.approvedAt, l) ?? "")}</p>
          <p className="break-all text-caption text-muted-foreground">{t.fromFile(d.fileName)}</p>
        </article>
      ))}
      {ranged > 0 && (
        <div className="space-y-2 rounded-2xl border border-border/70 bg-card p-4">
          <div className="flex h-3 w-full overflow-hidden rounded-full" aria-hidden>
            {counts.map(([s, n]) => <span key={s} style={{ width: `${(n / ranged) * 100}%`, background: fill[s] }} />)}
          </div>
          <ul className="flex flex-wrap gap-2">
            {counts.map(([s, n]) => <li key={s}><Badge variant={tone[s]} className="gap-1"><StatusIcon s={s} />{t.range[s]}: {n}</Badge></li>)}
          </ul>
        </div>
      )}
      <ul className="grid gap-4 sm:grid-cols-2">
        {list.map((a) => <li key={a.key} className="min-w-0"><AnalyteCard a={a} locale={l} /></li>)}
      </ul>
    </section>
  );
}

/** Where the value sits against the printed range: a track, the range band, and a marker. Text says the same. */
function RangeBar({ p }: { p: AnalytePoint }) {
  if (p.value === null || (p.refLow === null && p.refHigh === null)) return null;
  const lo = p.refLow ?? 0, hi = p.refHigh ?? lo * 2;
  if (!(hi > lo)) return null;
  const pad = (hi - lo) * 0.5;
  const min = Math.min(lo - pad, p.value), max = Math.max(hi + pad, p.value);
  const x = (v: number) => ((v - min) / (max - min)) * 100;
  return (
    <svg viewBox="0 0 100 14" preserveAspectRatio="none" className="h-3.5 w-full" aria-hidden>
      <rect x="0" y="5" width="100" height="4" rx="2" fill="var(--chart-track)" />
      <rect x={x(lo)} y="5" width={Math.max(x(hi) - x(lo), 1)} height="4" fill="var(--marker-optimal-bg)" stroke="var(--marker-optimal-fg)" strokeWidth="0.4" />
      <rect x={Math.min(Math.max(x(p.value) - 1, 0), 98)} y="1" width="2" height="12" rx="1" fill={fill[p.status]} />
    </svg>
  );
}

function AnalyteCard({ a, locale: l }: { a: Analyte; locale: PatientLocale }) {
  const t = resultsCopy(l);
  const p = a.latest;
  const name = analyteDisplayName(a.testName, clinicalLocale(l), a.catalogueRef);
  const range = rangeText(p);
  const Arrow = a.change?.direction === "up" ? ArrowUp : a.change?.direction === "down" ? ArrowDown : ArrowRight;
  return (
    <article className="h-full min-w-0 space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-sm" aria-labelledby={`analyte-${a.key}`}>
      <header className="flex flex-wrap items-start justify-between gap-2">
        <h3 id={`analyte-${a.key}`} className="min-w-0 break-words text-body1 font-semibold">{name}</h3>
        <Badge variant={tone[p.status]} className="gap-1"><StatusIcon s={p.status} />{t.range[p.status]}</Badge>
      </header>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-h2 tabular-nums">{p.value === null ? p.valueText : num(p.value)}</span>
        {p.unit && <span className="text-body2 text-muted-foreground">{p.unit}</span>}
      </p>
      <RangeBar p={p} />
      <dl className="grid gap-1 text-caption text-muted-foreground">
        {range && <div><dt className="inline">{t.labRange}: </dt><dd className="inline tabular-nums">{range}</dd></div>}
        <div><dt className="inline">{t.date}: </dt><dd className="inline">{day(p.date, l) ?? t.noDate}</dd></div>
      </dl>
      {a.change && (
        <p className="flex flex-wrap items-center gap-x-2 text-body2">
          <Arrow aria-hidden className="size-4 shrink-0" />
          <span className="font-medium">{t.direction[a.change.direction]}</span>
          {a.change.direction !== "same" && <span className="tabular-nums">{changeText(a.change)}</span>}
          <span className="text-caption text-muted-foreground">{t.since(day(a.change.from.date, l) ?? "")}</span>
        </p>
      )}
      {a.series.length >= 2 && <TrendChart a={a} name={name} locale={l} />}
      {(p.doctorEdited || !p.checked) && <p className="text-caption text-muted-foreground">{p.doctorEdited ? t.editedByDoctor : t.notChecked}</p>}
      {a.points.length >= 2 && (
        <details className="text-caption">
          <summary className="min-h-11 cursor-pointer py-2">{t.earlier}</summary>
          <table className="w-full text-left">
            <thead><tr><th className="py-1 pr-3 font-medium">{t.date}</th><th className="py-1 pr-3 font-medium">{a.unit ?? ""}</th><th className="py-1 font-medium"><span className="sr-only">{t.labRange}</span></th></tr></thead>
            <tbody>{[...a.points].reverse().map((x) => (
              <tr key={x.valueId} className="border-t"><td className="py-1 pr-3">{day(x.date, l) ?? t.noDate}</td><td className="py-1 pr-3 tabular-nums">{x.value === null ? x.valueText : num(x.value)}{x.unit && x.unit !== a.unit ? ` ${x.unit}` : ""}</td><td className="py-1">{t.range[x.status]}</td></tr>
            ))}</tbody>
          </table>
        </details>
      )}
    </article>
  );
}

function TrendChart({ a, name, locale: l }: { a: Analyte; name: string; locale: PatientLocale }) {
  const t = resultsCopy(l);
  const data = a.series.map((p) => ({ at: p.at!, value: p.value!, status: p.status }));
  const lo = a.latest.refLow, hi = a.latest.refHigh;
  const values = [...data.map((d) => d.value), ...(lo !== null ? [lo] : []), ...(hi !== null ? [hi] : [])];
  const span = Math.max(...values) - Math.min(...values) || Math.abs(values[0]!) || 1;
  // Never below zero when every number is zero or more (a lab range that starts at 0).
  const domain: [number, number] = [Math.min(...values) >= 0 ? Math.max(0, Math.min(...values) - span * 0.15) : Math.min(...values) - span * 0.15, Math.max(...values) + span * 0.15];
  const first = data[0]!.at, last = data.at(-1)!.at;
  const xTicks = first === last ? [first] : [first, last];
  return (
    <figure className="space-y-1">
      <div className="h-36" role="img" aria-label={t.chart(name)}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: -16, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--chart-grid)" strokeDasharray="3 4" />
            {(lo !== null || hi !== null) && <ReferenceArea y1={lo ?? domain[0]} y2={hi ?? domain[1]} fill="var(--marker-optimal-bg)" fillOpacity={1} stroke="none" ifOverflow="hidden" />}
            <XAxis dataKey="at" type="number" scale="time" domain={[first, last]} ticks={xTicks} interval={0} tickFormatter={(v) => axisDateLabel(Number(v), xTicks, l)} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} stroke="var(--border)" padding={{ left: 16, right: 16 }} />
            <YAxis domain={domain} tickCount={4} width={48} tickFormatter={(v) => tick(Number(v))} tick={{ fill: "var(--muted-foreground)", fontSize: 12 }} stroke="var(--border)" />
            <Tooltip labelFormatter={(v) => day(new Date(Number(v)).toISOString(), l)} formatter={(v) => [`${num(Number(v))} ${a.unit ?? ""}`, name]}
              contentStyle={{ background: "var(--card)", borderColor: "var(--border)", borderRadius: "var(--radius-lg)", color: "var(--foreground)" }} />
            <Line dataKey="value" type="linear" stroke="var(--chart-1)" strokeWidth={2} isAnimationActive={false}
              dot={({ cx, cy, payload, index }) => <circle key={index} cx={cx} cy={cy} r={5} fill={fill[(payload as { status: RangeStatus }).status]} stroke="var(--card)" strokeWidth={2} />} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {(lo !== null || hi !== null) && <figcaption className="text-caption text-muted-foreground">{t.band}</figcaption>}
    </figure>
  );
}
