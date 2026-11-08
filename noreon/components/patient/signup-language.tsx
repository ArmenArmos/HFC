"use client";
import { Languages } from "lucide-react";
import { IconTile } from "@/components/patient-care/common";
import { tx, type PatientLocale } from "@/lib/patient/copy";

/** Before the profile exists there is no saved language, so the browser keeps it (as the sign-in page does). */
export function rememberLocale(locale: PatientLocale) {
  try { document.cookie = `noreon_locale=${locale}; Path=/; SameSite=Lax; Max-Age=31536000`; } catch { /* Blocked storage: the form still switches. */ }
}

/** The menu's Language during sign-up, consent included. Same three languages as the saved version. */
export function SignUpLanguage({ locale, onChange }: { locale: PatientLocale; onChange: (locale: PatientLocale) => void }) {
  return <section className="space-y-3" data-signup-language>
    <header className="flex items-center gap-3"><IconTile icon={Languages} /><h2 className="text-h2">{tx(locale, "Լեզու", "Language", "Язык")}</h2></header>
    <div role="group" aria-label={tx(locale, "Ընտրել լեզուն", "Choose your language", "Выберите язык")} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-1 rounded-xl border p-1">
      {([["hy", "Հայերեն"], ["en", "English"], ["ru", "Русский"]] as const).map(([id, label]) =>
        <button type="button" key={id} aria-pressed={locale === id} onClick={() => onChange(id)}
          className={`flex min-h-11 items-center justify-center rounded-lg px-2 text-body2 font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${locale === id ? "bg-brand-navy text-on-inverse" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{label}</button>)}
    </div>
  </section>;
}
