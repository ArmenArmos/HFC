import { MemberScreen } from "@/components/patient-care/member-screens";
import { memberScreensPrototypeEnabled } from "@/lib/patient/member-screens-config";
import type { Route } from "next";
import { ArrowLeft } from "lucide-react";
import { PatientShell } from "@/components/patient/patient-shell";
import { CareLink, copy } from "@/components/patient-care/common";
import { UploadCard } from "@/components/member-history/upload-card";
import { ValueForm } from "@/components/member-history/value-form";
import { DocumentList, ValueList } from "@/components/member-history/history-lists";
import { requireRegistered } from "@/lib/patient/repository";
import { readOwnHistory } from "@/lib/member-history/server";
import { ReadingCards, type ReadingCardItem } from "@/components/member-history/ai-reading-card";
import { readOwnLabResults, readOwnUploadReading, readOwnUploadReadings } from "@/lib/member-history/ai-server";
import { LabResultsView } from "@/components/member-history/lab-results-view";
import { resultsCopy } from "@/lib/member-history/lab-results-copy";
import { readingState, type MemberOverview } from "@/lib/member-history/ai-reading";
import type { ReportedDocument } from "@/lib/member-history/measures";
import { addEarlierValue, answerEarlierIdentity, deleteEarlierValue, editEarlierReading, removeEarlierDocument } from "./actions";
export const dynamic = "force-dynamic";
/**
 * AI reading of uploads (dark): a status card per recent upload. A saved reading shows a short summary with an
 * Edit link; `?edit=<file>` opens that file's values for correction (also reachable from "Your files").
 */
async function readingCards(readings: MemberOverview, files: ReportedDocument[], editing: string | null) {
  const now = Date.now();
  const cards: ReadingCardItem[] = [];
  for (const d of readings.documents) {
    const s = readingState(d, now);
    const file = files.find((x) => x.id === d.documentId);
    // While the doctor's check is required, the member does not edit values: a saved reading waits for the doctor
    // (shown until approved), then says it was checked (for a week).
    const review = s.state === "saved" ? d.job?.review?.state : undefined;
    const shown = review === "waiting" || (review === "approved" ? now - Date.parse(d.job!.review!.approvedAt ?? "") < 7 * 86_400_000 : s.shown);
    const edit = editing === d.documentId && s.state === "saved" && (review === undefined || review === "not_required");
    if (!file || (!shown && !edit)) continue;
    cards.push({ documentId: d.documentId, fileName: file.fileName, state: s.state, jobId: d.job?.jobId, saved: d.job?.confirmation?.valuesSaved ?? d.job?.valueCount ?? 0,
      charted: d.job?.confirmation?.valuesCharted ?? 0, reading: edit ? await readOwnUploadReading(d.documentId) : undefined, review: edit ? undefined : review });
  }
  return cards;
}
export default async function EarlierResults({ searchParams }: { searchParams: Promise<{ edit?: string | string[]; view?: string }> }) {
  const { profile } = await requireRegistered();
  const l = profile.locale;
  const params = await searchParams;
  const prototype = memberScreensPrototypeEnabled() && params.view !== "classic";
  const editParam = params.edit;
  const editing = typeof editParam === "string" ? editParam : null;
  const [history, readings, results] = await Promise.all([readOwnHistory(), readOwnUploadReadings(), readOwnLabResults()]);
  const cards = history && readings?.enabled ? await readingCards(readings, history.documents, editing) : [];
  // "Your files": how many values each saved reading kept, with a way back to edit them (only while the doctor's check is off).
  const readFiles = Object.fromEntries((readings?.enabled ? readings.documents : []).flatMap((d) => d.job?.confirmation && d.job.confirmation.identityAnswer !== "not_mine" && (d.job.review === undefined || d.job.review.state === "not_required") ? [[d.documentId, d.job.confirmation.valuesSaved]] : []));
  return (
    <PatientShell locale={l}>
      <MemberScreen enabled={prototype} locale={l} classicHref={(`/patient/progress/earlier?view=classic${editing ? `&edit=${encodeURIComponent(editing)}` : ""}`) as Route}>
      <div className={prototype ? "ms-support ms-earlier mx-auto max-w-3xl space-y-5" : "mx-auto max-w-3xl space-y-5"}>
        <CareLink href="/patient/progress" icon={ArrowLeft}>{copy(l, "Back to My progress", "Վերադառնալ «Իմ առաջընթացը»", "Вернуться к моему прогрессу")}</CareLink>
        <header className="space-y-2">
          <h1 className="text-h1">{copy(l, "Earlier results", "Նախկին արդյունքներ", "Предыдущие результаты")}</h1>
          <p className="text-body2 text-muted-foreground">
            {copy(
              l,
              "Add results from before Noreon so you can see how your numbers have changed. Your assigned doctor can open what you add. Everything here is marked as from you, because the clinic has not checked it.",
              "Ավելացրեք Noreon-ից առաջ ստացված արդյունքները՝ տեսնելու, թե ինչպես են փոխվել ձեր թվերը։ Ձեր բժիշկը կարող է բացել ձեր ավելացրածը։ Այստեղ ամեն ինչ նշվում է որպես ձեզնից ստացված, քանի որ կլինիկան այն չի ստուգել։",
              "Добавьте результаты, полученные до Noreon, чтобы увидеть, как изменились ваши показатели. Ваш врач может открыть добавленные материалы. Всё здесь отмечено как предоставленное вами, поскольку клиника ещё не проверила эти данные.",
            )}
          </p>
        </header>
        {history ? (
          <>
            <ReadingCards locale={l} items={cards} answer={answerEarlierIdentity} edit={editEarlierReading} />
            {results ? <LabResultsView data={results} locale={l} /> : readings?.enabled && <p role="status" className="rounded-xl border p-5 text-body2">{resultsCopy(l).unavailable}</p>}
            {prototype ? <div className="ms-upload-entry space-y-3">
              <UploadCard locale={l} reading={readings?.enabled === true} />
              <ValueForm locale={l} save={addEarlierValue} existing={history.values} />
            </div> : <>
              <ValueForm locale={l} save={addEarlierValue} existing={history.values} />
              <UploadCard locale={l} reading={readings?.enabled === true} />
            </>}
            <ValueList locale={l} values={history.values} remove={deleteEarlierValue} />
            <DocumentList locale={l} documents={history.documents} remove={removeEarlierDocument} readFiles={readFiles} />
          </>
        ) : (
          <p role="alert" className="rounded-xl border p-5 text-body2">{copy(l, "Your earlier results are unavailable right now. Reload the page to try again.", "Ձեր նախկին արդյունքներն այս պահին անհասանելի են։ Թարմացրեք էջը՝ կրկին փորձելու համար։", "Ваши предыдущие результаты сейчас недоступны. Обновите страницу, чтобы попробовать снова.")}</p>
        )}
      </div>
      </MemberScreen>
    </PatientShell>
  );
}
