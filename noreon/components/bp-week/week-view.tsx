import {isUnverifiedBp,unverifiedBpLabel,bpObservationCounts} from "@/lib/patient/bp-provenance";
import {useId} from 'react';
import { CalendarDays, Check, Clock, HeartPulse, MonitorSmartphone, Moon, Plus, Sun } from "lucide-react";
import {Button} from '@/components/ui/button';
import type { PatientLocale } from "@/lib/patient/copy";
import { formatMemberDate } from "@/lib/patient/date-format";
import { CareLink, IconTile, Status, copy } from "@/components/patient-care/common";
import { weekPhase, weekSlots, weekSummary, yerevanDate, type BpWeek, type SlotView } from "@/lib/bp-week/model";

const dayLabel = (date: string, l: PatientLocale) =>
  formatMemberDate(`${date}T12:00:00+04:00`, l, { timeZone: "Asia/Yerevan", weekday: "long", day: "numeric", month: "long" });

export function slotName(slot: SlotView["slot"], l: PatientLocale) {
  return slot === "morning" ? copy(l, "Morning", "Առավոտ", "Утро") : copy(l, "Evening", "Երեկո", "Вечер");
}

function SlotState({ s, l }: { s: SlotView; l: PatientLocale }) {
  switch (s.state) {
    case "done": return <Status tone="complete">{copy(l, "Done", "Արված է", "Готово")}</Status>;
    case "partial": return <Status tone="due">{copy(l, `${s.readings.length} of 2 saved`, `Պահված է 2-ից ${s.readings.length}-ը`, `Сохранено ${s.readings.length} из 2`)}</Status>;
    case "due": return <Status tone="due">{copy(l, "Due now", "Հիմա է", "Пора измерить")}</Status>;
    case "missed": return <Status>{copy(l, "Missed", "Բաց է թողնված", "Пропущено")}</Status>;
    default: return <Status>{copy(l, `At ${s.time}`, `Ժամը ${s.time}-ին`, `В ${s.time}`)}</Status>;
  }
}

/** The member's week: progress, the monitor and every slot. No reading is interpreted here. */
export function WeekView({ week, l, now, showDevice, record }: { week: BpWeek; l: PatientLocale; now: Date; showDevice: boolean; record?:(slot:'morning'|'evening')=>void }) {
  const id=useId();
  const phase = weekPhase(week, now), summary = weekSummary(week, now), slots = weekSlots(week, now), today = yerevanDate(now);
  const days = Array.from({ length: week.days }, (_, i) => slots.filter(s => s.day === i + 1));
  const pct = Math.round((summary.saved / summary.expected) * 100);
  return (
    <div className="space-y-5">
      <section className="journey-card space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" aria-labelledby={`${id}-bp-week-progress`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id={`${id}-bp-week-progress`} className="text-h2">
            {phase === "not-started" ? copy(l, `Your week starts on ${dayLabel(week.startsOn, l)}`, `Ձեր շաբաթը սկսվում է ${dayLabel(week.startsOn, l)}`, `Ваша неделя начинается ${dayLabel(week.startsOn, l)}`)
              : phase === "running" ? copy(l, `Day ${slots.find(s => s.date === today)?.day ?? 1} of 7`, `Օր ${slots.find(s => s.date === today)?.day ?? 1}՝ 7-ից`, `День ${slots.find(s => s.date === today)?.day ?? 1} из 7`)
                : phase === "stopped" ? copy(l, "This week was stopped", "Այս շաբաթը դադարեցվել է", "Эта неделя остановлена")
                  : copy(l, "Your week is complete", "Ձեր շաբաթն ավարտված է", "Ваша неделя завершена")}
          </h2>
          <span className="text-body2 font-semibold tabular-nums">{copy(l, `${summary.saved} of ${summary.expected} verified readings saved`, `Պահված է ${summary.expected}-ից ${summary.saved} ստուգված չափում`, `Сохранено проверенных измерений: ${summary.saved} из ${summary.expected}`)}</span>
        </div>
        <p className="text-caption text-muted-foreground">{bpObservationCounts(week.readings,l)}</p>
        <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuemin={0} aria-valuemax={summary.expected} aria-valuenow={summary.saved}
          aria-label={copy(l, "Verified readings saved", "Պահված ստուգված չափումներ", "Сохранённые проверенные измерения")}>
          <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
        </div>
        <p className="text-body2 text-muted-foreground">
          {copy(l, `Morning at ${week.morningTime} and evening at ${week.eveningTime}: two readings each time.`, `Առավոտյան ժամը ${week.morningTime}-ին և երեկոյան ժամը ${week.eveningTime}-ին՝ ամեն անգամ երկու չափում։`, `Утром в ${week.morningTime} и вечером в ${week.eveningTime}: по два измерения каждый раз.`)}
          {" "}{copy(l, "Missing readings are never counted as normal. Your care team sees the whole week.", "Բաց թողնված չափումները երբեք չեն համարվում նորմալ։ Ձեր խնամքի թիմը տեսնում է ամբողջ շաբաթը։", "Пропущенные измерения никогда не считаются нормальными. Ваша медицинская команда видит всю неделю.")}
        </p>
        {summary.missedSlots > 0 && phase !== "stopped" && (
          <p className="rounded-xl bg-muted p-3 text-body2">
            {copy(l, "Some readings were missed. No blame: life gets busy. Carry on with the next one.", "Որոշ չափումներ բաց են թողնվել։ Ոչինչ, կյանքը զբաղված է։ Շարունակեք հաջորդով։", "Некоторые измерения пропущены. Ничего страшного, всякое бывает. Продолжайте со следующего измерения.")}
          </p>
        )}
      </section>

      {showDevice && week.device && (
        <section className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-5" aria-label={copy(l, "Your monitor", "Ձեր սարքը", "Ваш тонометр")}>
          <IconTile icon={MonitorSmartphone} />
          <div className="min-w-0">
            <p className="text-body2 font-semibold">{copy(l, "Your monitor from Noreon", "Ձեր սարքը Noreon-ից", "Ваш тонометр от Noreon")}</p>
            <p className="mt-1 break-words text-caption text-muted-foreground">{week.device.model} · {week.device.serial}</p>
            <p className="mt-1 text-caption text-muted-foreground">{copy(l, "Enter each reading here. Automatic syncing is not available yet.", "Յուրաքանչյուր չափում մուտքագրեք այստեղ։ Ավտոմատ համաժամեցումը դեռ հասանելի չէ։", "Вводите каждое измерение здесь. Автоматическая синхронизация пока недоступна.")}</p>
          </div>
        </section>
      )}

      <section className="journey-card overflow-hidden rounded-2xl border border-border/70 bg-card shadow-sm" aria-labelledby={`${id}-bp-week-days`}>
        <header className="flex items-center gap-3 border-b p-5 sm:px-6">
          <IconTile icon={CalendarDays} />
          <h2 id={`${id}-bp-week-days`} className="text-h3">{copy(l, "Your 7 days", "Ձեր 7 օրը", "Ваши 7 дней")}</h2>
        </header>
        <ol className="divide-y">
          {days.map(daySlots => {
            const date = daySlots[0].date, isToday = date === today;
            return (
              <li key={date} className={`space-y-3 px-5 py-4 sm:px-6 ${isToday ? "bg-surface-subtle-teal/40" : ""}`} aria-current={isToday ? "date" : undefined}>
                <p className="text-body2 font-semibold">
                  {copy(l, `Day ${daySlots[0].day}`, `Օր ${daySlots[0].day}`, `День ${daySlots[0].day}`)} · {dayLabel(date, l)}{isToday && <span className="ml-2 text-caption text-muted-foreground">{copy(l, "Today", "Այսօր", "Сегодня")}</span>}
                </p>
                <ul className="grid gap-3 sm:grid-cols-2">
                  {daySlots.map(s => (
                    <li key={s.slot} className="space-y-2 rounded-xl border border-border/70 p-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 text-body2 font-semibold">
                          {s.slot === "morning" ? <Sun className="size-4" aria-hidden /> : <Moon className="size-4" aria-hidden />}
                          {slotName(s.slot, l)} · {s.time}
                        </span>
                        <SlotState s={s} l={l} />
                      </div>
                      {s.readings.length > 0 && (
                        <ul className="space-y-1">
                          {s.readings.map(r => (
                            <li key={r.id} className="flex flex-wrap items-center gap-2 text-body2 tabular-nums">
                              <Check className="size-4 text-brand-teal" aria-hidden />
                              {r.systolic}/{r.diastolic} <span className="text-caption text-muted-foreground">mmHg</span>
                              {r.pulse !== null && <span className="text-caption text-muted-foreground">· {r.pulse} {copy(l, "bpm", "զ/ր", "уд/мин")}</span>}
                              {isUnverifiedBp(r) && <span className="w-full text-caption text-muted-foreground">{unverifiedBpLabel(l)}</span>}
                              <span className="ml-auto text-caption text-muted-foreground"><Clock className="mr-1 inline size-3" aria-hidden />{formatMemberDate(r.measuredAt, l, { timeZone: "Asia/Yerevan", timeStyle: "short" })}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      {phase === "running" && isToday && (s.state === "due" || s.state === "partial" || s.state === "upcoming") && (
                        record ? <Button type="button" className="h-auto min-h-12 whitespace-normal" onClick={()=>record(s.slot)}>{s.readings.length ? copy(l, "Record the second reading", "Գրանցել երկրորդ չափումը", "Записать второе измерение") : copy(l, "Record a reading", "Գրանցել չափում", "Записать измерение")}</Button> : <CareLink href={`/patient/bp-week/record?slot=${s.slot}`} icon={s.state === "upcoming" ? Plus : HeartPulse} variant={s.state === "upcoming" ? "secondary" : "primary"}>
                          {s.readings.length ? copy(l, "Record the second reading", "Գրանցել երկրորդ չափումը", "Записать второе измерение") : copy(l, `Record ${s.slot === "morning" ? "morning" : "evening"} readings`, s.slot === "morning" ? "Գրանցել առավոտյան չափումները" : "Գրանցել երեկոյան չափումները", s.slot === "morning" ? "Записать утренние измерения" : "Записать вечерние измерения")}
                        </CareLink>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
