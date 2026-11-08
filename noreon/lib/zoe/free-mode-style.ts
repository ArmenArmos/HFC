import {z} from 'zod';

/**
 * Free-mode answer style (Zoe coach slice C1, output/zoe-coach/COACH_SPEC.md sections 8.1 and 8.7; Armen approved
 * the design and its recommendations on 20 Oct, P48). Style and structure only: every clinical rule, floor, urgent
 * route and judge MUST stays as it is.
 *
 *  - coach (shipped): the motivational-interviewing way of talking and the concrete answer shape (the member's own
 *    numbers, things to check for readings only and never causes for a symptom, one step now, when to see the doctor
 *    or call 103), with the judge's matching checks.
 *  - base: the prompt and judge before C1 (zoe-free-mode-2.5), for rollback.
 *  - coach-first (Armen, 30 Oct: "alert only in very rare cases"; not the default until Khikar and Armen approve): below the
 *    same-day level no closing warning, no routine "Shall I send this to Dr X?" and no 103 without an emergency sign. The
 *    urgent lists, red flags, floors, same-day and emergency flows, the automatic forward list and the judge's flags stay.
 *
 * Environment override (Vercel), optional: NOREON_ZOE_FREE_STYLE=coach|base|coach-first. An unreadable value keeps the default.
 */
export const FREE_STYLE_VERSION='free-style-1';
export const FREE_STYLES=['coach','base','coach-first']as const;
export type FreeStyle=typeof FREE_STYLES[number];
export const FREE_STYLE_DEFAULT:FreeStyle='coach';

export function freeStyle(env:Record<string,string|undefined>=process.env,base:FreeStyle=FREE_STYLE_DEFAULT):FreeStyle{
 const raw=env.NOREON_ZOE_FREE_STYLE;
 if(raw===undefined)return base;
 const p=z.enum(FREE_STYLES).safeParse(raw.trim().toLowerCase());
 return p.success?p.data:base;
}
