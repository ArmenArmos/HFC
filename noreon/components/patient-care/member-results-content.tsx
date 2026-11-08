import { MemberScreen, MemberResultsGlance } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { FlaskConical, History, FileText } from "lucide-react";
import { currentPatientPublishedReview } from "@/lib/patient-care/current-published-review";
import { currentPublishedSourceRows } from "@/lib/patient-care/published-review";
import { PublishedSourceResults } from "@/components/patient-care/published-source-results";
import { TestSummary } from "@/components/patient-care/test-summary";
import { ProgressNavigation } from "@/components/patient-care/progress-navigation";
import { RecommendedTests } from "@/components/patient-care/recommended-tests";
import { ConsultationWindowNotice } from "@/components/patient-care/consultation-window-notice";
import { ResultHistory } from "@/components/patient-care/result-history";
import { TestOrders } from "@/components/patient-care/test-orders";
import { MemberPageFrame } from "@/components/patient-care/member-page-frame";
import { carePageData } from "@/lib/patient-care/repository";
import { CareSection, CareLink, IconTile, RowLink, copy } from "@/components/patient-care/common";
import { CareRefresh } from "@/components/patient-care/controls";
import { buildPlan, evaluate } from "@/lib/clinical/rules/engine";
import { getMemberBookingData } from "@/lib/real-booking/repository";
import {visitSummary} from "@/lib/real-booking/visit-summary";
import { createClient } from "@/lib/supabase/server";
import { doctorCompletionEnabled } from "@/lib/doctor-completion/config";
import { readMemberDocuments, type DocumentRpc } from "@/lib/doctor-completion/document-runtime";
import { ReleasedDocuments } from "@/components/patient-care/released-documents";
import { arrangedTestIds, withoutArrangedTests } from "@/lib/patient-care/suggestion-filter";

export default async function Results({ searchParams = Promise.resolve({}), embedded = false }: { searchParams?: Promise<{ view?: string }>; embedded?: boolean } = {}) {
  const prototype = embedded || memberScreensPrototypeEnabled() && (await searchParams).view !== "classic";
  const { profile, assessment, care } = await carePageData(), l = profile.locale;
  const [publication, realBookings, documents] = await Promise.all([currentPatientPublishedReview(), getMemberBookingData({summaryOnly:true}), !doctorCompletionEnabled() ? Promise.resolve([]) : createClient().then(client => readMemberDocuments(client as unknown as DocumentRpc))]);
  const sourceRows = currentPublishedSourceRows(publication);
  const decision = evaluate({ answers: assessment.answers, observations: [] });
  const urgent = decision.urgency === "red" || !!assessment.urgentRule;
  const savedVisitSummary=visitSummary(realBookings?.pilot,l);
  const showRequests = !urgent && !!realBookings && (!!savedVisitSummary || realBookings.requests.length > 0 || (realBookings.available && realBookings.requirements.length > 0));
  // QA 178: tests already requested, booked, done or ordered are not suggested again.
  const suggestions = assessment.completedAt && decision.urgency !== "red"
    ? withoutArrangedTests(buildPlan(decision), arrangedTestIds({ requests: realBookings?.requests, appointments: realBookings?.pilot?.appointments }), care.tests)
    : [];
  const tests = care.tests.filter(t => t.status === "ordered" || t.status === "booked");
  return <MemberPageFrame embedded={embedded} kind="results" locale={l}>
    {!embedded && <CareRefresh />}
      <MemberScreen enabled={prototype && !embedded} locale={l} classicHref={"/patient/results?view=classic"}>
    <div id="tests" className={prototype ? "ms-results space-y-5" : "space-y-5"}>
      <h1 className="text-h1">{prototype ? copy(l, "Your results", "Ձեր արդյունքները", "Ваши результаты") : copy(l, "My progress", "Իմ առաջընթացը", "Мой прогресс")}</h1>
      {!embedded && <ProgressNavigation locale={l} active="tests" />}
      {!urgent && <ConsultationWindowNotice decision={decision} locale={l} />}
      {showRequests && <section className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
        <div className="space-y-1"><h2 className="text-h3">{copy(l, "Test arrangements", "Հետազոտությունների կազմակերպում", "Организация анализов")}</h2><p className="text-caption text-muted-foreground">{savedVisitSummary ?? (realBookings!.requests.length > 0 ? (activeCount => copy(l, `${activeCount} active ${activeCount === 1 ? "request" : "requests"}`, `${activeCount} ակտիվ հարցում`, `Активных запросов: ${activeCount}`))(realBookings!.requests.filter(request => request.status !== "cancelled").length) : copy(l, "View current visit availability.", "Տեսեք այցերի հասանելի ժամերը։", "Посмотрите доступное время визитов."))}</p></div>
        <CareLink href="/patient/service" icon={FlaskConical} variant="primary">{savedVisitSummary ? copy(l,"View visits","Տեսնել այցերը", "Посмотреть визиты") : realBookings!.requests.length ? copy(l, "View test requests", "Տեսնել հարցումները", "Посмотреть запросы на анализы") : copy(l, "Request tests", "Հետազոտության հարցում", "Запросить анализы")}</CareLink>
      </section>}
      {tests.length > 0 && <section id="active-tests" className="journey-card space-y-5">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1"><h2 className="text-h2">{copy(l, "My tests", "Իմ հետազոտությունները", "Мои анализы")}</h2></div>
        </header>
        <TestOrders tests={tests} locale={l} />
      </section>}
      {prototype && <MemberResultsGlance sourceRows={sourceRows} results={care.results} locale={l} />}
      <div id="approved-results" className="scroll-mt-6">
      {(sourceRows.length > 0 || care.results.length > 0) && <CareSection title={copy(l, "Doctor-approved results", "Բժշկի հաստատած արդյունքները", "Результаты, подтверждённые врачом")}>
        {sourceRows.length ? <PublishedSourceResults rows={sourceRows} locale={l} />
          : care.results.length ? <><TestSummary compact results={care.results} locale={l} /><ResultHistory results={care.results} locale={l} /></>
          : <p className="text-body2 text-muted-foreground">{copy(l, "No doctor-approved results available here yet.", "Այստեղ բժշկի հաստատած արդյունքներ դեռ հասանելի չեն։", "Здесь пока нет результатов, подтверждённых врачом.")}</p>}
      </CareSection>}
      </div>
      <ReleasedDocuments documents={documents} locale={l} />
      {suggestions.length > 0 && <CareSection title={copy(l, "Questionnaire suggestions", "Հարցաշարի առաջարկներ", "Рекомендации по анкете")}>
        <RecommendedTests compact={embedded} tests={suggestions} decision={decision} locale={l} questionnaireOnly />
        <CareLink href="/patient/questions">{copy(l, "Review your health answers", "Վերանայել առողջության պատասխանները", "Просмотреть ваши ответы о здоровье")}</CareLink>
      </CareSection>}
      {tests.length === 0 && suggestions.length === 0 && sourceRows.length === 0 && care.results.length === 0 && !documents?.length && <section className="journey-card space-y-3">
        <IconTile icon={FlaskConical} /><h2 className="text-h2">{copy(l, "Your tests", "Ձեր հետազոտությունները", "Ваши анализы")}</h2>
        <p className="text-body2 text-muted-foreground">{copy(l, "No current test orders or approved results here.", "Այստեղ ընթացիկ նշանակումներ կամ հաստատված արդյունքներ չկան։", "Здесь нет текущих назначений анализов или подтверждённых результатов.")}</p>
        <CareLink href="/patient/reports">{copy(l, "Open my reports", "Բացել իմ հետազոտությունները", "Открыть мои отчёты")}</CareLink>
      </section>}
      <section className="rounded-xl border bg-card p-2"><RowLink href="/patient/reports" icon={FileText}>{copy(l,"Reports and originals","Փաստաթղթեր և բնօրինակներ", "Отчёты и оригиналы")}</RowLink><RowLink href="/patient/results/history" icon={History}>{copy(l, "Test history", "Հետազոտությունների պատմություն", "История анализов")}</RowLink></section>
    </div>
  </MemberScreen>
    </MemberPageFrame>;
}
