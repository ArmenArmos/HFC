import type {Locale} from '@/lib/locale';
import {MEMBER_LANGUAGE} from '@/lib/patient/copy';
import {LDL_DRUGS} from '@/lib/ldl/schema';
import {LAB_ANALYTES} from '@/lib/lab-ai/catalogue';

type Script = 'armenian' | 'cyrillic' | 'latin' | 'other';
const SCRIPT: Record<Locale, Script> = {hy:'armenian',ru:'cyrillic',en:'latin'};
const letterScript = (letter: string): Script =>
  /[\u0531-\u058f]/u.test(letter) ? 'armenian'
    : /\p{Script=Cyrillic}/u.test(letter) ? 'cyrillic'
      : /\p{Script=Latin}/u.test(letter) ? 'latin' : 'other';

/** Script evidence only, not translation or a claim to identify a language. */
export function textScripts(text: string): Script[] {
  return [...new Set((text.match(/\p{L}/gu) ?? []).map(letterScript))];
}

// Latin identifiers and units may sit inside local instructions. They cannot make
// Latin-only instructions usable in Armenian or Russian.
const LATIN_TOKENS = new Set(['mg','g','kg','mcg','ug','ng','pg','ml','dl','ul','l','mmol','umol','nmol','pmol','mol','mmhg','cm','mm','min','h','u','iu','miu','uiu','mu','bmi','ldl','hdl','c','hba','egfr','id','pdf','ecg','bp','noreon','zoe']);
const CATALOGUE_NAMES = [
  ...LDL_DRUGS.filter(name=>name!=='other').map(name=>name.replaceAll('_',' ')),
  ...LAB_ANALYTES.map(test=>test.label),
  'Lipitor','Crestor', // Named brands also recognised by lib/staff-zoe/typed-boundary.ts.
];
const escapeRegExp = (text:string) => text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');

/** Identifiers come from structured name fields, never inferred from surrounding prose. */
export function isTextUsableInLocale(text: string, locale: Locale, identifiers: readonly string[] = []): boolean {
  const scripts = textScripts(text);
  if (!scripts.length) return true; // Numbers and punctuation carry no language.
  const own = SCRIPT[locale];
  if (!scripts.includes(own)) return false;
  if (scripts.some(script => script !== own && script !== 'latin')) return false;
  if (locale === 'en') return true;

  // Remove whole, explicitly known names, including lowercase generic medicines.
  // Any remaining Latin prose makes the instruction unavailable, regardless of case.
  let prose=text;
  for(const name of [...CATALOGUE_NAMES,...identifiers].filter(name=>name.trim()).sort((a,b)=>b.length-a.length)){
    prose=prose.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(name)}(?![\\p{L}\\p{N}])`,'giu'),' ');
  }
  return (prose.match(/\p{Script=Latin}+/gu) ?? []).every(word=>LATIN_TOKENS.has(word.toLowerCase()));
}

/** Apply at the member presentation boundary, including replayed historic cards. */
export function memberInstruction(text: string, locale: Locale, identifiers: readonly string[] = []): string {
  return isTextUsableInLocale(text, locale, identifiers) ? text : MEMBER_LANGUAGE.pendingInstruction[locale];
}
