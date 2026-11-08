/** UI languages. Armenian is the member default, English the staff default.
 * Russian copy is a machine-drafted first version ("unapproved v1", 22 Oct 2026)
 * waiting for native review; see docs/reference/russian-copy-review.md. */
export type Locale = 'en' | 'hy' | 'ru';
export const LOCALES = ['hy', 'en', 'ru'] as const satisfies readonly Locale[];
export const RU_COPY_STATUS = 'unapproved-v1' as const;
export const isLocale = (value: unknown): value is Locale => value === 'en' || value === 'hy' || value === 'ru';
export const parseLocale = (value: unknown, fallback: Locale): Locale => isLocale(value) ? value : fallback;
/** One string per UI language. Every key is required so a missing Russian line is a type error. */
export const pick = <T,>(locale: Locale, values: Record<Locale, T>): T => values[locale];
/** Clinical text (health summaries, AI care plans, GP reports, doctor-approved text)
 * stays Armenian for Russian readers (Khikar, 22 Oct 2026). */
export type ClinicalLocale = 'hy' | 'en';
export const clinicalLocale = (locale: Locale): ClinicalLocale => locale === 'ru' ? 'hy' : locale;
/** Native names for the language pickers. */
export const LOCALE_NAMES: Record<Locale, string> = { hy: 'Հայերեն', en: 'English', ru: 'Русский' };
