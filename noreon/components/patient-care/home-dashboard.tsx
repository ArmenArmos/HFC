import {memberDoctorLabel} from "@/lib/member-staff-name.mjs";
import {
  Activity,
  Bell,
  ClipboardList,
  HeartPulse,
  History,
  Leaf,
  Moon,
  Pill,
  Stethoscope,
  Utensils,
  Waves,
} from "lucide-react";
import Link from "next/link";
import type { PatientLocale } from "@/lib/patient/copy";
import type { Measurement } from "@/lib/patient/types";
import type { CareData } from "@/lib/patient-care/types";
import type { ReminderPreferences } from "@/lib/patient-care/reminder-preferences";
import { homeDashboard } from "@/lib/patient-care/home-dashboard";
import { formatMemberDate } from "@/lib/patient/date-format";
import { CareLink, copy, RowLink, stamp } from "./common";
import { DoseButtons } from "./controls";
import { ExercisePauseNotice } from "./exercise-pause-notice";
import { HealthTrends } from "./trends";
import {
  BreathingSession,
  EveningTip,
  MealIdeas,
  MeditationTip,
  MovementTip,
} from "./home-wellbeing";

type Props = {
  care: CareData;
  measurements: Measurement[];
  actionMeasurements?: Measurement[];
  preferences: ReminderPreferences;
  locale: PatientLocale;
  now: string;
};
const time = (at: string, l: PatientLocale) =>
  formatMemberDate(at, l, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: "Asia/Yerevan",
  });
function dueIn(at: string, now: string, l: PatientLocale) {
  const minutes = Math.ceil((Date.parse(at) - Date.parse(now)) / 60000);
  if (minutes <= 0)
    return copy(l, "Scheduled time reached", "Նշանակված ժամը հասել է", "Назначенное время наступило");
  if (minutes < 60) return copy(l, `In ${minutes} min`, `${minutes} րոպեից`, `Через ${minutes} мин`);
  const hours = Math.floor(minutes / 60),
    rest = minutes % 60;
  return copy(
    l,
    `In ${hours} h${rest ? ` ${rest} min` : ""}`,
    `${hours} ժամ${rest ? ` ${rest} րոպե` : ""}ից`,
    `${hours} ч${rest ? ` ${rest} мин` : ""} до назначенного времени`,
  );
}
function Heading({
  title,
  detail,
  icon: Icon,
}: {
  title: string;
  detail?: string;
  icon: typeof Activity;
}) {
  return (
    <header className="flex items-start gap-3">
      <Icon className="mt-0.5 size-5 shrink-0 text-brand-teal" aria-hidden />
      <div className="min-w-0">
        <h2 className="text-h2">{title}</h2>
        {detail && (
          <p className="mt-1 text-caption text-muted-foreground">{detail}</p>
        )}
      </div>
    </header>
  );
}
export function ComingUpNext({
  care,
  measurements,
  preferences,
  locale: l,
  now,
}: Props) {
  const { medicine, bp } = homeDashboard(
    care,
    measurements,
    preferences,
    new Date(now),
  );
  const laterDay = (at: string) =>
    formatMemberDate(at, l, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Yerevan",
    }) !==
    formatMemberDate(now, l, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      timeZone: "Asia/Yerevan",
    });
  const rowClass =
    "grid grid-cols-1 items-start gap-x-3 gap-y-3 py-4 @min-[14rem]:grid-cols-[2.5rem_minmax(0,1fr)] @min-[32rem]:grid-cols-[2.5rem_minmax(0,1fr)_auto]";
  const tileClass =
    "grid size-10 place-items-center rounded-lg bg-primary-foreground/10";
  const actionClass =
    "col-span-full min-w-0 @min-[32rem]:col-span-1 @min-[32rem]:col-start-3 @min-[32rem]:row-start-1 @min-[32rem]:self-center";
  return (
    <section
      className="@container rounded-2xl bg-brand-navy p-5 text-on-inverse shadow-sm sm:p-6"
      aria-labelledby="upcoming-actions-heading"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="upcoming-actions-heading" className="text-h2">
          {copy(l, "Up next", "Հաջորդը", "Что дальше")}
        </h2>
        <Link
          href="/patient/account/reminders"
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-body2 text-on-inverse-muted hover:bg-on-inverse/10 hover:text-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-inverse"
        >
          <Bell className="size-4 shrink-0" aria-hidden />
          {copy(l, "Reminders", "Հիշեցումներ", "Напоминания")}
        </Link>
      </header>
      <ul className="mt-1 divide-y divide-primary-foreground/20">
        {medicine ? (
          <li className={rowClass}>
            <span className={tileClass}>
              <Pill className="size-5" aria-hidden />
            </span>
            <div className="min-w-0 space-y-1">
              <h3 className="break-words text-body2 font-semibold">
                {medicine.medication.name} · {medicine.medication.dose}
              </h3>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <time
                  dateTime={medicine.dueAt}
                  className="font-display text-2xl font-bold tabular-nums"
                >
                  {time(medicine.dueAt, l)}
                </time>
                <span className="text-caption text-on-inverse-muted">
                  {laterDay(medicine.dueAt)
                    ? copy(l, "Tomorrow", "Վաղը", "Завтра") + " · "
                    : ""}
                  {dueIn(medicine.dueAt, now, l)}
                </span>
              </div>
              {!preferences.medicationEnabled && (
                <p className="text-caption text-on-inverse-muted">
                  {copy(
                    l,
                    "Medicine reminders off",
                    "Դեղերի հիշեցումներն անջատված են", "Напоминания о лекарствах отключены",
                  )}
                </p>
              )}
            </div>
            <div className={actionClass}>
              <DoseButtons dose={medicine} locale={l} compact tone="inverse" />
            </div>
            <details className="col-span-full min-w-0 @min-[32rem]:col-span-2 @min-[32rem]:col-start-2">
              <summary className="flex min-h-11 cursor-pointer items-center rounded-md text-caption text-on-inverse-muted hover:text-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-inverse">
                {copy(
                  l,
                  "Prescription instructions",
                  "Դեղի ընդունման ցուցումներ", "Указания по приёму лекарства",
                )}
              </summary>
              <div className="space-y-2 pb-2 text-body2">
                <p className="whitespace-pre-wrap break-words">
                  {medicine.medication.instructions}
                </p>
                <p className="text-caption text-on-inverse-muted">
                  {copy(
                    l,
                    "From your published care plan",
                    "Ձեր հրապարակված խնամքի պլանից", "Из вашего опубликованного плана лечения",
                  )}{" "}
                  · {stamp(medicine.dueAt, l, false)}
                </p>
              </div>
            </details>
          </li>
        ) : (care.plan?.medications.length ?? 0) > 0 ? (
          <li className={rowClass}>
            <span className={tileClass}>
              <Pill className="size-5" aria-hidden />
            </span>
            <p className="min-w-0 self-center text-body2 text-on-inverse-muted">
              {copy(
                l,
                "No upcoming dose scheduled",
                "Դեղի առաջիկա ընդունում նախատեսված չէ", "Ближайший приём не запланирован",
              )}
            </p>
            <Link
              href="/patient/care"
              className={`${actionClass} inline-flex min-h-11 items-center rounded-md text-body2 underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-on-inverse`}
            >
              {copy(l, "Check my care plan", "Ստուգել իմ խնամքի պլանը", "Проверить мой план лечения")}
            </Link>
          </li>
        ) : null}
        <li className={rowClass}>
          <span className={tileClass}>
            <HeartPulse className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 space-y-1">
            <h3 className="text-body2 font-semibold">
              {copy(l, "Blood pressure", "Արյան ճնշում", "Артериальное давление")}
            </h3>
            {bp ? (
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <time
                  dateTime={bp.dueAt}
                  className="font-display text-2xl font-bold tabular-nums"
                >
                  {time(bp.dueAt, l)}
                </time>
                <span className="text-caption text-on-inverse-muted">
                  {laterDay(bp.dueAt)
                    ? copy(l, "Tomorrow", "Վաղը", "Завтра") + " · "
                    : ""}
                  {Date.parse(bp.dueAt) > Date.parse(now)
                    ? dueIn(bp.dueAt, now, l)
                    : copy(l, "Your reminder time", "Ձեր հիշեցման ժամը", "Ваше время напоминания")}
                </span>
              </div>
            ) : (
              <p className="text-caption text-on-inverse-muted">
                {preferences.bpEnabled
                  ? copy(l, "No upcoming reminder", "Առաջիկա հիշեցում չկա", "Ближайших напоминаний нет")
                  : copy(l, "Reminders off", "Հիշեցումներն անջատված են", "Напоминания отключены")}
              </p>
            )}
          </div>
          <div className={actionClass}>
            <CareLink
              href="/patient/measurements/new"
              variant="secondary"
              icon={Activity}
            >
              {copy(l, "Log a reading", "Գրանցել չափումը", "Записать измерение")}
            </CareLink>
          </div>
        </li>
      </ul>
      <footer className="flex flex-wrap items-center justify-between gap-x-3 border-t border-primary-foreground/20 pt-2 text-caption text-on-inverse-muted">
        <p>{copy(l, "Armenia time", "Հայաստանի ժամանակով", "Время Армении")}</p>
        <details className="min-w-0">
          <summary className="flex min-h-11 cursor-pointer items-center rounded-md hover:text-on-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-inverse">
            {copy(l, "About reminders", "Հիշեցումների մասին", "О напоминаниях")}
          </summary>
          <p className="max-w-prose pb-3 text-body2">
            {copy(
              l,
              care.plan
                ? "Your chosen reminder time. Follow your care-plan instructions for measuring. You can record a measured reading at any time."
                : "Your chosen reminder time. You can record a measured reading at any time.",
              care.plan
                ? "Ձեր ընտրած հիշեցման ժամը։ Չափելիս հետևեք խնամքի պլանի ցուցումներին։ Կարող եք ցանկացած պահի գրանցել չափված արժեքը։"
                : "Ձեր ընտրած հիշեցման ժամը։ Կարող եք ցանկացած պահի գրանցել չափված արժեքը։", care.plan ? "Выбранное вами время напоминания. При измерении следуйте указаниям в плане лечения. Записать результат измерения можно в любое время." : "Выбранное вами время напоминания. Записать результат измерения можно в любое время.",
            )}
          </p>
        </details>
      </footer>
    </section>
  );
}

function Ring({
  count,
  total,
  label,
  detail,
}: {
  count: number;
  total: number;
  label: string;
  detail: string;
}) {
  const progress = total ? Math.min(1, count / total) : 0;
  return (
    <div className="flex min-w-0 flex-col items-center gap-2 rounded-xl bg-muted/50 p-3 text-center">
      <div className="relative grid size-24 place-items-center">
        <svg
          viewBox="0 0 100 100"
          className="absolute size-full -rotate-90 text-brand-teal"
          aria-hidden
        >
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            opacity=".12"
          />
          <circle
            cx="50"
            cy="50"
            r="42"
            fill="none"
            stroke="currentColor"
            strokeWidth="7"
            strokeDasharray="263.89"
            strokeDashoffset={263.89 * (1 - progress)}
          />
        </svg>
        <strong className="text-body1 tabular-nums">
          {total ? `${count}/${total}` : "–"}
        </strong>
      </div>
      <p className="text-body2 font-semibold">{label}</p>
      <p className="text-caption text-muted-foreground">{detail}</p>
    </div>
  );
}
export function HomeHealthAndRhythm(props: Props) {
  const { locale: l, now, care } = props,
    model = homeDashboard(
      care,
      props.actionMeasurements ?? props.measurements,
      props.preferences,
      new Date(now),
    );
  const chart = homeDashboard(
      care,
      props.measurements,
      props.preferences,
      new Date(now),
    ),
    latest = chart.latest;
  return (
    <>
      <section className="space-y-4">
        <Heading
          title={copy(
            l,
            "Your health at a glance",
            "Ձեր առողջությունը՝ մի հայացքով", "Кратко о вашем здоровье",
          )}
          detail={copy(l, "Your recorded readings", "Ձեր գրանցած չափումները", "Ваши записанные измерения")}
          icon={HeartPulse}
        />
        <div className="grid grid-cols-2 gap-3">
          <div className="min-w-0 rounded-2xl bg-surface-subtle-teal p-4 sm:p-5">
            <HeartPulse className="size-5 text-brand-teal" aria-hidden />
            <h3 className="mt-3 text-caption font-medium">
              {copy(l, "Blood pressure", "Արյան ճնշում", "Артериальное давление")}
            </h3>
            <p className="mt-2 break-words font-display text-3xl font-extrabold tabular-nums text-brand-navy">
              {latest ? `${latest.systolic}/${latest.diastolic}` : "–"}
            </p>
            <p className="text-caption">mmHg</p>
            <p className="mt-3 text-caption text-muted-foreground">
              {latest
                ? stamp(latest.measuredAt, l)
                : copy(l, "No readings yet", "Չափումներ դեռ չկան", "Измерений пока нет")}
            </p>
          </div>
          <div className="min-w-0 rounded-2xl bg-[var(--status-warning-bg)] p-4 sm:p-5">
            <Activity className="size-5 text-brand-navy" aria-hidden />
            <h3 className="mt-3 text-caption font-medium">
              {copy(l, "Recorded pulse", "Գրանցված զարկերակ", "Записанный пульс")}
            </h3>
            <p className="mt-2 font-display text-3xl font-extrabold tabular-nums text-brand-navy">
              {latest?.pulse ?? "–"}
            </p>
            <p className="text-caption">{copy(l, "bpm", "զարկ/րոպե", "уд/мин")}</p>
            <p className="mt-3 text-caption text-muted-foreground">
              {latest?.pulse
                ? stamp(latest.measuredAt, l)
                : copy(
                    l,
                    "Not recorded with the latest reading",
                    "Վերջին չափման հետ չի գրանցվել", "Не записан при последнем измерении",
                  )}
            </p>
          </div>
        </div>
        <div className="journey-card">
          <HealthTrends
            measurements={chart.measurements}
            results={[]}
            locale={l}
            now={now}
            compact
            mode="pressure"
            showRange
          />
          <CareLink href="/patient/measurements" icon={History}>
            {copy(l, "Measurement history", "Չափումների պատմություն", "История измерений")}
          </CareLink>
        </div>
      </section>
      <section className="space-y-4">
        <Heading
          title={copy(l, "Today’s rhythm", "Այսօրվա ռիթմը", "Сегодняшний ритм")}
          detail={copy(
            l,
            "Recorded actions, not a clinical score",
            "Գրանցված գործողություններ, ոչ կլինիկական գնահատական", "Записанные действия, а не клиническая оценка",
          )}
          icon={Activity}
        />
        <div className="grid grid-cols-2 gap-3">
          <Ring
            count={model.medicineTaken}
            total={model.medicineTotal}
            label={copy(l, "Medicine reports", "Դեղերի ընդունման նշումներ", "Отметки о приёме лекарств")}
            detail={copy(
              l,
              "Self-reported taken today",
              "Այսօր նշված է՝ ընդունված", "Отмечено вами как принято сегодня",
            )}
          />
          <Ring
            count={model.bpCompleted}
            total={model.bpTotal}
            label={copy(l, "BP check-ins", "Ճնշման գրառումներ", "Отметки об измерении давления")}
            detail={copy(
              l,
              "Readings in your reminder slots",
              "Չափումներ՝ ձեր հիշեցման ժամերին", "Измерения в ваше время напоминаний",
            )}
          />
        </div>
      </section>
    </>
  );
}
/** `exercise` is required, from exerciseGuidance (DT P389): paused or withheld hides the movement tip.
 *  `hasPlan`: a published care plan exists; without one no line refers to it (Gohar D-003). */
export function HomeLifestyle({ locale: l, exercise, hasPlan }: { locale: PatientLocale; exercise: "suggest" | "paused" | "withheld"; hasPlan: boolean }) {
  return (
    <>
      <section className="space-y-4">
        <Heading
          title={copy(l, "Diet and nutrition", "Սննդակարգ և սնուցում", "Рацион и питание")}
          icon={Utensils}
        />
        <div className="journey-card flex items-start gap-3">
          <Utensils className="size-7 shrink-0 text-brand-teal" aria-hidden />
          <div>
            <p className="text-body2 font-medium">
              {copy(
                l,
                "Meals and hydration are not tracked here yet",
                "Սնունդն ու ջրի ընդունումն այստեղ դեռ չեն գրանցվում", "Питание и потребление жидкости здесь пока не отслеживаются",
              )}
            </p>
            <p className="mt-1 text-caption text-muted-foreground">
              {hasPlan
                ? copy(
                    l,
                    "Use your agreed nutrition plan. These ideas do not set portions or water targets.",
                    "Հետևեք ձեր համաձայնեցված սննդակարգին։ Այս գաղափարները չափաբաժնի կամ ջրի թիրախներ չեն սահմանում։", "Следуйте согласованному плану питания. Эти идеи не задают размер порций или объём воды.",
                  )
                : copy(
                    l,
                    "These ideas do not set portions or water targets.",
                    "Այս գաղափարները չափաբաժնի կամ ջրի թիրախներ չեն սահմանում։", "Эти идеи не задают размер порций или объём воды.",
                  )}
            </p>
          </div>
        </div>
        <MealIdeas locale={l} hasPlan={hasPlan} />
      </section>
      <section className="space-y-4">
        <Heading
          title={copy(l, "Physical activity", "Ֆիզիկական ակտիվություն", "Физическая активность")}
          icon={Activity}
        />
        <div className="journey-card">
          <div className="flex items-center justify-between gap-4">
            <p className="text-body2 font-medium">
              {copy(l, "Steps and active time", "Քայլեր և ակտիվ ժամանակ", "Шаги и время активности")}
            </p>
            <span className="text-caption text-muted-foreground">
              {copy(l, "Not tracked", "Չի գրանցվում", "Не отслеживается")}
            </span>
          </div>
          <p className="mt-3 text-caption text-muted-foreground">
            {hasPlan
              ? copy(
                  l,
                  "No device connection or activity history is available. Your care plan has your activity guidance.",
                  "Սարքի կապ կամ ակտիվության պատմություն հասանելի չէ։ Շարժման ցուցումները ձեր խնամքի պլանում են։", "Подключение устройства и история активности недоступны. Рекомендации по активности есть в вашем плане лечения.",
                )
              : copy(
                  l,
                  "No device connection or activity history is available.",
                  "Սարքի կապ կամ ակտիվության պատմություն հասանելի չէ։", "Подключение устройства и история активности недоступны.",
                )}
          </p>
          {hasPlan && (
            <CareLink href="/patient/care">
              {copy(l, "Read my care plan", "Կարդալ իմ խնամքի պլանը", "Прочитать мой план лечения")}
            </CareLink>
          )}
        </div>
        {exercise === "suggest" ? <MovementTip locale={l} hasPlan={hasPlan} /> : exercise === "paused" ? <ExercisePauseNotice locale={l} /> : null}
      </section>
      <section className="space-y-4">
        <Heading title={copy(l, "Sleep", "Քուն", "Сон")} icon={Moon} />
        <div className="journey-card">
          <p className="text-body2 font-medium">
            {copy(
              l,
              "Sleep is not tracked here yet",
              "Քունն այստեղ դեռ չի գրանցվում", "Сон здесь пока не отслеживается",
            )}
          </p>
          <p className="mt-2 text-caption text-muted-foreground">
            {copy(l, "No recorded nights to show.", "Գրանցված գիշերներ չկան։", "Записей о сне пока нет.")}
          </p>
        </div>
        <EveningTip locale={l} />
      </section>
      <section className="space-y-4">
        <Heading
          title={copy(l, "A moment for yourself", "Մի պահ՝ ձեզ համար", "Минута для себя")}
          icon={Waves}
        />
        <div className="grid items-start gap-4 md:grid-cols-2">
          <BreathingSession locale={l} />
          <MeditationTip locale={l} />
        </div>
      </section>
    </>
  );
}
export function HomeCareAndTeam({
  care,
  locale: l,
  now,
  doctorShown = false,
  reviewedResults,
}: {
  care: CareData;
  locale: PatientLocale;
  /** From reviewedResultCount: also counts released clinic reports and doctor-approved uploads (QA 177). */
  reviewedResults?: number;
  /** Kept for callers; the Zoe card moved to its own screen (17 Oct). */
  demo?: boolean;
  now: string;
  /** Home shows the named-doctor card; the plan reviewer row would repeat it. */
  doctorShown?: boolean;
}) {
  const nextVisit = care.appointments
    .filter(
      (a) =>
        a.status === "confirmed" &&
        a.startsAt &&
        Date.parse(a.startsAt) > Date.parse(now),
    )
    .toSorted((a, b) => Date.parse(a.startsAt!) - Date.parse(b.startsAt!))[0];
  return (
    <>
      <section className="space-y-4">
        <Heading
          title={copy(l, "Your care, connected", "Ձեր կապակցված խնամքը", "Всё о вашем лечении")}
          icon={ClipboardList}
        />
        <div className="journey-card space-y-3">
          <p className="text-body1 font-semibold">
            {care.pendingReview
              ? copy(
                  l,
                  "Care review in progress",
                  "Խնամքի վերանայումն ընթացքի մեջ է", "Проверка лечения продолжается",
                )
              : care.plan
                ? copy(l, "Published care plan", "Հրապարակված խնամքի պլան", "Опубликованный план лечения")
                : copy(l, "Your next care step", "Խնամքի հաջորդ քայլը", "Ваш следующий шаг в лечении")}
          </p>
          <div className="grid grid-cols-3 divide-x rounded-xl bg-muted/50 py-3 text-center">
            <div className="min-w-0 px-2">
              <p className="text-caption">
                {copy(l, "Tests", "Հետազոտություններ", "Анализы")}
              </p>
              <p className="mt-1 text-body1 font-semibold tabular-nums">
                {care.tests.length}
              </p>
            </div>
            <div className="min-w-0 px-2">
              <p className="text-caption">
                {copy(l, "Reviewed results", "Վերանայված արդյունքներ", "Проверенные результаты")}
              </p>
              <p className="mt-1 text-body1 font-semibold tabular-nums">
                {reviewedResults ?? care.results.filter((r) => r.reviewedAt).length}
              </p>
            </div>
            <div className="min-w-0 px-2">
              <p className="text-caption">
                {copy(l, "Care plan", "Խնամքի պլան", "План лечения")}
              </p>
              <p className="mt-1 break-words text-caption font-semibold">
                {care.plan
                  ? copy(l, "Published", "Հրապարակված", "Опубликован")
                  : copy(l, "Not published", "Չի հրապարակվել", "Не опубликован")}
              </p>
            </div>
          </div>
          <p className="text-body2 text-muted-foreground">
            {care.plan
              ? copy(
                  l,
                  `Your plan was published on ${stamp(care.plan.publishedAt, l, false)}.`,
                  `Ձեր պլանը հրապարակվել է ${stamp(care.plan.publishedAt, l, false)}։`, `Ваш план опубликован ${stamp(care.plan.publishedAt, l, false)}.`,
                )
              : copy(
                  l,
                  "Open your care page for your current test, review and plan status.",
                  "Բացեք խնամքի էջը՝ հետազոտությունների, վերանայման և պլանի ընթացիկ կարգավիճակը տեսնելու համար։", "Откройте страницу лечения, чтобы увидеть текущий статус анализов, проверки и плана.",
                )}
          </p>
          {care.pendingReview && care.plan && (
            <p className="text-caption text-muted-foreground">
              {copy(
                l,
                "Your previously published plan remains available while the new review is pending.",
                "Նոր վերանայման ընթացքում ձեր նախկին հրապարակված պլանը հասանելի է։", "Ваш ранее опубликованный план остаётся доступным, пока ожидается новая проверка.",
              )}
            </p>
          )}
          {nextVisit && (
            <div className="border-t pt-3">
              <p className="text-body2 font-semibold">
                {copy(l, "Next confirmed visit", "Հաջորդ հաստատված այցը", "Следующий подтверждённый визит")}
              </p>
              <p className="mt-1 text-caption">
                {stamp(nextVisit.startsAt!, l)} · {nextVisit.specialty}
              </p>
            </div>
          )}
          <CareLink href="/patient/care" variant="primary">
            {copy(l, "Open my care", "Բացել իմ խնամքը", "Открыть моё лечение")}
          </CareLink>
        </div>
      </section>
      <section className="space-y-4">
        <Heading
          title={copy(
            l,
            "Care team and reports",
            "Խնամքի թիմ և հետազոտություններ", "Медицинская команда и отчёты",
          )}
          icon={Stethoscope}
        />
        <div className="journey-card !p-2 sm:!p-3">
          {!doctorShown && (
            <RowLink
              href="/patient/team?section=contact"
              icon={Stethoscope}
              detail={
                (care.plan?.clinician ? memberDoctorLabel(care.plan.clinician,l) : null) ??
                copy(
                  l,
                  "No plan reviewer shown yet",
                  "Պլանի վերանայող դեռ չի նշված", "Врач, проверяющий план, пока не указан",
                )
              }
            >
              {copy(l, "Your plan reviewer", "Ձեր պլանի վերանայողը", "Врач, проверяющий ваш план")}
            </RowLink>
          )}
          <RowLink
            href="/patient/team?section=contact"
            icon={Leaf}
            detail={copy(
              l,
              "Assigned nurse details are not available here yet",
              "Նշանակված բուժքրոջ տվյալներն այստեղ դեռ հասանելի չեն", "Сведения о назначенной медсестре здесь пока недоступны",
            )}
          >
            {copy(l, "Nurse information", "Բուժքրոջ տեղեկությունները", "Сведения о медсестре")}
          </RowLink>
          <RowLink
            href="/patient/reports"
            icon={History}
            detail={copy(
              l,
              "Read your saved reports and download the originals",
              "Կարդալ պահված հետազոտությունները և ներբեռնել բնօրինակները", "Прочитайте сохранённые отчёты и скачайте оригиналы",
            )}
          >
            {copy(l, "Report history", "Հետազոտությունների պատմություն", "История отчётов")}
          </RowLink>
        </div>
      </section>
    </>
  );
}
