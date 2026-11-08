import {Check,Circle,Stethoscope} from 'lucide-react';
import {copy} from './common';
import {formatMemberDate} from '@/lib/patient/date-format';
import type {PatientLocale} from '@/lib/patient/copy';
import type {MemberNurseVisit} from '@/lib/nurse-visit/schema';

const steps=[
 ['confirmed','Your nurse confirmed the visit','Ձեր բուժքույրը հաստատել է այցը','Ваша медсестра подтвердила визит'],
 ['samples-collected','Samples collected','Նմուշները վերցված են','Образцы собраны'],
 ['samples-at-lab','Samples sent to the lab, results pending','Նմուշներն ուղարկված են լաբորատորիա, արդյունքները սպասվում են','Образцы отправлены в лабораторию, ожидаются результаты'],
 ['completed','Visit done','Այցը կայացել է','Визит завершён'],
] as const;

/** Home: the steps of the member's nurse visit, done or still to come. Steps only: no names,
 * comments or values. */
export function NurseVisitStepsCard({visit,locale:l}:{visit:NonNullable<MemberNurseVisit>;locale:PatientLocale}){
 const at=new Map(visit.steps.map(s=>[s.step,s.at]));
 const when=(iso:string)=>formatMemberDate(iso,l,{timeZone:'Asia/Yerevan',day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 return <section aria-labelledby="nurse-visit-steps-title" className="journey-card space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-sm sm:p-6">
  <h2 id="nurse-visit-steps-title" className="flex items-center gap-2 text-h2"><Stethoscope className="size-5 shrink-0 text-brand-teal" aria-hidden/>{visit.mode==='home'?copy(l,'Your home visit','Ձեր տնային այցը', "Ваш визит на дому"):copy(l,'Your visit','Ձեր այցը', "Ваш визит")}</h2>
  <ol className="space-y-2">{steps.map(([key,en,hy,ru])=>{const done=at.get(key);return <li key={key} className="flex items-start gap-2 text-body2">
   {done?<Check className="mt-0.5 size-4 shrink-0 text-brand-teal" aria-hidden/>:<Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden/>}
   <span className={done?'':'text-muted-foreground'}>{copy(l,en,hy, ru)}{done&&<span className="block text-caption text-muted-foreground">{when(done)}</span>}</span>
  </li>;})}</ol>
 </section>;
}
