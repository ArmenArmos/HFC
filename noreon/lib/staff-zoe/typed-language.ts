import type {StaffLocale} from '@/lib/staff/staff-locale-copy';

/** A message changes its fixed replies, never the staff screen's language. */
export function typedLanguage(text:string,fallback:StaffLocale):StaffLocale{
 if(/(?=\p{L})\p{Script=Armenian}/u.test(text))return 'hy';
 if(/(?=\p{L})\p{Script=Cyrillic}/u.test(text))return 'ru';
 return fallback;
}
