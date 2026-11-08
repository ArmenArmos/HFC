"use client";
import { formatMemberDate } from "@/lib/patient/date-format";
import { useState } from "react";
import type { ReactNode } from "react";
import type { PatientLocale } from "@/lib/patient/copy";
import type { medicineReportDays } from "@/lib/patient-care/journey-evidence";
import { CareSection, copy } from "./common";
type Day = ReturnType<typeof medicineReportDays>[number];
function CalendarSection({ title, children, compact }: { title: string; children: ReactNode; compact: boolean }) {
  return compact ? <section className="journey-card space-y-3"><h2 className="text-body1 font-semibold">{title}</h2>{children}</section> : <CareSection title={title}>{children}</CareSection>;
}
export function MedicineCalendar({
  days,
  locale: l,
  compact = false,
}: {
  days: Day[];
  locale: PatientLocale;
  compact?: boolean;
}) {
  const [selected, setSelected] = useState(days.at(-1)?.day);
  const active = days.find((d) => d.day === selected) ?? days.at(-1);
  const daySummary = (d: Day) => d.taken || d.skipped
    ? `${d.taken} ${copy(l, "reported taken", "նշված է ընդունված", "отмечено как принято")}, ${d.skipped} ${copy(l, "reported skipped", "նշված է բաց թողնված", "отмечено как пропущено")}`
    : d.schedule === "not-scheduled" ? copy(l, "No medicine doses scheduled for this day.", "Այս օրվա համար դեղի ընդունումներ նախատեսված չեն։", "На этот день приём лекарств не запланирован.")
    : d.schedule !== "scheduled" ? copy(l, "Medicine schedule not available for this day.", "Այս օրվա դեղերի ժամանակացույցը հասանելի չէ։", "Расписание приёма лекарств на этот день недоступно.")
    : copy(l, "No dose reports available for this scheduled day.", "Այս նախատեսված օրվա ընդունումների նշումներ չկան։", "На этот день приём запланирован, но отметок о нём нет.");
  const label = (d: Day) => `${d.day}: ${daySummary(d)}`;
  const symbol = (d: Day) => d.taken && d.skipped ? "✓!" : d.skipped ? "!" : d.taken ? "✓" : d.schedule === "not-scheduled" ? "–" : d.schedule === "scheduled" ? "○" : "?";
  const total = days.reduce(
    (a, d) => ({ taken: a.taken + d.taken, skipped: a.skipped + d.skipped }),
    { taken: 0, skipped: 0 },
  );
  const firstWeekday = days[0] ? (new Date(`${days[0].day}T12:00:00+04:00`).getUTCDay() + 6) % 7 : 0;
  if (!total.taken && !total.skipped && !days.some(d => d.schedule === "scheduled")) return <CalendarSection compact={compact} title={copy(l, "Medicine calendar", "Դեղերի օրացույց", "Календарь приёма лекарств")}><p className="text-body2 text-muted-foreground">{days.some(d => d.schedule !== "not-scheduled") ? copy(l, "Medicine schedule dates are not available yet.", "Դեղերի ժամանակացույցի ամսաթվերը դեռ հասանելի չեն։", "Даты приёма лекарств пока недоступны.") : copy(l, "No medicine doses are scheduled in this period.", "Այս ժամանակահատվածում դեղի ընդունումներ նախատեսված չեն։", "В этот период приём лекарств не запланирован.")}</p></CalendarSection>;
  return (
    <>
      <CalendarSection compact={compact} title={copy(l, "Your medicine week", "Դեղերի այս շաբաթը", "Ваш приём лекарств за неделю")}>
        <div className="flex justify-between gap-2">
          {days.slice(-7).map((d) => (
            <div
              key={d.day}
              className="flex flex-col items-center gap-2 text-caption"
            >
              {compact && formatMemberDate(new Date(d.day + "T12:00:00+04:00"), l, { weekday: "narrow", timeZone: "Asia/Yerevan" })}
              <span
                title={label(d)}
                className={`flex size-8 items-center justify-center rounded-full border ${d.skipped ? "bg-muted" : d.taken ? "bg-brand-teal text-on-inverse" : "bg-card"}`}
              >
                {symbol(d)}
              </span>
              {!compact && formatMemberDate(new Date(d.day + "T12:00:00+04:00"), l, {
                weekday: "narrow",
                timeZone: "Asia/Yerevan",
              })}
              {compact && <span>{Number(d.day.slice(-2))}</span>}
            </div>
          ))}
        </div>
      </CalendarSection>
      <CalendarSection compact={compact} title={copy(l, "Medicine calendar · 4 weeks", "Դեղերի օրացույց · 4 շաբաթ", "Календарь приёма лекарств · 4 недели")}>
        <p className="text-caption">
          {total.taken} {copy(l, "reported taken", "նշված է ընդունված", "отмечено как принято")} ·{" "}
          {total.skipped} {copy(l, "reported skipped", "նշված է բաց թողնված", "отмечено как пропущено")}
          {compact && <> · {days.filter(d => d.schedule === "scheduled" && !d.taken && !d.skipped).length} {copy(l, "scheduled days with no report", "նախատեսված օր առանց նշման", "дней с запланированным приёмом без отметок")}</>}
        </p>
        <div className="grid grid-cols-7 gap-1">
          {compact && Array.from({ length: 7 }, (_, i) => <span key={`weekday-${i}`} className="text-center text-caption text-muted-foreground">{formatMemberDate(new Date(Date.UTC(2026, 9, 12 + i, 8)), l, { weekday: "narrow", timeZone: "Asia/Yerevan" })}</span>)}
          {compact && Array.from({ length: firstWeekday }, (_, i) => <span key={`blank-${i}`} aria-hidden />)}
          {days.map((d) => (
            <button
              key={d.day}
              onClick={() => setSelected(d.day)}
              aria-pressed={selected === d.day}
              aria-label={label(d)}
              className={`flex min-h-11 flex-col items-center justify-center rounded-lg border text-caption ${selected === d.day ? "outline-2 outline-brand-navy outline-offset-1" : ""} ${d.skipped ? "bg-muted" : d.taken ? "bg-brand-teal text-on-inverse" : "border-dashed bg-card"}`}
            >
              <small>{Number(d.day.slice(-2))}</small>
              <strong>{symbol(d)}</strong>
            </button>
          ))}
        </div>
        {active && (
          <div
            aria-live="polite"
            className="rounded-xl bg-muted p-3 text-body2"
          >
            <strong>{active.day}</strong>
            <p>
              {daySummary(active)}
            </p>
          </div>
        )}
        <p className="text-caption text-muted-foreground">
          {copy(l, "Self-reported · ✓ taken · ! skipped · ✓! mixed · ○ no report · – not scheduled · ? schedule unknown", "Ձեր նշումները · ✓ ընդունված · ! բաց թողնված · ✓! խառը · ○ նշում չկա · – նախատեսված չէ · ? ժամանակացույցն անհայտ է", "Ваши отметки · галочка: принято · восклицательный знак: пропущено · оба знака: принято и пропущено · кружок: нет отметок · черта: не запланировано · знак вопроса: расписание неизвестно")}
        </p>
        <details className="text-caption">
          <summary className="cursor-pointer font-semibold">{copy(l, "How to read your calendar", "Ինչպես կարդալ օրացույցը", "Как читать ваш календарь")}</summary>
          <p className="mt-2 text-muted-foreground">{copy(l, "These are your dose reports, not proof of intake. A tick means at least one dose was reported taken, not every scheduled dose. A mixed day has both taken and skipped reports. A circle means a scheduled day has no dose report; it does not mean you skipped a dose. A dash means no dose was scheduled. A question mark means the schedule is unavailable. Select a day to see its reports.", "Սրանք ձեր ընդունման նշումներն են, ոչ ընդունման ապացույց։ Նշանը նշանակում է առնվազն մեկ ընդունման նշում, ոչ բոլոր նախատեսված դեղաչափերի ընդունում։ Խառը օրը ունի և՛ ընդունված, և՛ բաց թողնված նշումներ։ Շրջանը նշանակում է՝ նախատեսված օրվա ընդունման նշում չկա․ դա չի նշանակում, որ ընդունումը բաց եք թողել։ Գծիկը նշանակում է՝ ընդունում նախատեսված չէ։ Հարցականը նշանակում է՝ ժամանակացույցը հասանելի չէ։ Ընտրեք օրը՝ նշումները տեսնելու համար։", "Это ваши отметки о приёме, они не подтверждают сам приём. Галочка означает, что вы отметили приём хотя бы одной дозы, а не всех запланированных доз. В день со смешанными отметками есть и принятые, и пропущенные дозы. Кружок означает, что на день запланирован приём, но отметок нет; это не значит, что вы пропустили дозу. Дефис означает, что приём не запланирован. Знак вопроса означает, что расписание недоступно. Выберите день, чтобы увидеть отметки.")}</p>
        </details>
      </CalendarSection>
    </>
  );
}
