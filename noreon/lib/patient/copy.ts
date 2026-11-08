import type { Locale } from "@/lib/locale";
export type PatientLocale = Locale;
export const tx = (locale: PatientLocale, hy: string, en: string, ru: string) =>
  locale === "hy" ? hy : locale === "ru" ? ru : en;

// STAGING WORDING pending Armen/Yesayi. This replaces unavailable language, never clinical advice.
export const MEMBER_LANGUAGE = {
  pendingInstruction: {
    en: 'Your clinic’s instructions are being added in your language. Ask your care team if you need them now.',
    hy: 'Ձեր կլինիկայի ցուցումները ավելացվում են ձեր լեզվով։ Եթե դրանք հիմա են պետք, գրեք ձեր խնամքի թիմին։',
    ru: 'Рекомендации вашей клиники добавляются на вашем языке. Если они нужны вам сейчас, напишите вашей медицинской команде.',
  },
};
