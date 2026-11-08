import {bpUnit} from '@/lib/bp-unit';
import {collectionCopy,collectionStatus} from '@/lib/nurse-visit/collection';
import {visitTestTitle} from '@/lib/nurse-visit/copy';
import {protocolLabel} from '@/lib/nurse-visit/protocol-copy';
import {CareSection} from '@/components/patient-care/common';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {NurseVisitTimeline} from './nurse-visit-timeline';
import type {NurseVisitRecord,NurseVisitItem} from '@/lib/nurse-visit/schema';

import {pick,type Locale} from '@/lib/locale';
type Ready=Extract<NurseVisitRecord,{enabled:boolean}>;
const c=(l:Locale,en:string,hy:string,ru:string)=>pick(l,{en,hy,ru});
function title(item:NurseVisitItem,l:Locale){
 if(item.kind==='sample')return visitTestTitle(item,l);
 if(item.kind==='check')return protocolLabel(item,l);
 if(item.kind==='device')return c(l,`BP monitor ${item.serial} handed over and connected`,`Ճնշման սարք ${item.serial}՝ հանձնված և միացված`,`Тонометр ${item.serial} передан и подключён`);
 return item.field==='bp'?c(l,'Blood pressure and pulse','Ճնշում և զարկերակ',"Артериальное давление и пульс"):item.field==='weight'?c(l,'Weight','Քաշ',"Вес"):c(l,'Waist circumference','Գոտկատեղ',"Окружность талии");
}
function value(item:NurseVisitItem,l:Locale){
 const v=item.mark?.values;if(!v)return null;
 return 'systolic'in v?`${v.systolic}/${v.diastolic} ${bpUnit(l)}${v.pulse!=null?` · ${pick(l,{en:'pulse',hy:'զարկերակ',ru:'пульс'})} ${v.pulse}`:''}`:`${v.value} ${item.kind==='measurement'&&item.field==='weight'?pick(l,{en:'kg',hy:'կգ',ru:'кг'}):pick(l,{en:'cm',hy:'սմ',ru:'см'})}`;
}

/** Nurse visits for the member page: the timeline with who and when, each item's state and the
 * nurse's comment, and the completion reason. Values are present only for the doctor and nurse
 * (the database leaves them out for the admin). Nothing renders while the switch is off. */
export function NurseVisitRecordPanel({data,locale:l}:{data:Ready|null;locale:Locale}){
 if(data&&!data.enabled)return null;
 return <CareSection title={c(l,'Nurse visits','Բուժքրոջ այցեր',"Визиты медсестры")}>
  {!data?<p role="status" className="text-body2">{c(l,'Nurse visits are unavailable. Reload to check them.','Բուժքրոջ այցերն անհասանելի են։ Թարմացրեք էջը՝ ստուգելու համար։',"Визиты медсестры недоступны. Обновите страницу для проверки.")}</p>
   :!data.visits.length?<p className="text-body2 text-muted-foreground">{c(l,'No nurse visit steps are recorded yet.','Բուժքրոջ այցի քայլեր դեռ գրանցված չեն։',"Этапы визитов медсестры пока не записаны.")}</p>
   :<div className="space-y-5">{data.visits.map(({visit,steps,items,completion})=><article key={`${visit.source}:${visit.id}`} className="space-y-3 border-t pt-4 first:border-t-0 first:pt-0">
    <h3 className="text-body1 font-medium">{visit.mode==='home'?c(l,'Home visit','Տնային այց',"Визит на дом"):visit.clinic??c(l,'Clinic visit','Այց կլինիկա',"Визит в клинику")} · {yerevanStamp(visit.startsAt,l)}</h3>
    <NurseVisitTimeline steps={steps} locale={l}/>
    {completion&&<p className="text-body2">{c(l,`${completion.summary.samplesTaken} of ${completion.summary.samplesPlanned} samples taken.`,`Վերցված նմուշներ՝ ${completion.summary.samplesTaken}/${completion.summary.samplesPlanned}։`,`Взято образцов: ${completion.summary.samplesTaken} из ${completion.summary.samplesPlanned}.`)}{completion.reason&&<span className="block whitespace-pre-wrap break-words">{c(l,'Not done, because: ','Չի արվել, քանի որ՝ ',"Не выполнено по причине: ")}{completion.reason}</span>}</p>}
    {items.some(item=>item.kind==='sample')&&<p className="text-body2">{collectionCopy(l).summary(items)}</p>}
    {items.filter(item=>item.kind==='sample'&&['not-collected','issue'].includes(collectionStatus(item))).map(item=><p key={item.key} className="text-body2 whitespace-pre-wrap break-words"><strong>{title(item,l)} · {collectionCopy(l).statuses[collectionStatus(item)]}</strong>{item.mark?.note&&<>: {item.mark.note}</>}{item.mark&&<span className="block text-caption text-muted-foreground">{yerevanStamp(item.mark.recordedAt,l)} · {item.mark.nurseName}</span>}</p>)}
    <details><summary className="min-h-11 cursor-pointer text-body2">{c(l,`Items and comments (${items.filter(i=>i.mark).length} recorded)`,`Կետեր և մեկնաբանություններ (գրանցված՝ ${items.filter(i=>i.mark).length})`,`Пункты и комментарии (записано: ${items.filter(i=>i.mark).length})`)}</summary>
     <ul className="divide-y">{items.map(item=><li key={item.key} className="space-y-1 py-2 text-body2">
      <p className="flex flex-wrap justify-between gap-x-3"><span className="min-w-0 break-words">{title(item,l)}</span><span className="text-muted-foreground">{item.kind==='sample'?collectionCopy(l).statuses[collectionStatus(item)]:!item.mark?c(l,'Not recorded','Չի գրանցվել',"Не записано"):item.mark.done?c(l,'Done','Արված է',"Выполнено"):c(l,'Not done','Չի արվել',"Не выполнено")}</span></p>
      {item.mark?.done&&value(item,l)&&<p>{value(item,l)}</p>}
      {item.mark?.note&&<p className="whitespace-pre-wrap break-words text-muted-foreground">{c(l,'Comment: ','Մեկնաբանություն՝ ',"Комментарий: ")}{item.mark.note}</p>}
      {item.mark&&<p className="text-caption text-muted-foreground">{yerevanStamp(item.mark.recordedAt,l)} · {item.mark.nurseName}</p>}
     </li>)}</ul>
    </details>
   </article>)}</div>}
 </CareSection>;
}
