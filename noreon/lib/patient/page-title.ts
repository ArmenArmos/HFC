import 'server-only';
import type {Metadata} from 'next';
import {cookies} from 'next/headers';
import {parseLocale, pick, type Locale} from '@/lib/locale';
import {NOREON} from '@/lib/brand';

/**
 * Document titles of member pages, read aloud by screen readers when a page opens. The reader's language
 * comes from the member's language cookie (`noreon_locale`), Armenian by default; English keeps its wording.
 */
const TITLES = {
  home: {en: 'Noreon · Your health', hy: `${NOREON.hy} · Ձեր առողջությունը`, ru: `${NOREON.ru} · Ваше здоровье`},
  chat: {en: 'Noreon chat', hy: `${NOREON.hy} · Զրույց`, ru: `${NOREON.ru} · Чат`},
  overview: {en: 'Noreon overview', hy: `${NOREON.hy} · Ամփոփում`, ru: `${NOREON.ru} · Обзор`},
  lessons: {en: 'Noreon · Lessons', hy: `${NOREON.hy} · Դասեր`, ru: `${NOREON.ru} · Уроки`},
  lesson: {en: 'Noreon · Lesson', hy: `${NOREON.hy} · Դաս`, ru: `${NOREON.ru} · Урок`},
} as const satisfies Record<string, Record<Locale, string>>;

export type MemberPage = keyof typeof TITLES;

/** The title of a member page in one language. Pure. */
export function memberPageTitle(locale: Locale, page: MemberPage): string {
  return pick(locale, TITLES[page]);
}

/** Metadata with the member page's title in the reader's language (cookie, Armenian by default). */
export async function memberPageMetadata(page: MemberPage): Promise<Metadata> {
  const locale = parseLocale((await cookies()).get('noreon_locale')?.value, 'hy');
  return {title: memberPageTitle(locale, page)};
}
