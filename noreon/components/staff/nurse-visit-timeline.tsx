import {Check,Circle} from 'lucide-react';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import type {StaffStep,NurseVisitStep} from '@/lib/nurse-visit/schema';

import {pick,type Locale} from '@/lib/locale';
export const staffStepLabel:Record<NurseVisitStep,Record<Locale,string>>={
 confirmed:{en:'Nurse confirmed the visit',hy:'Բուժքույրը հաստատել է այցը',ru:'Медсестра подтвердила визит'},
 started:{en:'Nurse arrived',hy:'Բուժքույրը ժամանել է',ru:'Медсестра прибыла'},
 'samples-collected':{en:'Samples collected',hy:'Նմուշները վերցված են',ru:'Образцы взяты'},
 'samples-at-lab':{en:'Samples handed to the lab',hy:'Նմուշները հանձնված են լաբորատորիա',ru:'Образцы переданы в лабораторию'},
 completed:{en:'Visit completed',hy:'Այցն ավարտված է',ru:'Визит завершён'},
};
const order:NurseVisitStep[]=['confirmed','started','samples-collected','samples-at-lab','completed'];

/** The visit timeline for staff: every step, done with who and when, or still to come. */
export function NurseVisitTimeline({steps,locale:l,compact=false}:{steps:StaffStep[];locale:Locale;compact?:boolean}){
 const byStep=new Map(steps.map(s=>[s.step,s]));
 return <ol className={compact?'flex flex-wrap gap-x-4 gap-y-1':'space-y-2'} aria-label={pick(l,{en:'Visit timeline',hy:'Այցի ընթացքը',ru:'Ход визита'})}>
  {order.filter(step=>!compact||byStep.has(step)).map(step=>{const s=byStep.get(step);return <li key={step} className="flex items-start gap-2 text-body2">
   {s?<Check className="mt-0.5 size-4 shrink-0" aria-hidden/>:<Circle className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden/>}
   <span className={s?'':'text-muted-foreground'}>{staffStepLabel[step][l]}{s&&<span className="text-caption text-muted-foreground"> · {yerevanStamp(s.at,l)}{compact?'':` · ${s.by}`}</span>}{!s&&step==='started'&&<span className="text-caption"> {pick(l,{en:'(optional)',hy:'(ըստ ցանկության)',ru:'(необязательно)'})}</span>}</span>
  </li>;})}
 </ol>;
}
