"use client";
import { pick, type Locale } from "@/lib/locale";
import { FilePicker } from "@/components/patient/file-picker";
import {PROMPT_VERSION} from '@/lib/reports/metadata';
import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { processUploadBatch, type UploadStatus } from "@/lib/reports/upload-batch";
import { extractionSchema } from "@/lib/reports/schema";
import { sampleReports, type ReportRecord } from "@/lib/reports/demo";
import { reportFailureMessage } from "@/lib/reports/feedback";
export async function demoReportCommand(body: unknown) {
  const path = typeof window === "undefined" ? "" : window.location.pathname;
  const staffCase = path.startsWith("/staff/case/") ? path.split("/")[3] : "";
  const endpoint = staffCase
    ? `/staff/ai?caseId=${encodeURIComponent(staffCase)}`
    : "/patient/reports/ai";
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "unavailable");
  return data;
}
export function DemoUpload({
  locale,
  onReport,
  disabled,
  onBusy,
  sharedPersistence = false,
  remainingSlots = 10,
  onError,
  clearErrorVersion = 0,
}: {
  locale: Locale;
  onReport: (report: ReportRecord, file: File) => void | Promise<void>;
  disabled: boolean;
  onBusy: (busy: boolean) => void;
  sharedPersistence?: boolean;
  remainingSlots?: number;
  onError?: (message: string) => void;
  clearErrorVersion?: number;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]),
    [statuses, setStatuses] = useState<UploadStatus[]>([]),
    [fileFailures, setFileFailures] = useState<{index: number; error: string}[]>([]),
    [consent, setConsent] = useState(false),
    [sharedConsent, setSharedConsent] = useState(false),
    [busy, setBusy] = useState(false),
    [errorState, setErrorState] = useState({message: '', version: clearErrorVersion});
  const error = errorState.version === clearErrorVersion ? errorState.message : '';
  const setError = (message: string) => setErrorState({message, version: clearErrorVersion});
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  async function upload() {
    if (!files.length || files.length > remainingSlots || !consent || (sharedPersistence && !sharedConsent) || busy) return;
    setBusy(true);
    onBusy(true);
    setError("");
    setFileFailures([]);
    onError?.('');
    let failures: {index: number; error: string}[] = [];
    try {
      failures = await processUploadBatch(files, async (file) => {
        if (
          !file.size ||
          file.size > 2 * 1024 * 1024 ||
          !["application/pdf", "image/png", "image/jpeg"].includes(file.type)
        )
          throw new Error("invalid_file");
        const encoded = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(",")[1]);
          reader.onerror = () => reject(new Error("invalid_file"));
          reader.readAsDataURL(file);
        });
        const data = await demoReportCommand({
          op: "extract",
          consent: true,
          mime: file.type,
          data: encoded,
        });
        const extraction = extractionSchema.parse(data.extraction);
        const now = new Date().toISOString();
        await onReport(
          {
            ...sampleReports()[0],
            id: crypto.randomUUID(),
            user_id: "temporary-demo",
            file_name: file.name,
            mime: file.type,
            size_bytes: file.size,
            created_at: now,
            consent_at: now,
            consent_version: "demo-openai-v1",
            model: data.model,
            prompt_version: data.prompt_version ?? PROMPT_VERSION,
            extraction_receipt: data.extraction_receipt,
            page_count: data.pages,
            extraction,
            reviewed: null,
            explanation: null,
          },
          file,
        );
      }, (index, status) => setStatuses(previous => previous.map((old, i) => i === index ? status : old)));
      setFileFailures(failures);
      if (failures.length) throw new Error(failures[0].error);
      setConsent(false);
      setSharedConsent(false);
      if (input.current) input.current.value = "";
    } catch (e) {
      const code = e instanceof Error ? e.message : "";
      const message = failures.length > 1
        ? t(`${failures.length} files could not be uploaded. Check the messages beside each file.`, `${failures.length} ֆայլ չի վերբեռնվել։ Ստուգեք յուրաքանչյուր ֆայլի հաղորդագրությունը։`, `${failures.length} файлов не удалось загрузить. Проверьте сообщения рядом с каждым файлом.`)
        : reportFailureMessage(code, locale);
      setError(message);
      onError?.(message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="space-y-4 rounded-xl border bg-card p-5">
      <h2 className="text-h2">
        {t("Upload previous reports", "Վերբեռնել նախկին հետազոտությունը", "Загрузить предыдущие отчёты")}
      </h2>
      <p className="text-body2 text-muted-foreground">
        {t("Select one or more reports for review. Results appear after the plan is approved.", "Վերբեռնեք հետազոտությունը վերանայման համար։ Արդյունքները կհայտնվեն պլանի հաստատումից հետո։", "Выберите один или несколько отчётов для проверки. Результаты появятся после утверждения плана лечения.")}
      </p>
      <div className="space-y-2 text-body2">
        <p>{t(
          "PDF, JPEG or PNG · up to 2 MB per file · up to 10 PDF pages",
          "PDF, JPEG կամ PNG · մինչև 2 ՄԲ · PDF մինչև 10 էջ", "PDF, JPEG или PNG · до 2 МБ на файл · до 10 страниц PDF"
        )}</p>
        <FilePicker
          inputRef={input}
          locale={locale}
          multiple
          accept="application/pdf,image/jpeg,image/png"
          disabled={disabled || busy}
          files={files}
          onFiles={(next) => { setFiles(next); setStatuses(next.map(() => "waiting")); setFileFailures([]); setError(""); onError?.(''); }}
        />
      </div>
      {files.length > remainingSlots && !statuses.some(status => status === "complete") && <p role="alert" className="text-body2">{t(`You can add ${remainingSlots} more reports. Select fewer files.`, `Կարող եք ավելացնել ևս ${remainingSlots} փաստաթուղթ։ Ընտրեք ավելի քիչ ֆայլեր։`, `Вы можете добавить ещё ${remainingSlots} отчётов. Выберите меньше файлов.`)}</p>}
      {!!files.length && <ul className="space-y-2 text-body2" aria-live="polite">{files.map((file, index) => {
        const failure = fileFailures.length > 1 && errorState.version === clearErrorVersion ? fileFailures.find(item => item.index === index) : null;
        return <li key={`${file.name}-${index}`} className="flex flex-wrap justify-between gap-2"><span className="min-w-0 break-words">{file.name}</span><span>{statuses[index] === 'processing' ? t('Processing', 'Մշակվում է', "Обработка") : statuses[index] === 'complete' ? t('Uploaded', 'Վերբեռնված է', "Загружен") : statuses[index] === 'failed' ? t('Not uploaded', 'Չի վերբեռնվել', "Не загружен") : t('Selected', 'Ընտրված է', "Выбран")}</span>{failure && <p className="w-full text-caption text-destructive">{reportFailureMessage(failure.error, locale)}</p>}</li>;
      })}</ul>}
      <label className="flex items-start gap-3 text-body2">
        <input
          type="checkbox"
          className="mt-1 size-5 shrink-0"
          checked={consent}
          disabled={disabled || busy}
          onChange={(e) => setConsent(e.target.checked)}
        />
        {t("I agree to send these reports to OpenAI for reading the report.", "Համաձայն եմ այս հետազոտությունն ուղարկել OpenAI՝ տվյալների ընթերցման համար։", "Я согласен отправить эти отчёты в OpenAI для чтения данных.")}
      </label>
      <details className="group/upload-privacy rounded-lg border p-3 text-body2">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-lg py-2 text-body2 font-semibold transition-colors hover:text-brand-teal focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden"><span className="min-w-0 flex-1">{t("Privacy and storage details", "Գաղտնիության և պահպանման մանրամասներ", "Конфиденциальность и хранение")}</span><ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open/upload-privacy:rotate-180" aria-hidden /></summary>
        <p className="mt-3 text-muted-foreground">
          {t(
            sharedPersistence
              ? "Upload only a report you are allowed to share. The report is sent to OpenAI for reading the report; OpenAI may retain content for abuse monitoring. The original file and extracted report are stored privately for up to 7 days for the assigned doctor and workspace administrators."
              : "Upload only a report you are allowed to share. The report is sent to OpenAI for reading the report; OpenAI may retain content for abuse monitoring. Files stay in tab memory and clear on reload, sign-out or tab close.",
            sharedPersistence
              ? "Վերբեռնեք միայն այն հետազոտությունը, որը կիսելու իրավունք ունեք։ Այն ուղարկվում է OpenAI՝ ընթերցման համար, և OpenAI-ը կարող է պահպանել բովանդակությունը չարաշահումների վերահսկման նպատակով։ Բնօրինակն ու ընթերցված տվյալները մասնավոր ձևով պահվում են մինչև 7 օր՝ կցված բժշկի և ադմինիստրատորների համար։"
              : "Վերբեռնեք միայն այն հետազոտությունը, որը կիսելու իրավունք ունեք։ Այն ուղարկվում է OpenAI՝ ընթերցման համար, և OpenAI-ը կարող է պահպանել բովանդակությունը չարաշահումների վերահսկման նպատակով։ Ֆայլերը մնում են ներդիրի հիշողությունում և մաքրվում են թարմացնելիս, դուրս գալիս կամ փակելիս։", sharedPersistence ? "Загружайте только отчёты, которыми вы имеете право делиться. Отчёт отправляется в OpenAI для чтения данных; OpenAI может сохранять содержимое для контроля злоупотреблений. Исходный файл и извлечённые данные хранятся конфиденциально до 7 дней для проверки назначенным врачом и администраторами рабочего пространства." : "Загружайте только отчёты, которыми вы имеете право делиться. Отчёт отправляется в OpenAI для чтения данных; OpenAI может сохранять содержимое для контроля злоупотреблений. Файлы остаются в памяти вкладки и удаляются при обновлении страницы, выходе из аккаунта или закрытии вкладки."
          )}
        </p>
      </details>
      {sharedPersistence && (
        <label className="flex items-start gap-3 text-body2">
          <input
            type="checkbox"
            className="mt-1 size-5 shrink-0"
            checked={sharedConsent}
            disabled={disabled || busy}
            onChange={(e) => setSharedConsent(e.target.checked)}
          />
          {t(
            "I agree to store these reports privately for up to 7 days for the assigned doctor and workspace administrators to review.",
            "Համաձայն եմ այս հետազոտությունը մինչև 7 օր մասնավոր ձևով պահել՝ կցված բժշկի և ադմինիստրատորների վերանայման համար։", "Я согласен на конфиденциальное хранение этих отчётов до 7 дней для проверки назначенным врачом и администраторами рабочего пространства."
          )}
        </label>
      )}
      <button
        className="min-h-11 rounded-md bg-primary px-5 py-3 text-primary-foreground disabled:opacity-50"
        disabled={!files.length || files.length > remainingSlots || statuses.some(status => status === "complete") || !consent || (sharedPersistence && !sharedConsent) || busy || disabled}
        onClick={upload}
      >
        {busy
          ? t("Processing your reports…", "Հետազոտությունն ընթերցվում է…", "Обрабатываем ваши отчёты…")
          : t("Upload for review", "Վերբեռնել վերանայման համար", "Загрузить для проверки")}
      </button>
      {busy && (
        <p role="status" className="text-body2">
          {t(
            "This can take about a minute. Keep this page open.",
            "Սա կարող է տևել մոտ մեկ րոպե։ Էջը բաց պահեք։", "Это может занять около минуты. Оставьте страницу открытой."
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="text-body2">
          {error}
        </p>
      )}
    </section>
  );
}
