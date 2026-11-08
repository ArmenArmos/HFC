"use client";
import { FILE_LINK } from "@/lib/patient/file-link";
import { clinicalLocale, pick, type Locale } from "@/lib/locale";
import { FilePicker } from "@/components/patient/file-picker";
import {SourceResultRow} from "@/components/patient-care/result-row";
import {sourceBoundExplanation,sourceBoundExtractionNarrative} from "@/lib/reports/source-bound-output";
import {explanationInput} from "@/lib/reports/explanation-input";
import { sameReportContent } from "@/lib/service-workflow/report-associations";
import { ReportAssociations } from "@/components/service-workflow/report-associations";
import { reportAdvisories } from "@/lib/service-workflow/report-advisories";
import type { ServiceWorkflow } from "@/lib/service-workflow/types";
import Image from "next/image";
import { Check, ChevronDown, ChevronRight, Download, FileText, FileUp, FolderSync, RefreshCw, Save, ShieldCheck, Sparkles, Table2, Trash2 } from "lucide-react";
import { applyReportExplanation } from "@/lib/service-workflow/report-memory";
import { ReportExplanation } from "./report-explanation";
import { DemoUpload, demoReportCommand } from "./demo-upload";
import { useEffect, useState, type ReactNode } from "react";
import { useOptionalDemoReports } from "@/components/service-workflow/reports-provider";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { createClient } from "@/lib/supabase/client";
import {
  CONSENT,
  MAX_BYTES,
  MIME_TYPES,
  extractionSchema,
  explanationSchema,
  trendPoints,
  validateReview,
  type ReportExtraction,
} from "@/lib/reports/schema";
import { sampleReports, type ReportRecord } from "@/lib/reports/demo";

const button =
  "inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-lg border border-primary bg-primary px-4 py-3 text-body2 font-semibold text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
const quietButton =
  "inline-flex min-h-11 max-w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-body2 font-semibold transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50";
function ReportDisclosureSummary({children}: {children: ReactNode}) {
  return <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg py-3 text-body2 font-semibold transition-colors hover:text-brand-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
    <span className="min-w-0 flex-1">{children}</span>
    <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/report-disclosure:rotate-180" aria-hidden />
  </summary>;
}
const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-background px-3 py-3 text-body2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground";
export function ReportWorkspace({
  locale,
  embedded = false,
  enabled,
  demo,
  memberName,
  demoAi = false,
  doctorName,
  workflow,
}: {
  locale: Locale;
  embedded?: boolean;
  enabled: boolean;
  demo: boolean;
  memberName: string;
  demoAi?: boolean;
  doctorName?: string;
  workflow?: ServiceWorkflow;
}) {
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  // Demo staff review only; absent on member pages.
  const memory = useOptionalDemoReports();
  const [savedReports, setSavedReports] = useState<ReportRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(!demo);
  const reports = demo && memory ? memory.reports : savedReports;
  const setReports = demo && memory ? memory.setReports : setSavedReports;
  const originalUrls = memory?.originalUrls ?? {};
  const writesAvailable = demo || enabled;
  const [selected, setSelected] = useState<string | null>(null),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [consent, setConsent] = useState(false),
    [file, setFile] = useState<File | null>(null),
    [draft, setDraft] = useState<ReportExtraction | null>(null),
    [mine, setMine] = useState(false),
    [remove, setRemove] = useState(false);
  function clearOriginals() {
    memory?.clear();
  }
  const record = reports.find((r) => r.id === selected);
  const previewUrl = record ? (!demo ? `/api/patient/reports/${record.id}/original?preview=1` : originalUrls[record.id] ? originalUrls[record.id] + (memory?.shared ? "&preview=1" : "") : null) : null;
  const advisories = record && draft && doctorName ? reportAdvisories({...record,reviewed:draft},memberName,reports) : [];
  async function refresh() {
    const response = await fetch("/api/patient/reports", { cache: "no-store" });
    if (!response.ok) throw new Error("unavailable");
    const data = await response.json();
    setReports(data.reports);
    return data.reports as ReportRecord[];
  }
  useEffect(() => {
    if (!demo) {
      let alive = true;
      fetch("/api/patient/reports", { cache: "no-store" })
        .then(async (r) => {
          if (!r.ok) throw new Error();
          return r.json();
        })
        .then((d) => {
          if (alive) setReports(d.reports);
        })
        .catch(() => {
          if (alive) setError("unavailable");
        })
        .finally(() => {
          if (alive) setHistoryLoading(false);
        });
      return () => {
        alive = false;
      };
    }
  }, [demo, setReports]);
  async function command(body: unknown) {
    const r = await fetch("/api/patient/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error);
    return data;
  }
  async function run(label: string, work: () => Promise<void>) {
    setBusy(label);
    setError("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setBusy("");
    }
  }
  function choose(r: ReportRecord) {
    setSelected(r.id);
    const parsed = extractionSchema.safeParse(r.reviewed ?? r.extraction);
    setDraft(parsed.success ? structuredClone(parsed.data) : null);
    setMine(false);
    setRemove(false);
    setError("");
  }
  function reportListStatus(r: ReportRecord) {
    if (!doctorName) {
      return r.state === "confirmed"
        ? t(
            "Transcription confirmed by you",
            "Ընթերցված տվյալները հաստատված են ձեր կողմից", "Вы подтвердили извлечённые данные"
          )
        : r.state === "needs_review"
          ? t("Check the extracted results", "Ստուգեք ընթերցված արդյունքները", "Проверьте извлечённые результаты")
          : t(
              "Not saved as results yet · open to retry",
              "Դեռ չի պահվել որպես արդյունք · բացել և կրկնել", "Результаты ещё не сохранены · откройте для повторной попытки"
            );
    }
    if (memory?.published?.reports[r.id]?.revision === r.revision)
      return t(
        "Included in the published plan",
        "Ներառված է հրապարակված ծրագրում", "Включено в опубликованный план лечения"
      );
    if (memory?.approvals[r.id]?.revision === r.revision)
      return t(
        "Clinician checked for plan inclusion · overall plan not yet approved",
        "Բժշկի կողմից ստուգված է ծրագրում ներառելու համար · ամբողջական ծրագիրը դեռ հաստատված չէ", "Врач проверил для включения в план лечения · весь план лечения ещё не утверждён"
      );
    if (r.state === "confirmed")
      return t(
        "Historical import · clinician check needed",
        "Ներմուծված նախկին հետազոտություն · անհրաժեշտ է բժշկի ստուգում", "Импорт предыдущего отчёта · нужна проверка врача"
      );
    if (r.state === "needs_review")
      return t(
        "Extraction needs clinician review",
        "Անհրաժեշտ է բժշկի կողմից ընթերցվածի ստուգում", "Извлечённые данные требуют проверки врача"
      );
    return t(
      "Not saved as results yet · open to retry",
      "Դեռ չի պահվել որպես արդյունք · բացել և կրկնել", "Результаты ещё не сохранены · откройте для повторной попытки"
    );
  }
  async function process(r: ReportRecord) {
    await command({ op: "extract", id: r.id, revision: r.revision });
    const rows = await refresh();
    const updated = rows.find((x) => x.id === r.id);
    if (updated) choose(updated);
  }
  const errorText: Record<string, string> = {
    invalid_date: t(
      "Use a valid report date, such as 2025-09-12. Leave it blank if unknown.",
      "Մուտքագրեք ճիշտ ամսաթիվ, օրինակ՝ 2025-09-12։ Եթե անհայտ է, թողեք դատարկ։", "Укажите корректную дату отчёта, например 2025-09-12. Оставьте поле пустым, если дата неизвестна."
    ),
    duplicate: t(
      "This report is already in your history. Open the existing copy.",
      "Այս փաստաթուղթն արդեն պատմության մեջ է։ Բացեք առկա օրինակը։", "Этот отчёт уже есть в вашей истории. Откройте существующую копию."
    ),
    daily_limit: t(
      "Today’s processing limit has been reached. Try again tomorrow.",
      "Այսօրվա մշակման սահմանաչափը սպառվել է։ Փորձեք վաղը։", "Достигнут дневной лимит обработки. Попробуйте завтра."
    ),
    conflict: t(
      "This report changed or is still processing. Refresh the list before trying again.",
      "Փաստաթուղթը փոխվել է կամ մշակվում է։ Թարմացրեք ցանկը։", "Этот отчёт изменился или ещё обрабатывается. Обновите список перед повторной попыткой."
    ),
    invalid_file: t(
      "We could not read this file. Use an unencrypted PDF of up to 10 pages or a clear JPEG/PNG, up to 8 MB.",
      "Ֆայլը չի ընթերցվում։ Օգտագործեք մինչև 10 էջանոց չգաղտնագրված PDF կամ հստակ JPEG/PNG՝ մինչև 8 ՄԲ։", "Не удалось прочитать файл. Используйте незашифрованный PDF до 10 страниц или чёткий JPEG/PNG размером до 8 МБ."
    ),
    cleanup_pending: t(
      "The report is hidden. File removal is still pending; please contact info@noreon.health.",
      "Փաստաթուղթը թաքցված է։ Ֆայլի հեռացումը դեռ սպասման մեջ է․ կապվեք info@noreon.health հասցեով։", "Отчёт скрыт. Удаление файла ещё не завершено; свяжитесь с info@noreon.health."
    ),
  };
  const groups = new Map<string, Array<{ date: string; value: number }>>();
  for (const r of reports.filter((r) => r.state === "confirmed")) {
    const parsed = extractionSchema.safeParse(r.reviewed);
    if (parsed.success)
      for (const p of trendPoints(parsed.data)) {
        const key = `${p.marker} · ${p.unit}`;
        groups.set(key, [
          ...(groups.get(key) ?? []),
          { date: p.date, value: p.value },
        ]);
      }
  }
  const GuidanceHeading = doctorName ? "h3" : "h1";
  const guidance = <>
      <header>
        <p className="text-caption text-brand-teal">
          {t(
            !demo ? "Your health history" : memory?.shared ? "Doctor review · shared reports" : "Doctor review · temporary reports",
            !demo ? "Ձեր առողջության պատմությունը" : "Բժշկի վերանայում · ժամանակավոր փաստաթղթեր", !demo ? "История вашего здоровья" : memory?.shared ? "Проверка врачом · общие отчёты" : "Проверка врачом · временные отчёты"
          )}
        </p>
        <GuidanceHeading className={doctorName ? "mt-2 text-h3" : "mt-2 text-h1"}>
          {t(
            doctorName ? "Review historical reports" : !demo ? "Your reports" : "Review uploaded reports",
            doctorName ? "Վերանայել նախկին հետազոտությունները" : !demo ? "Ձեր հետազոտությունները" : "Վերանայել վերբեռնված փաստաթղթերը", doctorName ? "Проверить предыдущие отчёты" : !demo ? "Ваши отчёты" : "Проверить загруженные отчёты"
          )}
        </GuidanceHeading>
        <p className="mt-3 text-body2 text-muted-foreground">
          {t(
            doctorName
              ? "Compare each imported report with its source and check the extracted values. The doctor can approve each report for the plan; it appears in the member view only when the overall plan is approved."
              : !demo && !enabled
              ? embedded ? "Read your saved reports and download the originals. Choose Add earlier results from the chat menu to add a report." : "Read your saved reports and download the originals. To add an earlier report, use Add earlier results in Progress."
              : demo && !demoAi
              ? "Preview how a report becomes a checked history. Personal file uploads are not available here yet."
              : demo
                ? "Check the source and extraction. Reports appear after the plan is approved."
                : "Add an old report, check the extracted values and keep a clear history. Summaries show the checked source values without choosing a diagnosis or treatment.",
            doctorName
              ? "Համեմատեք ներմուծված յուրաքանչյուր փաստաթուղթը բնօրինակի հետ և ստուգեք ընթերցված արժեքները։ Բժիշկը կարող է հաստատել յուրաքանչյուր փաստաթուղթը ծրագրի համար․ այն անդամին կցուցադրվի միայն ամբողջական ծրագրի հաստատումից հետո։"
              : !demo && !enabled
              ? embedded ? "Դիտեք պահված հետազոտությունները և ներբեռնեք բնօրինակները։ Ավելացնելու համար զրույցի ցանկից ընտրեք «Ավելացնել նախկին արդյունքներ»։" : "Դիտեք պահված հետազոտությունները և ներբեռնեք բնօրինակները։ Նախկին հետազոտություն ավելացնելու համար օգտագործեք «Ավելացնել նախկին արդյունքներ»՝ «Առաջընթաց» բաժնում։"
              : demo && !demoAi
              ? "Տեսեք՝ ինչպես է հետազոտությունը դառնում ստուգված պատմություն։ Անձնական ֆայլերի վերբեռնումն այստեղ դեռ հասանելի չէ։"
              : demo
                ? "Փորձեք հետազոտությունը իրական AI-ով։ Ստուգեք յուրաքանչյուր արժեքը բնօրինակի հետ։ Արդյունքները ժամանակավոր են և բժշկական խորհուրդ չեն։"
                : "Ավելացրեք նախկին հետազոտություն, ստուգեք ընթերցված արժեքները և պահեք պատմությունը։ AI բացատրությունները տեղեկատու են և չեն փոխարինում բժշկական խորհրդին։", doctorName ? "Сравните каждый импортированный отчёт с оригиналом и проверьте извлечённые значения. Врач может утвердить каждый отчёт для плана лечения; участник увидит его только после утверждения всего плана лечения." : !demo && !enabled ? embedded ? "Просматривайте сохранённые отчёты и скачивайте оригиналы. Чтобы добавить отчёт, выберите предыдущие результаты в меню чата." : "Просматривайте сохранённые отчёты и скачивайте оригиналы. Чтобы добавить предыдущий отчёт, выберите добавление прежних результатов в разделе прогресса." : demo && !demoAi ? "Посмотрите, как отчёт становится проверенной записью в истории. Загрузка личных файлов здесь пока недоступна." : demo ? "Проверьте оригинал и извлечённые данные. Отчёты появятся после утверждения плана лечения." : "Добавьте предыдущий отчёт, проверьте извлечённые значения и сохраните историю. Резюме показывает проверенные исходные значения без выбора диагноза или лечения."
          )}
        </p>
      </header>
      {(demo || enabled) && <ol
        className="grid divide-y rounded-xl border bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0"
        aria-label={t(
          doctorName ? "Report review steps" : "Report import steps",
          doctorName ? "Փաստաթղթի վերանայման քայլերը" : "Ներմուծման քայլերը", doctorName ? "Этапы проверки отчёта" : "Этапы импорта отчёта"
        )}
      >
        {[
          [
            "1",
            doctorName
              ? t("Open a historical report", "Բացել նախկին հետազոտությունը", "Открыть предыдущий отчёт")
              : t("Upload a report", "Վերբեռնել հետազոտություն", "Загрузить отчёт"),
            t(
              doctorName
                ? "Select an imported report"
                : demoAi || enabled
                  ? "PDF or photo"
                  : "PDF or photo, when enabled",
              doctorName
                ? "Ընտրեք ներմուծված հետազոտությունը"
                : demoAi || enabled
                  ? "PDF կամ լուսանկար"
                  : "PDF կամ լուսանկար՝ միացնելուց հետո", doctorName ? "Выберите импортированный отчёт" : demoAi || enabled ? "PDF или фото" : "PDF или фото, когда функция доступна"
            ),
          ],
          [
            "2",
            doctorName
              ? t("Check the source and extraction", "Ստուգել բնօրինակն ու ընթերցվածը", "Проверить оригинал и извлечённые данные")
              : t("Check the AI extraction", "Ստուգել AI-ի ընթերցումը", "Проверить данные, извлечённые ИИ"),
            t(
              doctorName
                ? "Compare dates, values and units"
                : "Review dates, values and units",
              doctorName
                ? "Համեմատեք ամսաթվերը, արժեքներն ու միավորները"
                : "Ստուգել ամսաթվերը, արժեքներն ու միավորները", doctorName ? "Сравните даты, значения и единицы измерения" : "Проверьте даты, значения и единицы измерения"
            ),
          ],
          [
            "3",
            doctorName
              ? t("Approve for the care plan", "Հաստատել խնամքի ծրագրի համար", "Утвердить для плана лечения")
              : t(
                  demo && !memory?.shared ? "Review in this tab" : "Save your history",
                  demo ? "Վերանայել այս էջում" : "Պահել պատմությունը", demo && !memory?.shared ? "Проверить в этой вкладке" : "Сохранить историю"
                ),
            t(
              doctorName
                ? "Released only with the approved overall plan"
                : "Explore trends and explanations",
              doctorName
                ? "Հրապարակվում է միայն ամբողջական ծրագրի հաստատման հետ"
                : "Դիտել փոփոխություններն ու բացատրությունները", doctorName ? "Публикуется только вместе с утверждённым планом лечения" : "Изучите динамику и объяснения"
            ),
          ],
        ].map(([step, title, detail]) => (
          <li key={step} className="flex gap-3 px-4 py-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-subtle-teal text-caption font-semibold text-brand-navy">
              {step}
            </span>
            <div>
              <p className="text-body2 font-semibold">{title}</p>
              <p className="mt-1 text-caption text-muted-foreground">
                {detail}
              </p>
            </div>
          </li>
        ))}
      </ol>}</>;
  return (
    <div className="space-y-6">
      {doctorName ? <details className="group/report-disclosure"><ReportDisclosureSummary>{t("Report review guide", "Report review guide", "Руководство по проверке отчётов")}</ReportDisclosureSummary>{guidance}</details> : guidance}
      {demo && !demoAi && (
        <p className="text-body2 text-muted-foreground">
          {t(
            "Real uploads belong in a verified account on app.noreon.health. That feature is still awaiting sign-in and upload testing; switching sites will not enable it yet.",
            "Իրական վերբեռնումները նախատեսված են app.noreon.health-ի հաստատված հաշվի համար։ Դեռ անհրաժեշտ են մուտքի և վերբեռնման փորձարկումները․ կայքը փոխելը դեռ չի միացնի այն։", "Загрузка личных файлов доступна в подтверждённом аккаунте на app.noreon.health. Эта функция ещё ожидает проверки входа и загрузки; переход на другой сайт пока не сделает её доступной."
          )}
        </p>
      )}
      {demo && demoAi && !doctorName && (
        <DemoUpload
          locale={locale}
          disabled={!!busy}
          onBusy={(value) =>
            setBusy(
              value
                ? t("Reading your report…", "Հետազոտությունն ընթերցվում է…", "Читаем ваш отчёт…")
                : "",
            )
          }
          remainingSlots={10 - (memory?.reports.length ?? 0)}
          onReport={async (r, source) => {
            await memory?.add(r, source);
            choose(r);
          }}
        />
      )}
      {demo && !doctorName ? (
        <section className="space-y-3 rounded-2xl border bg-muted/40 p-5">
          <h2 className="text-h3">
            {t("Or try sample reports", "Կամ փորձեք օրինակները", "Или попробуйте примеры отчётов")}
          </h2>
          <p className="my-3 text-body2">
            {t(
              "Sample reports send no AI requests. Loading them replaces the report open below. Changes are temporary.",
              "Այս հորինված օրինակները AI հարցում չեն ուղարկում։ Դրանք բեռնելը փոխարինում է ստորև բացված հետազոտությունը։ Փոփոխությունները ժամանակավոր են։", "Примеры отчётов не отправляют запросы ИИ. Их загрузка заменит отчёт, открытый ниже. Изменения временные."
            )}
          </p>
          <button
            className={button}
            disabled={!!busy}
            onClick={() => {
              clearOriginals();
              const rows = sampleReports();
              setReports(rows);
              choose(rows[0]);
            }}
          >
            <FolderSync className="size-4 shrink-0" aria-hidden />
            {t("Load sample reports", "Բեռնել օրինակները", "Загрузить примеры отчётов")}
          </button>
        </section>
      ) : !demo && !enabled ? null : !demo ? (
        <section className="space-y-4 rounded-2xl border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-h2"><FileUp className="size-5 shrink-0 text-brand-teal" aria-hidden />
            {t("Add a previous report", "Ավելացնել նախկին հետազոտություն", "Добавить предыдущий отчёт")}
          </h2>
          <div className="space-y-1 text-body2">
            <p>{t(
              "PDF, JPEG or PNG · up to 8 MB · PDF up to 10 pages",
              "PDF, JPEG կամ PNG · մինչև 8 ՄԲ · PDF մինչև 10 էջ", "PDF, JPEG или PNG · до 8 МБ · PDF до 10 страниц"
            )}</p>
            <FilePicker
              locale={locale}
              disabled={!!busy}
              accept="application/pdf,image/jpeg,image/png"
              files={file ? [file] : []}
              onFiles={(files) => setFile(files[0] ?? null)}
            />
          </div>
          <label className="flex items-start gap-3 text-body2">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-1 size-5 shrink-0 accent-brand-teal"
            />
            {t("I agree to send this report to OpenAI for reading the report.", "Համաձայն եմ այս հետազոտությունն ուղարկել OpenAI՝ տվյալների ընթերցման համար։", "Я согласен отправить этот отчёт в OpenAI для чтения данных.")}
          </label>
          <details className="group/report-disclosure rounded-md border p-3 text-body2">
            <ReportDisclosureSummary>{t("Privacy and storage details", "Գաղտնիության և պահպանման մանրամասներ", "Конфиденциальность и хранение")}</ReportDisclosureSummary>
            <p className="mt-3 text-muted-foreground">
              {t(
                "The report is sent to OpenAI for reading the report. OpenAI may retain content for abuse monitoring. Noreon stores the report privately in your account.",
                "Հետազոտությունն ուղարկվում է OpenAI՝ ընթերցման համար։ OpenAI-ը կարող է պահպանել բովանդակությունը չարաշահումների վերահսկման նպատակով։ Noreon-ը հետազոտությունը պահում է ձեր անձնական հաշվում։", "Отчёт отправляется в OpenAI для чтения данных. OpenAI может сохранять содержимое для контроля злоупотреблений. Noreon конфиденциально хранит отчёт в вашем аккаунте."
              )}
            </p>
          </details>
          <button
            className={button}
            disabled={!file || !consent || !!busy}
            onClick={() =>
              run(
                t(
                  "Uploading and reading your report…",
                  "Փաստաթուղթը վերբեռնվում և ընթերցվում է…", "Загружаем и читаем ваш отчёт…"
                ),
                async () => {
                  if (
                    !file ||
                    file.size > MAX_BYTES ||
                    !MIME_TYPES.includes(
                      file.type as (typeof MIME_TYPES)[number],
                    )
                  )
                    throw new Error("invalid_file");
                  const u = await command({
                    op: "upload",
                    name: file.name,
                    mime: file.type,
                    size: file.size,
                    consent: CONSENT,
                  });
                  const upload = await createClient()
                    .storage.from("patient-reports")
                    .uploadToSignedUrl(u.path, u.token, file, {
                      contentType: file.type,
                    });
                  if (upload.error) throw new Error("upload_failed");
                  await refresh();
                  await process({ id: u.id, revision: 0 } as ReportRecord);
                  setFile(null);
                },
              )
            }
          >
            <FileUp className="size-4 shrink-0" aria-hidden />
            {t("Upload and extract", "Վերբեռնել և ընթերցել", "Загрузить и извлечь данные")}
          </button>
        </section>
      ) : null}
      {busy && (
        <p role="status" className="rounded-lg bg-muted p-4">
          {busy}
        </p>
      )}
      {(error || (demo && memory?.persistenceError)) && (
        <p
          role="alert"
          className="rounded-lg border border-destructive p-4 text-body2"
        >
          {(demo && memory?.persistenceError) || errorText[error] ||
            t(
              "We could not finish this step. Your saved records are unchanged. Refresh and try again.",
              "Այս քայլը չհաջողվեց։ Պահված գրառումները չեն փոխվել։ Թարմացրեք և փորձեք կրկին։", "Не удалось завершить этот шаг. Сохранённые записи не изменились. Обновите страницу и попробуйте снова."
            )}
        </p>
      )}
      {(!demo || !!reports.length) && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-h2">
              {t(
                doctorName ? "Imported reports" : !demo ? "Saved reports" : "Your reports",
                doctorName ? "Ներմուծված հետազոտություններ" : !demo ? "Պահված հետազոտություններ" : "Ձեր փաստաթղթերը", doctorName ? "Импортированные отчёты" : !demo ? "Сохранённые отчёты" : "Ваши отчёты"
              )}
            </h2>
            {!demo && (
              <button
                disabled={!!busy}
                className={quietButton}
                onClick={() =>
                  run(t("Refreshing…", "Թարմացվում է…", "Обновляем…"), async () => {
                    const rows = await refresh();
                    if (selected) {
                      const r = rows.find((x) => x.id === selected);
                      if (r) choose(r);
                      else setSelected(null);
                    }
                  })
                }
              >
                <RefreshCw className="size-4 shrink-0" aria-hidden />
                {t("Refresh", "Թարմացնել", "Обновить")}
              </button>
            )}
          </div>
          {historyLoading && <p role="status" className="text-body2 text-muted-foreground">{t("Loading your reports…", "Ձեր հետազոտությունները բեռնվում են…", "Загружаем ваши отчёты…")}</p>}
          {!demo && !historyLoading && !error && !reports.length && <p className="text-body2 text-muted-foreground">{t("You have no saved reports yet.", "Դուք դեռ չունեք պահված հետազոտություններ։", "У вас пока нет сохранённых отчётов.")}</p>}
          {reports.map((r) => (
            <button
              disabled={!!busy}
              key={r.id}
              aria-pressed={selected === r.id}
              className={`flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-colors hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:opacity-50 ${selected === r.id ? "border-brand-teal bg-surface-subtle-teal" : "border-border bg-card"}`}
              onClick={() => choose(r)}
            >
              <FileText className="size-5 shrink-0 text-brand-teal" aria-hidden />
              <span className="min-w-0 flex-1"><span className="block break-words text-body2 font-semibold">
                {r.file_name}
              </span>
              <span className="mt-1 block text-caption">
                {reportListStatus(r)}
              </span></span>
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            </button>
          ))}
        </section>
      )}
      {record && (
        <section className="min-w-0 space-y-5 rounded-2xl border bg-card p-5 sm:p-6">
          <p className="break-words text-body1 font-semibold">{record.file_name}</p>
          <p className="text-caption text-muted-foreground">{reportListStatus(record)}</p>
          <h2 className="text-h2">
            {t(
              doctorName ? "Check against the original" : "Check against your original",
              "Համեմատեք բնօրինակի հետ", doctorName ? "Сверить с оригиналом" : "Сверить с вашим оригиналом"
            )}
          </h2>
          {doctorName && demo && record.model !== 'Simulated' && (
            <p className="rounded-lg bg-muted p-3 text-body2">
              {record.extraction_provenance?.status === 'verified'
                ? t('Extraction source verified against this original file. Check the values before approving.', 'Ընթերցման աղբյուրը ստուգված է այս բնօրինակի նկատմամբ։ Հաստատելուց առաջ ստուգեք արժեքները։', "Источник извлечённых данных подтверждён для этого исходного файла. Проверьте значения перед утверждением.")
                : t('Unverified extraction source. This older draft has no server proof of its origin. Check every value against the original before approving.', 'Ընթերցման աղբյուրը ստուգված չէ։ Այս հին սևագրի ծագումը սերվերով հաստատված չէ։ Հաստատելուց առաջ յուրաքանչյուր արժեք համեմատեք բնօրինակի հետ։', "Источник извлечённых данных не подтверждён. У этого старого черновика нет серверного подтверждения происхождения. Перед утверждением сверьте каждое значение с оригиналом.")}
            </p>
          )}
          {demo && originalUrls[record.id] && (
            <a
              className={quietButton}
              href={originalUrls[record.id]}
              download={record.file_name}
            >
              <Download className="size-4 shrink-0" aria-hidden />
              {t(
                doctorName ? "Download source report" : "Download your original for comparison",
                "Ներբեռնել բնօրինակը համեմատելու համար", doctorName ? "Скачать исходный отчёт" : "Скачать ваш оригинал для сравнения"
              )}
            </a>
          )}
          {!demo && (
            <a
              className={quietButton}
              href={`/api/patient/reports/${record.id}/original`}
              {...FILE_LINK}
            >
              <Download className="size-4 shrink-0" aria-hidden />
              {t("Download original report", "Ներբեռնել բնօրինակը", "Скачать оригинал отчёта")}
            </a>
          )}
          {draft && previewUrl && (
            <details className="group/report-disclosure rounded-lg border p-3">
              <ReportDisclosureSummary>
                {t(
                  "View original alongside these fields",
                  "Դիտել բնօրինակը դաշտերի կողքին", "Показать оригинал рядом с этими полями"
                )}
              </ReportDisclosureSummary>
              <p className="mb-3 text-body2 text-muted-foreground">{t("If the preview is blank or unavailable, use the original report link above.", "Եթե նախադիտումը դատարկ է կամ անհասանելի, օգտվեք վերևի բնօրինակ հետազոտության հղումից։", "Если предпросмотр пуст или недоступен, воспользуйтесь ссылкой на оригинал отчёта выше.")}</p>
              {record.mime === "application/pdf" ? (
                <iframe
                  title={t("Original report", "Փաստաթղթի բնօրինակ", "Оригинал отчёта")}
                  className="h-96 w-full"
                  src={previewUrl}
                />
              ) : (
                <Image
                  unoptimized
                  width={1200}
                  height={1600}
                  alt={t("Original report", "Փաստաթղթի բնօրինակ", "Оригинал отчёта")}
                  className="h-auto w-full"
                  src={previewUrl}
                />
              )}
            </details>
          )}
          {!!advisories.length && <div role="note" className="rounded-lg border p-4 text-body2"><p className="font-medium">{t("Check source identity and date", "Check source identity and date", "Проверьте, кому принадлежит отчёт, и его дату")}</p><ul className="mt-2 list-inside list-disc">{advisories.map(code=><li key={code}>{({"name-missing":t("The source name is missing. Verify whose report this is.", "The source name is missing. Verify whose report this is.", "В оригинале не указано имя. Проверьте, кому принадлежит отчёт."),"name-differs":"The extracted name differs from the member’s name. Verify the original before saving.","date-missing":t("The report date is missing. Verify it against the original.", "The report date is missing. Verify it against the original.", "Дата отчёта отсутствует. Уточните её по оригиналу."),"possible-duplicate":t("Another checked report has the same dated rows. Check whether this is a duplicate.", "Another checked report has the same dated rows. Check whether this is a duplicate.", "В другом проверенном отчёте есть такие же строки с той же датой. Проверьте, не является ли это дубликатом.")})[code]}</li>)}</ul><p className="mt-2">{t("These checks are advisory; confirm against the original.", "These checks are advisory; confirm against the original.", "Эти проверки носят рекомендательный характер; сверьтесь с оригиналом.")}</p></div>}
          {!draft && (
            <button
              className={button}
              disabled={!!busy || !writesAvailable}
              onClick={() =>
                run(
                  t("Reading your report…", "Փաստաթուղթը ընթերցվում է…", "Читаем ваш отчёт…"),
                  () => process(record),
                )
              }
            >
              <RefreshCw className="size-4 shrink-0" aria-hidden />
              {t("Try extraction again", "Կրկին ընթերցել", "Повторить извлечение данных")}
            </button>
          )}
          {draft && (
            <>
              <p className="text-body2">
                {t(
                  "AI can misread numbers. Check every result, unit and date. Leave uncertain values marked until you have checked the source.",
                  "AI-ը կարող է սխալ կարդալ թվերը։ Ստուգեք յուրաքանչյուր արժեքը, միավորը և ամսաթիվը։ Անորոշ արժեքները նշված թողեք մինչև բնօրինակի ստուգումը։", "ИИ может неверно прочитать числа. Проверьте каждый результат, единицу измерения и дату. Сохраняйте отметку неопределённости, пока не сверите значение с оригиналом."
                )}
              </p>
              <p className="text-body2">
                {t("Name on report", "Փաստաթղթի անունը", "Имя в отчёте")}:{" "}
                {draft.personName ?? t("Not found", "Չի գտնվել", "Не найдено")}
              </p>
              {!demo &&
                draft.personName &&
                draft.personName
                  .normalize("NFKC")
                  .trim()
                  .toLocaleLowerCase() !==
                  memberName.normalize("NFKC").trim().toLocaleLowerCase() && (
                  <p className="rounded-lg border p-3 text-body2">
                    {t(
                      "The name on this report differs from your profile. Check that it belongs to you before saving.",
                      "Փաստաթղթի անունը տարբերվում է ձեր պրոֆիլից։ Նախքան պահելը համոզվեք, որ այն ձերն է։", "Имя в этом отчёте отличается от имени в вашем профиле. Перед сохранением проверьте, что отчёт принадлежит вам."
                    )}
                  </p>
                )}
              {draft.summary && (
                <div className="text-body2">
                  <h3 className="font-semibold">
                    {t(
                      "Extracted document summary",
                      "Փաստաթղթից ընթերցված ամփոփում", "Извлечённое резюме документа"
                    )}
                  </h3>
                  <p>{sourceBoundExtractionNarrative(draft).summary}</p>
                </div>
              )}
              {sourceBoundExtractionNarrative(draft).warnings.map((w, i) => (
                <p key={i} className="text-caption text-muted-foreground">
                  {w}
                </p>
              ))}
              {!writesAvailable && <p className="text-body2 text-muted-foreground">{t("Saved report details are read-only while corrections are unavailable.", "Պահված հետազոտության տվյալները միայն դիտելու համար են․ ուղղումները հասանելի չեն։", "Данные сохранённого отчёта доступны только для чтения, пока исправления недоступны.")}</p>}
              <label className="block text-body2">
                {t(
                  "Collection date (YYYY-MM-DD, blank if unknown)",
                  "Նմուշառման ամսաթիվ (YYYY-MM-DD, դատարկ՝ անհայտ լինելու դեպքում)", "Дата взятия образца (ГГГГ-ММ-ДД, оставьте пустым, если неизвестна)"
                )}
                <input
                  className={inputClass}
                  inputMode="numeric"
                  placeholder="2025-09-12"
                  maxLength={10}
                  disabled={!writesAvailable}
                  value={draft.reportDate ?? ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reportDate:
                        e.target.value
                          .replace(/[^0-9]/g, "")
                          .slice(0, 8)
                          .replace(/^(\d{4})(\d)/, "$1-$2")
                          .replace(/^(\d{4}-\d{2})(\d)/, "$1-$2") || null,
                    })
                  }
                />
              </label>
              {draft.rows.map((r, i) => (
                <fieldset key={i} className="min-w-0 space-y-3 border-t py-4">
                  <legend className="sr-only">{r.name}</legend>
                  <SourceResultRow row={r} locale={locale}/>
                  <p className="text-caption">
                    {t("Source page", "Աղբյուրի էջ", "Страница источника")} {r.page}: {r.snippet}
                  </p>
                  <details className="group/report-disclosure" open={record.state !== "confirmed"}>
                  <ReportDisclosureSummary>{t("Check or correct source fields", "Ստուգել կամ ուղղել աղբյուրի դաշտերը", "Проверить или исправить исходные поля")}</ReportDisclosureSummary>
                  <div className="grid gap-3">
                    {(["name", "literal", "unit", "reference"] as const).map(
                      (field) => (
                        <label className="block text-body2" key={field}>
                          {field === "name"
                            ? t("Test name", "Հետազոտություն", "Название исследования")
                            : field === "literal"
                              ? t(
                                  "Result as written",
                                  "Արդյունքը՝ ինչպես գրված է", "Результат как в оригинале"
                                )
                              : field === "unit"
                                ? t("Unit", "Միավոր", "Единица измерения")
                                : t("Lab reference", "Լաբորատոր միջակայք", "Референсный интервал лаборатории")}
                          <input
                            className={inputClass}
                            disabled={!writesAvailable}
                            value={r[field] ?? ""}
                            maxLength={
                              field === "literal"
                                ? 200
                                : field === "unit"
                                  ? 60
                                  : 160
                            }
                            onChange={(e) =>
                              setDraft({
                                ...draft,
                                rows: draft.rows.map((x, n) =>
                                  n === i
                                    ? {
                                        ...x,
                                        [field]:
                                          e.target.value ||
                                          (field === "unit" ||
                                          field === "reference"
                                            ? null
                                            : ""),
                                      }
                                    : x,
                                ),
                              })
                            }
                          />
                        </label>
                      ),
                    )}
                  </div>
                  <label className="flex items-center gap-3 text-body2">
                    <input
                      type="checkbox"
                      checked={r.uncertain}
                      disabled={!writesAvailable}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          rows: draft.rows.map((x, n) =>
                            n === i ? { ...x, uncertain: e.target.checked } : x,
                          ),
                        })
                      }
                    />
                    {t(
                      "Still uncertain · do not plot this value",
                      "Դեռ անորոշ է · չներառել գրաֆիկում", "Всё ещё неясно · не показывать это значение на графике"
                    )}
                  </label>
                  </details>
                </fieldset>
              ))}
              {!draft.rows.length && (
                <p className="text-body2">
                  {t(
                    "No laboratory rows were found. This report can be saved as a document, but it will not add graph points.",
                    "Լաբորատոր տողեր չեն գտնվել։ Փաստաթուղթը կարող եք պահել, սակայն այն չի ավելացնի գրաֆիկի կետեր։", "Лабораторные строки не найдены. Этот отчёт можно сохранить как документ, но он не добавит точки на график."
                  )}
                </p>
              )}
              <label className="flex items-start gap-3 text-body2">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 accent-brand-teal"
                  checked={mine}
                  disabled={!writesAvailable}
                  onChange={(e) => setMine(e.target.checked)}
                />
                {t(
                  demo
                    ? "I have checked these fields against the original. This confirmation is not a clinician review."
                    : "This is my report and I have checked these fields. This confirmation is not a clinician review.",
                  demo
                    ? "Ստուգել եմ այս դաշտերը բնօրինակի հետ։ Այս հաստատումը բժշկական վերանայում չէ։"
                    : "Սա իմ փաստաթուղթն է, և ես ստուգել եմ դաշտերը։ Այս հաստատումը բժշկական վերանայում չէ։", demo ? "Подтверждаю сверку этих полей с оригиналом. Это подтверждение не является проверкой врача." : "Подтверждаю, что это мой отчёт и эти поля проверены. Это подтверждение не является проверкой врача."
                )}
              </label>
              <button
                className={button}
                disabled={!mine || !!busy || !writesAvailable}
                onClick={() =>
                  run(t("Saving…", "Պահվում է…", "Сохраняем…"), async () => {
                    const valid = validateReview(draft);
                    if (demo) {
                      setReports(
                        reports.map((r) =>
                          r.id === record.id
                            ? {
                                ...r,
                                reviewed: JSON.parse(JSON.stringify(valid)),
                                state: "confirmed",
                                revision: r.revision + 1,
                                explanation: null,
                              }
                            : r,
                        ),
                      );
                      setMine(false);
                    } else {
                      await command({
                        op: "confirm",
                        id: record.id,
                        revision: record.revision,
                        review: valid,
                        mine: true,
                      });
                      const rows = await refresh();
                      choose(rows.find((r) => r.id === record.id)!);
                    }
                  })
                }
              >
                <Save className="size-4 shrink-0" aria-hidden />
                {t(
                  demo && !memory?.shared
                    ? "Keep checked results in this tab"
                    : "Save checked results",
                  demo && !memory?.shared
                    ? "Պահել ստուգված արդյունքներն այս էջում"
                    : "Պահել ստուգված արդյունքները", demo && !memory?.shared ? "Сохранить проверенные результаты в этой вкладке" : "Сохранить проверенные результаты"
                )}
              </button>
              {record.state === "confirmed" && (
                <div className="space-y-3 border-t pt-5">
                  <h3 className="text-h3">
                    {t("Report summary", "Հետազոտության ամփոփում", "Резюме отчёта")}
                  </h3>
                  <p className="text-caption text-muted-foreground">
                    {t(
                      "Based on the last saved version. Educational information, not a diagnosis or treatment plan.",
                      "Հիմնված է վերջին պահված տարբերակի վրա։ Տեղեկատու է, ոչ ախտորոշում կամ բուժման պլան։", "На основе последней сохранённой версии. Информация для ознакомления, а не диагноз или план лечения."
                    )}
                  </p>
                  <button
                    className={button}
                    disabled={!!busy || !writesAvailable}
                    onClick={() =>
                      run(
                        t(
                          "Preparing an explanation…",
                          "Բացատրությունը պատրաստվում է…", "Готовим объяснение…"
                        ),
                        async () => {
                          if (demo && memory?.shared && record.model !== "Simulated") {
                            const result = await demoReportCommand({
                              op: "explain",
                              consent: true,
                              locale: clinicalLocale(locale),
                              ...(memory?.shared ? {reportId:record.id,reportRevision:record.revision,contentRevision:record.contentRevision??0} : {reviewed:explanationInput(record.reviewed)}),
                            });
                            const explanation = explanationSchema.parse(
                              result.explanation,
                            );
                            setReports((rows) =>
                              applyReportExplanation(
                                rows,
                                record.id,
                                record.revision,
                                explanation,
                              ),
                            );
                          } else if (demo) {
                            const checked=validateReview(record.reviewed);
                            setReports(rows=>applyReportExplanation(rows,record.id,record.revision,sourceBoundExplanation(checked,clinicalLocale(locale))));
                          }
                          else {
                            await command({
                              op: "explain",
                              id: record.id,
                              revision: record.revision,
                              locale: clinicalLocale(locale),
                            });
                            await refresh();
                          }
                        },
                      )
                    }
                  >
                    <Sparkles className="size-4 shrink-0" aria-hidden />
                    {t("Explain saved results", "Բացատրել պահված արդյունքները", "Объяснить сохранённые результаты")}
                  </button>
                  <ReportExplanation
                    value={record.explanation}
                    reviewed={record.reviewed}
                    locale={locale}
                  />
                </div>
              )}
            </>
          )}
          {doctorName && workflow && record.state === "confirmed" && <ReportAssociations key={`${record.id}-${record.contentRevision??0}`} record={record} workflow={workflow} doctorName={doctorName} disabled={!!busy || !sameReportContent(draft,record.reviewed)} />}
          {doctorName && record.state === "confirmed" && (
            <div className="space-y-3 rounded-xl border bg-surface-subtle-teal p-5">
              <h3 className="text-h3">
                {t(
                  "Prepare this report for publication",
                  "Պատրաստել հրապարակման", "Подготовить этот отчёт к публикации"
                )}
              </h3>
              <p className="text-body2">
                {t(
                  "Review the explanation below, then include this checked version in the package. It stays hidden from the client until you approve and send the complete plan above.",
                  "Ստուգված տարբերակը կհրապարակվի միայն ամբողջական պլանի հաստատումից հետո։", "Проверьте объяснение ниже, затем включите эту проверенную версию в пакет. Участник не увидит её, пока вы не утвердите и не отправите весь план лечения выше."
                )}
              </p>
              <label className="block text-body2">
                {t("Doctor explanation", "Բժշկի բացատրություն", "Объяснение врача")}
                <textarea
                  className={inputClass}
                  rows={4}
                  maxLength={700}
                  value={
                    explanationSchema.safeParse(record.explanation).success
                      ? explanationSchema.parse(record.explanation).summary
                      : ""
                  }
                  onChange={(e) =>
                    setReports((rows) =>
                      rows.map((r) =>
                        r.id === record.id
                          ? {
                              ...r,
                              revision: r.revision + 1,
                              explanation: {
                                summary: e.target.value,
                                attention: [],
                                questions: [],
                                items: [],
                              },
                            }
                          : r,
                      ),
                    )
                  }
                />
              </label>
              <button
                className={button}
                disabled={
                  !!busy ||
                  !explanationSchema.safeParse(record.explanation).success ||
                  !sameReportContent(draft,record.reviewed)
                }
                onClick={() =>
                  run(t("Saving approval…", "Հաստատումը պահվում է…", "Сохраняем утверждение…"), async () => {
                    await memory?.approve(record, doctorName);
                  })
                }
              >
                <ShieldCheck className="size-4 shrink-0" aria-hidden />
                {t(
                  "Include checked report in publication",
                  "Ներառել ստուգված փաստաթուղթը հրապարակման մեջ", "Включить проверенный отчёт в публикацию"
                )}
              </button>
              {memory?.approvals[record.id]?.revision === record.revision && (
                <p role="status" className="text-body2">
                  {t(
                    "Ready. Approve the complete plan above to send it.",
                    "Պատրաստ է։ Հաստատեք ամբողջական պլանը՝ ուղարկելու համար։", "Готово. Утвердите весь план лечения выше, чтобы отправить его."
                  )}
                </p>
              )}
            </div>
          )}
          {!doctorName && <div className="border-t pt-4">
            {remove ? (
              <div className="space-y-3">
                <p className="text-body2">
                  {t(
                    demo
                      ? "Clear this report and its results from this tab?"
                      : "Remove this report and its imported results? Access is removed immediately. File cleanup completes after any pending upload expires, within 48 hours.",
                    demo
                      ? "Մաքրե՞լ հետազոտությունն ու արդյունքներն այս էջից։"
                      : "Հեռացնե՞լ փաստաթուղթն ու արդյունքները։ Հասանելիությունը փակվում է անմիջապես, ֆայլի մաքրումն ավարտվում է մինչև 48 ժամում։", demo ? "Удалить этот отчёт и его результаты из этой вкладки?" : "Удалить этот отчёт и импортированные результаты? Доступ закроется сразу. Очистка файла завершится после истечения срока ожидающей загрузки, в течение 48 часов."
                  )}
                </p>
                <div className="flex flex-wrap gap-3">
                <button
                  disabled={!!busy}
                  className={button}
                  onClick={() =>
                    run(t("Removing…", "Հեռացվում է…", "Удаляем…"), async () => {
                      if (!demo) await command({ op: "delete", id: record.id });
                      else {
                        memory?.remove(record.id);
                      }
                      setReports(reports.filter((r) => r.id !== record.id));
                      setSelected(null);
                    })
                  }
                >
                  <Trash2 className="size-4 shrink-0" aria-hidden />
                  {t("Remove report", "Հեռացնել փաստաթուղթը", "Удалить отчёт")}
                </button>
                <button
                  className={quietButton}
                  onClick={() => setRemove(false)}
                >
                  <Check className="size-4 shrink-0" aria-hidden />
                  {t("Keep report", "Պահպանել փաստաթուղթը", "Сохранить отчёт")}
                </button>
                </div>
              </div>
            ) : (
              <button
                disabled={!!busy}
                className={quietButton}
                onClick={() => setRemove(true)}
              >
                <Trash2 className="size-4 shrink-0" aria-hidden />
                {t("Remove this report", "Հեռացնել այս փաստաթուղթը", "Удалить этот отчёт")}
              </button>
            )}
          </div>}
        </section>
      )}
      {!!groups.size && !doctorName && (
        <section className="space-y-5">
          <h2 className="text-h2">
            {t("Your imported trends", "Ձեր ներմուծված տվյալների միտումները", "Динамика импортированных результатов")}
          </h2>
          <p className="text-body2 text-muted-foreground">
            {t(
              "Historical, self-confirmed results. Dates and units are kept separate; bounded, uncertain and qualitative results stay in the report.",
              "Նախկին, ձեր կողմից հաստատված արդյունքներ։ Պահպանվում են ամսաթվերն ու միավորները․ սահմանային, անորոշ և որակական արդյունքները մնում են փաստաթղթում։", "Предыдущие результаты, подтверждённые вами. Даты и единицы измерения учитываются отдельно; ограниченные, неопределённые и качественные результаты остаются в отчёте."
            )}
          </p>
          {[...groups].map(([key, points]) => (
            <article key={key} className="rounded-xl border bg-card p-5">
              <h3 className="text-h3">{key}</h3>
              <div className="mt-4 h-52">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={points.sort((a, b) => a.date.localeCompare(b.date))}
                  >
                    <XAxis dataKey="date" />
                    <YAxis domain={["auto", "auto"]} />
                    <Tooltip />
                    <Line
                      type="linear"
                      dataKey="value"
                      stroke="var(--chart-1)"
                      strokeWidth={2}
                      dot={{ r: 4 }}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <details className="group/report-disclosure">
                <ReportDisclosureSummary>
                  <Table2 className="mr-2 inline size-4" aria-hidden />
                  {t("Read values as a table", "Դիտել արժեքներն աղյուսակով", "Показать значения в таблице")}
                </ReportDisclosureSummary>
                <table className="w-full text-body2">
                  <thead>
                    <tr>
                      <th className="text-left">{t("Date", "Ամսաթիվ", "Дата")}</th>
                      <th className="text-right">{t("Value", "Արժեք", "Значение")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {points.map((p, i) => (
                      <tr key={i}>
                        <td>{p.date}</td>
                        <td className="text-right">{p.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
