import {isUnverifiedBp} from '@/lib/patient/bp-provenance';
import { formatMemberDate } from "@/lib/patient/date-format";
import type { Measurement } from "@/lib/patient/types";
import { tx, type PatientLocale } from "@/lib/patient/copy";
export function MeasurementTrend({
  measurements,
  locale,
}: {
  measurements: Measurement[];
  locale: PatientLocale;
}) {
  const points = measurements.filter(m => !isUnverifiedBp(m)).slice(0, 14).reverse();
  if (points.length < 2) return null;
  const min = Math.min(...points.map((p) => p.diastolic)) - 5,
    max = Math.max(...points.map((p) => p.systolic)) + 5;
  const x = (i: number) => 38 + (i / (points.length - 1)) * 264,
    y = (value: number) => 110 - ((value - min) / (max - min)) * 80;
  const line = (key: "systolic" | "diastolic") =>
    points.map((p, i) => `${i ? "L" : "M"}${x(i)},${y(p[key])}`).join(" ");
  // Readings from different years would otherwise read as this year (QA a2-02).
  const year = (s: string) => formatMemberDate(new Date(s), "en", { timeZone: "Asia/Yerevan", year: "numeric" });
  const years = year(points[0].measuredAt) !== year(points.at(-1)!.measuredAt);
  const date = (s: string) =>
    formatMemberDate(new Date(s), locale, {
      timeZone: "Asia/Yerevan",
      month: "short",
      day: "numeric",
      ...(years ? { year: "numeric" } : {}),
    });
  return (
    <section className="max-w-lg space-y-3">
      <h2 className="text-h3">
        {tx(locale, "Ճնշման փոփոխությունը", "Blood pressure over time", "Артериальное давление в динамике")}
      </h2>
      <p className="text-caption text-muted-foreground">
        {tx(
          locale,
          "Ձեր վերջին գրառումները · mmHg",
          "Your latest entries · mmHg", "Ваши последние измерения · mmHg",
        )}
      </p>
      <svg
        className="w-full"
        viewBox="0 0 320 150"
        role="img"
        aria-label={tx(
          locale,
          "Սիստոլիկ և դիաստոլիկ ճնշման գրառումները։ Թվերը նաև չափումների պատմության մեջ են։",
          "Systolic and diastolic readings. Values are also in measurement history.", "Измерения систолического и диастолического давления. Значения также доступны в истории измерений.",
        )}
      >
        <path d="M38 30H302M38 110H302" stroke="var(--border)" />
        <text x="0" y="34" fill="var(--muted-foreground)" fontSize="12">
          {max}
        </text>
        <text x="0" y="114" fill="var(--muted-foreground)" fontSize="12">
          {min}
        </text>
        <path
          d={line("systolic")}
          fill="none"
          stroke="var(--color-brand-teal)"
          strokeWidth="2"
        />
        <path
          d={line("diastolic")}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="2"
          strokeDasharray="4 3"
        />
        <text x="38" y="140" fill="var(--muted-foreground)" fontSize="12">
          {date(points[0].measuredAt)}
        </text>
        <text
          x="302"
          y="140"
          textAnchor="end"
          fill="var(--muted-foreground)"
          fontSize="12"
        >
          {date(points.at(-1)!.measuredAt)}
        </text>
      </svg>
      <p className="text-caption">
        {tx(
          locale,
          "Հոծ գիծ՝ սիստոլիկ։ Կետագիծ՝ դիաստոլիկ։",
          "Solid: systolic. Dashed: diastolic.", "Сплошная линия: систолическое. Пунктирная: диастолическое.",
        )}
      </p>
    </section>
  );
}
