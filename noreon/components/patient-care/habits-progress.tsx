"use client";

import { useState } from "react";
import { Pill, ChevronDown, Activity } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import type { medicineReportDays } from "@/lib/patient-care/journey-evidence";
import type { ReminderOccurrence } from "@/lib/patient-care/reminders";
import { formatMemberDate } from "@/lib/patient/date-format";
import { CareLink, copy } from "./common";
import { DailyRoutine } from "./daily-routine";

type Day = ReturnType<typeof medicineReportDays>[number];
const dayDate = (day: Day) => new Date(`${day.day}T12:00:00+04:00`);
function evidence(day: Day, l: PatientLocale) {
  if (day.taken || day.skipped) return `${day.taken} ${copy(l, "reported taken", "նշված է ընդունված", "отмечено как принято")}, ${day.skipped} ${copy(l, "reported skipped", "նշված է բաց թողնված", "отмечено как пропущено")}`;
  return day.schedule === "scheduled" ? copy(l, "No reports", "Նշումներ չկան", "Отметок нет") : day.schedule === "not-scheduled" ? copy(l, "No doses scheduled", "Ընդունում նախատեսված չէ", "Приём не запланирован") : copy(l, "Schedule unavailable", "Ժամանակացույցը հասանելի չէ", "Расписание недоступно");
}

type Week = {days: Day[]; taken:number; skipped:number};
function weekEvidence(week: Week, l: PatientLocale) {
  if (week.taken || week.skipped || week.days.some(day => day.schedule === "scheduled")) return `${week.taken} ${copy(l, "reported taken", "նշված է ընդունված", "отмечено как принято")}, ${week.skipped} ${copy(l, "reported skipped", "նշված է բաց թողնված", "отмечено как пропущено")}`;
  return week.days.some(day => day.schedule === "unknown") ? copy(l, "Schedule unavailable", "Ժամանակացույցը հասանելի չէ", "Расписание недоступно") : copy(l, "No doses scheduled", "Ընդունում նախատեսված չէ", "Приём не запланирован");
}
function weekCount(week: Week, l: PatientLocale) {
  if (week.taken || week.skipped || week.days.some(day => day.schedule === "scheduled")) return String(week.taken + week.skipped);
  return week.days.some(day => day.schedule === "unknown") ? copy(l, "Unavailable", "Անհասանելի", "Недоступно") : copy(l, "No schedule", "Չի նախատեսված", "Нет расписания");
}

/** Evidence stays independent of reminder timing and of permission to report a dose. */
export function HabitsProgress({ days, occurrences, locale: l, hasPlan }: {
  days: Day[];
  occurrences: ReminderOccurrence[];
  locale: PatientLocale;
  /** A published care plan exists; without one nothing points to it (Gohar D-003). */
  hasPlan: boolean;
}) {
  // Align chunks to the most recent day even if a caller has fewer than 28 days.
  const recent = days.slice(-28);
  const weeks: Week[] = [];
  for (let end = recent.length; end > 0; end -= 7) {
    const weekDays = recent.slice(Math.max(0, end - 7), end);
    const counts = weekDays.reduce((a, d) => ({ taken: a.taken + d.taken, skipped: a.skipped + d.skipped }), { taken: 0, skipped: 0 });
    weeks.unshift({ days: weekDays, ...counts });
  }
  const [selected, setSelected] = useState<string>();
  const active = weeks.find(w => w.days[0]?.day === selected) ?? weeks.at(-1);
  const maxReports = Math.max(1, ...weeks.map(w => w.taken + w.skipped));
  const hasEvidence = recent.some(d => d.taken || d.skipped || d.schedule === "scheduled");
  const date = (day: Day) => formatMemberDate(dayDate(day), l, { day: "numeric", month: "short", timeZone: "Asia/Yerevan" });
  const range = (weekDays: Day[]) => `${date(weekDays[0])}${copy(l, " – ", " – ", " - ")}${date(weekDays[weekDays.length - 1])}`;
  return <div className="space-y-5">
    <section className="space-y-3 rounded-xl border border-dashed bg-muted/40 p-5" aria-label={copy(l,"Lifestyle tracking","Առօրյա սովորությունների հետևում", "Наблюдение за привычками")}>
      <div className="flex items-start gap-3"><Activity aria-hidden className="mt-1 size-6 shrink-0 text-brand-navy"/><div className="min-w-0"><p className="text-caption font-semibold text-muted-foreground">{copy(l,"Planned feature","Նախատեսվող հնարավորություն", "Планируемая возможность")}</p><h2 className="text-h3">{copy(l,"Lifestyle tracking","Առօրյա սովորությունների հետևում", "Наблюдение за привычками")}</h2></div></div>
      <p className="text-body2 text-muted-foreground">{copy(l,"Food, activity and sleep tracking are not available yet.","Սննդի, ակտիվության և քնի հետևումը դեռ հասանելի չէ։", "Наблюдение за питанием, активностью и сном пока недоступно.")}</p>
    </section>
    <DailyRoutine compact occurrences={occurrences} locale={l} hasPlan={hasPlan}/>

    <section className="journey-card space-y-4" aria-label={copy(l, "Medicine reports", "Դեղերի ընդունման նշումներ", "Отметки о приёме лекарств")}>
      <header className="flex items-start gap-3">
        <Pill className="mt-0.5 size-5 shrink-0 text-brand-teal" aria-hidden />
        <div className="min-w-0">
          <h2 className="text-body1 font-semibold">{copy(l, "Your medicine reports", "Դեղերի ընդունման նշումները", "Ваши отметки о приёме лекарств")}</h2>
          <p className="mt-1 text-caption text-muted-foreground">{copy(l, "Self-reported, not proof of intake.", "Ձեր նշումներն են, ոչ ընդունման ապացույց։", "Это ваши отметки, они не подтверждают приём лекарства.")}</p>
        </div>
      </header>
      {hasEvidence ? <>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={copy(l, "Select a week of dose reports", "Ընտրել դեղի ընդունման նշումների շաբաթը", "Выберите неделю отметок о приёме лекарств")}>
          {weeks.map(w => <button key={w.days[0].day} type="button" onClick={() => setSelected(w.days[0].day)} aria-pressed={active === w} aria-label={`${range(w.days)}: ${weekEvidence(w, l)}`} className={`flex min-w-0 flex-col items-center gap-2 rounded-lg border px-1 py-2 text-caption focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-navy ${active === w ? "border-brand-navy" : "border-transparent hover:bg-muted/50"}`}>
            <span className="flex min-h-10 w-full items-center justify-center break-words font-semibold tabular-nums">{weekCount(w, l)}</span>
            <span aria-hidden className="flex h-24 w-8 flex-col justify-end overflow-hidden rounded-md bg-muted">
              {w.skipped > 0 && <span className="block w-full bg-[var(--status-warning-fg)]" style={{ height: `${w.skipped / maxReports * 100}%` }} />}
              {w.taken > 0 && <span className="block w-full bg-brand-teal" style={{ height: `${w.taken / maxReports * 100}%` }} />}
            </span>
            <span className="text-muted-foreground">{date(w.days[0])}</span>
          </button>)}
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted-foreground">
          <span className="inline-flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-sm bg-brand-teal" />{copy(l, "Reported taken", "Նշված է ընդունված", "Отмечено как принято")}</span>
          <span className="inline-flex items-center gap-2"><span aria-hidden className="size-2.5 rounded-sm bg-[var(--status-warning-fg)]" />{copy(l, "Reported skipped", "Նշված է բաց թողնված", "Отмечено как пропущено")}</span>
        </div>
        {active && <div aria-live="polite" className="border-t pt-3 text-body2">
          <p className="font-medium">{range(active.days)}</p>
          <p className="mt-1 text-muted-foreground">{weekEvidence(active, l)}</p>
        </div>}
      </> : <div className="space-y-1">
        <p className="text-body2 text-muted-foreground">{!hasPlan ? copy(l, "No medicines to report yet.", "Նշելու դեղեր դեռ չկան։", "Пока нет лекарств, приём которых нужно отмечать.") : !recent.length || recent.some(d => d.schedule === "unknown") ? copy(l, "Medicine schedule unavailable. Check your care plan.", "Դեղերի ժամանակացույցը հասանելի չէ։ Ստուգեք խնամքի պլանը։", "Расписание приёма лекарств недоступно. Проверьте ваш план лечения.") : copy(l, "No medicine doses scheduled this week.", "Այս շաբաթ դեղի ընդունումներ նախատեսված չեն։", "На эту неделю приём лекарств не запланирован.")}</p>
        {hasPlan && <CareLink href="/patient/care">{copy(l, "Check my care plan", "Ստուգել իմ խնամքի պլանը", "Проверить мой план лечения")}</CareLink>}
      </div>}
      {active && hasEvidence && <section className="border-t pt-3">
        <h3 className="mb-2 text-body2 font-semibold">{copy(l, "Daily reports for this week", "Այս շաբաթվա օրական նշումները", "Ежедневные отметки за эту неделю")}</h3>
        <div className="divide-y">{active.days.map(day => <div key={day.day} data-report-day className="flex flex-wrap justify-between gap-x-3 gap-y-1 py-2 text-caption"><span>{date(day)}</span><span className="text-muted-foreground">{evidence(day, l)}</span></div>)}</div>
      </section>}
      {recent.length > 0 && <details className="group border-t pt-3">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-caption font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><span>{copy(l, "How to read your reports", "Ինչպես կարդալ ձեր նշումները", "Как понимать ваши отметки")}</span><ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden /></summary>
        <p className="pb-3 text-body2 text-muted-foreground">{copy(l, "Bars count your dose reports, not adherence. No report does not mean skipped. A day with no scheduled doses differs from an unavailable schedule.", "Սյունակները հաշվում են ձեր նշումները, ոչ դեղերի ընդունման կարգապահությունը։ Նշման բացակայությունը բաց թողնել չի նշանակում։ Նախատեսված ընդունում չունեցող օրն ու անհասանելի ժամանակացույցը տարբեր են։", "Столбцы показывают количество ваших отметок о приёме, а не соблюдение назначений. Отсутствие отметки не означает пропуск. День без назначенного приёма отличается от дня с недоступным расписанием.")}</p>
      </details>}
    </section>
  </div>;
}
