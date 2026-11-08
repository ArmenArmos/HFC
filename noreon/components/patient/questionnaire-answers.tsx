import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { answerSummary } from "@/lib/patient/answer-summary";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import type { Answers } from "@/lib/clinical/types";

/** A completed questionnaire opens as a read-only summary; editing is an explicit choice (QA 175). */
export function QuestionnaireAnswers({ answers, locale }: { answers: Answers; locale: PatientLocale }) {
  const sections = answerSummary(answers, locale);
  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div className="space-y-2">
        <p className="text-caption text-brand-teal">{tx(locale, "Հարցաշարը լրացված է", "Questionnaire complete", "Анкета заполнена")}</p>
        <h1 className="text-h1">{tx(locale, "Ձեր պատասխանները", "Your answers", "Ваши ответы")}</h1>
        <p className="text-body2 text-muted-foreground">
          {tx(locale, "Ստորև ձեր պահված պատասխաններն են։ Եթե ինչ-որ բան փոխվել է, կարող եք թարմացնել դրանք։ Ձեր բժիշկը կտեսնի ձեր փոփոխությունները։", "These are your saved answers. If something has changed, you can update them. Your doctor will see your changes.", "Это ваши сохранённые ответы. Если что-то изменилось, вы можете их обновить. Ваш врач увидит ваши изменения.")}
        </p>
      </div>
      <Link className={buttonVariants({ className: "h-12 w-full" })} href="/patient/questions?edit=1">
        {tx(locale, "Փոխել իմ պատասխանները", "Change my answers", "Изменить мои ответы")}
      </Link>
      {sections.map((section) => (
        <section key={section.id} aria-labelledby={`answers-${section.id}`} className="space-y-2 rounded-2xl border bg-card p-4">
          <h2 id={`answers-${section.id}`} className="text-body1 font-semibold">
            {tx(locale, `Բաժին ${section.index}`, `Section ${section.index}`, `Раздел ${section.index}`)} · {section.title}
          </h2>
          <dl className="divide-y">
            {section.rows.map((row) => (
              <div key={row.id} className="py-3">
                <dt className="text-caption text-muted-foreground">{row.label}</dt>
                <dd className="break-words text-body2">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
      <Link className={buttonVariants({ variant: "secondary", className: "h-12 w-full" })} href="/patient/dashboard">
        {tx(locale, "Վերադառնալ գլխավոր էջ", "Back to Home", "На главную")}
      </Link>
    </div>
  );
}
