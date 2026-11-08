/**
 * The product's names in every supported language, in one place.
 *
 * Armenian copy always says «Զոյա» for the assistant and «Նորեոն Հելթ» for the
 * service. Armenian is an inflected language, so the declined forms used in
 * running text are listed here too rather than being spelled ad hoc in copy:
 * a misspelt case ending is a defect a reviewer cannot grep for.
 *
 * Framework-free on purpose (no next/* imports), like the rest of lib/.
 */
import type {Locale} from './locale';

export const ZOE = Object.freeze({
  hy: 'Զոյա',
  en: 'Zoe',
  ru: 'Зоя',
} as const satisfies Record<Locale, string>);

export const NOREON = Object.freeze({
  hy: 'Նորեոն Հելթ',
  en: 'Noreon Health',
  ru: 'Нореон Хелс',
} as const satisfies Record<Locale, string>);

/** Armenian case forms of «Զոյա», as already used across the staff copy. */
export const ZOE_HY = Object.freeze({
  /** Bare name, also the vocative: «Զոյա, ...». */
  base: 'Զոյա',
  /** Definite nominative: «Զոյան պատասխանեց». */
  definite: 'Զոյան',
  /** Genitive: «Զոյայի պատասխանը». */
  genitive: 'Զոյայի',
  /** Dative: «գրեք Զոյային». */
  dative: 'Զոյային',
  /** Ablative: «Զոյայից». */
  ablative: 'Զոյայից',
  /** Instrumental: «Զոյայով». */
  instrumental: 'Զոյայով',
});

/** Armenian case forms of «Նորեոն Հելթ». */
export const NOREON_HY = Object.freeze({
  base: 'Նորեոն Հելթ',
  definite: 'Նորեոն Հելթը',
  genitive: 'Նորեոն Հելթի',
  dative: 'Նորեոն Հելթին',
  ablative: 'Նորեոն Հելթից',
});

export function zoeName(locale: Locale): string {
  return ZOE[locale] ?? ZOE.hy;
}

export function noreonName(locale: Locale): string {
  return NOREON[locale] ?? NOREON.hy;
}

/**
 * One line for model system prompts (English): how Zoe writes her own name and the service's name in
 * each reply language. Models otherwise transliterate «Zoe» ad hoc («Զոի», «Զոե», "Zoe-ն").
 */
export const BRAND_NAMES_PROMPT_RULE =
  `Names: in Armenian replies write your name as «${ZOE_HY.base}» (declined ${ZOE_HY.definite}, ${ZOE_HY.genitive}, ${ZOE_HY.dative}, ${ZOE_HY.ablative}, ${ZOE_HY.instrumental}) and the service as «${NOREON_HY.base}» (${NOREON_HY.genitive}, ${NOREON_HY.dative}); in Russian replies write «${ZOE.ru}» and «${NOREON.ru}»; in English write ${ZOE.en} and ${NOREON.en}. Never write these names in Latin letters inside Armenian or Russian text.`;
