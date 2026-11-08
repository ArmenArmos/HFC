import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import type {NurseVisitList as VisitListData} from '@/lib/nurse-visit/schema';
import type {VisitChoice} from './use-nurse-visit';

const day=(iso:string)=>new Date(Date.parse(iso)+4*3600_000).toISOString().slice(0,10);

/** The previous visit list's groups and wording, opened inside the chat. */
export function NurseVisitList({data,locale,disabled,onOpen}:{data:Extract<VisitListData,{enabled:true}>;locale:StaffLocale;disabled:boolean;onOpen:(visit:VisitChoice)=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const rows=data.visits;
 const groups=[
  {id:'today',title:t('Today','Այսօր','Сегодня'),rows:rows.filter(v=>!v.completion&&day(v.startsAt)===data.today)},
  {id:'earlier',title:t('Earlier','Ավելի վաղ','Ранее'),rows:rows.filter(v=>!v.completion&&day(v.startsAt)<data.today)},
  {id:'upcoming',title:t('Upcoming','Առաջիկա','Предстоящие'),rows:rows.filter(v=>!v.completion&&day(v.startsAt)>data.today)},
  {id:'completed',title:t('Completed','Ավարտված','Завершённые'),rows:rows.filter(v=>v.completion).reverse()},
 ];
 return <section data-visit-list aria-label={t('Your visits','Ձեր այցերը','Ваши визиты')}>
  <p><strong>{t('Your visits','Ձեր այցերը','Ваши визиты')}</strong></p>
  {!rows.length&&<p role="status">{t('No visits are arranged.','Այցեր նշանակված չեն։','Визиты не назначены.')}</p>}
  {groups.filter(group=>group.rows.length).map(group=><section key={group.id} data-visit-group={group.id}>
   <h3 className="ncv2-body font-semibold">{group.title}</h3>
   <ul className="ncv2-list">{group.rows.map(visit=><li key={`${visit.source}:${visit.id}`} data-visit-list-row={visit.id}>
    <button type="button" data-visit-open={visit.id} className="ncv2-choice" disabled={disabled} onClick={()=>onOpen(visit)} onPointerDown={event=>event.preventDefault()} onMouseDown={event=>event.preventDefault()}>
     <span className="min-w-0 break-words"><strong>{visit.memberName}</strong><span className="cv2-time block">{yerevanStamp(visit.startsAt,locale)} · {visit.mode==='home'?t('Home visit','Տնային այց','Визит на дом'):visit.clinic??t('Clinic visit','Այց կլինիկա','Визит в клинику')}</span><span className="cv2-time block">{t(`Samples ${visit.samplesTaken}/${visit.samplesPlanned}`,`Նմուշներ՝ ${visit.samplesTaken}/${visit.samplesPlanned}`,`Образцы: ${visit.samplesTaken}/${visit.samplesPlanned}`)}{!visit.completion&&` · ${t(`${visit.openItems} items left`,`Մնացած կետեր՝ ${visit.openItems}`,`Осталось пунктов: ${visit.openItems}`)}`}</span><span className="block underline">{visit.completion?t('Read completed visit','Կարդալ ավարտված այցը','Прочитать завершённый визит'):t('Open visit','Բացել այցը','Открыть визит')}</span></span>
    </button>
   </li>)}</ul>
  </section>)}
 </section>;
}
