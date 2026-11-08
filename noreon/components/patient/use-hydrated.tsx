"use client";
import { useSyncExternalStore, type ReactNode } from "react";
import { tx, type PatientLocale } from "@/lib/patient/copy";

const noChanges = () => () => {};

/** False in the server's page and until React owns it. Until then buttons do nothing and a form submits natively. */
export function useHydrated() {
  return useSyncExternalStore(noChanges, () => true, () => false);
}

/** Send is held until the chat can read the words. The line appears only if the wait is long enough to notice. */
export function ComposerWaiting({ locale }: { locale: PatientLocale }) {
  if (useHydrated()) return null;
  return <p role="status" className="composer-waiting">{tx(locale, "Զրույցը պատրաստվում է։ Ձեր հաղորդագրությունը մնում է այստեղ։", "Getting the chat ready. Your message stays here.", "Чат загружается. Ваше сообщение останется здесь.")}</p>;
}

/** The chat's call control. A button after hydration, a real call link before it, so 103 never waits for scripts. */
export function Call103({ size, className, label, children }: { size: "pill" | "call"; className: string; label?: string; children: ReactNode }) {
  if (useHydrated()) return <button type="button" className={`emergency-${size} ${className}`} aria-label={label} onClick={() => { window.location.href = "tel:103"; }}>{children}</button>;
  return <a href="tel:103" className={`emergency-${size} ${className}`} aria-label={label}>{children}</a>;
}
