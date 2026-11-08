import type {Locale} from '@/lib/locale';

// Draft names for Roo. Enrollment consent versions come from patient_consents;
// Zoe, messaging and Telegram keep their consent versions separately.
const names = new Map<string, Record<Locale, string>>([
 ['patient-pilot-v1', {
  en: 'Pilot consent',
  hy: 'Փորձնական ծրագրի համաձայնություն',
  ru: 'Согласие на участие в пилоте',
 }],
]);
const neutral: Record<Locale, string> = {en: 'Consent', hy: 'Համաձայնություն', ru: 'Согласие'};

/** An unrecognized version is still consent, never a raw internal ID. */
export function clinicConsentName(version: string, locale: Locale) {
 return (names.get(version) ?? neutral)[locale];
}
