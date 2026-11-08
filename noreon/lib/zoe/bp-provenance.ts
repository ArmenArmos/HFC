import type {Locale} from '@/lib/locale';
import {unverifiedBpLabel} from '@/lib/patient/bp-provenance';

/** Add provenance beside the exact typed values a reply quotes, without changing fixed safety wording.
 * A number supplied only as a threshold or as a verified record never receives this label. */
export function labelBpQuotes(text:string,locale:Locale,reported:readonly {systolic:number;diastolic:number}[]):string{
 const label=unverifiedBpLabel(locale);
 if(text.includes(label))return text;
 const pairs=[...new Set(reported.filter(r=>new RegExp(`(?<![\\d/])${r.systolic}\\s*[/\\\\]\\s*${r.diastolic}(?![\\d/])`,'u').test(text)).map(r=>`${r.systolic}/${r.diastolic}`))];
 return pairs.length?`${text}\n\n${label}: ${pairs.join(', ')} mmHg.`:text;
}
