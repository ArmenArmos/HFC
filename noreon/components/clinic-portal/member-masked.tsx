import type {ClinicMemberMasked} from '@/lib/clinic-portal/member-masked-schema';
import {pick,type Locale} from '@/lib/locale';

export const clinicNotGiven=(locale:Locale)=>pick(locale,{en:'Not given',hy:'Նշված չէ',ru:'Не указано'});
/** Values are supplied by the masked RPC, never derived from full member data in the browser. */
export const clinicMaskedPhone=(member:ClinicMemberMasked|undefined,locale:Locale)=>member?.phoneLast4?`•••• ${member.phoneLast4}`:clinicNotGiven(locale);
export const clinicMaskedBirthYear=(member:ClinicMemberMasked|undefined,locale:Locale)=>member?.birthYear?.toString()??clinicNotGiven(locale);
export function ClinicMemberMaskedSummary({member,locale}:{member?:ClinicMemberMasked;locale:Locale}){
 return <>{clinicMaskedPhone(member,locale)} · {clinicMaskedBirthYear(member,locale)}</>;
}

export function ClinicFileLinkedNotice({locale}:{locale:Locale}){return <p className="text-caption text-muted-foreground">{pick(locale,{en:'Linked to the member\'s record. Their doctor reviews the values.',hy:'Կցված է անդամի գրառմանը։ Արժեքները վերանայում է նրա բժիշկը։',ru:'Прикреплено к записи участника. Значения проверяет его врач.'})}</p>;}
