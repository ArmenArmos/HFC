'use client';
import {useRef,useState,useTransition} from 'react';
import Link from 'next/link';
import {TaskRow,RealCoordinationTasks} from './real-coordination-tasks';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import {stamp} from '@/components/patient-care/common';
import {nurseVisitChatHref} from './nurse-chat-visit-list';
import {todayItems} from '@/lib/nurse-chat/today';
import {readNurseToday} from '@/lib/nurse-chat/today-actions';
import {NurseUrgentAlertRow,NurseAlertReadFailure} from './nurse-urgent-alerts';
import type {CoordinationActor} from '@/lib/staff/real-coordination/schema';

type Today=Awaited<ReturnType<typeof readNurseToday>>;
export function NurseToday({initial,actor,locale}:{initial:Today;actor:CoordinationActor;locale:StaffLocale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 const [data,setData]=useState(initial),[notice,setNotice]=useState('');
 const [source,setSource]=useState(initial);
 if(source!==initial){setSource(initial);setData(initial);}
 const [busy,start]=useTransition(),locked=useRef(false);
 const items=data.ok?todayItems(data.page?.tasks??[],data.visits?.enabled?data.visits.visits:[],new Date(data.asOf),data.alerts?.kind==='ready'?data.alerts.alerts:[]):[];
 const active=items.filter(i=>i.state!=='completed'&&i.state!=='cancelled'&&i.state!=='resolved');
 const open=active.length;
 const onTaskChanged=(task:import('@/lib/staff/real-coordination/schema').CoordinationTask)=>setData(previous=>previous.ok&&previous.page?{...previous,page:{...previous.page,tasks:previous.page.tasks.map(row=>row.id===task.id?task:row)}}:previous);
 const onAlertChanged=()=>load();
 const labels={resolved:t('Resolved','Կարգավորված','Решено'),acknowledged:t('Acknowledged','Ընդունված','Принято'),open:t('Open','Բաց','Открыто'),due:t('Due today','Այսօրվա համար','На сегодня'),overdue:t('Overdue','Ժամկետանց','Просрочено'),completed:t('Completed','Ավարտված','Завершено'),cancelled:t('Cancelled','Չեղարկված','Отменено')};
 function load(){if(locked.current)return;locked.current=true;start(async()=>{
  try{
   setData(await readNurseToday());
   setNotice('');
  }catch{setData({ok:false,code:'unavailable'});setNotice(t('Reload your work list to check current access.','Թարմացրեք աշխատանքների ցանկը՝ ընթացիկ հասանելիությունը ստուգելու համար։','Обновите список для проверки текущего доступа.'));}
  finally{locked.current=false;}
 });}
 return <section className="space-y-3 rounded-xl bg-card p-4" aria-label={t('Your work today','Ձեր այսօրվա աշխատանքը','Ваша работа на сегодня')} aria-busy={busy}>
  {!data.ok?<p role="alert">{t('Your work list is unavailable. Reload to check it.','Ձեր աշխատանքների ցանկն անհասանելի է։ Թարմացրեք՝ ստուգելու համար։','Список работы недоступен. Обновите страницу для проверки.')}</p>:<>
   <NurseAlertReadFailure read={data.alerts} locale={locale}/>
   {data.alerts?.kind==='ready'&&data.alerts.total>data.alerts.alerts.length&&<p role="status">{t('More urgent alerts exist. Reload or ask the doctor to review the rest.','Կան այլ շտապ ազդանշաններ։ Թարմացրեք կամ խնդրեք բժշկին դիտել մնացածը։','Есть другие срочные оповещения. Обновите список или попросите врача просмотреть остальные.')}</p>}
   <p className="text-body2">{open} {t('open alerts, tasks and visits','բաց ազդանշան, առաջադրանք և այց','открытых оповещений, задач и визитов')} · {items.filter(i=>i.state==='overdue').length} {t('overdue','ժամկետանց','просрочено')}</p>
   <p className="text-caption text-muted-foreground">{t('As of','Առ','По состоянию на')} {stamp(data.asOf,locale)}</p>
   {(!data.page||!data.visits)&&<p role="alert">{!data.visits&&!data.page?t('Tasks and visits could not be read. The counts are incomplete; do not assume nothing is due.','Առաջադրանքներն ու այցերը չհաջողվեց կարդալ։ Քանակները թերի են. մի կարծեք, թե ոչինչ ժամկետանց չէ։','Не удалось прочитать задачи и визиты. Количество неполное; не считайте, что ничего не ждёт.'):!data.visits?t('Visits could not be read. The counts are incomplete; do not assume none are due.','Այցերը չհաջողվեց կարդալ։ Քանակները թերի են. մի կարծեք, թե ժամկետանց այցեր չկան։','Не удалось прочитать визиты. Количество неполное; не считайте, что ближайших визитов нет.'):t('Tasks could not be read. The counts are incomplete; do not assume none are due.','Առաջադրանքները չհաջողվեց կարդալ։ Քանակները թերի են. մի կարծեք, թե ժամկետանց առաջադրանքներ չկան։','Не удалось прочитать задачи. Количество неполное; не считайте, что задач к сроку нет.')}</p>}
   {data.visits&&!data.visits.enabled&&<p role="status">{t('Visits are switched off. Alerts and tasks are shown.','Այցերն անջատված են։ Ցուցադրված են ազդանշաններն ու առաջադրանքները։','Визиты отключены. Показаны оповещения и задачи.')}</p>}
   {!active.length&&data.alerts?.kind!=='unavailable'&&Boolean(data.page&&data.visits)&&<p role="status">{t('No open work in the available list.','Հասանելի ցանկում բաց աշխատանք չկա։','В доступном списке нет открытой работы.')}</p>}
   {!!active.length&&<p className="text-body2 font-medium">{t('Open work, urgent alerts first','Բաց աշխատանք՝ շտապ ազդանշանները սկզբում','Открытая работа, сначала срочные оповещения')}</p>}
   <ul className="space-y-3">{active.map(item=><li key={item.id} className="rounded-lg border p-3">
    <p className="text-caption font-semibold">{labels[item.state]}{item.at?` · ${stamp(item.at,locale)}`:''}</p>
    {item.kind==='alert'?<NurseUrgentAlertRow alert={item.alert} locale={locale} onChanged={onAlertChanged} member={alert=><Link href={`/staff/real/nurse-chat?member=${alert.memberId}`} className="underline underline-offset-4">{alert.memberName||t('Member without a name','Անանուն անդամ','Участник без имени')}</Link>}/>:item.kind==='task'?<ul><TaskRow memberHref={`/staff/real/nurse-chat?member=${item.task.caseId}`} initial={item.task} actor={actor} l={locale} onChanged={onTaskChanged}/></ul>:<Link href={nurseVisitChatHref(item.visit)} className="inline-flex min-h-11 flex-col justify-center text-body2 underline">{item.visit.memberName} · {t('Open visit','Բացել այցը','Открыть визит')} · {item.visit.openItems} {t('to do','անելիք','задач')}</Link>}
   </li>)}</ul>
   {data.visits?.enabled&&<details name="nurse-today-work" className="rounded-lg border p-3"><summary className="min-h-11 cursor-pointer content-center text-body2 font-medium">{t('All visits','Բոլոր այցերը','Все визиты')} · {data.visits.visits.length}</summary><ul className="divide-y">{items.filter(item=>item.kind==='visit').map(item=>item.kind==='visit'&&<li key={item.id} className="py-2"><Link href={nurseVisitChatHref(item.visit)} className="inline-flex min-h-11 flex-col justify-center text-body2 underline">{item.visit.memberName} · {labels[item.state]} · {stamp(item.visit.startsAt,locale)}</Link></li>)}</ul></details>}
   {data.page&&<details name="nurse-today-work" className="rounded-lg border p-3"><summary className="min-h-11 cursor-pointer content-center text-body2 font-medium">{t('Task filters and history','Առաջադրանքների զտիչներ և պատմություն','Фильтры и история задач')}</summary><RealCoordinationTasks page={data.page} memberPage={{members:[],nextCursor:null}} actor={actor} locale={locale} nurseChat onTaskChanged={onTaskChanged}/></details>}
   {data.page?.nextCursor&&<p className="text-caption">{t('Counts and due order cover loaded work. Open task filters and history to load more tasks.','Քանակներն ու ժամկետների հերթը վերաբերում են բեռնված աշխատանքին։ Այլ առաջադրանքների համար բացեք զտիչներն ու պատմությունը։','Количество и порядок сроков относятся к загруженной работе. Откройте фильтры и историю, чтобы загрузить ещё задачи.')}</p>}

  </>}
  <div className="flex flex-wrap gap-3"><button type="button" disabled={busy} className="dw-pill" onClick={()=>load()}>{busy?t('Loading…','Բեռնվում է…','Загрузка…'):t('Reload work list','Թարմացնել աշխատանքների ցանկը','Обновить список работы')}</button></div>
  {notice&&<p role="status">{notice}</p>}
 </section>;
}
