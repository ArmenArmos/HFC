import {bpReadings} from '@/lib/zoe/bp-parse';
import {unverifiedBpLabel} from '@/lib/patient/bp-provenance';
import type {Locale} from '@/lib/locale';

/** Labels what was typed, without claiming it was saved or measured. A historical
 * Zoe quote is labelled only when it repeats numbers in the member's messages. */
export function ReportedBpLabel({text,locale,reported}:{text:string;locale:Locale;reported?:readonly string[]}){
 const label=unverifiedBpLabel(locale);
 if(text.includes(label))return null;
 const readings=bpReadings(text);
 const quoted=reported?.flatMap(bpReadings);
 const show=readings.some(r=>!quoted||quoted.some(q=>q.systolic===r.systolic&&q.diastolic===r.diastolic));
 return show?<p className="text-caption" data-bp-provenance>{label}</p>:null;
}
