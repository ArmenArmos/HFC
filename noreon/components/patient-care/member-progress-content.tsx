import { MemberScreen, MemberCharts } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { HabitsProgress } from "@/components/patient-care/habits-progress";
import { medicineReportDays } from "@/lib/patient-care/journey-evidence";
import { ProgressRings } from "@/components/patient-care/progress-rings";
import { measurementOverview } from "@/lib/patient-care/overview";
import { dosesForDay } from "@/lib/patient-care/model";
import { patientPresentation } from "@/lib/patient/presentation";
import { MemberPageFrame } from "@/components/patient-care/member-page-frame";
import { ProgressNavigation } from "@/components/patient-care/progress-navigation";
import {
  JourneyTimeline,
} from "@/components/patient-care/journey-overview";
import { History } from "lucide-react";
import { CareLink, CareSection, RowLink, copy } from "@/components/patient-care/common";
import { CareRefresh } from "@/components/patient-care/controls";
import { carePageData } from "@/lib/patient-care/repository";
import { dailyReminders } from "@/lib/patient-care/reminders";
import { ProgressCharts } from "@/components/member-history/progress-charts";
import { chartSeries } from "@/lib/member-history/measures";
import { readOwnHistory } from "@/lib/member-history/server";
import { FilePlus2 } from "lucide-react";
import { memberProgramme } from "@/lib/programme/member";
import { ProgrammeJourneyCard, ProgrammeTimeline } from "@/components/patient/programme-timeline";
import { submitProgrammeCheckin } from "@/lib/programme/actions";
import { getMemberLabStages } from "@/lib/patient-care/lab-stage-repository";
import { getMemberBookingData } from "@/lib/real-booking/repository";
import { memberLabSummary } from "@/lib/staff/lab-stage-schema";
import { journeyStripInput } from "@/lib/patient-care/journey-strip";
import { readJourneyExtras } from "@/lib/patient-care/journey-reads";
import { LdlGoalCard } from "@/components/patient-care/ldl-goal-card";
import { memberLdl } from "@/lib/ldl/member";
export default async function ProgressPage({
  searchParams, embedded = false,
}: {
  embedded?: boolean;
  searchParams: Promise<{ section?: string; view?: string }>;
}) {
  const params = await searchParams;
  const prototype = embedded || memberScreensPrototypeEnabled() && params.view !== "classic";
  const data = await carePageData();
  const l = data.profile.locale,
    now = new Date();
  const { urgent, showRoutine } = patientPresentation(data.assessment);
  const summary = measurementOverview(data.chartMeasurements, now),
    doses = dosesForDay(data.care, now);
  const active =
    params.section === "habits" ? "habits" : "overview";
  const [history, ldl] = active === "overview" && !urgent ? await Promise.all([readOwnHistory(), memberLdl()]) : [null, undefined];
  // Programme rhythm (dark, database switch): replaces the four-step journey when on.
  // Lab and booking state are read only when the programme is on.
  const programme = !urgent && active === "overview"
    ? await memberProgramme(async () => {
        const [labSamples, bookings, extras] = await Promise.all([getMemberLabStages(), getMemberBookingData({ summaryOnly: true }).catch(() => null), readJourneyExtras()]);
        // The same stage input as Home (QA 177).
        const journey = journeyStripInput({
          questionnaireComplete: !!data.assessment.completedAt,
          lab: labSamples ? memberLabSummary(labSamples) : undefined,
          planPublished: !!data.care.plan,
          requests: bookings?.requests,
          appointments: bookings?.pilot?.appointments,
          ...extras,
        });
        return {
          questionnaireComplete: !!data.assessment.completedAt,
          lab: journey.lab,
          nurseSamplesTaken: journey.nurseSamplesTaken,
          visitDone: journey.visitDone,
          testsArranged: !!bookings && ((bookings.pilot?.appointments.length ?? 0) > 0 || bookings.requests.length > 0),
          planPublishedAt: data.care.plan?.publishedAt ?? null,
        };
      })
    : null;
  const series = history ? chartSeries(history.values, history.clinic, data.measurements) : null;
  return (
    <MemberPageFrame embedded={embedded} kind="progress" locale={l}>
      {!embedded && <CareRefresh />}
      <MemberScreen enabled={prototype && !embedded} locale={l} classicHref={active === "habits" ? "/patient/progress?view=classic&section=habits" : "/patient/progress?view=classic"}>
      <div className="space-y-6">
        <header className="space-y-2">
          <h1 className="text-h1">{copy(l, "My progress", "Իմ առաջընթացը", "Мой прогресс")}</h1>
          {active === "overview" && <p className="text-body2 text-muted-foreground">
            {copy(
              l,
              "How your numbers and habits are changing.",
              "Ձեր գրանցված չափումները, արդյունքներն ու առօրյան՝ մեկ տեղում։",
              "Как меняются ваши показатели и привычки.",
            )}
          </p>}
        </header>
        {!embedded && <ProgressNavigation locale={l} active={active} />}
        {urgent ? (
          <CareSection
            title={copy(l, "Get urgent help", "Ստացեք շտապ օգնություն", "Получите срочную помощь")}
          >
            <p role="alert" className="text-body1">
              {copy(
                l,
                "Your answers indicate an urgent concern. Follow the urgent guidance before continuing your routine.",
                "Ձեր պատասխանները վկայում են հրատապ խնդրի մասին։ Նախ հետևեք շտապ օգնության ցուցումներին։",
                "Ваши ответы указывают на срочную проблему. Следуйте указаниям по срочной помощи, прежде чем возвращаться к обычным делам.",
              )}
            </p>
            <CareLink href="/patient/urgent">
              {copy(
                l,
                "Open urgent guidance",
                "Բացել շտապ օգնության ցուցումները",
                "Открыть указания по срочной помощи",
              )}
            </CareLink>
          </CareSection>
        ) : active === "overview" ? (
          <>
            {prototype && ldl?.enabled && ldl.inPathway && <div className="ms-goal"><LdlGoalCard prototype data={ldl} locale={l} /></div>}
            <ProgressRings
              locale={l}
              readings={summary.count}
              days={summary.days}
              taken={doses.filter((d) => d.status === "taken").length}
              doses={doses.length}
              nextDoseAt={doses.find(dose => dose.status === "upcoming")?.dueAt}
            />
            {programme && <ProgrammeJourneyCard stages={programme.stages} locale={l} />}
            {!prototype && <LdlGoalCard data={ldl} locale={l} />}
            {(
              <section aria-labelledby="numbers-over-time" className="space-y-4">
                <header className="space-y-1">
                  <h2 id="numbers-over-time" className="text-h2">{copy(l, "Your numbers over time", "Ձեր թվերը՝ ըստ ժամանակի", "Ваши показатели со временем")}</h2>
                  <p className="text-body2 text-muted-foreground">
                    {copy(l, "Values measured at the clinic and values you added yourself are drawn differently. The charts only show your numbers; they are not an assessment.", "Կլինիկայում չափված և ձեր ավելացրած արժեքները ցույց են տրվում տարբեր կերպ։ Գրաֆիկները միայն ցույց են տալիս ձեր թվերը և գնահատական չեն։", "Показатели, измеренные в клинике, и добавленные вами значения отображаются по-разному. Графики показывают только ваши показатели и не являются оценкой состояния здоровья.")}
                  </p>
                </header>
                {!history ? (
                  <p role="status" className="text-body2">{copy(l, "Charts are unavailable right now. Reload to try again.", "Գրաֆիկներն այս պահին անհասանելի են։ Թարմացրեք էջը՝ կրկին փորձելու համար։", "Графики сейчас недоступны. Обновите страницу, чтобы попробовать снова.")}</p>
                ) : series && Object.values(series).some((points) => points.length) ? (
                  <MemberCharts enabled={prototype} locale={l}><ProgressCharts series={series} locale={l} /></MemberCharts>
                ) : (
                  <p className="text-body2 text-muted-foreground">{copy(l, "No numbers yet. Add earlier results to see them here.", "Թվեր դեռ չկան։ Ավելացրեք նախկին արդյունքները՝ դրանք այստեղ տեսնելու համար։", "Показателей пока нет. Добавьте предыдущие результаты, чтобы увидеть их здесь.")}</p>
                )}
                <CareLink href="/patient/progress/earlier" icon={FilePlus2}>{copy(l, "Add earlier results", "Ավելացնել նախկին արդյունքներ", "Добавить предыдущие результаты")}</CareLink>
              </section>
            )}
            {programme ? (
              <ProgrammeTimeline stages={programme.stages} schedulePending={programme.schedulePending} locale={l} submit={submitProgrammeCheckin} />
            ) : (
              <JourneyTimeline
                care={data.care}
                complete={!!data.assessment.completedAt}
                locale={l}
              />
            )}
            {!!(data.care.planHistory?.length || data.care.medicationHistory?.length || data.care.events.length || data.care.doseHistory?.length) && <section className="journey-card"><RowLink href="/patient/care#care-history" icon={History}>{copy(l,"Care history","Խնամքի պատմություն", "История лечения")}</RowLink></section>}
          </>
        ) : (
          <>
            {showRoutine ? (
              <HabitsProgress
                days={medicineReportDays([...data.care.events, ...(data.care.doseHistory ?? [])], now, data.care)}
                occurrences={dailyReminders(
                  data.care,
                  data.measurements,
                  data.reminders.preferences,
                  now,
                )}
                locale={l}
                hasPlan={!!data.care.plan}
              />
            ) : (
              <CareSection
                title={copy(
                  l,
                  "Finish your health questions",
                  "Ավարտեք առողջության հարցերը",
                  "Заполните анкету о здоровье",
                )}
              >
                <CareLink href="/patient/questions">
                  {copy(
                    l,
                    "Continue health questions",
                    "Շարունակել առողջության հարցերը",
                    "Продолжить анкету о здоровье",
                  )}
                </CareLink>
              </CareSection>
            )}
          </>
        )}
      </div>
    </MemberScreen>
    </MemberPageFrame>
  );
}
