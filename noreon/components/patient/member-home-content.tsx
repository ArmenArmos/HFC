import {isUnverifiedBp} from '@/lib/patient/bp-provenance';
import { HomeNotices } from "@/components/patient/home-notices";
import { MemberScreen } from "@/components/patient-care/member-screens";
import { HomeVisitDetail } from "@/components/patient-care/home-visit-detail";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { CalendarDays } from "lucide-react";
import { ExercisePauseNotice } from "@/components/patient-care/exercise-pause-notice";
import { MemberHome } from "@/components/patient/member-home";
import { memberHomeEnabled } from "@/lib/patient/member-home-config";
import {
  ComingUpNext,
  HomeHealthAndRhythm,
  HomeLifestyle,
  HomeCareAndTeam,
} from "@/components/patient-care/home-dashboard";
import { patientPresentation } from "@/lib/patient/presentation";
import {
  dailyReminders,
  nextReminderAction,
} from "@/lib/patient-care/reminders";
import { DailyRoutine } from "@/components/patient-care/daily-routine";
import { PatientShell } from "@/components/patient/patient-shell";
import { requirePatient } from "@/lib/patient/auth";
import { carePageData } from "@/lib/patient-care/repository";
import { careActions, armeniaDate } from "@/lib/patient-care/model";
import { NextSteps } from "@/components/patient-care/next-steps";
import { CareRefresh } from "@/components/patient-care/controls";
import { CareLink, RowLink, copy } from "@/components/patient-care/common";
import { evaluate, needsAttention } from "@/lib/clinical/rules/engine";
import { getMemberBookingData } from "@/lib/real-booking/repository";
import { getMemberLabStages } from "@/lib/patient-care/lab-stage-repository";
import { LabStageCard } from "@/components/patient-care/lab-stage-card";
import { ConsultationHoldCard } from "@/components/patient-care/consultation-hold-card";
import { doctorCompletionEnabled } from "@/lib/doctor-completion/config";
import { readRealMemberStatus } from "@/lib/patient-care/clinical-case-repository";
import { PwaInstall } from "@/components/patient/pwa-install";
import { memberLabSummary } from "@/lib/staff/lab-stage-schema";
import { memberJourneyStep } from "@/lib/patient-care/journey-step";
import { readPlanPreparing } from "@/lib/ai-plan/member";
import { arrangedConsultationText } from "@/lib/doctor-completion/consultation-copy";
import { memberProgramme } from "@/lib/programme/member";
import { ProgrammeNowCard } from "@/components/patient/programme-timeline";
import { createClient } from "@/lib/supabase/server";
import { readMemberDocuments, type DocumentRpc } from "@/lib/doctor-completion/document-runtime";
import { readMemberSafety } from "@/lib/member-safety/member";
import { exerciseGuidance, visibleChestPainCard } from "@/lib/member-safety/contract";
import { hideChestPainCardToday } from "@/lib/member-safety/actions";
import { ChestPainSafetyCard } from "@/components/patient-care/chest-pain-safety-card";
import { cookies } from "next/headers";
import { ZoeConsentPrompt } from "@/components/patient/zoe-consent-prompt";
import { readZoePrompt } from "@/lib/zoe/member";
import { ZOE_PROMPT_LATER_COOKIE } from "@/lib/zoe/consent-prompt";
import { BpWeekHome } from "@/components/bp-week/home-card";
import { MedicinesHome, MedicineAskHomeNotice } from "@/components/member-medicines/home-card";
import { readMemberCareTeam } from "@/lib/patient-care/care-team-repository";
import { journeyStripIndex, journeyStripInput } from "@/lib/patient-care/journey-strip";
import { reviewedResultCount } from "@/lib/patient-care/reviewed-results";
import { countOwnDoctorApprovedValues } from "@/lib/member-history/server";
import { readMemberNurseVisit, type NurseVisitRpc } from "@/lib/nurse-visit/runtime";
import { NurseVisitStepsCard } from "@/components/patient-care/nurse-visit-steps-card";
import { NextDateCard } from "@/components/patient-care/next-date-card";
import { nextDatedThing, type NextDateKind } from "@/lib/patient-care/next-date";
import { readMemberBpWeek } from "@/lib/bp-week/server";
import { FirstNoteCard } from "@/components/patient-care/first-note-card";
import { memberFirstNote } from "@/lib/first-note/member";
import { LdlGoalCard } from "@/components/patient-care/ldl-goal-card";
import { memberLdl } from "@/lib/ldl/member";
import {
  HomeCareTeam,
  HomeJourneyStrip,
  HomeUnwellCard,
  HomeZoeCard,
} from "@/components/patient-care/home-journey";

import { memberGreeting as greeting } from "@/lib/patient/greeting";
export async function MemberHomeContent({ searchParams, chat = false, promptForChat }: { searchParams: Promise<{ view?: string | string[] }>; chat?: boolean; promptForChat?: Awaited<ReturnType<typeof readZoePrompt>> | null }) {
  // These reads do not depend on carePageData, so they start alongside it instead of after
  // it, once the member is known to be signed in (a signed-out visitor is redirected before
  // any database read, as before). Each stays member-scoped by the database.
  const laterReads = requirePatient().then(() => Promise.all([
    getMemberBookingData({ summaryOnly: true }),
    getMemberLabStages(),
    // A status outage hides the hold card and the review step; it never shows clinical content.
    readRealMemberStatus().catch(() => undefined),
    // A failed read hides the care team card; it never claims nobody is assigned.
    readMemberCareTeam(),
    // Released clinic lab PDFs move the next step on (QA N-02); a failed read is null and changes nothing.
    !doctorCompletionEnabled()
      ? Promise.resolve(null)
      : createClient().then((client) => readMemberDocuments(client as unknown as DocumentRpc)),
    // Safety holds (dark, DT P342/P371/P389). Never throws; unreadable withholds exercise tips.
    readMemberSafety(),
    // "Your doctor is preparing your plan" (dark, ai_plan_draft_enabled). A failed read changes nothing.
    readPlanPreparing(),
    // Nurse visit completion (dark, database switch). A failed read is undefined and changes nothing.
    createClient().then((client) => readMemberNurseVisit(client as unknown as NurseVisitRpc)),
    // BP week (database switch) for the next dated reading; a failed read is "off" and adds nothing.
    readMemberBpWeek(),
    // The doctor's approved first note (dark, database switch), until a plan is active. A failed read shows nothing.
    memberFirstNote(),
    // LDL goal (dark, ldl_goal_settings). A failed read shows nothing.
    memberLdl(),
    // Doctor-approved values from the member's uploads, for "Reviewed results". Null adds nothing.
    countOwnDoctorApprovedValues(),
  ]));
  // A failure surfaces at the await below, after carePageData's own redirects.
  laterReads.catch(() => {});
  const {
    profile,
    assessment,
    care,
    measurements,
    reminders,
    chartMeasurements,
  } = await carePageData();
  const params = await searchParams;
  const completion = doctorCompletionEnabled();
  const [realBookings, labSamples, caseStatus, careTeam, released, safety, planPreparing, nurseVisit, bpWeek, firstNote, ldl, doctorApprovedValues] = await laterReads;
  const safetyCard = visibleChestPainCard(safety);
  // One-time Zoe consent card: members who never decided, unless "Not now" was pressed today.
  const zoePrompt =
    !(await cookies()).has(ZOE_PROMPT_LATER_COOKIE) ? (chat && promptForChat !== undefined ? promptForChat : await readZoePrompt()) : null;
  const consultationHold =
    completion && caseStatus?.status?.status === "consultation_needed";
  const l = profile.locale,
    now = new Date();
  const decision = evaluate({ answers: assessment.answers, observations: [] });
  const { urgent, showRoutine } = patientPresentation(assessment);
  const prototype = memberScreensPrototypeEnabled() && params.view !== "classic" && !urgent;
  // One stage for the strip, the programme step and Progress (QA 177).
  const journey = journeyStripInput({
    questionnaireComplete: !!assessment.completedAt,
    lab: labSamples ? memberLabSummary(labSamples) : undefined,
    planPublished: !!care.plan,
    nurseVisit,
    requests: realBookings?.requests,
    appointments: realBookings?.pilot?.appointments,
    released,
  });
  // Programme rhythm (dark, database switch): the step that matters now and its date.
  const programme =
    !urgent
      ? await memberProgramme(async () => ({
          questionnaireComplete: !!assessment.completedAt,
          lab: journey.lab,
          nurseSamplesTaken: journey.nurseSamplesTaken,
          visitDone: journey.visitDone,
          testsArranged:
            !!realBookings &&
            ((realBookings.pilot?.appointments.length ?? 0) > 0 ||
              realBookings.requests.length > 0),
          planPublishedAt: care.plan?.publishedAt ?? null,
        }))
      : null;
  const actions = careActions(care, {
    complete: !!assessment.completedAt,
    showAssessmentNextSteps: true,
    assessmentCompletedAt: assessment.completedAt,
    urgent,
    attention: needsAttention(decision)
      .filter((f) => f.urgency === "orange")
      .map((f) => ({
        id: f.ruleId,
        detail: {
          en: f.nextStep?.en ?? f.reason.en ?? f.reason.hy,
          hy: f.nextStep?.hy ?? f.reason.hy,
        },
      })),
    measuredToday: measurements.some(
      (m) => !isUnverifiedBp(m) && Date.parse(m.measuredAt) <= now.getTime() && armeniaDate(new Date(m.measuredAt)) === armeniaDate(now),
    ),
    now,
  });
  const routine = dailyReminders(
    care,
    measurements,
    reminders.preferences,
    now,
  );
  const reminderActions = actions.filter(
    (a) =>
      a.kind !== "medication" &&
      (a.kind !== "measurement" || !reminders.preferences.bpEnabled),
  );
  // Real members: the next step follows the saved journey (lead input 17 Oct).
  const consultation = caseStatus?.status?.consultation;
  const journeyAction =
    !urgent && realBookings
      ? memberJourneyStep({
          questionnaireComplete: !!assessment.completedAt,
          review:
            caseStatus === undefined
              ? undefined
              : !caseStatus?.enabled
                ? null
                : (caseStatus.status ?? "none"),
          appointments: realBookings.pilot?.appointments,
          clinics: realBookings.pilot?.clinics ?? {},
          canBook:
            realBookings.available ||
            !!realBookings.homeRequestAvailable ||
            !!realBookings.legacyCreationAvailable,
          hasOpenRequest: realBookings.requests.some(
            (r) => r.status !== "cancelled" && r.status !== "completed",
          ),
          lab: labSamples ? memberLabSummary(labSamples) : undefined,
          nurseVisit,
          released,
          planPublished: !!care.plan,
          planPreparing,
          doctorName: careTeam?.doctor ?? null,
          consultationText: consultation
            ? {
                en: arrangedConsultationText(consultation, "en"),
                hy: arrangedConsultationText(consultation, "hy"),
                ru: arrangedConsultationText(consultation, "ru"),
              }
            : undefined,
          now,
        })
      : null;
  const serviceAction = journeyAction;
  const baseActions = serviceAction
    ? [
        serviceAction,
        ...reminderActions.filter(
          (a) =>
            ![
              "tests",
              "waiting",
              "results",
              "appointment",
              "consultation",
              "plan",
            ].includes(a.kind),
        ),
      ]
    : reminderActions;
  const routineAction =
    !urgent && !!assessment.completedAt ? nextReminderAction(routine) : null;
  const preserveClinicalNext =
    !!serviceAction ||
    baseActions.some((a) =>
      ["urgent", "questions", "consultation", "appointment", "plan"].includes(
        a.kind,
      ),
    );
  const visibleActions =
    routineAction && !preserveClinicalNext
      ? [
          routineAction,
          ...baseActions.filter(
            (a) => a.id !== "caught-up" && a.kind !== "measurement",
          ),
        ]
      : baseActions;
  // Khikar, 18 Oct: everything is on Home again (no "More" fold). The next step
  // still leads; anything it already shows is not repeated below it.
  const showPrimary =
    urgent ||
    !["medication", "measurement"].includes(visibleActions[0]?.kind ?? "");
  const primaryHref = showPrimary ? visibleActions[0]?.href : undefined;
  const comingUpNext = (
    <ComingUpNext
      care={care}
      measurements={measurements}
      preferences={reminders.preferences}
      locale={l}
      now={now.toISOString()}
    />
  );
  const showVisits =
    !!realBookings &&
    primaryHref !== "/patient/service" &&
    ((realBookings.pilot?.appointments.length ?? 0) > 0 ||
      realBookings.requests.length > 0 ||
      (realBookings.available && realBookings.requirements.length > 0));
  // The next dated thing (product review §4.1): never repeats what the next step above already shows.
  const shownByStep: NextDateKind[] = !showPrimary ? []
    : journeyAction && ["journey-visit", "journey-proposal", "journey-nurse-confirmed"].includes(journeyAction.id) ? ["visit", "proposal"]
      : journeyAction?.id === "journey-consultation" ? ["consultation"] : [];
  const nextDate = urgent ? null : nextDatedThing({
    now,
    appointments: realBookings?.pilot?.appointments,
    consultationAt: caseStatus?.status?.consultation?.scheduledAt ?? null,
    bpWeek,
    stages: programme?.stages,
    skip: shownByStep,
  });
  const journeyShows = (ids: string[]) =>
    !!journeyAction && ids.includes(journeyAction.id);
  const showHold = consultationHold && !journeyShows(["journey-consultation"]);
  const showLab =
    !!labSamples &&
    !!memberLabSummary(labSamples) &&
    !journeyShows(["journey-samples", "journey-results"]);
  const journeyStrip = !urgent && (
    <HomeJourneyStrip current={journeyStripIndex(journey)} locale={l} />
  );
  const primaryStep = showPrimary ? (
    <NextSteps
      actions={visibleActions}
      locale={l}
      mode={urgent ? "all" : "primary"}
    />
  ) : (
    !urgent && comingUpNext
  );
  const nextDetails = prototype && <div className="ms-next-details" data-member-next-details>
    {!care.plan && <FirstNoteCard note={firstNote} locale={l} />}
    <HomeVisitDetail data={realBookings} locale={l} />
    {nurseVisit && nurseVisit.steps.length > 0 && <NurseVisitStepsCard visit={nurseVisit} locale={l} />}
    {labSamples && <LabStageCard samples={labSamples} locale={l} separateRelease={completion} />}
    {programme && <ProgrammeNowCard stages={programme.stages} locale={l} />}
  </div>;
  // The classic Home owns the full dashboard. The compact Home renders notices separately.
  const supportingCards = !urgent && (
    <>
      {!prototype && programme && (
        <ProgrammeNowCard stages={programme.stages} locale={l} />
      )}
      <BpWeekHome locale={l} />
      <MedicinesHome locale={l} />
      {showHold && (
        <ConsultationHoldCard
          locale={l}
          hasPlan={!!care.plan}
          arrangement={caseStatus?.status?.consultation ?? null}
        />
      )}
      {!prototype && nurseVisit && nurseVisit.steps.length > 0 && <NurseVisitStepsCard visit={nurseVisit} locale={l} />}
      {!prototype && showLab && labSamples && (
        <LabStageCard
          samples={labSamples}
          locale={l}
          separateRelease={completion}
        />
      )}
      {showVisits && realBookings && (
        <div className="divide-y rounded-xl border bg-card px-1" data-home-visits>
          <RowLink href="/patient/service" icon={CalendarDays}>
            {(realBookings.pilot?.appointments.length ?? 0) > 0
              ? copy(l, "View my visits", "Տեսնել իմ այցերը", "Посмотреть мои визиты")
              : realBookings.requests.length > 0
                ? copy(
                    l,
                    "View my test requests",
                    "Տեսնել իմ հետազոտությունների հարցումները",
                    "Посмотреть мои запросы на анализы",
                  )
                : copy(l, "Request tests", "Հետազոտության հարցում", "Запросить анализы")}
          </RowLink>
        </div>
      )}
      {showPrimary && comingUpNext}
      {showRoutine && (
        <DailyRoutine compact occurrences={routine} locale={l} hasPlan={!!care.plan} />
      )}
      <HomeHealthAndRhythm
        care={care}
        measurements={chartMeasurements}
        actionMeasurements={measurements}
        preferences={reminders.preferences}
        locale={l}
        now={now.toISOString()}
      />
      {/* "Up next" above always offers the reading, so the list does not repeat it. */}
      <NextSteps
        actions={visibleActions.filter(
          (a, i) => i === 0 || a.kind !== "measurement",
        )}
        locale={l}
        mode="secondary"
      />
      <HomeLifestyle locale={l} exercise={exerciseGuidance(safety)} hasPlan={!!care.plan} />
      <HomeCareAndTeam
        care={care}
        locale={l}
        demo={false}
        now={now.toISOString()}
        doctorShown={!!careTeam?.doctor}
        reviewedResults={reviewedResultCount({ results: care.results, released, doctorApprovedValues, planPublishedAt: care.plan?.publishedAt ?? null })}
      />
      {assessment.completedAt && (
        <CareLink href="/patient/health/profile">
          {copy(
            l,
            "Your questionnaire summary",
            "Ձեր հարցաշարի ամփոփումը",
            "Сводка по вашей анкете",
          )}
        </CareLink>
      )}
      <PwaInstall locale={l} dismissible />
    </>
  );
  const ldlNotice = ldl?.enabled && ldl.inPathway && !!(ldl.withDoctor || ldl.retest);
  const hasHomeDetails = (ldl?.enabled && ldl.inPathway && !ldlNotice) ||
    (realBookings?.pilot?.appointments.length ?? 0) > 0 ||
    (realBookings?.requests.length ?? 0) > 0 ||
    (nurseVisit?.steps.length ?? 0) > 0 ||
    (!!labSamples && !!memberLabSummary(labSamples)) || !!programme;
  const notices = <HomeNotices cards={{
      "chest-pain": (safetyCard && <ChestPainSafetyCard card={safetyCard} locale={l} hide={hideChestPainCardToday} />),
      "zoe-consent": (zoePrompt?.due && <ZoeConsentPrompt locale={l} directAnswers={zoePrompt.directAnswers} />),
      "first-note": (!care.plan && <FirstNoteCard note={firstNote} locale={l} />),
      "ldl": (ldlNotice && <LdlGoalCard prototype={prototype} data={ldl} locale={l} compact />),
      "medicine-ask": (<MedicineAskHomeNotice care={care} locale={l} now={now} />),
      "exercise-paused": (exerciseGuidance(safety) === "paused" && <ExercisePauseNotice locale={l} />),
      "consultation-hold": ((chat ? consultationHold : showHold) && <ConsultationHoldCard locale={l} hasPlan={!!care.plan} arrangement={caseStatus?.status?.consultation ?? null} />),
      "attention": (actions.filter(action => action.id.startsWith("RF-") && (chat || action.id !== visibleActions[0]?.id)).map(action => <aside key={action.id} className="member-home-card" role="note" data-home-attention>
            <h2>{action.title[l]}</h2>
            <p>{action.detail[l]}</p>
            <CareLink href={action.href}>{action.button[l]}</CareLink>
          </aside>)),
      "pending-review": (care.pendingReview && <aside className="member-home-card" role="note" data-home-review>
            <h2>{copy(l, "Care review in progress", "Խնամքի վերանայումն ընթացքի մեջ է", "Проверка лечения продолжается")}</h2>
            {care.plan && <p>{copy(l, "Your previously published plan remains available while the new review is pending.", "Նոր վերանայման ընթացքում ձեր նախկին հրապարակված պլանը հասանելի է։", "Ваш ранее опубликованный план остаётся доступным, пока ожидается новая проверка.")}</p>}
            <CareLink href="/patient/care">{copy(l, "Open my care", "Բացել իմ խնամքը", "Открыть моё лечение")}</CareLink>
          </aside>),
      "care-team": (!chat && careTeam && !careTeam.doctor && <HomeCareTeam doctor={null} locale={l} />),
  }} />;
  // Chat retains only required notices after its conversation. The next-step card used to carry these
  // hold messages, so retain their existing wording without the dashboard around them.
  if (chat && !urgent) return <>
    {notices}
    {journeyAction && ["journey-results", "journey-plan-preparing"].includes(journeyAction.id) &&
      <aside className="member-chat-card space-y-2" role="note" data-chat-results-notice>
        <h2 className="text-body2 font-semibold">{journeyAction.title[l]}</h2>
        <p className="text-body2">{journeyAction.detail[l]}</p>
        <CareLink href="/patient/zoe?card=results">{journeyAction.button[l]}</CareLink>
      </aside>}
    {completion && !consultationHold && !journeyShows(["journey-results", "journey-plan-preparing"]) &&
      labSamples && memberLabSummary(labSamples) === "results-received" &&
      <LabStageCard samples={labSamples} locale={l} separateRelease />}
  </>;
  // Keep the established emergency Home. The query can select the old Home only;
  // it never turns the prototype on when the server flag is off.
  if (memberHomeEnabled() && params.view !== "classic" && !urgent) {
    return <PatientShell locale={l}>
      <CareRefresh />
      <MemberScreen enabled={prototype} locale={l} classicHref="/patient/dashboard?view=classic">
      <MemberHome
        details={hasHomeDetails ? <>
          {!ldlNotice && <LdlGoalCard prototype={prototype} data={ldl} locale={l} compact />}
          <HomeVisitDetail data={realBookings} locale={l} />
          {nurseVisit && nurseVisit.steps.length > 0 && <NurseVisitStepsCard visit={nurseVisit} locale={l} />}
          {labSamples && <LabStageCard samples={labSamples} locale={l} separateRelease={completion} />}
          {programme && <ProgrammeNowCard stages={programme.stages} locale={l} />}
        </> : null}
        locale={l}
        greeting={greeting(l, now, profile.name.split(" ")[0] ?? "")}
        date={new Intl.DateTimeFormat(l === "hy" ? "hy-AM" : l === "ru" ? "ru-RU" : "en-GB", {
          weekday: "long", day: "numeric", month: "long", timeZone: "Asia/Yerevan",
        }).format(now)}
        now={now}
        care={care}
        measurements={chartMeasurements}
        preferences={reminders.preferences}
        next={visibleActions[0] ?? null}
        nextDate={nextDate}
        ldl={ldl}
        doctor={careTeam?.doctor}
        journeyCurrent={journeyStripIndex(journey)}
        exercise={exerciseGuidance(safety)}
        notices={notices}
      />
      </MemberScreen>
    </PatientShell>;
  }
  return (
    <PatientShell locale={l}>
      <CareRefresh />
      <MemberScreen enabled={prototype} locale={l} classicHref="/patient/dashboard?view=classic">
      <div className="space-y-5">
        <header className="space-y-1">
          <h1 className="text-h1">
            {greeting(l, now, profile.name.split(" ")[0] ?? "")}
          </h1>
          <p className="text-body2 text-muted-foreground">
            {copy(
              l,
              new Intl.DateTimeFormat("en-GB", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "Asia/Yerevan",
              }).format(now),
              new Intl.DateTimeFormat("hy-AM", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "Asia/Yerevan",
              }).format(now),
              new Intl.DateTimeFormat("ru-RU", {
                weekday: "long",
                day: "numeric",
                month: "long",
                timeZone: "Asia/Yerevan",
              }).format(now),
            )}
          </p>
        </header>
        {!urgent && safetyCard && (
          <ChestPainSafetyCard card={safetyCard} locale={l} hide={hideChestPainCardToday} />
        )}
        {!urgent && zoePrompt?.due && <ZoeConsentPrompt locale={l} directAnswers={zoePrompt.directAnswers} />}
        {journeyStrip}
        {!prototype && !urgent && !care.plan && <FirstNoteCard note={firstNote} locale={l} />}
        {!urgent && <LdlGoalCard prototype={prototype} data={ldl} locale={l} compact />}
        {primaryStep}
        {nextDetails}
        {!urgent && <NextDateCard next={nextDate} locale={l} now={now} />}
        {supportingCards}
        {!urgent && (
          <>
            {careTeam && <HomeCareTeam doctor={careTeam.doctor} locale={l} />}
            <HomeUnwellCard locale={l} />
            <HomeZoeCard locale={l} />
          </>
        )}
      </div>
      </MemberScreen>
    </PatientShell>
  );
}
