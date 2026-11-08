import { HeartPulse } from "lucide-react";
import type { PatientLocale } from "@/lib/patient/copy";
import { SAFETY_COPY } from "@/lib/member-safety/contract";

/** DT P371/P389: shown wherever an exercise suggestion would be while exercise is paused. */
export function ExercisePauseNotice({ locale: l, compact = false }: { locale: PatientLocale; compact?: boolean }) {
  const e = SAFETY_COPY.exercise;
  const contentLocale = l;
  const title = e.title[l];
  if (compact) return <p data-exercise-paused className="text-body2 font-medium">{title}. <span lang={contentLocale}>{e.short[contentLocale]}</span></p>;
  return (
    <div data-exercise-paused role="note" className="journey-card flex items-start gap-3 rounded-2xl border bg-card p-5">
      <HeartPulse className="mt-0.5 size-6 shrink-0 text-brand-navy" aria-hidden />
      <div className="min-w-0 space-y-1">
        <p className="text-body2 font-semibold">{title}</p>
        <p lang={contentLocale} className="text-body2 text-muted-foreground">{e.body[contentLocale]}</p>
      </div>
    </div>
  );
}
