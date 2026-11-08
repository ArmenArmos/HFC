import {bpObservationCounts} from "@/lib/patient/bp-provenance";
import { HeartPulse } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { CareLink, IconTile, Status, copy } from "@/components/patient-care/common";
import { currentWeek, nextSlot, weekPhase, weekSlots, weekSummary, yerevanDate, type BpWeekRead } from "@/lib/bp-week/model";

/** Home, during a BP week: today's slots and the next one to do. Nothing is shown otherwise. */
export function BpWeekHomeCard({ read, locale: l, now }: { read: BpWeekRead; locale: PatientLocale; now: Date }) {
  const week = currentWeek(read, now);
  if (!week) return null;
  const phase = weekPhase(week, now);
  if (phase !== "running" && phase !== "not-started") return null;
  const today = yerevanDate(now), slots = weekSlots(week, now).filter(s => s.date === today), next = nextSlot(week, now), summary = weekSummary(week, now);
  const day = slots[0]?.day;
  return (
    <section className="journey-card space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6" aria-labelledby="bp-week-home">
      <header className="flex items-start gap-3">
        <IconTile icon={HeartPulse} />
        <div className="min-w-0">
          <h2 id="bp-week-home" className="text-h2">{copy(l, "Your blood pressure week", "Ձեր ճնշման շաբաթը", "Ваша неделя измерений артериального давления")}</h2>
          <p className="mt-1 text-body2 text-muted-foreground">
            {phase === "not-started" ? copy(l, `Starts on ${week.startsOn}.`, `Սկսվում է ${week.startsOn}։`, `Начало ${week.startsOn}.`)
              : copy(l, `Day ${day} of 7 · ${summary.saved} of ${summary.expected} verified readings saved`, `Օր ${day}՝ 7-ից · պահված է ${summary.expected}-ից ${summary.saved} ստուգված չափում`, `День ${day} из 7 · сохранено проверенных измерений: ${summary.saved} из ${summary.expected}`)}
          </p>
        </div>
      </header>
      <p className="text-caption text-muted-foreground">{bpObservationCounts(week.readings,l)}</p>
      {phase === "running" && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {slots.map(s => (
            <li key={s.slot} className="flex items-center justify-between gap-2 rounded-xl border border-border/70 px-3 py-2 text-body2">
              <span>{s.slot === "morning" ? copy(l, "Morning", "Առավոտ", "Утро") : copy(l, "Evening", "Երեկո", "Вечер")} · {s.time}</span>
              <Status tone={s.state === "done" ? "complete" : s.state === "due" || s.state === "partial" ? "due" : "neutral"}>
                {s.state === "done" ? copy(l, "Done", "Արված է", "Готово") : copy(l, `${s.readings.length} of 2`, `${s.readings.length}՝ 2-ից`, `${s.readings.length} из 2`)}
              </Status>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        {next && next.state !== "upcoming"
          ? <CareLink href={`/patient/bp-week/record?slot=${next.slot}`} variant="primary" icon={HeartPulse}>{next.slot === "morning" ? copy(l, "Record morning readings", "Գրանցել առավոտյան չափումները", "Записать утренние измерения") : copy(l, "Record evening readings", "Գրանցել երեկոյան չափումները", "Записать вечерние измерения")}</CareLink>
          : null}
        <CareLink href="/patient/bp-week">{copy(l, "See my week", "Տեսնել իմ շաբաթը", "Посмотреть мою неделю")}</CareLink>
      </div>
    </section>
  );
}

/** Self-loading, so Home needs one line; an outage or the switch off renders nothing. */
export async function BpWeekHome({ locale }: { locale: PatientLocale }) {
  const { readMemberBpWeek } = await import("@/lib/bp-week/server");
  const read = await readMemberBpWeek();
  return read.enabled ? <BpWeekHomeCard read={read} locale={locale} now={new Date()} /> : null;
}

/** The entry on the Pressure page while the feature is on. */
export async function BpWeekLink({ locale: l }: { locale: PatientLocale }) {
  const { readMemberBpWeek } = await import("@/lib/bp-week/server");
  const { RowLink } = await import("@/components/patient-care/common");
  const read = await readMemberBpWeek();
  if (!read.enabled) return null;
  return <RowLink href="/patient/bp-week" icon={HeartPulse} detail={copy(l, "Two readings morning and evening, for 7 days", "Երկու չափում առավոտ և երեկո՝ 7 օր", "По два измерения утром и вечером в течение 7 дней")}>{copy(l, "My 7-day BP week", "Իմ 7-օրյա ճնշման շաբաթը", "Мои 7 дней измерений артериального давления")}</RowLink>;
}
