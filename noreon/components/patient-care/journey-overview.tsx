import { ChartNoAxesCombined, History, CalendarDays, Bell, Check } from "lucide-react";
import type { Measurement } from "@/lib/patient/types";
import type { CareData } from "@/lib/patient-care/types";
import type { PatientLocale } from "@/lib/patient/copy";
import { measurementOverview } from "@/lib/patient-care/overview";
import { dosesForDay } from "@/lib/patient-care/model";
import { CareSection, CareLink, copy, stamp } from "./common";
import { FutureFeature, ZoeCard } from "./coming-soon";

export function HomeWeekSummary({ measurements, care, locale: l, now }: {
  measurements: Measurement[]; care: CareData; locale: PatientLocale; now: Date;
}) {
  const summary = measurementOverview(measurements, now);
  const latest = measurements.filter(r => Date.parse(r.measuredAt) <= now.getTime()).toSorted((a,b) => Date.parse(b.measuredAt)-Date.parse(a.measuredAt))[0];
  const doses = dosesForDay(care, now), taken = doses.filter(d => d.status === "taken").length;
  const tiles = [
    {label:copy(l,"Latest blood pressure","Վերջին ճնշումը", "Последнее артериальное давление"),value:latest ? `${latest.systolic}/${latest.diastolic}` : "–",detail:latest ? stamp(latest.measuredAt,l) : copy(l,"No readings yet","Չափումներ դեռ չկան", "Измерений пока нет"),unit:"mmHg"},
    {label:copy(l,"7-day average","7 օրվա միջինը", "Среднее за 7 дней"),value:summary.average ? `${summary.average.systolic}/${summary.average.diastolic}` : "–",detail:copy(l,"From your recorded readings","Ձեր գրանցած չափումներից", "По вашим записанным измерениям"),unit:"mmHg"},
    {label:copy(l,"Readings saved","Գրանցված չափումներ", "Сохранённые измерения"),value:String(summary.count),detail:copy(l,"In the last 7 days","Վերջին 7 օրում", "За последние 7 дней"),unit:""},
    {label:copy(l,"Medicine today","Այսօրվա դեղերը", "Лекарства сегодня"),value:doses.length ? `${taken}/${doses.length}` : "–",detail:copy(l,"Self-reported doses","Ձեր նշած ընդունումները", "Приём по вашим отметкам"),unit:""},
  ];
  return <section className="journey-card space-y-4">
    <header className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-body1 font-semibold">{copy(l,"This week","Այս շաբաթը", "На этой неделе")}</h2><CareLink href="/patient/progress" icon={ChartNoAxesCombined}>{copy(l,"Progress","Առաջընթաց", "Динамика")}</CareLink></header>
    <div className="grid grid-cols-2 gap-2">{tiles.map(tile => <div key={tile.label} className="min-w-0 rounded-xl bg-muted/70 p-3">
      <p className="text-caption font-medium text-muted-foreground">{tile.label}</p>
      <p className="mt-2 break-words font-display text-2xl font-extrabold tabular-nums text-brand-navy">{tile.value} {tile.unit && <span className="text-[10px] font-normal text-muted-foreground">{tile.unit}</span>}</p>
      <p className="mt-1 text-caption text-muted-foreground">{tile.detail}</p>
    </div>)}</div>
    <p className="text-caption text-muted-foreground">{copy(l,"Recorded values, not a diagnosis. Your doctor sets your treatment goals.","Գրանցված արժեքներ, ոչ ախտորոշում։ Բուժման նպատակները սահմանում է ձեր բժիշկը։", "Это записанные значения, а не диагноз. Цели лечения определяет ваш врач.")}</p>
    <CareLink href="/patient/measurements" icon={History}>{copy(l,"Measurement history","Չափումների պատմություն", "История измерений")}</CareLink>
  </section>;
}
export function FutureHabits({ locale: l }: { locale: PatientLocale }) {
  return (
    <>
      <FutureFeature
        locale={l}
        title={copy(l, "Walking this week", "Այս շաբաթվա քայլքը", "Прогулки на этой неделе")}
        detail={copy(
          l,
          "Your walking minutes and weekly goal will appear here. No activity is tracked yet.",
          "Այստեղ կհայտնվեն քայլքի րոպեներն ու շաբաթական նպատակը։ Ակտիվությունը դեռ չի գրանցվում։", "Здесь появятся минуты прогулок и цель на неделю. Активность пока не отслеживается.",
        )}
        action={copy(l, "Log a walk", "Գրանցել քայլքը", "Записать прогулку")}
      />
      <FutureFeature
        locale={l}
        title={copy(l, "One small goal", "Մեկ փոքր նպատակ", "Одна небольшая цель")}
        detail={copy(
          l,
          "A goal you choose together with your care team, with room to change or pause it.",
          "Նպատակ՝ ընտրված խնամքի թիմի հետ, փոխելու կամ դադարեցնելու հնարավորությամբ։", "Цель, которую вы выбираете вместе с медицинской командой, с возможностью изменить её или сделать паузу.",
        )}
        action={copy(l, "Choose my goal", "Ընտրել իմ նպատակը", "Выбрать мою цель")}
      />
    </>
  );
}
export function JourneyTimeline({
  care,
  complete,
  locale: l,
}: {
  care: CareData;
  complete: boolean;
  locale: PatientLocale;
}) {
  const steps = [
    { name: copy(l, "Get started", "Սկսել", "Начать"), done: complete },
    { name: copy(l, "Doctor decides", "Բժշկի որոշում", "Решение врача"), done: !!care.plan },
    { name: care.plan || care.appointments.length ? copy(l, "View visits", "Դիտել այցերը", "Посмотреть визиты") : copy(l, "View care", "Դիտել խնամքը", "Посмотреть лечение"), icon: CalendarDays, href: care.plan || care.appointments.length ? "/patient/care#appointments" : "/patient/care" },
    { name: copy(l, "Check-ins", "Գրառումներ", "Отметки"), icon: Bell, href: "/patient/progress?section=habits" },
  ];
  return (
    <CareSection title={copy(l, "My journey", "Իմ ուղին", "Мой путь")}>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {steps.map((s, i) => (
          <div
            key={s.name}
            className="flex flex-1 flex-col items-center gap-2 text-center"
          >
            {s.href ? <CareLink href={s.href} icon={s.icon}>{s.name}</CareLink> : <>
            <span
              className={`flex size-9 items-center justify-center rounded-full border-2 text-body2 font-bold ${s.done ? "border-brand-teal bg-brand-teal text-on-inverse" : "border-border bg-card text-muted-foreground"}`}
            >
              {s.done ? <Check className="size-4" aria-hidden /> : i + 1}
            </span>
            <span className="text-caption">{s.name}</span>
            <span className="sr-only">{s.done ? copy(l, "Completed", "Ավարտված", "Завершено") : copy(l, "Not completed", "Չավարտված", "Не завершено")}</span>
            </>}
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-muted p-3 text-body2">
        <strong>
          {care.plan
            ? copy(l, "Your plan is published", "Ձեր պլանը հրապարակված է", "Ваш план опубликован")
            : copy(l, "Your next steps", "Ձեր հաջորդ քայլերը", "Ваши следующие шаги")}
        </strong>
        <p className="mt-1 text-muted-foreground">
          {care.plan
            ? copy(
                l,
                "Your doctor plans follow-up. Keep recording readings and medicine check-ins.",
                "Ձեր բժիշկը պլանավորում է հետագա խնամքը։ Շարունակեք գրանցել չափումներն ու դեղերի ընդունումը։", "Ваш врач планирует дальнейшее наблюдение. Продолжайте записывать измерения и отмечать приём лекарств.",
              )
            : copy(
                l,
                "Your doctor plans follow-up. You can record blood pressure readings at any time.",
                "Ձեր բժիշկը պլանավորում է հետագա խնամքը։ Կարող եք ցանկացած պահի գրանցել ճնշման չափումները։", "Ваш врач планирует дальнейшее наблюдение. Вы можете записывать измерения артериального давления в любое время.",
              )}
        </p>
      </div>
      {care.plan && <p className="text-caption text-muted-foreground">{copy(l, "Follow your current plan until a new one is published.", "Հետևեք գործող պլանին մինչև նորի հրապարակումը։", "Следуйте текущему плану, пока не опубликован новый.")}</p>}
      <CareLink href="/patient/care">
        {care.plan ? copy(l, "View my care plan", "Տեսնել իմ խնամքի պլանը", "Посмотреть мой план лечения") : copy(l, "Open my care", "Բացել իմ խնամքը", "Открыть моё лечение")}
      </CareLink>
    </CareSection>
  );
}
export { ZoeCard };

export function PressureSummary({
  measurements,
  locale: l,
  now,
}: {
  measurements: Measurement[];
  locale: PatientLocale;
  now: Date;
}) {
  const summary = measurementOverview(measurements, now),
    latest = measurements
      .filter((r) => Date.parse(r.measuredAt) <= now.getTime())
      .toSorted(
        (a, b) => Date.parse(b.measuredAt) - Date.parse(a.measuredAt),
      )[0];
  return (
    <section className="journey-card">
      <div className="journey-values">
        <div>
          <strong>
            {latest ? `${latest.systolic}/${latest.diastolic}` : "–"}
          </strong>
          <small>{copy(l, "Latest, mmHg", "Վերջինը, mmHg", "Последнее, мм рт. ст.")}</small>
        </div>
        <div>
          <strong>
            {summary.average
              ? `${summary.average.systolic}/${summary.average.diastolic}`
              : "–"}
          </strong>
          <small>{copy(l, "7-day average", "7 օրվա միջինը", "Среднее за 7 дней")}</small>
        </div>
        <div>
          <strong>–</strong>
          <small>{copy(l, "Target: coming soon", "Թիրախը՝ շուտով", "Целевое значение: скоро")}</small>
        </div>
      </div>
      {[
        ["systolic", copy(l, "Upper (systolic)", "Վերին (սիստոլիկ)", "Верхнее (систолическое)")],
        ["diastolic", copy(l, "Lower (diastolic)", "Ստորին (դիաստոլիկ)", "Нижнее (диастолическое)")],
      ].map(([key, label]) => (
        <div key={key}>
          <div className="flex items-center justify-between text-caption">
            <span>{label}</span>
            <strong>
              {summary.average?.[key as "systolic" | "diastolic"] ?? "–"}
            </strong>
          </div>
        </div>
      ))}
      <p className="text-caption text-muted-foreground">
        {copy(
          l,
          "Recorded averages, not clinical categories. Your doctor sets your treatment goals.",
          "Գրանցված միջին արժեքներ, ոչ ախտորոշում։ Բուժման նպատակները սահմանում է ձեր բժիշկը։", "Это средние значения записанных измерений, а не клинические категории. Цели лечения определяет ваш врач.",
        )}
      </p>
    </section>
  );
}
