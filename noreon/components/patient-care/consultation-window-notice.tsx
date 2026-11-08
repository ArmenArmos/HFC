import { Stethoscope } from "lucide-react";
import { consultationWindow } from "@/lib/clinical/rules/engine";
import { localized, type Decision } from "@/lib/clinical/types";
import type { PatientLocale } from "@/lib/patient/copy";
import { copy } from "./common";

/**
 * Orange keeps the member in the product: tests can be arranged, and the
 * consultation window the rule set stays in view next to them. Red never
 * reaches this, because it opens the urgent route instead.
 */
export function ConsultationWindowNotice({ decision, locale: l, headingId = "consultation-window-title" }: { decision: Decision; locale: PatientLocale; headingId?: string }) {
  if (decision.urgency !== "orange") return null;
  const t = (value: { hy: string; en?: string; ru?: string }) => localized(value, l);
  const steps = decision.findings.filter((f) => f.urgency === "orange" && f.nextStep);
  return (
    <aside role="status" aria-labelledby={headingId} className="journey-card space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
      <h2 id={headingId} className="flex items-center gap-2 text-h3">
        <Stethoscope className="size-5 shrink-0 text-brand-teal" aria-hidden />
        {copy(l, "A medical consultation comes first", "Առաջնահերթը բժշկի խորհրդատվությունն է", "Сначала нужна консультация врача")}
      </h2>
      <p className="text-body2 font-semibold">{t(consultationWindow(decision))}</p>
      {steps.length > 0 && <ul className="space-y-1 text-body2">{steps.map((f) => <li key={f.ruleId}>{t(f.nextStep!)}</li>)}</ul>}
      <p className="text-body2 text-muted-foreground">
        {copy(l, "You can arrange the suggested tests now. They do not replace the consultation.", "Առաջարկվող հետազոտությունները կարող եք կազմակերպել հիմա։ Դրանք չեն փոխարինում խորհրդատվությանը։", "Вы можете организовать предложенные анализы уже сейчас. Они не заменяют консультацию.")}
      </p>
    </aside>
  );
}
