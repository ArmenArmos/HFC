"use client";
import { pick, type Locale } from "@/lib/locale";
import { explanationSchema, extractionSchema, validateExplanation } from "@/lib/reports/schema";
export function ReportExplanation({
  value,
  reviewed,
  locale,
  published = false,
}: {
  value: unknown;
  reviewed: unknown;
  locale: Locale;
  published?: boolean;
}) {
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  const parsed = extractionSchema.safeParse(reviewed);
  if (!parsed.success || !value) return null;
  let explanation;
  try {
    explanation = validateExplanation(value, parsed.data);
  } catch {
    // An explicit published clinician note is separate from generated prose.
    const approved=published ? explanationSchema.safeParse(value) : null;
    if(approved?.success) {
      return <section className="space-y-2"><h3 className="text-h3">{t("Doctor-approved explanation","Բժշկի հաստատած բացատրություն", "Объяснение, утверждённое врачом")}</h3><p className="whitespace-pre-wrap text-body2">{approved.data.summary}</p></section>;
    }
    return (
      <p className="text-body2 text-muted-foreground">
        {t(
          "Prepare a new source-based summary to replace this older explanation.",
          "Պատրաստեք նոր ամփոփում՝ նախկին բացատրությունը փոխարինելու համար։", "Подготовьте новое резюме по исходным данным, чтобы заменить прежнее объяснение."
        )}
      </p>
    );
  }
  const report = parsed.data;
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-surface-subtle-teal p-5">
        <h3 className="text-h3">
          {t("Your report at a glance", "Ձեր հետազոտությունը՝ համառոտ", "Кратко о вашем отчёте")}
        </h3>
        <p className="mt-2 text-body2">{explanation.summary}</p>
      </section>
      {explanation.attention.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-h3">
            {t("What needs a closer look", "Ինչը պետք է մանրամասնել", "Что требует внимания")}
          </h3>
          {explanation.attention.map((item) => (
            <div key={item.row} className="rounded-lg border p-4">
              <p className="text-caption text-muted-foreground">
                {item.reason === "printed_reference"
                  ? t(
                      "Printed reference comparison",
                      "Համեմատություն տպված միջակայքի հետ", "Сравнение с указанным референсным интервалом"
                    )
                  : item.reason === "unclear"
                    ? t("Check the original", "Ստուգեք բնօրինակը", "Проверьте оригинал")
                    : t("More context needed", "Լրացուցիչ տեղեկություն է պետք", "Нужна дополнительная информация")}
              </p>
              <h4 className="mt-1 text-body1 font-semibold">
                {report.rows[item.row].name}
              </h4>
              <p className="mt-2 text-caption text-muted-foreground">
                {t("Printed result", "Տպված արդյունք", "Указанный результат")}:{" "}
                {report.rows[item.row].literal}{" "}
                {report.rows[item.row].unit ?? ""}
                {report.rows[item.row].reference && (
                  <>
                    {" "}
                    · {t("Reference", "Միջակայք", "Референсный интервал")}:{" "}
                    {report.rows[item.row].reference}
                  </>
                )}
                {" · "}
                {t("Page", "Էջ", "Страница")} {report.rows[item.row].page}
              </p>
              <p className="mt-2 text-body2">{item.explanation}</p>
            </div>
          ))}
        </section>
      )}
      {explanation.questions.length > 0 && (
        <section className="rounded-xl border p-5">
          <h3 className="text-h3">
            {t("Useful questions to discuss", "Քննարկման օգտակար հարցեր", "Вопросы для обсуждения")}
          </h3>
          <ul className="mt-3 list-disc space-y-3 pl-5 text-body2">
            {explanation.questions.map((q, i) => (
              <li key={i}>
                {q.question}
                <span className="mt-1 block text-caption text-muted-foreground">
                  {q.rows.map((row) => report.rows[row].name).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {(["result", "sample"] as const).map((kind) => {
        const items = explanation.items.filter((x) => x.kind === kind);
        return (
          items.length > 0 && (
            <details key={kind} className="rounded-xl border p-4">
              <summary className="min-h-11 cursor-pointer text-body1 font-medium">
                {kind === "sample"
                  ? t("Sample details", "Նմուշի տվյալներ", "Сведения об образце")
                  : t(
                      "Individual result explanations",
                      "Առանձին արդյունքների բացատրություններ", "Объяснения отдельных результатов"
                    )}{" "}
                ({items.length})
              </summary>
              <div className="mt-3 space-y-4">
                {items.map((item) => (
                  <div key={item.row} className="border-t pt-3">
                    <h4 className="text-body2 font-semibold">
                      {report.rows[item.row].name}
                    </h4>
                    <p className="mt-1 text-body2">{item.explanation}</p>
                  </div>
                ))}
              </div>
            </details>
          )
        );
      })}
      <p className="text-caption text-muted-foreground">
        {t(
          published
            ? "Published with your approved plan. Matching a printed reference does not rule out illness."
            : "Working explanation based on the checked report. Matching a printed reference does not rule out illness. This draft does not change the care plan.",
          published
            ? "Հրապարակված է բժշկի ցուցադրական հաստատմամբ։ Տպված միջակայքին համապատասխանելը չի բացառում հիվանդությունը։ Սա իրական բժշկական խնամք չէ։"
            : "Ստուգված հետազոտության աշխատանքային բացատրություն։ Սա չի փոխում խնամքի պլանը։", published ? "Опубликовано вместе с утверждённым планом лечения. Соответствие указанному референсному интервалу не исключает заболевания." : "Рабочее объяснение на основе проверенного отчёта. Соответствие указанному референсному интервалу не исключает заболевания. Этот черновик не меняет план лечения."
        )}
      </p>
    </div>
  );
}
