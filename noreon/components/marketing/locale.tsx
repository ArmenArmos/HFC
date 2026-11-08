"use client";

import { createContext, use, useMemo, useState, type ReactNode } from "react";

import type { Locale, LocalizedHyEn } from "@/lib/clinical/types";

type LocaleContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  /** Resolves a LocalizedHyEn value against the active locale. */
  t: (text: LocalizedHyEn) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

/** The public site's language. English unless a page switches it. */
export function LocaleProvider({ children, initial = "en" }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLocale] = useState<Locale>(initial);
  const value = useMemo<LocaleContextValue>(
    () => ({ locale, setLocale, t: (text) => (locale === "en" ? (text.en ?? text.hy) : text.hy) }),
    [locale],
  );
  return <LocaleContext value={value}>{children}</LocaleContext>;
}

export function useMarketingLocale(): LocaleContextValue {
  const ctx = use(LocaleContext);
  if (!ctx) throw new Error("useMarketingLocale must be used inside <LocaleProvider>");
  return ctx;
}
