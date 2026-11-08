import {isLocale,type Locale} from '@/lib/locale';
import type {PlanItem} from './contracts';

/** App and Telegram use the member profile locale; ui_locale preserves Russian. No staff fallback. */
export function planMemberLanguage(profile:{ui_locale?:unknown;locale?:unknown}|null):Locale|null{
 const language=profile?.ui_locale??profile?.locale;
 return isLocale(language)?language:null;
}
export const MEMBER_LANGUAGE_UNKNOWN={en:'Member language unknown, check before publishing',hy:'Անդամի լեզուն անհայտ է, ստուգեք հրապարակելուց առաջ',ru:'Язык участника неизвестен, проверьте перед публикацией'} as const;
export const PLAN_TRANSLATION_MISSING={en:'Translation unavailable, check before publishing',hy:'Թարգմանությունը հասանելի չէ, ստուգեք հրապարակելուց առաջ',ru:'Перевод недоступен, проверьте перед публикацией'} as const;
/** Existing approved templates have English and Armenian only. Never translate clinical wording here. */
export function missingPlanTranslations(items:PlanItem[],language:Locale|null):string[]{
 if(language===null)return [];
 const missing=items.filter(i=>i.member&&i.status==='protocol'&&!(i.member as Partial<Record<Locale,string>>)[language]).map(i=>i.id);
 return language==='ru'?['intro','nothing','more',...missing]:missing;
}
export function planLanguageWarning(guard:readonly string[],locale:Locale):string|null{
 if(guard.includes('member_language_unknown')||!guard.some(g=>g.startsWith('member_language:')))return MEMBER_LANGUAGE_UNKNOWN[locale];
 if(guard.some(g=>g.startsWith('member_translation_missing:')))return PLAN_TRANSLATION_MISSING[locale];
 return null;
}

export const PLAN_SHOWN_IN_ENGLISH={en:'Shown in English: not translated yet',hy:'Ցուցադրված է անգլերեն․ դեռ թարգմանված չէ',ru:'Показано на английском: ещё не переведено'} as const;
export const PLAN_SUMMARY_LANGUAGE_MISMATCH={en:'Summary is in a different language than your screen',hy:'Ամփոփման լեզուն տարբերվում է ձեր էկրանի լեզվից',ru:'Язык резюме отличается от языка вашего экрана'} as const;
/** Fixed item text, timing and rationale are English. Label them without hiding clinical guidance. */
export function planStaffLanguageLabel(locale:Locale):string|null{
 return locale==='en'?null:PLAN_SHOWN_IN_ENGLISH[locale];
}
export function planSummaryLanguage(guard:readonly string[]):Locale|null{
 const language=guard.find(code=>code.startsWith('summary_language:'))?.slice('summary_language:'.length);
 return isLocale(language)?language:null;
}
export function planSummaryWarning(guard:readonly string[],locale:Locale):string|null{
 return planSummaryLanguage(guard)===locale?null:PLAN_SUMMARY_LANGUAGE_MISMATCH[locale];
}

/** A cheap script check, not linguistic verification. Unknown/tied/unsupported scripts stay unknown. */
export function detectPlanSummaryLanguage(summary:string):Locale|null{
 const letters=summary.match(/\p{L}/gu)??[];
 const scripts={en:/\p{Script=Latin}/u,hy:/\p{Script=Armenian}/u,ru:/\p{Script=Cyrillic}/u};
 for(const locale of ['en','hy','ru'] as const){
  if(letters.filter(letter=>scripts[locale].test(letter)).length>letters.length/2)return locale;
 }
 return null;
}
