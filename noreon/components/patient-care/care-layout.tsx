import {isTextUsableInLocale,memberInstruction} from "@/lib/text-language";
import Link from "next/link";
import {NEXT_STEP} from "@/lib/zoe-chat-actions/next-step-copy";
import {memberDoctorLabel} from "@/lib/member-staff-name.mjs";
import type { ReactNode } from "react";
import { ShieldCheck, CalendarDays, Pill, Clock3, Info, ChevronDown } from "lucide-react";
import type {
  CarePlan,
  CareAppointment,
  DueDose,
  Medication,
} from "@/lib/patient-care/types";
import type { PatientLocale } from "@/lib/patient/copy";
import { appointmentIsCurrent } from "@/lib/patient-care/model";
import { formatMemberDate } from "@/lib/patient/date-format";
import { copy, stamp, Status, IconTile } from "./common";
import { RegimenChanges } from "./regimen-changes";
import type { RegimenChange } from "@/lib/patient-care/regimen";

export function PlanApproval({ plan, pendingReview, locale: l }: {
  plan: CarePlan;
  pendingReview: boolean;
  locale: PatientLocale;
}) {
  return <div className="border-b border-border pb-2">
    <details className="group">
      <summary className="flex min-h-11 cursor-pointer list-none flex-wrap items-center gap-x-2 gap-y-1 rounded-lg py-2 text-body2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="size-5 shrink-0 text-brand-teal" aria-hidden />
        <span className="min-w-0 break-words font-semibold">{copy(l, "Approved by your doctor", "Հաստատված է ձեր բժշկի կողմից", "Утверждено вашим врачом")}</span>
        <span className="min-w-0 break-words text-caption text-muted-foreground">{stamp(plan.publishedAt, l, false)}</span>
        <ChevronDown className="ml-auto size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <dl className="grid gap-2 pb-3 text-body2 sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
        <dt className="text-muted-foreground">{copy(l, "Published by", "Հրապարակել է", "Кто опубликовал")}</dt>
        <dd className="min-w-0 break-words">{memberDoctorLabel(plan.clinician,l)}</dd>
        <dt className="text-muted-foreground">{copy(l, "Plan published", "Պլանը հրապարակված է", "План опубликован")}</dt>
        <dd className="min-w-0 break-words">{stamp(plan.publishedAt, l)}</dd>
      </dl>
    </details>
    {pendingReview && <p role="status" className="pb-2 text-body2 text-muted-foreground">{copy(l,
      "Review pending. Your approved plan remains in effect while new information is reviewed.",
      "Սպասում է վերանայման։ Ձեր հաստատված պլանը գործում է, մինչ նոր տեղեկությունը վերանայվում է։", "Ожидает проверки. Ваш утверждённый план продолжает действовать, пока новые сведения проверяются.",
    )}</p>}
  </div>;
}

export function ApprovedPlan({ plan, locale: l, readAction, summary, version, medicineChanges, embedded=false }: {
  plan: CarePlan | null;
  embedded?:boolean;
  locale: PatientLocale;
  readAction: ReactNode;
  summary?: ReactNode;
  version?: { version: number; changeSummary: string | null } | null;
  medicineChanges?: readonly RegimenChange[];
}) {
  const instructions = plan?.publishedReview?.instructions ?? plan?.instructions;
  const explanation = plan?.publishedReview?.explanation ?? plan?.explanation;
  const names = plan?.medications.map(m=>m.name) ?? [];
  const usable = [instructions, explanation, plan?.publishedReview?.followUp, version && version.version>1 ? version.changeSummary : null, ...(plan?.medications.map(m=>m.instructions) ?? [])]
    .every(text=>!text || isTextUsableInLocale(text,l,names));
  return <section id={embedded?undefined:"plan"} className={embedded?"min-w-0 space-y-3":"scroll-mt-24 rounded-2xl border border-border/70 bg-card p-4 sm:p-5"}>
    <h2 className="care-plan-heading text-h2">{plan ? copy(l, "Your instructions", "Ձեր ցուցումները", "Ваши инструкции") : copy(l, "Your care plan", "Ձեր խնամքի պլանը", "Ваш план лечения")}</h2>
    {plan ? <>
      {summary && <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-caption text-muted-foreground">{summary}</div>}
      {version && version.version > 1 && version.changeSummary && <section className="mt-4 rounded-xl border border-border/70 bg-muted/40 p-4">
        <h3 className="text-body2 font-semibold">{copy(l, `What changed in version ${version.version}`, `Ինչ է փոխվել ${version.version}-րդ տարբերակում`, `Что изменилось в версии ${version.version}`)}</h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-body2">{memberInstruction(version.changeSummary, l, names)}</p>
      </section>}
      {!!medicineChanges?.length && <section className="mt-4 space-y-2 rounded-xl border border-border/70 bg-muted/40 p-4">
        <h3 className="text-body2 font-semibold">{copy(l, "Changes to your medicines", "Ձեր դեղերի փոփոխությունները", "Изменения в ваших лекарствах")}</h3>
        <RegimenChanges changes={medicineChanges} locale={l} />
      </section>}
      <p className="mt-4 whitespace-pre-wrap break-words text-body2">{memberInstruction(instructions ?? "", l, names)}</p>
      {plan.publishedReview?.followUp && <section className="mt-4 border-t pt-4">
        <h3 className="text-body2 font-semibold">{copy(l, "Your follow-up", "Ձեր հետագա քայլերը", "Ваши дальнейшие шаги")}</h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-body2">{memberInstruction(plan.publishedReview.followUp, l, names)}</p>
      </section>}
      <div className="mt-5 [&_button]:h-auto [&_button]:min-h-12 [&_button]:max-w-full [&_button]:whitespace-normal [&_button]:break-words [&_button:first-child]:w-full">{usable?readAction:<Link href="/patient/team?section=contact" className="text-body2 font-semibold underline">{NEXT_STEP.careTeam[l]}</Link>}</div>
      {explanation && <details className="group mt-4 border-t pt-2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-2 text-body2 font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
          <span>{copy(l, "Why this plan", "Ինչու է այս պլանը", "Почему выбран этот план")}</span><ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <h3 className="mt-2 text-body2 font-semibold">{copy(l, "Your doctor’s explanation", "Ձեր բժշկի բացատրությունը", "Объяснение вашего врача")}</h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-body2">{memberInstruction(explanation, l, names)}</p>
      </details>}
    </> : <p className="mt-3 text-body2 text-muted-foreground">{copy(l,
      "No clinician-approved plan has been published. Your instructions will appear here when they are recorded.",
      "Բժշկի հաստատած պլան դեռ հրապարակված չէ։ Ցուցումները կհայտնվեն այստեղ, երբ գրանցվեն։", "План, утверждённый врачом, ещё не опубликован. Ваши инструкции появятся здесь после записи.",
    )}</p>}
  </section>;
}
/** Keep separate published orders separate even when a source reuses an id. */
function orderIdentity(m: Medication) {
  return JSON.stringify([m.planId, m.originatingPlanId, m.effectiveAt, m.id, m.name, m.dose, m.instructions, m.times, m.startDate, m.endDate, m.active]);
}
export function MedicationSchedule({
  doses,
  plan,
  locale: l,
  doseAction,
  ordersOnly=false,
  embedded=false,
}: {
  doses: DueDose[];
  plan: CarePlan | null;
  locale: PatientLocale;
  doseAction: (dose: DueDose) => ReactNode;
  ordersOnly?:boolean;
  embedded?:boolean;
}) {
  const medicines = plan?.medications ?? [];
  return (
    <section id={embedded?undefined:"medicines"} className={embedded?"min-w-0 space-y-3":"scroll-mt-24 rounded-2xl border border-border/70 bg-card p-4 sm:p-5"}>
      <header className="flex items-center gap-3">
        <IconTile icon={Pill} />
        <div><h2 className="text-h2">{copy(l, "Your medicines", "Ձեր դեղերը", "Ваши лекарства")}</h2>
          {medicines.length > 0 && <p className="mt-1 text-caption text-muted-foreground">{copy(l, "Times in Armenia (UTC+4)", "Ժամերը՝ Հայաստանի ժամանակով (UTC+4)", "Время указано по Армении (UTC+4)")}</p>}
        </div>
      </header>
      <div className="mt-4 divide-y divide-border">
        {medicines.map(m => {
          const today = doses.filter(d => orderIdentity(d.medication) === orderIdentity(m));
          return <article key={orderIdentity(m)} className="min-w-0 py-4 first:pt-0 last:pb-0">
            <div className="space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0"><h3 className="break-words text-body1 font-semibold">{m.name}</h3><p className="mt-1 text-body2 text-muted-foreground">{m.dose}</p></div>
                <Status tone={m.active ? "complete" : "neutral"}>{m.active ? copy(l, "Current medicine", "Ընթացիկ դեղ", "Текущее лекарство") : copy(l, "Stopped", "Դադարեցված", "Отменено")}</Status>
              </div>
              <div className="flex flex-wrap gap-2">{m.times.map(time => <span key={time} className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-caption font-semibold tabular-nums"><Clock3 size={13} aria-hidden />{time}</span>)}</div>
              <p className="text-caption text-muted-foreground">{copy(l, "From", "Սկսած", "С")} {stamp(m.startDate + "T00:00:00+04:00", l, false)}{m.endDate ? ` · ${copy(l, "Through", "Մինչև", "По")} ${stamp(m.endDate + "T00:00:00+04:00", l, false)}` : ""}</p>
              {m.instructions.trim() && <div className="space-y-2">
                <h4 className="flex items-start gap-1.5 text-caption font-semibold"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{copy(l, "How to take it", "Ինչպես ընդունել", "Как принимать")}</h4>
                <p className="whitespace-pre-wrap break-words text-body2">{memberInstruction(m.instructions, l, [m.name])}</p>
              </div>}
            </div>
            {!!today.length && <div className="mt-3 border-t">
              <h4 className="pt-3 text-caption font-semibold">{copy(l, "Today’s check-ins", "Այսօրվա գրառումները", "Сегодняшние записи")}</h4>
              <div className="divide-y">{today.map(d => <div key={d.dueAt} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="flex flex-wrap items-center gap-2"><p className="text-body2 font-semibold tabular-nums">{formatMemberDate(d.dueAt, l, {timeZone: "Asia/Yerevan", hour: "2-digit", minute: "2-digit", hour12: false})}</p>
                  {(d.status === "taken" || d.status === "skipped") && <Status tone={d.status === "taken" ? "complete" : "neutral"}>{d.status === "taken" ? copy(l, "Reported taken", "Գրանցված է՝ ընդունված", "Отмечено: принято") : copy(l, "Reported skipped", "Գրանցված է՝ բաց թողնված", "Отмечено: пропущено")}</Status>}
                </div>
                <div className="min-w-0 max-w-full">{doseAction(d)}</div>
              </div>)}</div>
            </div>}
          </article>;
        })}
        {!ordersOnly&&!doses.length && <p className="text-body2 text-muted-foreground">{plan
          ? copy(l, "No active medication doses are scheduled for today in your published plan. This does not change any prescription you already have.", "Հրապարակված պլանում այսօրվա համար ակտիվ ընդունումներ նախատեսված չեն։ Սա չի փոխում ձեր առկա նշանակումը։", "В опубликованном плане на сегодня нет запланированных приёмов действующих лекарств. Это не меняет ваши действующие назначения.")
          : copy(l, "No medicines have been published in a care plan. This does not change any prescription you already have.", "Խնամքի պլանում դեղեր դեռ հրապարակված չեն։ Սա չի փոխում ձեր առկա նշանակումը։", "В плане лечения лекарства ещё не опубликованы. Это не меняет ваши действующие назначения.")}</p>}
      </div>
      {!ordersOnly&&medicines.length > 0 && <p className="mt-4 border-t pt-4 text-caption text-muted-foreground">{copy(l, "Check-ins record what you report; they are not proof of intake. Follow your prescription for any missed dose.", "Գրառումները ձեր հաղորդած տվյալներն են, ոչ թե ընդունման ապացույց։ Բաց թողնված ընդունման համար հետևեք նշանակման ցուցումներին։", "Записи отражают то, что вы сообщаете, и не подтверждают приём лекарства. Если вы пропустили приём, следуйте инструкциям в назначении.")}</p>}
    </section>
  );
}

function AppointmentRows({
  appointments,
  locale: l,
}: {
  appointments: CareAppointment[];
  locale: PatientLocale;
}) {
  return (
    <div className="divide-y">
      {appointments.map((a) => (
        <article
          key={a.id}
          className="grid gap-2 py-4 sm:grid-cols-[10rem_minmax(0,1fr)]"
        >
          <p className="text-body2 font-semibold tabular-nums">
            {a.startsAt
              ? stamp(a.startsAt, l)
              : copy(l, "Time not confirmed yet", "Ժամը դեռ հաստատված չէ", "Время ещё не подтверждено")}
          </p>
          <div className="min-w-0 space-y-1 break-words">
            <h3 className="text-body1 font-semibold">{a.specialty}</h3>
            <p className="text-body2 text-muted-foreground">
              {(a.clinician ? memberDoctorLabel(a.clinician,l) : null) ??
                copy(
                  l,
                  "Clinician not assigned yet",
                  "Բժիշկը դեռ նշանակված չէ", "Врач ещё не назначен",
                )}
            </p>
            <p className="text-caption text-muted-foreground">
              {a.location ? memberInstruction(a.location, l) :
                copy(l, "Location not confirmed yet", "Վայրը դեռ հաստատված չէ", "Место ещё не подтверждено")}
            </p>
            <Status tone={a.status === "completed" || a.status === "confirmed" ? "complete" : "neutral"}>
              {a.status === "confirmed"
                ? copy(l, "Confirmed", "Հաստատված", "Подтверждено")
                : a.status === "requested"
                  ? copy(
                      l,
                      "Requested, not confirmed",
                      "Հարցված է, հաստատված չէ", "Запрошено, не подтверждено",
                    )
                  : a.status === "completed"
                    ? copy(l, "Completed", "Ավարտված", "Завершено")
                    : copy(l, "Cancelled", "Չեղարկված", "Отменено")}
            </Status>
            {a.needsReview && (
              <p role="status" className="text-body2 text-muted-foreground">
                {copy(l,
                  "Your test requirements need review. Confirm the next step with your care team.",
                  "Ձեր հետազոտությունների ցանկը վերանայման կարիք ունի։ Հաջորդ քայլը հաստատեք ձեր բուժթիմի հետ։", "Список необходимых анализов нужно проверить. Уточните следующий шаг у вашей медицинской команды.",
                )}
              </p>
            )}
          </div>
        </article>
      ))}
    </div>
  );
}
export function CareAppointments({
  appointments,
  locale: l,
  now,
  clinicianOnly = false,
}: {
  appointments: CareAppointment[];
  locale: PatientLocale;
  now: Date;
  clinicianOnly?: boolean;
}) {
  const upcoming = appointments
    .filter(
      (a) => appointmentIsCurrent(a, now),
    )
    .sort(
      (a, b) =>
        (a.startsAt ? Date.parse(a.startsAt) : Infinity) -
        (b.startsAt ? Date.parse(b.startsAt) : Infinity),
    );
  const history = appointments.filter((a) => !upcoming.includes(a));
  return (
    <section
      id="appointments"
      className="scroll-mt-24 rounded-2xl border border-border/70 bg-card p-5 sm:p-6"
    >
      <div className="flex items-center gap-3">
<IconTile icon={CalendarDays} />
        <h2 className="text-h2">
          {clinicianOnly ? copy(l, "Clinician appointments", "Բժշկի այցերը", "Приёмы у врача") : copy(l, "Your appointments", "Ձեր այցերը", "Ваши визиты")}
        </h2>
      </div>
      {upcoming.length ? (
        <AppointmentRows appointments={upcoming} locale={l} />
      ) : (
        <p className="mt-3 text-body2 text-muted-foreground">
          {appointments.length
            ? copy(
                l,
                clinicianOnly ? "No upcoming clinician appointments recorded." : "No upcoming appointments recorded.",
                clinicianOnly ? "Բժշկի առաջիկա այցեր գրանցված չեն։" : "Առաջիկա այցեր գրանցված չեն։", clinicianOnly ? "Предстоящие приёмы у врача не записаны." : "Предстоящие визиты не записаны.",
              )
            : copy(
                l,
                clinicianOnly ? "No clinician appointments recorded." : "No appointments recorded. A confirmed visit will appear here with its time and location.",
                clinicianOnly ? "Բժշկի այցեր գրանցված չեն։" : "Այցեր գրանցված չեն։ Հաստատված այցը կհայտնվի ժամով և վայրով։", clinicianOnly ? "Приёмы у врача не записаны." : "Визиты не записаны. Подтверждённый визит появится здесь с указанием времени и места.",
              )}
        </p>
      )}
      {!!history.length && (
        <details className="group mt-3 border-t pt-3">
          <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg border border-border px-3 py-2 text-caption font-semibold text-foreground transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
            <span>{copy(
              l,
              "Past and cancelled appointments",
              "Նախկին և չեղարկված այցերը", "Прошедшие и отменённые визиты",
            )}{" "}
            · {history.length}</span><ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <AppointmentRows appointments={history} locale={l} />
        </details>
      )}
    </section>
  );
}
export function CareAvailability({ locale: l }: { locale: PatientLocale }) {
  return <p className="flex items-start gap-2 text-caption text-muted-foreground"><Info className="mt-0.5 size-4 shrink-0" aria-hidden />{copy(l, "Programme timeline, targets and Zoe’s explanation are not available yet. Only your doctor changes treatment.", "Ծրագրի ժամանակացույցը, թիրախներն ու Zoe-ի բացատրությունը դեռ հասանելի չեն։ Բուժումը փոխում է միայն բժիշկը։", "Расписание программы, цели и объяснения Zoe пока недоступны. Только ваш врач меняет лечение.")}</p>;
}
