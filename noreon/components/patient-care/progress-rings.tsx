import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { formatMemberDate } from "@/lib/patient/date-format";
import { copy } from "./common";

/**
 * "This week" in the prototype's style (pair 11), with our honesty rules: a reading count
 * has no expected denominator, so it is a number and a day-by-day strip, never a ring.
 * Only medicine has a real denominator (the doses in a published plan), so only it is a
 * ring, and a missing tick is an empty part of it, never counted as taken.
 */
export function ProgressRings({
  locale: l,
  readings,
  days = [],
  taken,
  doses,
  nextDoseAt,
}: {
  locale: PatientLocale;
  readings: number;
  /** The last 7 Yerevan days, oldest first, with how many readings each has. */
  days?: { day: string; count: number }[];
  taken: number;
  doses: number;
  nextDoseAt?: string;
}) {
  const nextTime = nextDoseAt && Number.isFinite(Date.parse(nextDoseAt)) ? formatMemberDate(nextDoseAt, l, {hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Yerevan"}) : null;
  const medicine = doses ? `${taken}/${doses}` : "–";
  return (
    <section className="journey-card" aria-labelledby="this-week-title">
      <header>
        <h2 id="this-week-title">{copy(l, "This week", "Այս շաբաթ", "На этой неделе")}</h2>
        <p className="text-body2 text-muted-foreground">{copy(l, "What you saved in the last 7 days.", "Ինչ եք գրանցել վերջին 7 օրում։", "Что вы записали за последние 7 дней.")}</p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <Link href="/patient/health" className="progress-week-tile">
            <span className="flex items-center gap-3">
              <strong className="min-w-14 text-center font-display text-4xl font-extrabold tabular-nums text-brand-navy">{readings}</strong>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{copy(l, "Readings saved", "Գրանցված չափումներ", "Сохранённые измерения")}</span>
                <span className="mt-0.5 block text-caption text-muted-foreground">{copy(l, "In the last 7 days", "Վերջին 7 օրում", "За последние 7 дней")}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </span>
            {days.length > 0 && (
              <ol className="progress-week-days" aria-label={copy(l, "Readings by day", "Չափումներն ըստ օրերի", "Измерения по дням")}>
                {days.map((d) => {
                  const name = formatMemberDate(`${d.day}T12:00:00+04:00`, l, { weekday: "short", timeZone: "Asia/Yerevan" });
                  return (
                    <li key={d.day} data-measured={d.count > 0 || undefined}>
                      <span aria-hidden className="progress-week-day-dot">{d.count > 0 ? d.count : ""}</span>
                      <span aria-hidden>{name}</span>
                      <span className="sr-only">{name}: {d.count > 0 ? copy(l, `${d.count} ${d.count === 1 ? "reading" : "readings"}`, `${d.count} չափում`, `Измерений: ${d.count}`) : copy(l, "no reading", "չափում չկա", "нет измерений")}</span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Link>
          <p className="text-caption text-muted-foreground">
            {copy(l, "Readings recorded in the last 7 days. A count, not a treatment target.", "Վերջին 7 օրում գրանցված չափումները։ Քանակ է, ոչ բուժման թիրախ։", "Измерения, записанные за последние 7 дней. Это количество, а не цель лечения.")}
          </p>
        </div>
        <div className="min-w-0 space-y-2">
          <Link href="/patient/progress?section=habits" className="progress-week-tile">
            <span className="flex items-center gap-3">
              <svg width="88" height="88" viewBox="0 0 88 88" aria-hidden className="shrink-0">
                <circle cx="44" cy="44" r="36" fill="none" stroke="var(--chart-track)" strokeWidth="9" />
                {doses > 0 && taken > 0 && <circle cx="44" cy="44" r="36" pathLength="100" fill="none" stroke="var(--noreon-teal-600)" strokeWidth="9" strokeDasharray={`${Math.min(100, (taken / doses) * 100)} 100`} strokeLinecap="round" transform="rotate(-90 44 44)" />}
                <text x="44" y="50" textAnchor="middle" fill="var(--text-strong)" fontSize="18" fontWeight="800">{medicine}</text>
              </svg>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{copy(l, "Medicine today", "Այսօրվա դեղերը", "Лекарства сегодня")}</span>
                <span className="mt-0.5 block text-caption text-muted-foreground">{copy(l, "Self-reported doses", "Ձեր նշած ընդունումները", "Приёмы, отмеченные вами")}</span>
                {nextTime && <span className="mt-0.5 block text-caption text-muted-foreground">{copy(l, `Next dose at ${nextTime}`, `Հաջորդ ընդունումը՝ ${nextTime}`, `Следующая доза в ${nextTime}`)}</span>}
                <span className="sr-only">{medicine}</span>
              </span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </span>
          </Link>
          <p className="text-caption text-muted-foreground">
            {copy(l, "Doses you reported taken today. Missing check-ins are not counted as taken.", "Այսօր ընդունված նշված դեղաչափերը։ Բացակայող նշումները ընդունված չեն համարվում։", "Дозы, которые вы отметили как принятые сегодня. Без отметки доза не считается принятой.")}
          </p>
        </div>
      </div>
      <p className="border-t pt-3 text-caption text-muted-foreground">{copy(l,"Walking goals and activity logging are coming soon.","Քայլքի նպատակներն ու գրանցումը՝ շուտով։","Цели по ходьбе и запись активности скоро появятся.")}</p>
    </section>
  );
}
