"use client";
import { FILE_LINK } from "@/lib/patient/file-link";
import { pick, type Locale } from "@/lib/locale";
import { formatMemberDate } from "@/lib/patient/date-format";
import { useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { useDemoReports } from "@/components/service-workflow/reports-provider";
import { historicalPoints, type HistoryPoint } from "@/lib/reports/history";
import {SelectField} from '@/components/ui/select-field';
export function HistoricalCharts({
  doctor = false,
  locale = "en",
}: {
  doctor?: boolean;
  locale?: Locale;
}) {
  const memory = useDemoReports();
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  const records = doctor
    ? memory.reports.filter((r) => r.state === "confirmed")
    : Object.values(memory.published?.reports ?? {}).map((a) => a.report);
  const { points, skipped, unplotted, duplicates } = historicalPoints(records);
  const groups = new Map<string, HistoryPoint[]>();
  for (const p of points) {
    const k = `${p.marker} · ${p.unit}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }
  if (!memory.shared && !doctor) return null;
  return (
    <section className="space-y-5" id="report-history" aria-label={t("Historical report charts", "Պատմական հետազոտությունների գրաֆիկներ", "Графики предыдущих результатов")}>
      <header>
        <h2 className="text-h2">
          {t(
            "Your report history, over time",
            "Ձեր հետազոտությունների պատմությունը", "История ваших результатов"
          )}
        </h2>
        <p className="mt-2 text-body2 text-muted-foreground">
          {doctor
            ? t("Checked extractions for your review. These charts are not published until you approve the complete plan. Confirm the test identity and specimen before comparing.", "Checked extractions for your review. These charts are not published until you approve the complete plan. Confirm the test identity and specimen before comparing.", "Проверенные извлечённые данные для вашей проверки. Графики не публикуются, пока вы не утвердите весь план лечения. Перед сравнением уточните исследование и образец.")
            : t(
                "Doctor-published results from your uploaded reports. Dates are the report dates, not upload dates.",
                "Բժշկի հրապարակած արդյունքները ձեր փաստաթղթերից։ Ամսաթվերը հետազոտության ամսաթվերն են։", "Результаты из загруженных вами отчётов, опубликованные врачом. Указаны даты исследований, а не загрузки."
              )}
        </p>
      </header>
      {memory.persistenceError ? (
        <p role="alert">{memory.persistenceError}</p>
      ) : !memory.loaded ? (
        <p role="status">
          {t("Loading report history…", "Բեռնվում է պատմությունը…", "Загружаем историю отчётов…")}
        </p>
      ) : !points.length ? (
        <p className="rounded-xl border p-5 text-body2">
          {t(
            "No comparable numerical report results yet. Charts appear after dates, values and units are checked and the plan is published.",
            "Համեմատելի թվային արդյունքներ դեռ չկան։ Գրաֆիկները կհայտնվեն տվյալների ստուգումից և պլանի հրապարակումից հետո։", "Сопоставимых числовых результатов пока нет. Графики появятся после проверки дат, значений и единиц измерения и публикации плана лечения."
          )}
        </p>
      ) : (
        <div className="grid gap-5 lg:grid-cols-2">
          {[...groups].map(([key, rows]) => (
            <HistoryChart
              key={key}
              rows={rows}
              urls={memory.originalUrls}
              locale={locale}
            />
          ))}
        </div>
      )}
      {!!skipped && (
        <details className="rounded-md border p-3 text-body2">
          <summary className="cursor-pointer">{t(`${skipped} results are available in reports only. See why.`, `${skipped} արդյունք հասանելի է միայն փաստաթղթերում։ Տեսնել պատճառը։`, `${skipped} результатов доступны только в отчётах. Узнать причину.`)}</summary>
          <p className="mt-3 text-muted-foreground">{t("These results are kept in your reports. They do not prevent plan approval.", "Այս արդյունքները պահպանվում են փաստաթղթերում և չեն խանգարում պլանի հաստատմանը։", "Эти результаты сохраняются в ваших отчётах. Они не препятствуют утверждению плана лечения.")}</p>
          <ul className="mt-3 space-y-2">{unplotted.map((item, index) => <li key={index}><span className="font-medium">{item.test ?? item.file}</span>: {item.reason}<span className="block text-caption text-muted-foreground">{item.file}{item.row ? ` · ${t("row", "տող", "строка")} ${item.row}` : ''}</span></li>)}</ul>
        </details>
      )}
      {!!duplicates && (
        <p className="text-caption text-muted-foreground">
          {t(
            `${duplicates} matching entries share a plotted point. All source references are retained below.`,
            `${duplicates} համընկնող գրառում ցուցադրվում է մեկ կետով։ Բոլոր աղբյուրները պահպանված են։`, `${duplicates} совпадающих записей объединены в одну точку на графике. Все ссылки на источники сохранены ниже.`
          )}
        </p>
      )}
      <p className="text-caption text-muted-foreground">
        {t(
          "Different units stay separate. Laboratory methods and reference ranges may differ. Lines connect available records only; they do not show measurements between tests.",
          "Տարբեր միավորները ցուցադրվում են առանձին։ Լաբորատոր մեթոդներն ու միջակայքերը կարող են տարբեր լինել։ Գծերը միացնում են միայն առկա գրառումները։", "Разные единицы измерения показаны отдельно. Лабораторные методы и референсные интервалы могут различаться. Линии соединяют только имеющиеся записи и не показывают измерения между исследованиями."
        )}
      </p>
    </section>
  );
}
function HistoryChart({
  rows,
  urls,
  locale,
}: {
  rows: HistoryPoint[];
  urls: Record<string, string>;
  locale: Locale;
}) {
  const [selected, setSelected] = useState(rows.at(-1)!.id);
  const p = rows.find((r) => r.id === selected) ?? rows.at(-1)!;
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  const date = (s: string) =>
    formatMemberDate(new Date(s + "T12:00:00Z"), locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    });
  const domain = p.range
    ? [
        Math.min(p.range[0], p.value) -
          Math.max((p.range[1] - p.range[0]) * 0.25, 0.01),
        Math.max(p.range[1], p.value) +
          Math.max((p.range[1] - p.range[0]) * 0.25, 0.01),
      ]
    : null;
  const position = (n: number) =>
    domain ? (100 * (n - domain[0])) / (domain[1] - domain[0]) : 0;
  return (
    <article className="min-w-0 rounded-2xl border bg-card p-5 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-h3">{p.marker}</h3>
          <p className="mt-1 text-caption text-muted-foreground">
            {rows.length} {t(rows.length === 1 ? "recorded value" : "recorded values", "գրառում", "записей")} · {p.unit}
          </p>
        </div>
        <p className="text-h2 tabular-nums">
          {p.value}
          <span className="ml-2 text-caption font-normal">{p.unit}</span>
        </p>
      </div>
      {rows.length > 1 ? (
        <div className="mt-5 h-52">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={rows.map((r) => ({
                ...r,
                at: Date.parse(r.date + "T12:00:00Z"),
              }))}
              margin={{ top: 15, right: 16, left: -15, bottom: 5 }}
              accessibilityLayer
            >
              <CartesianGrid
                vertical={false}
                stroke="var(--border)"
                strokeDasharray="3 4"
              />
              <XAxis
                dataKey="at"
                type="number"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) =>
                  formatMemberDate(new Date(v), locale, {
                    month: "short",
                    year: "2-digit",
                    timeZone: "UTC",
                  })
                }
                minTickGap={35}
              />
              <YAxis domain={["auto", "auto"]} width={55} />
              <Tooltip
                labelFormatter={(v) =>
                  date(new Date(Number(v)).toISOString().slice(0, 10))
                }
                contentStyle={{
                  background: "var(--card)",
                  borderColor: "var(--border)",
                  borderRadius: "var(--radius-lg)",
                }}
              />
              <Line
                dataKey="value"
                name={p.marker}
                type="linear"
                stroke="var(--chart-1)"
                strokeWidth={3}
                dot={{ r: 5 }}
                activeDot={{ r: 7 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <p className="mt-5 text-body2">
          {t("Your first recorded value. Another comparable result will show change over time.", "Առաջին գրանցված արժեքը։ Հաջորդ համեմատելի արդյունքից հետո կհայտնվի փոփոխությունը։", "Ваше первое записанное значение. Следующий сопоставимый результат покажет динамику.")}
        </p>
      )}
      <div className="mt-5 rounded-lg bg-muted p-4">
        <label className="text-caption">
          {t("Inspect a result", "Ընտրել արդյունքը", "Выбрать результат")}
          <SelectField
            className="mt-2"
            value={p.id}
            onValueChange={setSelected}
            searchPlaceholder={t("Search", "Որոնել", "Поиск")}
            emptyText={t("No matches", "Համընկնումներ չկան", "Совпадений нет")}
            options={rows.map((r) => ({ value: r.id, label: `${date(r.date)} · ${r.value} ${r.unit}` }))}
          />
        </label>
        {p.range && domain ? (
          <div
            className="my-5"
            aria-label={t(`Printed reference ${p.range[0]} to ${p.range[1]}; recorded value ${p.value}`, `Տպված միջակայք՝ ${p.range[0]} մինչև ${p.range[1]}․ գրանցված արժեք՝ ${p.value}`, `Указанный референсный интервал от ${p.range[0]} до ${p.range[1]}; записанное значение ${p.value}`)}
          >
            <div className="relative h-3 rounded-full bg-border">
              <div
                className="absolute h-3 rounded-full bg-brand-teal/40"
                style={{
                  left: `${position(p.range[0])}%`,
                  width: `${position(p.range[1]) - position(p.range[0])}%`,
                }}
              />
              <span
                className="absolute -top-1 h-5 w-1 rounded-full bg-primary"
                style={{ left: `${position(p.value)}%` }}
              />
            </div>
            <p className="mt-3 text-caption">
              {t("Printed reference", "Տպված միջակայքը", "Указанный референсный интервал")}: {p.range[0]}{locale === "ru" ? " - " : "–"}
              {p.range[1]} {p.unit}
            </p>
          </div>
        ) : (
          <p className="mt-3 text-caption">
            {t("Printed reference", "Տպված հղումը", "Указанный референсный интервал")}:{" "}
            {p.reference ?? (t("Not supplied", "Չի տրամադրվել", "Не указан"))}.{" "}
            {t("No simple interval is inferred.", "Միջակայքի գրաֆիկ չի ենթադրվում։", "Простой интервал не определяется.")}
          </p>
        )}
        <ul className="mt-3 space-y-2">
          {p.sources.map((s, i) => (
            <li
              key={`${s.id}:${s.row}:${i}`}
              className="break-words text-caption"
            >
              {s.laboratory ??
                (t("Laboratory not specified", "Լաբորատորիան նշված չէ", "Лаборатория не указана"))}{" "}
              · {s.file} · {t("row", "տող", "строка")} {s.row}
              {urls[s.id] && (
                <a
                  className="mt-1 flex min-h-11 items-center underline"
                  href={urls[s.id]}
                  {...FILE_LINK}
                >
                  {t("Open original report", "Բացել սկզբնաղբյուրը", "Открыть оригинал отчёта")}
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </article>
  );
}
