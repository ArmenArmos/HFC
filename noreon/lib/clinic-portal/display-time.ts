import type {Locale} from '@/lib/locale';
import {calendarDate,yerevanStamp} from '@/lib/staff/yerevan-time';
/** Record creation uses the clinic's explicit Yerevan zone and numeric parts.
 * Avoid locale-dependent punctuation/month names changing during hydration. */
export function clinicRecordTime(value:string){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));
 const get=(type:Intl.DateTimeFormatPartTypes)=>parts.find(part=>part.type===type)!.value;
 return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
}

/** One deterministic clinic date format, including date-only values without a timezone shift. */
export function clinicDate(value:string,locale:Locale){return calendarDate(value.length===10?value:new Date(Date.parse(value)+4*3600000).toISOString().slice(0,10),locale);}
export function clinicTimestamp(value:string,locale:Locale){return yerevanStamp(value,locale).replace(', ',' · ');}

/** Translate the system-created default only; preserve names entered by clinic staff. */
export function clinicBatchName(value:string,locale:Locale){return ['Results upload','Արդյունքների վերբեռնում','Загрузка результатов'].includes(value)?{en:'Results upload',hy:'Արդյունքների վերբեռնում',ru:'Загрузка результатов'}[locale]:value;}

/** Clinic labels never echo the submitted file name or a test/member name. */
export function clinicLabFileLabel(uploadedAt:string,locale:Locale){return `${{en:'Lab result PDF',hy:'Լաբորատոր արդյունքի PDF',ru:'PDF результата анализа'}[locale]} · ${clinicDate(uploadedAt,locale)}`;}
/** Canonical upload command name also stays safe in persisted recovery payloads. */
export function clinicLabUploadName(uploadedAt:string){return `PDF ${new Date(Date.parse(uploadedAt)+4*3600000).toISOString().slice(0,10)}.pdf`;}
