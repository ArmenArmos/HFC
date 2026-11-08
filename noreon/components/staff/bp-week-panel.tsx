import {bpUnit} from '@/lib/bp-unit';
import {isUnverifiedBp,unverifiedBpLabel,bpObservationCounts} from "@/lib/patient/bp-provenance";
import { CareSection } from "@/components/patient-care/common";
import { st, type StaffLocale } from "@/lib/staff/staff-locale-copy";
import { weekPhase, weekSlots, weekSummary, type BpWeek, type BpWeekRead } from "@/lib/bp-week/model";
import { StaffStartWeek, StaffStopWeek } from "./bp-week-controls";

const reading = (r: { systolic: number; diastolic: number; pulse: number | null }) => `${r.systolic}/${r.diastolic}${r.pulse !== null ? ` · ${r.pulse}` : ""}`;

function WeekTable({ week, locale, now }: { week: BpWeek; locale: StaffLocale; now: Date }) {
  const t = (en: string, hy: string, ru: string) => st(locale, en, hy, ru);
  const slots = weekSlots(week, now);
  const cell = (day: number, slot: "morning" | "evening") => {
    const s = slots.find(x => x.day === day && x.slot === slot)!;
    if (s.readings.length) return <>{s.readings.map(r => <span key={r.id} className="block tabular-nums">{reading(r)}{isUnverifiedBp(r)&&<span className="block text-caption text-muted-foreground">{unverifiedBpLabel(locale)}</span>}</span>)}{s.readings.length < 2 && <span className="block text-caption text-muted-foreground">{s.state === "missed" ? t("1 missing", "1-ը բացակայում է", "Не хватает 1 измерения") : t("1 to come", "1-ը սպասվում է", "Ожидается еще 1 измерение")}</span>}</>;
    return <span className="text-caption text-muted-foreground">{s.state === "missed" ? t("Missed", "Բաց է թողնված", "Пропущено") : s.state === "due" ? t("Due", "Սպասվում է", "Пора измерить") : "—"}</span>;
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[22rem] text-left text-body2">
        <caption className="sr-only">{t(`Readings by day and slot, ${bpUnit(locale)} and pulse`, `Չափումներն ըստ օրերի և ժամերի, ${bpUnit(locale)} և զարկերակ`, `Измерения по дням и периодам, ${bpUnit(locale)} и пульс`)}</caption>
        <thead><tr className="border-b text-caption text-muted-foreground"><th scope="col" className="py-2 pr-3">{t("Day", "Օր", "День")}</th><th scope="col" className="py-2 pr-3">{t("Morning", "Առավոտ", "Утро")} {week.morningTime}</th><th scope="col" className="py-2">{t("Evening", "Երեկո", "Вечер")} {week.eveningTime}</th></tr></thead>
        <tbody className="divide-y">
          {Array.from({ length: week.days }, (_, i) => i + 1).map(day => (
            <tr key={day}><th scope="row" className="py-2 pr-3 align-top font-normal">{day} · {slots.find(s => s.day === day)!.date.slice(5)}</th><td className="py-2 pr-3 align-top">{cell(day, "morning")}</td><td className="py-2 align-top">{cell(day, "evening")}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** D1 for the assigned nurse and doctor: raw readings, missing slots and a plain average marked pending. */
export function BpWeekPanel({ read, memberId, locale, now }: { read: Extract<BpWeekRead, { enabled: true }>; memberId: string; locale: StaffLocale; now: Date }) {
  const t = (en: string, hy: string, ru: string) => st(locale, en, hy, ru);
  const week = read.weeks[0] ?? null, phase = week ? weekPhase(week, now) : null, open = phase === "running" || phase === "not-started";
  const summary = week ? weekSummary(week, now) : null;
  return (
    <CareSection title={t("7-day home BP week", "7-օրյա տնային ճնշման շաբաթ", "7-дневная неделя домашних измерений давления")} detail={t("Home readings entered by the member (manual entry; device sync is not live).", "Անդամի մուտքագրած տնային չափումներ (ձեռքով, սարքի համաժամեցումը միացված չէ)։", "Домашние измерения, внесенные участником (вручную; синхронизация с устройством не включена).")}>
      {!week && <p className="text-body2 text-muted-foreground">{t("No week yet.", "Դեռ շաբաթ չկա։", "Недели пока нет.")}</p>}
      {week && summary && (
        <div className="space-y-4">
          <p className="text-caption text-muted-foreground">{bpObservationCounts(week.readings,locale)}</p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div><dt className="text-caption text-muted-foreground">{t("Week", "Շաբաթ", "Неделя")}</dt><dd className="text-body2">{week.startsOn} · {phase === "running" ? t("running", "ընթացքում", "идет") : phase === "not-started" ? t("not started", "դեռ չի սկսվել", "еще не началась") : phase === "stopped" ? t("stopped", "դադարեցված", "остановлена") : t("finished", "ավարտված", "завершена")}{week.startedByRole !== "member" ? ` · ${t("started by", "սկսել է", "начало недели:")} ${week.startedByRole === "nurse" ? t("nurse", "բուժքույր", "медсестра") : t("doctor", "բժիշկ", "врач")}` : ` · ${t("started by the member", "սկսել է անդամը", "начал участник")}`}</dd></div>
            <div><dt className="text-caption text-muted-foreground">{t("Verified readings", "Ստուգված չափումներ", "Проверенные измерения")}</dt><dd className="text-body2 tabular-nums">{summary.saved} / {summary.expected} · {t("complete slots", "ամբողջական", "полные периоды")} {summary.completeSlots}/14 · {t("missed slots", "բաց թողնված", "пропущенные периоды")} {summary.missedSlots}</dd></div>
            <div><dt className="text-caption text-muted-foreground">{t("Monitor", "Սարք", "Тонометр")}</dt><dd className="break-words text-body2">{week.device ? `${week.device.model} · ${week.device.serial}` : t("None linked", "Կապված չէ", "Не связан")}</dd></div>
          </dl>
          <div className="rounded-xl border border-border p-3">
            <p className="text-caption text-muted-foreground">{t("Plain average of verified readings", "Ստուգված չափումների պարզ միջինը", "Простое среднее проверенных измерений")}</p>
            <p className="text-h3 tabular-nums">{summary.plainAverage ? `${summary.plainAverage.systolic} / ${summary.plainAverage.diastolic} ${bpUnit(locale)}` : "—"}{summary.plainAverage && <span className="ml-2 text-caption text-muted-foreground">n={summary.plainAverage.count}</span>}</p>
            <p className="mt-1 text-caption text-muted-foreground">{t("The averaging rule and the home threshold are proposed and under clinical review. No classification is applied. Missing readings are not counted.", "Միջինացման կանոնը և տնային շեմը առաջարկվող են և կլինիկական վերանայման փուլում են։ Դասակարգում չի կիրառվում։ Բացակայող չափումները չեն հաշվվում։", "Правило усреднения и домашний порог предложены и проходят клиническую проверку. Классификация не применяется. Отсутствующие измерения не учитываются.")}</p>
          </div>
          <WeekTable week={week} locale={locale} now={now} />
          {week.stoppedAt && <p className="text-caption text-muted-foreground">{t("Stopped", "Դադարեցվել է", "Остановлена")} {week.stoppedAt.slice(0, 10)}{week.stopReason ? `: ${week.stopReason}` : ""}</p>}
          {open && <StaffStopWeek memberId={memberId} weekId={week.id} locale={locale} />}
        </div>
      )}
      {!open && <StaffStartWeek memberId={memberId} locale={locale} today={read.today} device={read.currentDevice ? `${read.currentDevice.model} · ${read.currentDevice.serial}` : null} />}
    </CareSection>
  );
}
