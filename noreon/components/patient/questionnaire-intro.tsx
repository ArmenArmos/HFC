import Link from "next/link";
import { ShieldCheck, TriangleAlert, Phone } from "lucide-react";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { Button } from "@/components/ui/button";

/**
 * Before the first question (prototype pair 05): Zoe's framing, what happens with the answers,
 * the screening notice and the red safety box. Staging draft copy for Armen/Tatevik sign-off. It
 * names no staff member and promises no review of each answer (AGENTS.md copy rule). No
 * questionnaire logic lives here: Start opens the same questionnaire as before.
 */
export function QuestionnaireIntro({ locale: l, onStart }: { locale: PatientLocale; onStart?: () => void }) {
  const rows: [string, string][] = [
    [tx(l, "Ով է դրանք օգտագործում", "Who uses them", "Кто их использует"), tx(l, "Noreon-ի խնամքի թիմը", "Your Noreon care team", "Ваша медицинская команда Noreon")],
    [tx(l, "Ինչ են դրանք որոշում", "What they decide", "Что они определяют"), tx(l, "Որ հետազոտություններն են ձեզ պետք, և որքան շուտ", "Which tests you need, and how soon", "Какие анализы вам нужны и как скоро")],
    [tx(l, "Բժշկական խորհուրդ Zoe-ից", "Medical advice from Zoe", "Медицинские рекомендации от Zoe"), tx(l, "Ոչ։ Որոշում է բժիշկը։", "No. A doctor decides.", "Нет. Решение принимает врач.")],
  ];
  return (
    <div className="mx-auto flex max-w-lg flex-col gap-4">
      <h1 className="text-h1">{tx(l, "Առողջության հարցեր", "Health questions", "Вопросы о здоровье")}</h1>
      <div className="flex items-start gap-3">
        <span className="journey-orb size-10" aria-hidden />
        <p className="questionnaire-intro-bubble text-body1">
          {tx(
            l,
            "Ես կտամ կարճ հարցեր՝ մեկ առ մեկ։ Որոշ հարցեր ունեն լրացուցիչ հարցեր՝ կախված ձեր պատասխաններից։ Կարող եք կանգ առնել ցանկացած պահի․ ձեր պատասխանները պահվում են։",
            "I will ask short questions, one at a time. Some have a few follow-ups that depend on your answers. You can stop whenever you like; your answers are saved.",
            "Я буду задавать короткие вопросы по одному. К некоторым есть уточнения, которые зависят от ваших ответов. Вы можете остановиться в любой момент, ваши ответы сохраняются.",
          )}
        </p>
      </div>
      <section className="journey-card" aria-labelledby="answers-title">
        <h2 id="answers-title" className="text-h2">{tx(l, "Ինչ է լինում ձեր պատասխանների հետ", "What happens with your answers", "Что происходит с вашими ответами")}</h2>
        <dl className="mt-3 divide-y">
          {rows.map(([k, v]) => (
            <div key={k} className="space-y-1 py-3">
              <dt className="text-caption text-muted-foreground">{k}</dt>
              <dd className="m-0 text-body2 font-medium">{v}</dd>
            </div>
          ))}
        </dl>
      </section>
      <p className="journey-callout" data-tone="teal">
        <ShieldCheck className="mt-0.5 size-5 shrink-0" aria-hidden />
        <span>{tx(l, "Սա սքրինինգի գործիք է։ Այն չի ախտորոշում, դեղ չի նշանակում և չի փոխարինում բժշկին։", "This is a screening tool. It does not diagnose, prescribe or replace a doctor.", "Это инструмент скрининга. Он не ставит диагноз, не назначает лекарства и не заменяет врача.")}</span>
      </p>
      <div className="journey-callout" data-tone="danger" role="note">
        <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
        <div className="min-w-0 flex-1 space-y-3">
          <p>
            <strong>{tx(l, "Եթե հիմա շատ վատ եք զգում,", "If you feel very unwell right now,", "Если прямо сейчас вам очень плохо,")}</strong>{" "}
            {tx(l, "օրինակ՝ կրծքավանդակի ցավ կամ շնչառության դժվարություն, դադարեցրեք և զանգահարեք 103։", "for example chest pain or trouble breathing, stop and call 103.", "например, болит грудь или трудно дышать, остановитесь и позвоните 103.")}
          </p>
          <a href="tel:103" className="emergency-pill">
            <Phone className="size-4 shrink-0" aria-hidden />
            <span>{tx(l, "Շտապ օգնություն 103", "Emergency 103", "Скорая помощь 103")}</span>
          </a>
        </div>
      </div>
      {onStart ? <Button className="min-h-12 w-full" onClick={onStart}>
        {tx(l, "Սկսել հարցերը", "Start the questions", "Начать отвечать на вопросы")}
      </Button> : <Link href="/patient/questions?start=1" className="journey-button inline-flex min-h-12 w-full items-center justify-center rounded-lg bg-primary px-4 text-body1 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {tx(l, "Սկսել հարցերը", "Start the questions", "Начать отвечать на вопросы")}
      </Link>}
    </div>
  );
}
