"use client";
import {isUnverifiedBp,bpObservationCounts} from '@/lib/patient/bp-provenance';
import { formatMemberDate } from "@/lib/patient/date-format";
import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import type { YAxisProps } from "recharts";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { Measurement } from "@/lib/patient/types";
import type { CareResult } from "@/lib/patient-care/types";
import type { PatientLocale } from "@/lib/patient/copy";
import { armeniaDate, resultGroups } from "@/lib/patient-care/model";
import { copy, stamp } from "./common";
const armeniaHour = (iso: string) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Yerevan", hour: "2-digit", hourCycle: "h23" }).format(new Date(iso)));
import { Button } from "@/components/ui/button";
type ChartRow = { at: number; [key: string]: number | null };
export function HealthTrends({
  measurements,
  results,
  locale: l,
  now,
  compact = false,
  mode = "all",
  showRange = false,
}: {
  measurements: Measurement[];
  results: CareResult[];
  locale: PatientLocale;
  now: string;
  compact?: boolean;
  showRange?: boolean;
  mode?: "all" | "pressure" | "labs";
}) {
  const [range, setRange] = useState(
    mode === "pressure" ? "14" : showRange ? "7" : "90",
  );
  // Time of day (prototype "Morning / Evening", report P1): a display filter on Armenia
  // time only. Readings before noon are "morning"; from noon on, "afternoon and evening".
  const [daypart, setDaypart] = useState<"all" | "morning" | "later">("all");
  const start =
    range === "all"
      ? 0
      : Date.parse(`${armeniaDate(new Date(now))}T00:00:00+04:00`) -
        (Number(range) - 1) * 86400000;
  const periodMeasurements = measurements
    .filter(
      (m) =>
        Date.parse(m.measuredAt) >= start &&
        Date.parse(m.measuredAt) <= Date.parse(now) &&
        (daypart === "all" || (armeniaHour(m.measuredAt) < 12) === (daypart === "morning")),
    );
  const rows = periodMeasurements.filter(m => !isUnverifiedBp(m))
    .sort((a, b) => Date.parse(a.measuredAt) - Date.parse(b.measuredAt))
    .map((m) => ({
      at: Date.parse(m.measuredAt),
      systolic: m.systolic,
      diastolic: m.diastolic,
      pulse: m.pulse ?? null,
    }));
  const groups = resultGroups(
    results.filter((r) => Date.parse(r.collectedAt) >= start),
  );
  const pressureControls = mode === "pressure" && (
    <div className="flex w-full flex-col gap-2">
      <div className="journey-seg" role="group" aria-label={copy(l, "Chart date range", "Գրաֆիկի ժամանակահատված", "Период графика")}>
        {[["14", "2 weeks", "2 շաբաթ", "2 недели"], ["all", "Since start", "Սկզբից", "С начала"]].map(([value, en, hy, ru]) => (
          <button key={value} type="button" aria-pressed={range === value} onClick={() => setRange(value)}>{copy(l, en, hy, ru)}</button>
        ))}
      </div>
      <div className="journey-seg" role="group" aria-label={copy(l, "Time of day", "Օրվա ժամը", "Время суток")}>
        {([["all", "All", "Բոլորը", "Все"], ["morning", "Morning", "Առավոտ", "Утро"], ["later", "Afternoon, evening", "Կեսօրից հետո", "День, вечер"]] as const).map(([value, en, hy, ru]) => (
          <button key={value} type="button" aria-pressed={daypart === value} onClick={() => setDaypart(value)}>{copy(l, en, hy, ru)}</button>
        ))}
      </div>
      {daypart !== "all" && (
        <p className="text-caption text-muted-foreground">
          {daypart === "morning"
            ? copy(l, "Readings taken before 12:00, Armenia time.", "Մինչև 12:00-ն արված չափումները, Հայաստանի ժամանակով։", "Измерения до 12:00 по времени Армении.")
            : copy(l, "Readings taken from 12:00 on, Armenia time.", "12:00-ից հետո արված չափումները, Հայաստանի ժամանակով։", "Измерения с 12:00 по времени Армении.")}
        </p>
      )}
    </div>
  );
  const rangeControls = mode !== "pressure" && (!compact || showRange) && (
        <div
          className="flex flex-wrap gap-2"
          role="group"
          aria-label={copy(l, "Chart date range", "Գրաֆիկի ժամանակահատված", "Период графика")}
        >
          {[
                ["7", "7 days", "7 օր", "7 дней"],
                ["30", "30 days", "30 օր", "30 дней"],
                ["90", "90 days", "90 օր", "90 дней"],
                ["all", "All history", "Ամբողջը", "Вся история"],
              ].map(([value, en, hy, ru]) => (
            <Button
              key={value}
              variant={range === value ? "default" : "outline"}
              aria-pressed={range === value}
              className="min-h-11"
              onClick={() => setRange(value)}
            >
              {copy(l, en, hy, ru)}
            </Button>
          ))}
        </div>
      );
  return (
    <div className="space-y-6">
      {mode !== "pressure" && rangeControls}
      {mode !== "labs" && <p className="text-caption text-muted-foreground">{bpObservationCounts(periodMeasurements,l)}</p>}
      {mode !== "labs" && (
        <Chart
          title={copy(l, "Blood pressure", "Արյան ճնշում", "Артериальное давление")}
          unit="mmHg"
          rows={rows}
          series={[
            ["systolic", copy(l, "Systolic", "Սիստոլիկ", "Систолическое")],
            ["diastolic", copy(l, "Diastolic", "Դիաստոլիկ", "Диастолическое")],
          ]}
          locale={l}
          compact={compact}
          headerControls={pressureControls || undefined}
          summaryShown={mode === "pressure"}
        />
      )}
      {!compact && (
        <>
          {mode !== "labs" && (
            <Chart
              title={copy(l, "Pulse", "Զարկերակ", "Пульс")}
              unit="bpm"
              rows={rows.filter((r) => r.pulse !== null)}
              series={[["pulse", copy(l, "Pulse", "Զարկերակ", "Пульс")]]}
              locale={l}
              minimumYSpan={40}
              headerControls={mode === "pressure" && daypart !== "all" ? (
                <p className="w-full text-caption text-muted-foreground">
                  {daypart === "morning"
                    ? copy(l, "Morning readings only, as chosen above.", "Միայն առավոտյան չափումները, ինչպես ընտրված է վերևում։", "Только утренние измерения, как выбрано выше.")
                    : copy(l, "Afternoon and evening readings only, as chosen above.", "Միայն կեսօրից հետո արված չափումները, ինչպես ընտրված է վերևում։", "Только дневные и вечерние измерения, как выбрано выше.")}
                </p>
              ) : undefined}
            />
          )}
          {mode !== "pressure" && (
            <div>
              <h2 className="mb-4 text-h2">
                {copy(
                  l,
                  "Your laboratory trends",
                  "Լաբորատոր ցուցանիշների փոփոխությունը",
                  "Динамика ваших лабораторных показателей",
                )}
              </h2>
              {groups.length ? (
                <div className="grid gap-5 lg:grid-cols-2">
                  {groups.map((group) => (
                    <Chart
                      key={`${group[0].marker}-${group[0].unit}`}
                      title={group[0].marker}
                      unit={group[0].unit}
                      rows={group.map((r) => ({
                        at: Date.parse(r.collectedAt),
                        value: r.value,
                      }))}
                      series={[["value", group[0].marker]]}
                      locale={l}
                    />
                  ))}
                </div>
              ) : (
                <p className="rounded-xl border p-6 text-body2 text-muted-foreground">
                  {copy(
                    l,
                    "No laboratory results in this period. Received results will appear here with their source and date.",
                    "Այս ժամանակահատվածում լաբորատոր արդյունքներ չկան։ Ստացված արդյունքները կհայտնվեն աղբյուրով և ամսաթվով։",
                    "За этот период результатов анализов нет. Полученные результаты появятся здесь с источником и датой.",
                  )}
                </p>
              )}
            </div>
          )}
          {mode !== "pressure" && <p className="text-caption text-muted-foreground">
            {copy(
              l,
              "Charts show recorded values, not a diagnosis. Lines connect available records; gaps do not represent measurements. Different units are kept in separate charts.",
              "Գրաֆիկները ցույց են տալիս գրանցված արժեքները, ոչ թե ախտորոշում։ Գծերը միացնում են առկա գրառումները․ բաց հատվածները չափումներ չեն։ Տարբեր միավորները ցուցադրվում են առանձին։",
              "Графики показывают записанные значения, а не диагноз. Линии соединяют имеющиеся записи, промежутки не означают измерений. Разные единицы показаны на отдельных графиках.",
            )}
          </p>}
        </>
      )}
    </div>
  );
}
function Chart({
  title,
  unit,
  rows,
  series,
  locale: l,
  compact = false,
  headerControls,
  summaryShown = false,
  minimumYSpan = 0,
}: {
  title: string;
  headerControls?: ReactNode;
  summaryShown?: boolean;
  minimumYSpan?: number;
  unit: string;
  rows: ChartRow[];
  series: [string, string][];
  locale: PatientLocale;
  compact?: boolean;
}) {
  const latest = rows.at(-1),
    first = rows[0];
  const shortDate = (n: number) =>
    formatMemberDate(new Date(n), l, {
      timeZone: "Asia/Yerevan",
      month: "short",
      day: "numeric",
    });
  const colors = ["var(--chart-1)", "var(--chart-2)"];
  const singleReading = rows.length === 1;
  const observed = rows.flatMap(row => series.map(([key]) => row[key])).filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  // A minimum visual span avoids magnifying tiny pulse changes. It is centred
  // on the recorded values, not a clinical reference range or treatment goal.
  const observedMin = observed.length ? Math.min(...observed) : 0;
  const observedMax = observed.length ? Math.max(...observed) : 0;
  const visualSpan = Math.max(minimumYSpan, (observedMax - observedMin) * 1.2);
  const midpoint = (observedMin + observedMax) / 2;
  const displayLower = Math.min(observedMin, Math.max(0, Math.floor(midpoint - visualSpan / 2)));
  const displayUpper = Math.max(Math.ceil(midpoint + visualSpan / 2), displayLower + minimumYSpan);
  // Whole-number readings (blood pressure, pulse) get whole-number axis ticks.
  const wholeNumbers = observed.length > 0 && observed.every(Number.isInteger);
  const edge = (n: number, round: (n: number) => number) => wholeNumbers ? round(n) : n;
  const yDomain: YAxisProps["domain"] = minimumYSpan > 0
    ? [displayLower, displayUpper]
    : singleReading ? [(min: number) => edge(min - Math.max(Math.abs(min) * 0.05, 1), Math.floor), (max: number) => edge(max + Math.max(Math.abs(max) * 0.05, 1), Math.ceil)] : ["auto", "auto"];
  const sameDay = first && latest && armeniaDate(new Date(first.at)) === armeniaDate(new Date(latest.at));
  const tickDates = [...new Set(rows.map(row => row.at))];
  const timeTicks = tickDates.length <= 5 ? tickDates : Array.from({ length: 5 }, (_, i) => tickDates[Math.round(i * (tickDates.length - 1) / 4)]);
  const axisLabel = (at: number) => sameDay && !singleReading
    ? formatMemberDate(new Date(at), l, { timeZone: "Asia/Yerevan", hour: "2-digit", minute: "2-digit", hour12: false })
    : shortDate(at);
  return (
    <section
      className={`min-w-0 space-y-4 rounded-2xl border bg-card ${compact ? "p-5" : "p-5 sm:p-7"}`}
      aria-label={title}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-h3">{title}</h3>
          <p className={summaryShown ? "sr-only" : "mt-1 text-caption text-muted-foreground"}>
            {unit} · {copy(l, "Armenia time", "Հայաստանի ժամանակ", "Время Армении")}
          </p>
        </div>
        {headerControls}
        {latest && !summaryShown && (
          <p className="text-h2 tabular-nums">
            {series.map(([key]) => latest[key] ?? "—").join(" / ")}
            <span className="ml-2 text-caption font-normal text-muted-foreground">
              {unit}
            </span>
          </p>
        )}
      </div>
      {singleReading && <p className="text-caption text-muted-foreground">{copy(l, "One reading. No trend yet.", "Մեկ չափում։ Փոփոխության միտում դեռ չկա։", "Одно измерение. Динамики пока нет.")}</p>}
      {rows.length > 0 ? (
        <div className={minimumYSpan > 0 ? "h-40 w-full" : compact ? "h-48 w-full" : "h-64 w-full"}>
          {/* A fixed first-render size stops Recharts warning about a -1 width before layout. */}
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 160 }}>
            <AreaChart
              data={rows}
              margin={{ top: 8, right: 12, bottom: 4, left: -14 }}
              accessibilityLayer
            >
              <CartesianGrid
                stroke="var(--border)"
                vertical={false}
                strokeDasharray="3 4"
              />
              <XAxis
                type="number"
                dataKey="at"
                // A tiny layout window centers the actual timestamp. Only the
                // recorded timestamp is labelled; no neighbouring observations
                // or elapsed-day trend are manufactured for a single reading.
                domain={singleReading ? [rows[0].at - 1, rows[0].at + 1] : ["dataMin", "dataMax"]}
                ticks={singleReading ? [rows[0].at] : sameDay ? timeTicks : undefined}
                tickFormatter={axisLabel}
                tick={{ fontSize: 14, fill: "var(--muted-foreground)" }}
                minTickGap={35}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                domain={yDomain}
                allowDecimals={!wholeNumbers}
                tick={{ fontSize: 14, fill: "var(--muted-foreground)" }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                labelFormatter={(n) =>
                  stamp(new Date(Number(n)).toISOString(), l)
                }
                contentStyle={{
                  background: "var(--card)",
                  borderColor: "var(--border)",
                  borderRadius: "var(--radius-lg)",
                  color: "var(--foreground)",
                }}
              />
              <Legend itemSorter={null} wrapperStyle={{ fontSize: 14, paddingTop: 10 }} />
              {series.map(([key, label], i) => (
                <Area
                  key={key}
                  type="linear"
                  dataKey={key}
                  name={label}
                  stroke={singleReading ? "none" : colors[i % 2]}
                  fill={singleReading ? "none" : colors[i % 2]}
                  fillOpacity={!singleReading && i === 0 ? 0.07 : 0}
                  strokeWidth={2.5}
                  strokeDasharray={i ? "5 4" : undefined}
                  dot={{ r: singleReading ? 4 : 3, strokeWidth: 2, stroke: colors[i % 2], fill: "var(--card)" }}
                  activeDot={{ r: 5 }}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="py-6 text-body2 text-muted-foreground">
          {copy(
                l,
                "No recorded values in this period yet.",
                "Այս ժամանակահատվածում դեռ գրանցված արժեքներ չկան։",
                "За этот период записанных значений пока нет.",
              )}
        </p>
      )}
      {latest && !summaryShown && (
        <p className="text-caption text-muted-foreground">
          {copy(l, "Latest record", "Վերջին գրառումը", "Последняя запись")}:{" "}
          {stamp(new Date(latest.at).toISOString(), l)}
        </p>
      )}
      {summaryShown && <p className="text-caption text-muted-foreground">{copy(l,"Recorded values, not a diagnosis.","Գրանցված արժեքներ են, ոչ թե ախտորոշում։", "Записанные значения, а не диагноз.")}</p>}
      {rows.length > 0 && (
        <details className="group">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-caption font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span>{copy(l, "Recorded values", "Գրանցված արժեքներ", "Записанные значения")} ({rows.length})</span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <div className="mt-3 max-h-64 overflow-auto">
            {summaryShown && <p className="mb-3 text-caption text-muted-foreground">{copy(l, "Recorded values in mmHg, Armenia time. Lines connect available records; gaps are not measurements. Your doctor sets your treatment goals.", "Գրանցված արժեքները՝ mmHg-ով, Հայաստանի ժամանակով։ Գծերը միացնում են առկա գրառումները․ բաց հատվածները չափումներ չեն։ Բուժման նպատակները սահմանում է ձեր բժիշկը։", "Записанные значения в mmHg, время Армении. Линии соединяют имеющиеся записи, промежутки не означают измерений. Цели лечения определяет ваш врач.")}</p>}
            <table className="w-full text-left text-caption">
              <caption className="sr-only">
                {title} · {unit}
              </caption>
              <thead>
                <tr>
                  <th className="p-2">{copy(l, "Date", "Ամսաթիվ", "Дата")}</th>
                  {series.map(([key, label]) => (
                    <th className="p-2" key={key}>
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row, i) => (
                  <tr key={`${row.at}-${i}`} className="border-t">
                    <td className="p-2">
                      {stamp(new Date(row.at).toISOString(), l)}
                    </td>
                    {series.map(([key]) => (
                      <td className="p-2 tabular-nums" key={key}>
                        {row[key] ?? copy(l, "Not recorded", "Գրանցված չէ", "Не записано")}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {first && latest && rows.length > 1 && (
        <span className="sr-only">
          {shortDate(first.at)} – {shortDate(latest.at)}
        </span>
      )}
    </section>
  );
}
