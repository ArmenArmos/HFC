"use client";
import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { Route } from "next";
import { BookOpen, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { PatientLocale } from "@/lib/patient/copy";
import { dismissZoeLessonOffer, markLessonDone } from "@/app/patient/learn/actions";
import { copy } from "@/components/patient-care/common";

export function LessonDoneButton({ lessonId, done: initial, locale: l, saveAction=markLessonDone }: { lessonId: string; done: boolean; locale: PatientLocale; saveAction?:typeof markLessonDone }) {
  const [done, setDone] = useState(initial);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const sending=useRef(false);
  const toggle = () => start(async () => {
    if(sending.current)return;
    sending.current=true;
    const next = !done;
    const result = await saveAction(lessonId, next).catch(() => ({ ok: false }));
    setFailed(!result.ok);
    if (result.ok) setDone(next);
    sending.current=false;
  });
  return (
    <div className="space-y-2" data-lesson-done={done}>
      {done && <p className="flex items-center gap-2 text-body2 font-semibold"><Check className="size-4 shrink-0" aria-hidden />{copy(l, "You marked this lesson as done.", "Դուք նշել եք այս դասը որպես ավարտված։", "Вы отметили этот урок как пройденный.")}</p>}
      <Button type="button" variant={done ? "outline" : "default"} className="min-h-11" disabled={pending} onClick={toggle}>
        {done ? copy(l, "Mark as not done", "Նշել որպես չավարտված", "Отметить как непройденный") : copy(l, "Mark as done", "Նշել որպես ավարտված", "Отметить как пройденный")}
      </Button>
      {failed && <p role="alert" className="text-body2">{copy(l, "Not saved. Try again in a moment.", "Չպահվեց։ Մի պահից նորից փորձեք։", "Не сохранено. Попробуйте чуть позже.")}</p>}
    </div>
  );
}

/**
 * Zoe's one lesson offer of the day, above the chat. Fixed app text around the lesson title, never
 * model output. "Not now" ends today's offer; Zoe offers nothing else until tomorrow.
 */
export function LessonOfferCard({ lessonId, title, draft, locale: l, staffPreview=false }: { staffPreview?:boolean;lessonId: string; title: string; draft: boolean; locale: PatientLocale }) {
  const [hidden, setHidden] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  if (hidden) return null;
  return (
    <aside className="flex flex-wrap items-center gap-3 rounded-xl border bg-card p-3" data-zoe-lesson-offer={lessonId} aria-label={copy(l, "A lesson from Zoe", "Դաս Zoe-ից", "Урок от Zoe")}>
      <BookOpen className="size-5 shrink-0 text-brand-navy" aria-hidden />
      <div className="min-w-0 flex-1 basis-48">
        <p className="text-caption text-muted-foreground">{copy(l, "Zoe suggests a one-minute lesson", "Zoe-ն առաջարկում է մեկ րոպեանոց դաս", "Zoe предлагает урок на одну минуту")}</p>
        <p className="break-words text-body2 font-semibold">{title}{staffPreview && draft && <> <DraftBadge locale={l} /></>}</p>
      </div>
      <Link href={`/patient/learn/${lessonId}` as Route} className="inline-flex min-h-11 items-center rounded-lg border border-primary bg-primary px-4 text-body2 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
        {copy(l, "Read the lesson", "Կարդալ դասը", "Прочитать урок")}
      </Link>
      <Button type="button" variant="ghost" className="min-h-11" disabled={pending}
        onClick={() => start(async () => {
          const result = await dismissZoeLessonOffer().catch(() => ({ ok: false }));
          setFailed(!result.ok);
          if (result.ok) setHidden(true);
        })}>
        <X className="size-4" aria-hidden />{copy(l, "Not now", "Ոչ հիմա", "Не сейчас")}
      </Button>
      {failed && <p role="alert" className="w-full text-body2">{copy(l, "Not saved. Try again in a moment.", "Չպահվեց։ Մի պահից նորից փորձեք։", "Не сохранено. Попробуйте чуть позже.")}</p>}
    </aside>
  );
}

export function DraftBadge({ locale: l }: { locale: PatientLocale }) {
  return <span className="inline-flex rounded-md bg-[var(--status-warning-bg)] px-2 py-0.5 align-middle text-caption font-semibold text-foreground" data-lesson-draft>{copy(l, "Draft", "Սևագիր", "Черновик")}</span>;
}
