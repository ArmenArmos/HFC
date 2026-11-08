import { tx, type PatientLocale } from "@/lib/patient/copy";

/** The sign-up steps, in order (prototype "Join" group): phone, code, details, consent, Zoe, care team. */
export const ONBOARDING_STEP_COUNT = 6;

/** Prototype step dots: filled up to the current step. */
export function OnboardingSteps({ step, locale: l }: { step: number; locale: PatientLocale }) {
  const label = tx(l, `Քայլ ${step}՝ ${ONBOARDING_STEP_COUNT}-ից`, `Step ${step} of ${ONBOARDING_STEP_COUNT}`, `Шаг ${step} из ${ONBOARDING_STEP_COUNT}`);
  return (
    <div role="img" aria-label={label} data-onboarding-step={step} className="flex items-center justify-center gap-1.5 py-1">
      {Array.from({ length: ONBOARDING_STEP_COUNT }, (_, i) => (
        <span key={i} aria-hidden className={`h-1.5 w-7 rounded-full ${i < step ? "bg-brand-teal" : "bg-border"}`} />
      ))}
    </div>
  );
}
