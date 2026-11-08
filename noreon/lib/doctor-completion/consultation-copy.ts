import type {PatientLocale} from '@/lib/patient/copy';
import {formatMemberDate} from '@/lib/patient/date-format';
import type {ConsultationArrangement} from './consultation-schema';
/** Member wording for an arranged consultation: time and how it happens, nothing clinical. */
export function arrangedConsultationText(a:ConsultationArrangement,l:PatientLocale){
 const when=formatMemberDate(a.scheduledAt,l,{timeZone:'Asia/Yerevan',dateStyle:'full',timeStyle:'short'});
 if(l==='ru')return a.channel==='clinic'?`Ваша консультация назначена на ${when}. Место: ${a.clinic??'клиника'}.`:`Ваша консультация назначена на ${when}. Ваш врач позвонит вам.`;
 if(l==='hy')return a.channel==='clinic'?`Ձեր խորհրդատվությունը նշանակված է ${when}։ Վայրը՝ ${a.clinic??'կլինիկա'}։`:`Ձեր խորհրդատվությունը նշանակված է ${when}։ Ձեր բժիշկը կզանգահարի ձեզ։`;
 return a.channel==='clinic'?`Your consultation is arranged for ${when} at ${a.clinic??'the clinic'}.`:`Your consultation is arranged for ${when}. Your doctor will call you.`;
}
