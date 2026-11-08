import {
  ChevronDown,
  FlaskConical,
  HeartPulse,
  Ruler,
  FileText,
} from "lucide-react";
import type { Decision, PlannedTest } from "@/lib/clinical/types";
import { localized } from "@/lib/clinical/types";
import type { PatientLocale } from "@/lib/patient/copy";
import { CareLink, copy } from "./common";

/** Presentation only: the clinical engine supplies every recommendation. */
export function RecommendedTests({
  tests,
  decision,
  locale: l,
  questionnaireOnly = false,
  compact = false,
}: {
  tests: PlannedTest[];
  decision: Decision;
  locale: PatientLocale;
  questionnaireOnly?: boolean;
  compact?: boolean;
}) {
  const Detail = compact ? "div" : "details";
  const Reasons = compact ? "div" : "details";
  const Test = compact ? "details" : "article";
  const t = (value: { hy: string; en?: string; ru?: string }) => localized(value, l);
  if (decision.urgency === "red") return null;
  return (
    <div className="space-y-4">
      {questionnaireOnly && <p className="text-body2 text-muted-foreground">{copy(l,
        "Uses questionnaire answers only, not approved report values. Your clinician confirms which checks are still needed.",
        "Այս առաջարկները հիմնված են միայն հարցաշարի պատասխանների վրա, ոչ թե հաստատված արդյունքների։ Դեռ անհրաժեշտ հետազոտությունները ճշտեք բժշկի հետ։",
        "Используются только ответы анкеты, без значений из утверждённых отчётов. Ваш врач подтвердит, какие проверки ещё нужны.",
      )}</p>}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-body2 font-semibold">
          {tests.length}{" "}
          {copy(l, tests.length === 1 ? "suggested check" : "suggested checks", "առաջարկվող հետազոտություն", tests.length === 1 ? "рекомендуемая проверка" : "рекомендуемые проверки")}
        </p>
        <span className="rounded-md bg-surface-subtle-teal px-3 py-2 text-caption text-brand-teal">
          {copy(
            l,
            "For discussion, not ordered",
            "Քննարկման համար, ոչ նշանակված",
            "Для обсуждения, ещё не назначено",
          )}
        </span>
      </div>
      {tests.map((test) => {
        const findings = decision.findings.filter((f) =>
          test.sourceRuleIds.includes(f.ruleId),
        );
        const Icon =
          test.category === "laboratory"
            ? FlaskConical
            : test.category === "cardiovascular"
              ? HeartPulse
              : Ruler;
        return (
          <Test key={test.id} className="group/test overflow-hidden rounded-xl border bg-card">
            {compact&&<summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 p-3 text-body2 font-semibold">{t(test.name)}<ChevronDown aria-hidden className="size-4 shrink-0 group-open/test:rotate-180"/></summary>}
            <div className="space-y-3 p-5">
              <div className="flex items-start gap-4">
                <span className="rounded-lg bg-surface-subtle-teal p-3 text-brand-teal">
                  <Icon className="size-6" aria-hidden />
                </span>
                <div className="min-w-0">
                  <p className="mb-1 text-caption text-muted-foreground">
                    {test.method === "blood_draw"
                      ? copy(l, "Blood sample", "Արյան նմուշ", "Образец крови")
                      : test.method === "urine_sample"
                        ? copy(l, "Urine sample", "Մեզի նմուշ", "Образец мочи")
                      : test.method === "home_log"
                        ? copy(l, "Home measurements", "Տնային չափումներ", "Домашние измерения")
                        : test.method === "ecg"
                          ? copy(l, "Heart recording", "Սրտի գրանցում", "Запись работы сердца")
                          : copy(
                              l,
                              "Measurement or examination",
                              "Չափում կամ հետազոտություն",
                              "Измерение или обследование",
                            )}
                  </p>
                  {!compact&&<h3 className="text-h3">{t(test.name)}</h3>}
                </div>
              </div>
              {!questionnaireOnly && <ul className="space-y-2 text-body2">
                {findings.map((f) => (
                  <li key={f.ruleId}>{t(f.reason)}</li>
                ))}
              </ul>}
            </div>
            {questionnaireOnly && <Reasons className="group border-t">
              {!compact && <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                {copy(l, "Questionnaire screening reasons", "Հարցաշարային սքրինինգի պատճառները", "Причины рекомендаций по анкете")}
                <ChevronDown className="size-5 shrink-0 group-open:rotate-180" aria-hidden />
              </summary>}
              <div className="space-y-3 border-t p-5">
                <p className="text-caption text-muted-foreground">{copy(l,
                  "These reasons come from questionnaire-only screening, not a check of your approved reports or completed tests.",
                  "Այս պատճառները հիմնված են միայն հարցաշարային սքրինինգի վրա, ոչ թե հաստատված արդյունքների կամ կատարված հետազոտությունների ստուգման։",
                  "Эти причины основаны только на скрининге по анкете, без проверки утверждённых отчётов или выполненных анализов.",
                )}</p>
                <ul className="space-y-2 text-body2">{findings.map(f => <li key={f.ruleId}>
                  {t(f.reason)}
                  {f.detail ? ` · ${t(f.detail)}` : ""}
                </li>)}</ul>
              </div>
            </Reasons>}
            {compact && !questionnaireOnly && <ul className="space-y-2 px-3 pb-3 text-body2">{findings.map(f=><li key={f.ruleId}>{t(f.reason)}{f.detail?` · ${t(f.detail)}`:""}</li>)}</ul>}
            <Detail className="group border-t">
              {!compact&&<summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
                {copy(
                  l,
                  "What it tells you and why it is suggested",
                  "Ինչ է ցույց տալիս և ինչու է առաջարկվում",
                  "Что это показывает и почему рекомендуется",
                )}
                <ChevronDown
                  className="size-5 shrink-0 group-open:rotate-180"
                  aria-hidden
                />
              </summary>}
              <div className="space-y-5 border-t bg-muted/40 p-5">
                <div>
                  <h4 className="text-body2 font-semibold">
                    {copy(l, "What it can tell you", "Ինչ կարող է ցույց տալ", "Что это может показать")}
                  </h4>
                  <p className="mt-2 text-body2 text-muted-foreground">
                    {t(test.whatItTells)}
                  </p>
                </div>
                <div>
                  <h4 className="text-body2 font-semibold">
                    {copy(l, "Before you arrange it", "Նախքան կազմակերպելը", "Прежде чем записаться")}
                  </h4>
                  <p className="mt-2 text-body2 text-muted-foreground">
                    {copy(
                      l,
                      "Confirm the need, preparation, location and timing with your clinician or laboratory. An existing result may already provide the information needed.",
                      "Բժշկի կամ լաբորատորիայի հետ ճշտեք անհրաժեշտությունը, նախապատրաստումը, վայրը և ժամկետը։ Նախկին արդյունքը կարող է արդեն պարունակել անհրաժեշտ տեղեկությունը։",
                      "Уточните у врача или в лаборатории необходимость, подготовку, место и сроки. Возможно, имеющийся результат уже содержит нужную информацию.",
                    )}
                  </p>
                </div>
                {!questionnaireOnly && <div className="rounded-lg border bg-card p-4">
                  <h4 className="text-body2 font-semibold">
                    {copy(
                      l,
                      "Why this appears in your draft",
                      "Ինչու է սա ձեր նախնական ցանկում",
                      "Почему это есть в вашем черновике",
                    )}
                  </h4>
                  {findings.map((f) => (
                    <p
                      key={f.ruleId}
                      className="mt-2 break-words text-caption text-muted-foreground"
                    >
                      {t(f.reason)}
                      {f.detail ? ` · ${t(f.detail)}` : ""}
                    </p>
                  ))}
                </div>}
              </div>
            </Detail>
          </Test>
        );
      })}
      {tests.length === 0 && (
        <p className="text-body2 text-muted-foreground">
          {copy(
            l,
            "The implemented rules did not suggest additional tests. This does not establish that no medical assessment is needed.",
            "Ներդրված կանոնները լրացուցիչ հետազոտություն չեն առաջարկել։ Սա չի նշանակում, որ բժշկական գնահատում պետք չէ։",
            "Реализованные правила не предложили дополнительных анализов. Это не означает, что медицинская оценка не нужна.",
          )}
        </p>
      )}
      <div className="flex items-start gap-3 rounded-xl bg-surface-subtle-teal p-5">
        <FileText
          className="mt-1 size-5 shrink-0 text-brand-teal"
          aria-hidden
        />
        <div>
          <h4 className="text-body1 font-semibold">
            {copy(l, "Already have results?", "Արդեն ունե՞ք արդյունքներ", "У вас уже есть результаты?")}
          </h4>
          <p className="mt-2 text-body2">
            {copy(
              l,
              "Keep previous reports alongside your history. Imported values do not automatically complete a test order.",
              "Պահեք նախկին հետազոտությունները ձեր պատմության հետ։ Ներմուծված արժեքները ինքնաբերաբար չեն ավարտում նշանակված հետազոտությունը։",
              "Храните предыдущие отчёты вместе со своей историей. Импортированные значения не завершают назначенный анализ автоматически.",
            )}
          </p>
          <CareLink href="/patient/reports">
            {copy(
              l,
              "Open report history",
              "Բացել հետազոտությունների պատմությունը",
              "Открыть историю отчётов",
            )}
          </CareLink>
        </div>
      </div>
    </div>
  );
}
