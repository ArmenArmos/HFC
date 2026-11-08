"use client";
import { pick, type Locale } from "@/lib/locale";
import {SourceResultRow} from "@/components/patient-care/result-row";
import { useState, type ReactNode } from "react";
import { FileUp, ShieldCheck, Clock3, FolderSync, FileText, Trash2, ChevronDown } from "lucide-react";
import { DemoUpload } from "@/components/reports/demo-upload";
import { ReportExplanation } from "@/components/reports/report-explanation";
import { sampleReports, sampleReportPreview } from "@/lib/reports/demo";
import { extractionSchema } from "@/lib/reports/schema";
import { useDemoReports } from "./reports-provider";
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
export function ReportIntake({
  locale,
  demo,
  demoAi,
  publicationKey,
}: {
  locale: Locale;
  demo: boolean;
  demoAi: boolean;
  publicationKey: string | null;
}) {
  const memory = useDemoReports();
  const [busy, setBusy] = useState(false);
  const [uploadExpanded, setUploadExpanded] = useState(false);
  const [imported, setImported] = useState(false);
  const [shareFictional, setShareFictional] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [sampleError, setSampleError] = useState('');
  const [clearUploadErrorVersion, setClearUploadErrorVersion] = useState(0);
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  const publishedReports = memory.published?.key === publicationKey ? memory.published.reports : {};
  const orderedReports = [...memory.reports].sort((a, b) => Number(!!publishedReports[b.id]) - Number(!!publishedReports[a.id]));
  const approvedReports = orderedReports.filter(report => !!publishedReports[report.id]);
  const firstPendingReport = orderedReports.find(report => !publishedReports[report.id]);
  const firstSampleReport = orderedReports.find(report => !!(report.sample_preview ?? sampleReportPreview(report)));
  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <p className="text-caption text-brand-teal">
          {t("Your health history", "Ձեր առողջության պատմությունը", "Ваша история здоровья")}
        </p>
        <h1 className="report-intake-heading text-h1 [overflow-wrap:anywhere]">
          {t(
            "Your reports",
            "Ձեր հետազոտությունները", "Ваши результаты"
          )}
        </h1>
        <p className="max-w-2xl text-body2 text-muted-foreground">
          {t(
            "Add previous reports for review.",
            "Ավելացրեք նախկին հետազոտությունները վերանայման համար։", "Добавьте прежние результаты для рассмотрения."
          )}
        </p>
      </header>
      {memory.shared && !memory.loaded && !memory.reports.length && <p role="status" className="text-body2 text-muted-foreground">{t('Loading your reports…', 'Ձեր հետազոտությունները բեռնվում են…', "Загрузка ваших результатов…")}</p>}
      {memory.reports.length > 0 && <section className="space-y-4" aria-labelledby="uploaded-report-history">
        <h2 id="uploaded-report-history" className="flex flex-wrap items-center gap-2 text-h2"><FileText className="size-5 shrink-0 text-brand-teal" aria-hidden />
          {t("Your uploaded history", "Ձեր վերբեռնված պատմությունը", "Ваша загруженная история")}
          {(!memory.shared || memory.loaded) && <> · {memory.reports.length}</>}
        </h2>
        {approvedReports.length > 0 && <nav aria-label={t("Report sections", "Հետազոտությունների բաժիններ", "Разделы результатов")} className="flex flex-wrap gap-2">
          {approvedReports.map(report => <a key={report.id} href={`#report-${report.id}`} className={quietButton} aria-label={`${t("Read approved report", "Կարդալ հաստատված հետազոտությունը", "Прочитать подтверждённый результат")}: ${report.file_name}`}><FileText className="size-4 shrink-0" aria-hidden /><span className="min-w-0 break-words text-left">{approvedReports.length === 1 ? t("Read approved report", "Կարդալ հաստատված հետազոտությունը", "Прочитать подтверждённый результат") : report.file_name}</span></a>)}
          {firstPendingReport && <a href={`#report-${firstPendingReport.id}`} className={quietButton}>{t("See pending reports", "Տեսնել սպասող հետազոտությունները", "Посмотреть ожидающие результаты")}</a>}
          {demo && demoAi && (memory.reports.length < 10 || busy) && <a href="#report-upload" className={quietButton} onClick={() => setUploadExpanded(true)}>{t("Add another report", "Ավելացնել ևս մեկ հետազոտություն", "Добавить ещё один документ")}</a>}
        </nav>}
        {memory.shared && !memory.loaded && <p role="status" className="py-2 text-body2 text-muted-foreground">{t('Loading your reports…', 'Ձեր հետազոտությունները բեռնվում են…', "Загрузка ваших результатов…")}</p>}
        {memory.reports.some(r => (r.sample_preview || sampleReportPreview(r)) && !(memory.published?.key === publicationKey && memory.published?.reports[r.id])) && <p className="text-caption text-muted-foreground">{t('Sample reports use prepared fictional fields; no AI request runs. Clinical review is pending.', 'Օրինակներն օգտագործում են պատրաստված հորինված դաշտեր՝ առանց AI հարցման։ Բժշկական վերանայումը սպասվում է։', "В примерах используются заранее подготовленные вымышленные данные. Запрос к ИИ не выполняется. Ожидается медицинское рассмотрение.")}</p>}
        {memory.reports.some(
          (r) =>
            !(
              memory.published?.key === publicationKey &&
              memory.published?.reports[r.id]
            ),
        ) && (
          <p className="text-caption text-muted-foreground">
            {t(
              "Uploaded results and explanations appear with your doctor-approved care plan. Fictional sample values are a preview while review is pending.",
              "Վերբեռնված արդյունքներն ու բացատրությունները հասանելի կլինեն բժշկի հաստատած խնամքի պլանի հետ։ Հորինված օրինակների արժեքները նախադիտում են՝ մինչև վերանայումը։", "Загруженные результаты и объяснения появятся вместе с вашим планом лечения, подтверждённым врачом. Вымышленные значения доступны для предварительного просмотра, пока ожидается рассмотрение."
            )}
          </p>
        )}
        {orderedReports.map((r) => {
          const approval =
            memory.published?.key === publicationKey
              ? memory.published?.reports[r.id]
              : undefined;
          const sample = r.sample_preview ?? sampleReportPreview(r);
          const released = !!approval;
          const checked = released
            ? extractionSchema.safeParse(approval.report.reviewed)
            : null;
          return (
            <article
              key={r.id}
              id={`report-${r.id}`}
              className="scroll-mt-24 space-y-3 rounded-2xl border bg-card p-4 sm:p-5"
            >
              <div className="min-w-0 space-y-2">
                <h3 className="w-full break-words text-body1 font-semibold">
                  {r.file_name}
                </h3>
                <span className="inline-flex max-w-full items-start gap-2 rounded-md bg-surface-subtle-teal px-2.5 py-1 text-caption font-semibold text-brand-navy"><FileText className="mt-0.5 size-4 shrink-0" aria-hidden/>
                  {released
                    ? t("Published in demo", "Հրապարակված է ցուցադրությունում", "Опубликовано в демонстрации")
                    : t(
                        "Added for GP review",
                        "Ավելացված է բժշկի վերանայման համար", "Добавлено для рассмотрения врачом"
                      )}
                </span>
              </div>
              {sample && !released && <details open={imported || !!sampleError} className="group/report-disclosure border-t"><ReportDisclosureSummary>{t('Prepared sample values · Awaiting review', 'Պատրաստված օրինակային արժեքներ · Սպասում է վերանայման', "Подготовленные примерные значения · Ожидается рассмотрение")}</ReportDisclosureSummary><div className="divide-y">{sample.rows.map((row, index) => <div key={index} className="py-3 text-body2"><div className="flex flex-wrap justify-between gap-x-3 gap-y-1"><p className="font-semibold">{row.name}</p><p className="font-medium">{row.literal} {row.unit}</p></div>{row.reference && <p className="mt-1 text-caption text-muted-foreground">{t('Report reference:', 'Փաստաթղթի հղում՝', "Референсный интервал документа:")} {row.reference}</p>}</div>)}</div></details>}
              {released && checked?.success && (
                <section className="space-y-3 border-t pt-4">
                  <h4 className="text-body2 font-semibold">
                    {t(
                      "Read your approved explanation and results",
                      "Կարդալ հաստատված բացատրությունն ու արդյունքները", "Прочитать подтверждённое объяснение и результаты"
                    )}
                  </h4>
                  <div className="space-y-3 pt-2">
                    <p className="text-caption text-muted-foreground">
                      {t("Approved by", "Ցուցադրական հաստատում՝", "Подтверждено врачом")}{" "}
                      {approval.doctor}
                    </p>
                    <ReportExplanation
                      published
                      value={approval.report.explanation}
                      reviewed={approval.report.reviewed}
                      locale={locale}
                    />
                    <section className="border-t pt-4">
                      <h4 className="text-body2 font-semibold">
                        {t(
                          "See the checked results",
                          "Տեսնել ստուգված արդյունքները", "Посмотреть проверенные результаты"
                        )}
                      </h4>
                      <div className="divide-y">
                        {checked.data.rows.map((row, i) => <SourceResultRow key={i} row={row} locale={locale}/>)}
                      </div>
                    </section>
                  </div>
                </section>
              )}
              <button
                className={quietButton}
                disabled={busy}
                onClick={async () => {
                  if (released && !window.confirm(t(
                    `Remove ${r.file_name}? Its published explanation and checked results will also be removed from your report history.`,
                    `Հեռացնե՞լ ${r.file_name}։ Հրապարակված բացատրությունն ու ստուգված արդյունքները նույնպես կհեռացվեն ձեր հետազոտությունների պատմությունից։`, `Удалить ${r.file_name}? Опубликованное объяснение и проверенные результаты также будут удалены из вашей истории результатов.`
                  ))) return;
                  setBusy(true);
                  try { await memory.remove(r.id); }
                  finally { setBusy(false); setUploadError(''); setClearUploadErrorVersion(version => version + 1); }
                }}
              >
                <Trash2 className="size-4 shrink-0" aria-hidden />
                {t("Remove this report", "Հեռացնել փաստաթուղթը", "Удалить этот документ")}
              </button>
            </article>
          );
        })}
      </section>}
      {demo && !demoAi && <p role="status" className="rounded-xl border bg-card p-4 text-body2">{t("File upload is unavailable in this demo. You can try sample reports below.", "Այս ցուցադրությունում ֆայլի վերբեռնումը հասանելի չէ։ Ստորև կարող եք փորձել օրինակները։", "Загрузка файлов недоступна в этой демонстрации. Вы можете попробовать примеры ниже.")}</p>}
      {demo && demoAi && (memory.reports.length < 10 || busy) && (
        <details
          id="report-upload"
          className={memory.reports.length ? "group/report-disclosure scroll-mt-24 rounded-xl border bg-card px-4" : "scroll-mt-24"}
          open={!memory.reports.length || uploadExpanded || busy || !!uploadError}
          onToggle={event => { if (memory.reports.length && !busy && !uploadError) setUploadExpanded(event.currentTarget.open); }}
        >
          {memory.reports.length ? <ReportDisclosureSummary>{t("Add previous reports", "Ավելացնել նախկին հետազոտությունները", "Добавить прежние результаты")}</ReportDisclosureSummary> : <summary className="hidden">{t("Add previous reports", "Ավելացնել նախկին հետազոտությունները", "Добавить прежние результаты")}</summary>}
          <div className={memory.reports.length ? "border-t py-4" : undefined}>
            <DemoUpload
              locale={locale}
              disabled={busy || (memory.shared && !memory.loaded)}
              onBusy={setBusy}
              onReport={memory.add}
              sharedPersistence={memory.shared}
              remainingSlots={10 - memory.reports.length}
              onError={message => { setUploadError(message); if (!message) memory.clearUploadError(); }}
              clearErrorVersion={clearUploadErrorVersion}
            />
          </div>
        </details>
      )}
      {demoAi && <ol
        className="grid grid-cols-3 divide-x rounded-xl border bg-card py-3 max-[360px]:grid-cols-1 max-[360px]:divide-x-0 max-[360px]:divide-y max-[360px]:py-0"
        aria-label={t("Report workflow", "Փաստաթղթի ընթացքը", "Обработка документа")}
      >
        {[
          [FileUp, t("1. Add report", "1. Ավելացնել", "1. Добавить документ")],
          [Clock3, t("2. Team review", "2. Թիմի վերանայում", "2. Рассмотрение командой")],
          [ShieldCheck, t("3. Approved plan", "3. Հաստատված պլան", "3. Подтверждённый план лечения")],
        ].map(([Icon, title]) => {
          const Glyph = Icon as typeof FileUp;
          return (
            <li
              key={String(title)}
              className="flex flex-col gap-1 px-3 sm:flex-row sm:items-center sm:gap-2 max-[360px]:flex-row max-[360px]:items-center max-[360px]:gap-2 max-[360px]:py-2"
            >
              <Glyph className="size-4 shrink-0 text-brand-teal" aria-hidden />
              <span className="text-caption font-medium [overflow-wrap:anywhere]">{String(title)}</span>
            </li>
          );
        })}
      </ol>}
      {demo ? (
        <details className="group/report-disclosure rounded-xl border bg-card px-4">
          <ReportDisclosureSummary>
            {t(
              "Try sample reports · Demo only",
              "Փորձել հետազոտության օրինակներ · Միայն ցուցադրություն", "Попробовать примеры результатов · Только демонстрация"
            )}
          </ReportDisclosureSummary>
          <div className="space-y-3 border-t py-3">
            <p className="text-body2">
              {t(
                "Add two prepared fictional reports. Sample fields appear immediately; no AI request runs for these examples.",
                "Ավելացրեք երկու հորինված փաստաթուղթ։ Օրինակային դաշտերը կհայտնվեն անմիջապես․ AI հարցում չի կատարվում։", "Добавьте два подготовленных вымышленных документа. Примерные данные появятся сразу. Для этих примеров запрос к ИИ не выполняется."
              )}
            </p>
            <div className="rounded-lg bg-muted/40 p-3 text-caption text-muted-foreground">
              <p className="font-semibold">
                {t("About this demo", "Ցուցադրության մասին", "Об этой демонстрации")}
              </p>
              <p className="mt-2">
                {t(
                  "No laboratory is contacted and no real results are retrieved. Recommended tests stay unchanged.",
                  "Լաբորատորիա չի կապվում, և իրական արդյունքներ չեն ստացվում։ Առաջարկվող հետազոտությունները չեն փոխվում։", "Связь с лабораторией не устанавливается, реальные результаты не запрашиваются. Рекомендованные исследования остаются без изменений."
                )}
              </p>
            </div>
            {memory.shared && (
              <label className="flex items-start gap-3 text-body2">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0"
                  checked={shareFictional}
                  disabled={busy || imported}
                  onChange={(event) => setShareFictional(event.target.checked)}
                />
                {t(
                  "I agree to store these reports privately for up to 7 days for the assigned doctor and workspace administrators to review.",
                  "Հասկանում եմ, որ այս հորինված հետազոտությունները մինչև 7 օր մասնավոր ձևով կպահվեն ընդհանուր ցուցադրական տարածքում՝ կցված բժշկի և ադմինիստրատորների վերանայման համար։", "Я согласен на конфиденциальное хранение этих документов до 7 дней для рассмотрения назначенным врачом и администраторами рабочего пространства."
                )}
              </label>
            )}
            <button
              className={button}
              disabled={
                busy ||
                (memory.shared && !memory.loaded) ||
                imported ||
                memory.reports.length > 8 ||
                (memory.shared && !shareFictional)
              }
              onClick={async () => {
                setBusy(true);
                setSampleError('');
                try {
                  for (const r of sampleReports()) {
                    if (memory.reports.some(existing => existing.file_name === r.file_name && existing.model === "Simulated" && existing.prompt_version === "fictional")) continue;
                    await memory.add({
                        ...r,
                        id: crypto.randomUUID(),
                        state: "needs_review",
                        reviewed: null,
                        explanation: null,
                      });
                  }
                  setImported(true);
                  setShareFictional(false);
                } catch {
                  setSampleError(t("Sample reports could not all be saved. Check the report list and try again.", "Օրինակները չեն պահպանվել ամբողջությամբ։ Ստուգեք ցուցակը և փորձեք կրկին։", "Не все примеры удалось сохранить. Проверьте список документов и попробуйте снова."));
                } finally {
                  setBusy(false);
                }
              }}
            >
              <FolderSync className="size-5" aria-hidden />
              {busy ? t("Adding sample reports…", "Օրինակները ավելացվում են…", "Добавление примеров…") : t("Add sample reports", "Ավելացնել հետազոտության օրինակները", "Добавить примеры результатов")}
            </button>
            {imported && (
              <div className="space-y-2"><p role="status" className="text-body2">
                {t(
                  "Sample reports saved. See their prepared fields in your uploaded history. Clinical review is pending; no AI review or clinician approval has occurred.",
                  "Օրինակները պահպանված են։ Պատրաստված դաշտերը դիտեք ձեր վերբեռնված պատմությունում։ Բժշկական վերանայումը սպասվում է․ AI վերանայում կամ բժշկի հաստատում չի կատարվել։", "Примеры сохранены. Подготовленные данные доступны в вашей загруженной истории. Медицинское рассмотрение ожидается. Рассмотрение ИИ или подтверждение врачом не выполнялись."
                )}
              </p>
              {firstSampleReport && <a href={`#report-${firstSampleReport.id}`} className={quietButton}>{t("See added sample reports", "Տեսնել ավելացված օրինակները", "Посмотреть добавленные примеры")}</a>}
              </div>
            )}
          </div>
        </details>
      ) : (
        <section className="rounded-xl border bg-card p-5">
          <h2 className="text-h2">
            {t(
              "Report intake is being prepared",
              "Փաստաթղթերի ընդունումը պատրաստվում է", "Приём документов готовится"
            )}
          </h2>
          <p className="mt-2 text-body2">
            {t(
              "Clinical report review is not active in this app yet. Contact info@noreon.health for help.",
              "Բժշկական վերանայումն այստեղ դեռ ակտիվ չէ։ Օգնության համար՝ info@noreon.health։", "Медицинское рассмотрение документов в этом приложении пока не работает. Для помощи напишите на info@noreon.health."
            )}
          </p>
        </section>
      )}
      {demo && (
        <details className="group/report-disclosure text-caption text-muted-foreground">
          <ReportDisclosureSummary>
            {t("How reports are handled", "Ինչպես են պահվում փաստաթղթերը", "Как обрабатываются документы")}
          </ReportDisclosureSummary>
          <p className="mt-2">{t("Previous reports do not replace your current recommended tests.", "Նախկին հետազոտությունները չեն փոխարինում ներկայում առաջարկվող հետազոտություններին։", "Прежние результаты не заменяют текущие рекомендованные исследования.")}</p>
          <p className="mt-2">
            {t(
              memory.shared
                ? "Shared demo: only reports you explicitly choose to share are stored privately for up to 7 days for the assigned doctor and workspace administrators."
                : "Temporary demo: files stay in this tab and clear on reload, sign-out or tab close. No real clinician is notified.",
              memory.shared
                ? "Ընդհանուր ցուցադրություն․ մասնավոր ձևով մինչև 7 օր պահվում են միայն այն հետազոտությունները, որոնք բացահայտ ընտրում եք կիսել՝ կցված բժշկի և ադմինիստրատորների համար։ Մյուս ժամանակավոր փաստաթղթերը մնում են այս ներդիրում։"
                : "Ժամանակավոր ցուցադրություն․ ֆայլերը մնում են այս ներդիրում էջերի միջև անցնելիս։ Թարմացնելը, փակելը կամ դուրս գալը մաքրում է դրանք։ Իրական բժիշկ չի ծանուցվում։", memory.shared ? 'Общая демонстрация: только явно выбранные вами для передачи документы хранятся конфиденциально до 7 дней для назначенного врача и администраторов рабочего пространства.' : 'Временная демонстрация: файлы остаются в этой вкладке и удаляются при обновлении страницы, выходе из аккаунта или закрытии вкладки. Реальный врач не уведомляется.'
            )}
          </p>
        </details>
      )}
      {sampleError && <p role="alert" className="text-body2 text-destructive">{sampleError}</p>}
      {memory.persistenceError && !uploadError && !sampleError && (
        <p role="alert" className="text-body2 text-destructive">
          {memory.persistenceError}
        </p>
      )}
    </div>
  );
}
