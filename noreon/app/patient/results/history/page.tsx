import { MemberScreen } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import { ArrowLeft, ChartNoAxesCombined, ClipboardList, History } from "lucide-react";
import { PatientShell } from "@/components/patient/patient-shell";
import { CareSection, CareLink, copy } from "@/components/patient-care/common";
import { TestOrders } from "@/components/patient-care/test-orders";
import { ResultHistory } from "@/components/patient-care/result-history";
import { HealthTrends } from "@/components/patient-care/trends";
import { carePageData } from "@/lib/patient-care/repository";
import { currentPatientPublishedReview } from "@/lib/patient-care/current-published-review";
import { currentPublishedSourceRows } from "@/lib/patient-care/published-review";

export default async function TestHistoryPage({ searchParams = Promise.resolve({}) }: { searchParams?: Promise<{ view?: string; section?: string }> } = {}) {
  const params = await searchParams;
  const trends = params.view === "trends" || params.section === "trends";
  const prototype = memberScreensPrototypeEnabled() && params.view !== "classic";
  const { profile, care } = await carePageData(), l = profile.locale;
  const publication = await currentPatientPublishedReview();
  const tests = care.tests.filter(t => t.status === "collected" || t.status === "cancelled");
  const currentSources = currentPublishedSourceRows(publication).length > 0;
  return <PatientShell locale={l}><MemberScreen enabled={prototype} locale={l} classicHref={trends ? "/patient/results/history?section=trends&view=classic" : "/patient/results/history?view=classic"}><div className={prototype ? "ms-support ms-history space-y-5" : "space-y-5"}>
    <CareLink href="/patient/results" icon={ArrowLeft}>{copy(l, "Back to tests", "Վերադառնալ հետազոտություններին", "Вернуться к анализам")}</CareLink>
    <h1 className="break-words text-h2 sm:text-h1">{copy(l, "Test history", "Հետազոտությունների պատմություն", "История анализов")}</h1>
    {!trends && <><CareSection title={copy(l, "Past orders", "Նախկին նշանակումները", "Предыдущие назначения")}>
      {tests.length ? <TestOrders tests={tests} locale={l} /> : <p className="text-body2 text-muted-foreground">{copy(l, "No past test orders recorded.", "Նախկին հետազոտությունների նշանակումներ գրանցված չեն։", "Предыдущих назначений анализов нет.")}</p>}
    </CareSection>
    {care.results.length > 0 && <CareSection title={copy(l, currentSources ? "Numeric result history" : "Result history", currentSources ? "Թվային արդյունքների պատմություն" : "Արդյունքների պատմություն", currentSources ? "История числовых результатов" : "История результатов")}><ResultHistory results={care.results} locale={l} /></CareSection>}
    {currentSources && <CareLink href="/patient/review" icon={ClipboardList}>{copy(l, "Previous plans and sources", "Նախորդ պլաններն ու աղբյուրները", "Предыдущие планы и источники")}</CareLink>}
    <CareLink href="/patient/results/history?view=trends" icon={ChartNoAxesCombined}>{copy(l, "View result trends", "Դիտել արդյունքների փոփոխությունները", "Посмотреть изменения результатов")}</CareLink>
    </>}
    {trends && <><CareLink href="/patient/results/history" icon={History}>{copy(l, "Past orders and results", "Նախկին նշանակումներ և արդյունքներ", "Предыдущие назначения и результаты")}</CareLink><HealthTrends measurements={[]} results={care.results} locale={l} now={new Date().toISOString()} mode="labs" /></>}
    <p className="text-caption text-muted-foreground">{copy(l, "Reference intervals belong to the reporting laboratory. A value outside an interval does not by itself establish a diagnosis.", "Հղման միջակայքները տրամադրում է լաբորատորիան։ Միջակայքից դուրս արժեքն ինքնին ախտորոշում չէ։", "Референсные интервалы устанавливает лаборатория, выдавшая результат. Значение за пределами интервала само по себе не устанавливает диагноз.")}</p>
  </div></MemberScreen></PatientShell>;
}
