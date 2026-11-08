import Link from "next/link";
import { Check, ChevronRight, Stethoscope } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { JOURNEY_STAGES, STAGE_LABEL } from "@/lib/patient-care/journey-strip";
import { CareLink, copy } from "./common";
import { zoeName } from "@/lib/brand";

/** Where you are: questionnaire → tests → results → plan (Khikar, 17 Oct). */
export function HomeJourneyStrip({ current, locale: l }: { current: number; locale: PatientLocale }) {
  return (
    <nav aria-label={copy(l, "Where you are", "Որտեղ եք հիմա", "На каком вы этапе")} className="journey-card journey-strip">
      <ol>
        {JOURNEY_STAGES.map((stage, i) => {
          const state = i < current ? "done" : i === current ? "current" : "next";
          return (
            <li key={stage} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              <span className="journey-strip-dot" aria-hidden>
                {state === "done" && <Check className="size-3.5" strokeWidth={3} />}
              </span>
              <span className="journey-strip-label">
                {STAGE_LABEL[stage][l]}
                <span className="sr-only">
                  {state === "done" ? copy(l, ", done", ", արված է", ", завершено") : state === "current" ? copy(l, ", you are here", ", դուք այստեղ եք", ", вы здесь") : ""}
                </span>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

const initials = (name: string) =>
  name
    .replace(/^(dr\.?|բժ\.?)\s+/i, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

/**
 * The one assigned doctor, named (Khikar approved 17 Oct; wording for Armen to confirm).
 * Shown only when the case read succeeded; a failed read hides the card.
 */
export function HomeCareTeam({ doctor, locale: l }: { doctor: string | null; locale: PatientLocale }) {
  return (
    <section aria-labelledby="home-team-title" className="journey-card">
      <header className="flex items-center justify-between gap-3">
        <h2 id="home-team-title" className="text-h2">{copy(l, "Your care team", "Ձեր խնամքի թիմը", "Ваша медицинская команда")}</h2>
        <Link href="/patient/team?section=contact" className="inline-flex min-h-11 items-center gap-1 text-body2 font-semibold text-brand-teal underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
          {copy(l, "Contact", "Կապ", "Связаться")}
          <ChevronRight className="size-4" aria-hidden />
        </Link>
      </header>
      {doctor ? (
        <div className="flex items-start gap-3">
          <span className="journey-avatar" aria-hidden>{initials(doctor) || <Stethoscope className="size-5" />}</span>
          <div className="min-w-0">
            <p className="break-words text-body1 font-semibold">
              {doctor} <span className="text-body2 font-normal text-muted-foreground">· {copy(l, "your doctor", "ձեր բժիշկը", "ваш врач")}</span>
            </p>
            <p className="text-body2 text-muted-foreground">
              {copy(
                l,
                "Reviews your answers, tests, home readings and reports together.",
                "Միասին դիտարկում է ձեր պատասխանները, հետազոտությունները, տնային չափումներն ու զեկույցները։", "Рассматривает вместе ваши ответы, анализы, домашние измерения и отчёты.",
              )}
            </p>
          </div>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span className="journey-avatar" aria-hidden><Stethoscope className="size-5" /></span>
          <p className="text-body2 text-muted-foreground">
            {copy(l, "Your doctor is being assigned. Their name will appear here.", "Ձեզ համար բժիշկ է նշանակվում։ Նրա անունը կհայտնվի այստեղ։", "Вам назначают врача. Его имя появится здесь.")}
          </p>
        </div>
      )}
    </section>
  );
}

/** Khikar, 18 Oct: a quiet line, not a red card. The header's Emergency 103 pill is the one call button (18 Oct 22:57). */
export function HomeUnwellCard({ locale: l }: { locale: PatientLocale }) {
  return (
    <aside aria-label={copy(l, "Emergency help", "Շտապ օգնություն", "Скорая помощь")} className="journey-unwell-line">
      <p className="min-w-0 flex-1 basis-52 text-body2 text-muted-foreground">
        {copy(
          l,
          "Feeling unwell right now? If you think it is an emergency, call 103.",
          "Հիմա վա՞տ եք զգում։ Եթե կարծում եք, որ սա շտապ դեպք է, զանգահարեք 103։", "Вам сейчас плохо? Если вы считаете, что нужна экстренная помощь, позвоните 103.",
        )}
      </p>
    </aside>
  );
}

/** Zoe on Home: quick answers and the way to the Zoe tab. No AI claims (Zoe chat is not live). */
export function HomeZoeCard({ locale: l }: { locale: PatientLocale }) {
  return (
    <section aria-labelledby="home-zoe-title" className="journey-card journey-zoe">
      <div className="flex items-start gap-3">
        <span className="journey-orb" aria-hidden />
        <div className="min-w-0">
          <h2 id="home-zoe-title" className="text-h2">
            {zoeName(l)} <span className="text-body2 font-normal text-muted-foreground">· {copy(l, "your care assistant", "ձեր խնամքի օգնականը", "ваш помощник в лечении")}</span>
          </h2>
          <p className="text-body2">
            {copy(
              l,
              "Find out what your next step means, how to prepare for your tests and how to record a reading.",
              "Իմացեք, թե ինչ է նշանակում ձեր հաջորդ քայլը, ինչպես պատրաստվել հետազոտություններին և ինչպես գրանցել չափումը։", "Узнайте, что означает ваш следующий шаг, как подготовиться к анализам и как записать измерение.",
            )}
          </p>
        </div>
      </div>
      <CareLink href="/patient/zoe">{copy(l, "Open Zoe", "Բացել Զոյան", "Открыть чат с Зоей")}</CareLink>
    </section>
  );
}
