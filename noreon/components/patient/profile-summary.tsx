import type { ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { RecommendedTests } from "@/components/patient-care/recommended-tests";
import {
  buildPlan,
  evaluate,
  needsAttention,
  unknownFields,
  questionLabel,
} from "@/lib/clinical/rules/engine";
import { localized, UNKNOWN, type Answers } from "@/lib/clinical/types";
import { fieldById } from "@/lib/clinical/seed/questions";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { withExerciseGuidance } from "@/lib/member-safety/contract";
export function ProfileSummary({
  answers,
  locale,
  nextAction,
  exercise,
  embedded = false,
}: {
  answers: Answers;
  locale: PatientLocale;
  nextAction?: ReactNode;
  embedded?: boolean;
  /** Required, from exerciseGuidance (DT P389): every caller must decide, so the compiler enforces the gate. */
  exercise: "suggest" | "paused" | "withheld";
}) {
  const decision = withExerciseGuidance(evaluate({ answers, observations: [] }), exercise);
  const findings = needsAttention(decision).sort(
    (a, b) => Number(b.urgency === "orange") - Number(a.urgency === "orange"),
  );
  const tests = buildPlan(decision);
  const t = (value: { hy: string; en?: string; ru?: string }) => localized(value, locale);
  const number = (id: string, unit: string) =>
    typeof answers[id]?.value === "number"
      ? `${answers[id].value} ${unit}`
      : answers[id]?.value === UNKNOWN
        ? tx(locale, "Անհայտ", "Unknown", "Неизвестно")
        : tx(locale, "Գրանցված չէ", "Not recorded", "Не записано");
  const diagnosis = fieldById("q5.diagnosed")?.options?.find(
    (option) => option.value === answers["q5.diagnosed"]?.value,
  )?.label;
  const rows = [
    [tx(locale, "Հասակ", "Height", "Рост"), number("q2.height", "cm"), "q2.height"],
    [tx(locale, "Քաշ", "Weight", "Вес"), number("q2.weight", "kg"), "q2.weight"],
    [
      tx(locale, "Իրանի շրջագիծ", "Waist circumference", "Окружность талии"),
      number("q2.waist", "cm"),
      "q2.waist",
    ],
    [
      tx(locale, "Ճնշման մասին ձեր պատասխանը", "Your blood pressure history", "Ваши сведения об артериальном давлении"),
      diagnosis
        ? localized(diagnosis, locale)
        : tx(locale, "Գրանցված չէ", "Not recorded", "Не записано"),
      "q5.diagnosed",
    ],
  ].filter(([, , fieldId]) => !!answers[fieldId]);
  const missingLabels = [
    ...new Set(
      unknownFields(answers).map((id) => {
        const label = questionLabel(id);
        return label ? t(label) : id;
      }),
    ),
  ];
  // Emergency guidance takes precedence over every routine test suggestion.
  if (decision.urgency === "red") {
    return (
      <section className="space-y-4 rounded-xl border border-destructive p-6">
        <h2 className="text-h2">
          {tx(locale, "Զանգահարեք 103 հիմա", "Call 103 now", "Позвоните 103 сейчас")}
        </h2>
        <a
          className="emergency-call inline-flex min-h-12 items-center justify-center rounded-md px-5 py-3"
          href="tel:103"
        >
          {tx(locale, "Զանգահարել 103", "Call 103", "Позвонить 103")}
        </a>
        {decision.findings
          .filter((finding) => finding.urgency === "red")
          .map((finding) => (
            <article key={finding.ruleId} className="space-y-2">
              <p className="text-body1 font-medium">{t(finding.reason)}</p>
              {finding.detail && (
                <p className="text-body2">{t(finding.detail)}</p>
              )}
              {finding.nextStep && (
                <p className="text-body2 font-medium">{t(finding.nextStep)}</p>
              )}
            </article>
          ))}
        <a className="text-brand-teal underline" href="/patient/urgent">
          {tx(locale, "Բացել շտապ ցուցումները", "Open urgent guidance", "Открыть срочные рекомендации")}
        </a>
      </section>
    );
  }
  return (
    <section className="space-y-4">
      {findings
        .filter((f) => f.urgency === "orange")
        .map((finding) => (
          <article
            key={finding.ruleId}
            className="space-y-2 rounded-xl border border-[var(--status-warning-fg)]/25 bg-[var(--status-warning-bg)] p-5"
          >
            <h2 className="text-h3">
              {tx(locale, "Հրատապ խորհրդատվություն", "Urgent consultation", "Срочная консультация")}
            </h2>
            <p className="text-body2">{t(finding.reason)}</p>
            {finding.detail && (
              <p className="text-caption">{t(finding.detail)}</p>
            )}
            {finding.nextStep && (
              <p className="text-body2 font-medium">{t(finding.nextStep)}</p>
            )}
            <p className="text-caption">
              {tx(
                locale,
                "Խորհրդատվությունը մի հետաձգեք հետազոտությունների համար։",
                "Do not delay this consultation to complete tests.", "Не откладывайте эту консультацию ради обследований.",
              )}
            </p>
          </article>
        ))}
      {nextAction}
      {Array.isArray(answers["q6.conditions"]?.value) && answers["q6.conditions"].value.includes("kidney") && (
        <section className="space-y-2 rounded-xl border bg-card p-5">
          <h2 className="text-h3">{tx(locale, "Դուք նշել եք երիկամների հիվանդություն", "You reported kidney disease", "Вы указали заболевание почек")}</h2>
          <p className="text-body2">{tx(locale, "Ձեր երիկամների արդյունքներն ու հետագա քայլերը վերանայեք ձեր բուժող թիմի հետ։", "Review your kidney results and follow-up with your care team.", "Обсудите результаты обследований почек и дальнейшие шаги с вашей медицинской командой.")}</p>
        </section>
      )}
      {findings.some((f) => f.urgency !== "orange") && (
        <section className="space-y-3 rounded-2xl border bg-card p-6">
          <h2 className="text-h3">
            {tx(
              locale,
              "Ինչ քննարկել բժշկի հետ",
              "What to discuss with a clinician", "Что обсудить с врачом",
            )}
          </h2>
          {findings
            .filter((f) => f.urgency !== "orange")
            .map((finding) => (
              <article
                key={finding.ruleId}
                className="space-y-2 rounded-lg border p-4"
              >
                <p className="text-body1 font-medium">{t(finding.reason)}</p>
                {finding.detail && (
                  <p className="text-caption text-muted-foreground">
                    {t(finding.detail)}
                  </p>
                )}
                {finding.nextStep && (
                  <p className="text-body2">{t(finding.nextStep)}</p>
                )}
              </article>
            ))}
        </section>
      )}
      {!embedded && (
        <details open className="group/disclosure rounded-2xl border bg-card p-6">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-h3">
            <span>
              {tx(
                locale,
                "Հետազոտություններ՝ քննարկման համար",
                "Tests and measurements to discuss", "Обследования и измерения для обсуждения",
              )}
            </span>
            <ChevronDown
              className="size-5 shrink-0 group-open/disclosure:rotate-180"
              aria-hidden
            />
          </summary>
          <div className="mt-4 space-y-3">
            <p className="text-body2">
              {tx(
                locale,
                "Առաջարկվող հետազոտությունները ճշտեք բժշկի հետ։",
                "Confirm the suggested tests with your clinician.", "Уточните предложенные обследования у вашего врача.",
              )}
            </p>
            <p className="text-caption text-muted-foreground">
              {tx(
                locale,
                "Ցանկը ներառում է միայն ներդրված կատալոգի առաջարկները։ Բժիշկը կարող է ավելացնել կամ փոխել հետազոտությունները և ճշտել նախապատրաստումը։",
                "This list covers the implemented catalogue only. A clinician may add or change tests and confirm preparation, including whether existing results are sufficient.", "Этот список охватывает только доступный каталог. Врач может добавить или изменить обследования и уточнить подготовку, в том числе достаточно ли имеющихся результатов.",
              )}
            </p>
            <RecommendedTests tests={tests} decision={decision} locale={locale} />
          </div>
        </details>
      )}
      {missingLabels.length > 0 && (
        <details className="group/disclosure rounded-lg border p-4">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-body1 font-medium">
            <span>
              {tx(
                locale,
                "Տեղեկություն, որը դեռ պետք է ճշտել",
                "Information still to clarify", "Что ещё нужно уточнить",
              )}{" "}
              ({missingLabels.length})
            </span>
            <ChevronDown
              className="size-5 shrink-0 group-open/disclosure:rotate-180"
              aria-hidden
            />
          </summary>
          <p className="mt-3 text-body2">
            {tx(
              locale,
              "Անհայտ պատասխանները նորմալ արդյունք չեն համարվում։",
              "Unknown answers are not treated as normal results.", "Неизвестные ответы не считаются нормальными результатами.",
            )}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-body2">
            {missingLabels.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
        </details>
      )}

      {rows.length > 0 && (
        <details className="group/disclosure rounded-2xl border bg-card p-6">
          <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-body1 font-medium">
            <span>
              {tx(locale, "Ձեր պահպանված պատասխանները", "Your saved answers", "Ваши сохранённые ответы")}
            </span>
            <ChevronDown
              className="size-5 shrink-0 group-open/disclosure:rotate-180"
              aria-hidden
            />
          </summary>
          <dl className="mt-3">
            {rows.map(([label, value]) => (
              <div
                key={label}
                className="flex flex-wrap justify-between gap-3 border-b py-3 text-body2"
              >
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="max-w-sm text-right">{value}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </section>
  );
}
