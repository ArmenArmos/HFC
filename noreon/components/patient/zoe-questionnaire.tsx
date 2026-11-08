"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssessmentDraft } from "@/lib/patient/types";
import { tx, type PatientLocale } from "@/lib/patient/copy";
import { Button } from "@/components/ui/button";
import { Questionnaire } from "./questionnaire";
import { QuestionnaireIntro } from "./questionnaire-intro";
import { ProfileForm } from "./profile-form";
import { rememberLocale, SignUpLanguage } from "./signup-language";

/** Bounded clinical form, using the same questions, save queue and urgent screen as the page. */
export function ZoeQuestionnaire({ initial, locale, startAtFirst = false, onComplete, onLater }: {
  initial: AssessmentDraft;
  locale: PatientLocale;
  startAtFirst?: boolean;
  onComplete?: () => void;
  onLater?: () => void;
}) {
  const router = useRouter();
  const notStarted = !initial.completedAt && !Object.keys(initial.answers).some(id => !id.startsWith("q1."));
  const [started, setStarted] = useState(!notStarted);
  const [paused, setPaused] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [openAtFirst, setOpenAtFirst] = useState(startAtFirst);
  if (completed) return <p role="status" className="text-body2">{tx(locale,
    "Ձեր հարցաշարն ավարտված է։", "Your questionnaire is complete.", "Ваша анкета завершена.")}</p>;
  if (paused) return <section className="space-y-3" data-questionnaire-paused>
    <p role="status" className="text-body2">{tx(locale,
      "Կարող եք շարունակել ձեր հարցերն այստեղ։", "You can continue your questions here.", "Вы можете продолжить отвечать на вопросы здесь.")}</p>
    <Button onClick={() => setPaused(false)}>{tx(locale,
      "Շարունակել իմ հարցերը", "Continue my questions", "Продолжить мои вопросы")}</Button>
  </section>;
  if (!started) return <QuestionnaireIntro locale={locale} onStart={() => setStarted(true)} />;
  return <Questionnaire key={initial.id} initial={initial} locale={locale} startAtFirst={openAtFirst}
    onComplete={() => {
      setCompleted(true);
      if (onComplete) onComplete();
      else { router.replace("/patient/zoe"); router.refresh(); }
    }} onLater={onLater ?? (() => { setOpenAtFirst(false); setPaused(true); })} />;
}

/** Authenticated sign-up still uses the approved ProfileForm consent, including the Zoe opt-out. */
export function ZoeQuestionnaireOnboarding(props: {
  memberChatV2?: boolean;
  expectedRevision: number;
  today: string;
  initialLocale: PatientLocale;
  zoeStatement?: boolean;
  zoeDirectAnswers?: boolean;
  draftKey?: string;
  /** The menu's Language was opened: show the language choice above the form. */
  languageCard?: boolean;
}) {
  const router = useRouter();
  const { languageCard, initialLocale, ...form } = props;
  const [locale, setLocale] = useState(initialLocale);
  // Everything on this screen switches at once; a refresh brings the page's own header and menu along.
  const choose = useCallback((next: PatientLocale) => {
    if (next === locale) return;
    rememberLocale(next);
    setLocale(next);
    router.refresh();
  }, [locale, router]);
  return <>
    {languageCard && <SignUpLanguage locale={locale} onChange={choose} />}
    <ProfileForm {...form} initialLocale={locale} onLocaleChange={choose} profile={null} embedded onSaved={() => router.refresh()} />
  </>;
}
