import Link from 'next/link';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import type {NurseVisitList,NurseVisitRow} from '@/lib/nurse-visit/schema';

export function nurseVisitChatHref(visit:NurseVisitRow,evidence=false){
 const query=new URLSearchParams({member:visit.memberId,source:visit.source,visit:visit.id});
 if(evidence)query.set('evidence','true');
 return `/staff/real/nurse-chat?${query}` as const;
}
const day=(iso:string)=>new Date(Date.parse(iso)+4*3600_000).toISOString().slice(0,10);
export function NurseChatVisitList({list,locale,memberId}:{list:NurseVisitList|null;locale:StaffLocale;memberId?:string}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if(!list)return <p role="alert" className="rounded-xl bg-card p-4">{t('Visits are unavailable. Reload to try again.','Այցերն անհասանելի են։ Թարմացրեք՝ կրկին փորձելու համար։','Визиты недоступны. Обновите страницу для повторной попытки.')}</p>;
 if(!list.enabled)return <p role="status" className="rounded-xl bg-card p-4">{t('Nurse visits are switched off. Open a member from My members.','Բուժքրոջ այցերն անջատված են։ Բացեք անդամին «Իմ անդամները» բաժնից։','Визиты медсестры отключены. Откройте участника в разделе «Мои участники».')} <Link className="underline" href="/staff/real/members">{t('My members','Իմ անդամները','Мои участники')}</Link></p>;
 const rows=list.visits.filter(v=>!memberId||v.memberId===memberId);
 const groups=[
  {id:'today',title:t('Today','Այսօր','Сегодня'),rows:rows.filter(v=>!v.completion&&day(v.startsAt)===list.today)},
  {id:'earlier',title:t('Earlier','Ավելի վաղ','Ранее'),rows:rows.filter(v=>!v.completion&&day(v.startsAt)<list.today)},
  {id:'upcoming',title:t('Upcoming','Առաջիկա','Предстоящие'),rows:rows.filter(v=>!v.completion&&day(v.startsAt)>list.today)},
  {id:'completed',title:t('Completed','Ավարտված','Завершённые'),rows:rows.filter(v=>v.completion).reverse()},
 ];
 return <section className="space-y-4 rounded-xl border-l-4 border-l-primary bg-card p-4 sm:p-5" aria-label={t('Your visits','Ձեր այցերը','Ваши визиты')}>
  <h2 className="text-h3">{t('Your visits','Ձեր այցերը','Ваши визиты')}</h2>
  {!rows.length&&<p role="status" className="text-body2">{t('No visits are arranged.','Այցեր նշանակված չեն։','Визиты не назначены.')}</p>}
  {groups.filter(group=>group.rows.length).map(group=><section key={group.id} data-visit-group={group.id} className="space-y-2">
   <h3 className="text-body2 font-semibold">{group.title}</h3>
   <ul className="divide-y">{group.rows.map(visit=><li key={`${visit.source}:${visit.id}`}>
    <Link data-visit-link href={nurseVisitChatHref(visit)} className="flex min-h-11 flex-wrap items-center justify-between gap-2 py-3 text-body2">
     <span className="min-w-0 break-words"><strong>{visit.memberName}</strong><span className="block text-caption text-muted-foreground">{yerevanStamp(visit.startsAt,locale)} · {visit.mode==='home'?t('Home visit','Տնային այց','Визит на дом'):visit.clinic??t('Clinic visit','Այց կլինիկա','Визит в клинику')}</span><span className="block text-caption text-muted-foreground">{t(`Samples ${visit.samplesTaken}/${visit.samplesPlanned}`,`Նմուշներ՝ ${visit.samplesTaken}/${visit.samplesPlanned}`,`Образцы: ${visit.samplesTaken}/${visit.samplesPlanned}`)}{!visit.completion&&` · ${t(`${visit.openItems} items left`,`Մնացած կետեր՝ ${visit.openItems}`,`Осталось пунктов: ${visit.openItems}`)}`}</span></span>
     <span className="text-caption underline">{visit.completion?t('Read completed visit','Կարդալ ավարտված այցը','Прочитать завершённый визит'):t('Open visit','Բացել այցը','Открыть визит')}</span>
    </Link>
   </li>)}</ul>
  </section>)}
 </section>;
}
