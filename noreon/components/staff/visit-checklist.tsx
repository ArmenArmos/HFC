import{ListChecks}from'lucide-react';
import{checklistProgress,visitChecklist,visitChecklistStatus,type ChecklistItem}from'@/lib/staff/visit-checklist';
import type{CareVisit}from'@/lib/staff/visit-evidence-schema';

import {pick,clinicalLocale,type Locale} from '@/lib/locale';

const stateLabel={measured:{en:'Measured',hy:'Չափվել է',ru:'Измерено'},unknown:{en:'Unknown',hy:'Անհայտ',ru:'Неизвестно'},'not-recorded':{en:'Not recorded',hy:'Չի գրանցվել',ru:'Не записано'}} as const;
/** Renders nothing while the checklist content awaits Q2. */
export function VisitChecklist({visit,locale,items=visitChecklist,approved=visitChecklistStatus.state==='approved'}:{visit:CareVisit|undefined;locale:Locale;items?:readonly ChecklistItem[];approved?:boolean}){
 if(!approved||!items.length)return null;
 return <section aria-labelledby="visit-checklist-title" className="space-y-3 rounded-xl border bg-card p-5" lang={locale}>
  <h2 id="visit-checklist-title" className="flex items-center gap-2 text-h3"><ListChecks className="size-5" aria-hidden/>{pick(locale,{en:'Visit checklist',hy:'Այցի ստուգաթերթ',ru:'Контрольный список визита'})}</h2>
  <ul className="divide-y">{checklistProgress(items,visit).map(({item,state})=><li key={item.id} className="flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-1 py-2 text-body2"><span className="min-w-0 break-words">{item.label[clinicalLocale(locale)]}{item.required?'':pick(locale,{en:' (optional)',hy:' (ոչ պարտադիր)',ru:' (необязательно)'})}</span><span className="text-muted-foreground">{pick(locale,stateLabel[state])}</span></li>)}</ul>
 </section>;
}
