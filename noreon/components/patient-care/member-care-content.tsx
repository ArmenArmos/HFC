import { MemberScreen, MemberCareSections } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { LdlGoalCard } from "@/components/patient-care/ldl-goal-card";
import { memberLdl } from "@/lib/ldl/member";
import Link from "next/link";
import { Bell, BookOpen, CalendarDays, Clock3, History, MessageCircle, Pill, Users } from "lucide-react";
import { MemberMonitoring } from "@/components/patient-care/member-monitoring";
import { CareHistory } from "@/components/patient-care/care-history";
import { reportsEnabled } from "@/lib/reports/enabled";
import { HistoricalReminder } from "@/components/service-workflow/client";
import { MemberPageFrame } from "@/components/patient-care/member-page-frame";
import { carePageData } from "@/lib/patient-care/repository";
import { dosesForDay, appointmentIsCurrent } from "@/lib/patient-care/model";
import { RowLink, copy, stamp } from "@/components/patient-care/common";
import { MedicinesLink } from "@/components/member-medicines/home-card";
import {
  CareRefresh,
  DoseButtons,
  PlanAcknowledgement,
} from "@/components/patient-care/controls";
import {
  ApprovedPlan,
  PlanApproval,
  MedicationSchedule,
  CareAppointments,
  CareAvailability,
} from "@/components/patient-care/care-layout";
import { CareSections } from "@/components/patient-care/care-sections";
import { createClient } from "@/lib/supabase/server";
import { doctorCompletionEnabled } from "@/lib/doctor-completion/config";
import { readMemberPlanVersions, type DocumentRpc } from "@/lib/doctor-completion/document-runtime";
import { multiMedicineEnabled } from "@/lib/patient-care/regimen-config";
import { readMemberRegimens } from "@/lib/patient-care/regimen-runtime";
import { lessonsShowDrafts, visibleLessons } from "@/lib/lessons/catalogue";

function ruCount(n: number, one: string, few: string, many: string) {
  const form = new Intl.PluralRules("ru").select(n);
  return form === "one" ? one : form === "few" ? few : many;
}

export default async function Care({ searchParams = Promise.resolve({}), embedded = false }: { searchParams?: Promise<{ view?: string }>; embedded?: boolean } = {}) {
  const prototype = embedded || memberScreensPrototypeEnabled() && (await searchParams).view !== "classic";
  const Sections = prototype ? MemberCareSections : CareSections;
  const { profile, assessment, care } = await carePageData(),
    l = profile.locale,
    now = new Date(),
    plan = care.plan;
  const doses = dosesForDay(care, now);
  const activeMedicines = plan?.medications.filter(m => m.active).length ?? 0;
  const upcomingVisits = care.appointments.filter(a => appointmentIsCurrent(a, now)).length;
  // Existing feature gates still control version notes and regimen changes.
  const [versions, regimens, ldl] = await Promise.all([
    plan && doctorCompletionEnabled() ? createClient().then(client => readMemberPlanVersions(client as unknown as DocumentRpc)) : null,
    plan && multiMedicineEnabled() ? createClient().then(client => readMemberRegimens(client as never)).catch(() => null) : null,
    // Optional goal data must not make the published prescription unavailable.
    prototype && plan ? memberLdl().catch(() => undefined) : undefined,
  ]);
  const currentVersion = versions?.find(v => v.planId === plan?.id) ?? null;
  const medicineChanges = regimens?.find(v => v.planId === plan?.id)?.changes;
  return (
    <MemberPageFrame embedded={embedded} kind="care" locale={l}>
      {!embedded && <CareRefresh />}
      <MemberScreen enabled={prototype && !embedded} locale={l} classicHref={"/patient/care?view=classic"}>
      <div className="space-y-4 sm:space-y-5">
        <header>
          <h1 className="text-h1">
            {copy(l, plan ? "My care plan" : "My care", plan ? "Իմ խնամքի պլանը" : "Իմ խնամքը", plan ? "Мой план лечения" : "Моё лечение")}
          </h1>
          {!plan && <p className="mt-1 text-body2 text-muted-foreground">
            {copy(l, "Your care information and next step.", "Ձեր խնամքի տեղեկություններն ու հաջորդ քայլը։", "Информация о вашем лечении и следующий шаг.")}
          </p>}
        </header>
        {plan && <PlanApproval plan={plan} pendingReview={!!care.pendingReview} locale={l} />}
        <Sections locale={l} plan={<>
        <ApprovedPlan
          plan={plan}
          locale={l}
          version={currentVersion}
          medicineChanges={medicineChanges}
          summary={plan && (activeMedicines > 0 || doses.length > 0 || upcomingVisits > 0) ? <>
            {activeMedicines > 0 && <span className="inline-flex items-center gap-1.5"><Pill className="size-3.5 shrink-0" aria-hidden />{activeMedicines} {copy(l, activeMedicines === 1 ? "active medicine" : "active medicines", "ակտիվ դեղեր", ruCount(activeMedicines, "принимаемое лекарство", "принимаемых лекарства", "принимаемых лекарств"))}</span>}
            {doses.length > 0 && <>{activeMedicines > 0 && <span aria-hidden>·</span>}<span className="inline-flex items-center gap-1.5"><Clock3 className="size-3.5 shrink-0" aria-hidden />{doses.length} {copy(l, doses.length === 1 ? "dose today" : "doses today", "ընդունում այսօր", ruCount(doses.length, "доза сегодня", "дозы сегодня", "доз сегодня"))}</span></>}
            {upcomingVisits > 0 && <>{(activeMedicines > 0 || doses.length > 0) && <span aria-hidden>·</span>}<span className="inline-flex items-center gap-1.5"><CalendarDays className="size-3.5 shrink-0" aria-hidden />{upcomingVisits} {copy(l, upcomingVisits === 1 ? "upcoming visit" : "upcoming visits", "առաջիկա այցեր", ruCount(upcomingVisits, "предстоящий визит", "предстоящих визита", "предстоящих визитов"))}</span></>}
          </> : null}
          readAction={
            plan &&
            (plan.acknowledged || plan.acknowledgedAt ? (
              <p className="rounded-lg bg-surface-subtle-teal p-3 text-caption text-foreground">
                {copy(
                  l,
                  "You marked this plan as read",
                  "Դուք նշել եք պլանը որպես կարդացված",
                  "Этот план отмечен вами как прочитанный",
                )}{" "}
                ·{" "}
                {plan.acknowledgedAt
                  ? stamp(plan.acknowledgedAt, l)
                  : copy(l, "Date not recorded", "Ամսաթիվը գրանցված չէ", "Дата не записана")}
              </p>
            ) : (
              <PlanAcknowledgement planId={plan.id} locale={l} />
            ))
          }
        />
        {prototype && ldl?.enabled && ldl.inPathway && <div className="ms-goal"><LdlGoalCard prototype data={ldl} locale={l} /></div>}
        {!plan && <Link href={assessment.completedAt ? "/patient/dashboard" : "/patient/questions"} className="inline-flex min-h-11 max-w-full w-full items-center justify-center whitespace-normal break-words rounded-md bg-primary px-4 py-3 text-body2 font-semibold text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto">
          {assessment.completedAt ? copy(l,"See your next step","Դիտել հաջորդ քայլը","Посмотреть следующий шаг") : copy(l,"Continue health questions","Շարունակել առողջության հարցերը","Продолжить отвечать на вопросы о здоровье")}
        </Link>}

        {!!care.monitoring?.length && <MemberMonitoring requirements={care.monitoring} locale={l} now={now.getTime()} />}
        </>} medicines={<>
          <MedicationSchedule doses={doses} plan={plan} locale={l} doseAction={(d) => <DoseButtons dose={d} locale={l} compact />} />
          <section id="reminders" className="scroll-mt-24 rounded-2xl border border-border/70 bg-card p-2 sm:p-3">
            <MedicinesLink locale={l} />
            <RowLink href="/patient/account/reminders" icon={Bell} detail={copy(l, "Shown in the app only. Phone, SMS and push reminders are not enabled.", "Միայն հավելվածում։ Հեռախոսի, SMS և push հիշեցումները միացված չեն։", "Показываются только в приложении. Напоминания по телефону, SMS и push-уведомления отключены.")}>
              {copy(l, "Reminder times", "Հիշեցումների ժամերը", "Время напоминаний")}
            </RowLink>
          </section>
        </>} visits={<>
          <section className="rounded-2xl border border-border/70 bg-card p-2 sm:p-3">
            <RowLink href="/patient/service" icon={CalendarDays} narrowIconAbove detail={copy(l, "Requests, provider proposals and accepted times.", "Հարցումներ, առաջարկներ և հաստատված ժամեր։", "Запросы, предложения от исполнителей и подтверждённое время.")}>
              {copy(l, "Tests and bookings", "Հետազոտություններ և ամրագրումներ", "Анализы и запись")}
            </RowLink>
          </section>
          <CareAppointments appointments={care.appointments} locale={l} now={now} clinicianOnly />
        </>} />
        <section className="rounded-2xl border border-border/70 bg-card p-2 sm:p-3">
          <RowLink href="/patient/review" icon={History}>{copy(l, "Previous plans and sources", "Նախկին պլաններն ու աղբյուրները", "Предыдущие планы и источники")}</RowLink>
          <RowLink href="/patient/team" icon={Users}>{copy(l, "Your care team", "Ձեր խնամքի թիմը", "Ваша медицинская команда")}</RowLink>
          <RowLink href="/patient/zoe" icon={MessageCircle}>{copy(l, "Message your care team", "Գրել խնամքի թիմին", "Написать медицинской команде")}</RowLink>
          {visibleLessons(lessonsShowDrafts()).length > 0 && <RowLink href="/patient/learn" icon={BookOpen} detail={copy(l, "Short reads on blood pressure, sugar, cholesterol and medicines.", "Կարճ նյութեր ճնշման, շաքարի, խոլեստերինի և դեղերի մասին։", "Короткие материалы о давлении, глюкозе, холестерине и лекарствах.")}>{copy(l, "One-minute lessons", "Մեկ րոպեանոց դասեր", "Уроки на одну минуту")}</RowLink>}
        </section>
        <div id="care-history" className="scroll-mt-6"><CareHistory care={care} locale={l} audience="member" /></div>
        <CareAvailability locale={l} />
        <HistoricalReminder locale={l} uploadAvailable={reportsEnabled()} />
      </div>
    </MemberScreen>
    </MemberPageFrame>
  );
}
