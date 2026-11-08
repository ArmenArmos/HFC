"use client";
import { signOut } from "@/app/patient/actions";
import { continuePath } from "@/lib/patient/continue-path";
import { tx, type PatientLocale } from "@/lib/patient/copy";

/** A full load after sign-out, so no signed-in client state survives; sign-in opens in this language and comes back here. */
export async function signInAgain(locale: PatientLocale) {
  await signOut().catch(() => null);
  const here = window.location.pathname;
  const next = continuePath(here.startsWith("/patient/bp-week") ? "/patient/bp-week" : here);
  const query = new URLSearchParams({ locale, ...(next ? { next } : {}) });
  // eslint-disable-next-line @next/next/no-location-assign-relative-destination
  window.location.assign(`/patient?${query}`);
}

/** Says the sign-in ended, in place: what the member typed stays on screen with it. UNAPPROVED v1: wording for Tatevik. */
export function SignInEnded({ locale: l }: { locale: PatientLocale }) {
  return (
    <div role="alert" className="space-y-1 text-body2" data-sign-in-ended>
      <p>{tx(l, "Ձեր մուտքի ժամկետն ավարտվել է։ Մուտք գործեք նորից՝ շարունակելու համար։", "Your sign-in has ended. Sign in again to continue.", "Срок действия вашего входа истёк. Войдите снова, чтобы продолжить.")}</p>
      <button
        type="button"
        className="inline-flex min-h-11 items-center font-semibold text-foreground underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        onClick={() => void signInAgain(l)}
      >
        {tx(l, "Մուտք գործել նորից", "Sign in again", "Войти снова")}
      </button>
    </div>
  );
}
