import {MessagesSquare} from 'lucide-react';
import {copy} from './common';
import type {PatientLocale} from '@/lib/patient/copy';
import type {ConsultationArrangement} from '@/lib/doctor-completion/consultation-schema';
import {arrangedConsultationText} from '@/lib/doctor-completion/consultation-copy';

/** Neutral hold: no reason, finding or result is shown before the doctor releases them. */
export function ConsultationHoldCard({locale:l,hasPlan,arrangement=null}:{locale:PatientLocale;hasPlan:boolean;arrangement?:ConsultationArrangement|null}){
 return <section aria-labelledby="consultation-hold-title" className="journey-card space-y-2 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
  <h2 id="consultation-hold-title" className="flex items-center gap-2 text-h2"><MessagesSquare className="size-5 shrink-0 text-brand-teal" aria-hidden/>{copy(l,'Your doctor would like to talk with you','Ձեր բժիշկը ցանկանում է խոսել ձեզ հետ', "Ваш врач хочет поговорить с вами")}</h2>
  {arrangement?<><p className="max-w-2xl text-body2 text-muted-foreground">{copy(l,'Before your new results and plan are shared, your doctor would like a consultation with you.','Նախքան ձեր նոր արդյունքներն ու պլանը ձեզ հետ կիսվելը, ձեր բժիշկը ցանկանում է խորհրդատվություն անցկացնել ձեզ հետ։', "Прежде чем вы получите новые результаты и план, ваш врач хочет провести с вами консультацию.")}</p><p className="max-w-2xl text-body2 font-medium">{arrangedConsultationText(arrangement,l)}</p></>:<p className="max-w-2xl text-body2 text-muted-foreground">{copy(l,'Before your new results and plan are shared, your doctor would like a consultation with you. Your care team will contact you to arrange a time.','Նախքան ձեր նոր արդյունքներն ու պլանը ձեզ հետ կիսվելը, ձեր բժիշկը ցանկանում է խորհրդատվություն անցկացնել ձեզ հետ։ Ձեր խնամքի թիմը կկապվի ձեզ հետ՝ ժամը համաձայնեցնելու համար։', "Прежде чем вы получите новые результаты и план, ваш врач хочет провести с вами консультацию. Ваша медицинская команда свяжется с вами, чтобы согласовать время.")}</p>}
  {hasPlan&&<p className="max-w-2xl text-body2 text-muted-foreground">{copy(l,'Your current plan stays as it is until then.','Մինչ այդ ձեր ընթացիկ պլանը մնում է անփոփոխ։', "До этого ваш текущий план остаётся без изменений.")}</p>}
 </section>;
}
