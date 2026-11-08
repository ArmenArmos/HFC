'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { Bell } from 'lucide-react';
import type { Route } from 'next';
import {parseLocale} from '@/lib/locale';
import { eventLabels, eventLabelsHy } from '@/lib/notifications/catalogue';
const eventLabelsRu: Record<string,string> = {
 'monitoring.created':'Ваш врач добавил требование к измерениям',
 'monitoring.cancelled':'Ваш врач отменил требование к измерениям',
 'review.no_change':'Рассмотрение завершено, утверждённый план не изменён',
 'review.published':'Рассмотрение завершено с публикацией',
 'case.created':'Дело создано',
 'assignment.changed':'Назначение вашей медицинской команды изменилось',
 'questionnaire.completed':'Вопросы о здоровье заполнены',
 'questionnaire.updated':'Ответы о здоровье обновлены',
 'booking.changed':'Запись на исследования обновлена',
 'results.updated':'Получение результатов обновлено',
 'consultation.changed':'Решение о консультации обновлено',
 'appointment.changed':'Запись к врачу обновлена',
 'evidence.reviewed':'Текущие данные рассмотрены',
 'draft.saved':'Черновик рассмотрения сохранён',
 'plan.published':'Ваш утверждённый план медицинской помощи готов',
 'workflow.reset':'Демонстрационный процесс перезапущен',
};
type Item={id:number;readAt:string|null;kind:string;at:string;caseId:string};
export function Inbox({staff=false,compact=false,iconOnly=false,locale='en'}:{staff?:boolean;compact?:boolean;iconOnly?:boolean;locale?:string}) {
 const [items,setItems]=useState<Item[]>([]),[error,setError]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState<number|null>(null);
 const l=parseLocale(locale,'en'); const c=useCallback((en:string,hy:string,ru:string)=>l==='hy'?hy:l==='ru'?ru:en,[l]); const base=staff?'/staff/notifications':'/patient/notifications';
 const refresh=useCallback(async()=>{try { const response=await fetch(`${base}/feed`,{cache:'no-store'}); if(!response.ok)throw new Error();const body=await response.json();setItems(body.items);setError(''); }catch{setError(c('Notifications unavailable. Try again.','Ծանուցումները հասանելի չեն։ Փորձեք կրկին։','Уведомления недоступны. Попробуйте ещё раз.'));}finally{setLoading(false);}},[base,c]);
 useEffect(()=>{const initial=setTimeout(()=>void refresh(),0); const timer=setInterval(()=>{if(document.visibilityState==='visible')void refresh();},30000); const focus=()=>void refresh();window.addEventListener('focus',focus);window.addEventListener('noreon-inbox-read',focus);return()=>{clearTimeout(initial);clearInterval(timer);window.removeEventListener('focus',focus);window.removeEventListener('noreon-inbox-read',focus);};},[refresh]);
 async function mark(id:number){setBusy(id);try{const r=await fetch(`${base}/feed`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});if(!r.ok)throw new Error();window.dispatchEvent(new Event('noreon-inbox-read'));await refresh();}catch{setError(c('Could not mark as read. Try again.','Չհաջողվեց պահպանել։ Փորձեք կրկին։','Не удалось отметить как прочитанное. Попробуйте ещё раз.'));}finally{setBusy(null);}}
 const unread=items.filter(n=>!n.readAt).length;
 if(compact)return <Link href={base as Route} className={iconOnly ? "relative inline-flex size-11 shrink-0 items-center justify-center rounded-full border text-foreground" : "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-caption"} aria-label={`${c('Notifications','Ծանուցումներ','Уведомления')}${error?(c(' · unavailable',' · հասանելի չեն',' · недоступны')):` · ${unread} ${c('unread','չկարդացված','непрочитанных')}`}`}>
  {iconOnly ? <Bell className="size-5" aria-hidden /> : (c('Notifications','Ծանուցումներ','Уведомления'))}
  {!loading&&!error&&(iconOnly ? unread>0&&<span aria-hidden className="absolute -right-1 -top-1 min-w-5 rounded-full bg-primary px-1 text-center text-caption leading-5 text-primary-foreground">{unread>=100?'100+':unread}</span> : <span className="rounded-full bg-primary px-2 py-1 text-primary-foreground">{unread===100?'100+':unread}</span>)}
  {error&&<span aria-hidden className={iconOnly?'absolute right-0 top-0 rounded-full bg-primary px-1 text-caption text-primary-foreground':undefined}>!</span>}
 </Link>;
 return <section className="space-y-4"><div className="flex items-center justify-between gap-3"><p className="text-body2 text-muted-foreground">{c('Your latest care updates.','Ձեր խնամքի վերջին թարմացումները։','Последние обновления по вашей медицинской помощи.')}</p><button onClick={()=>void refresh()} className="min-h-11 rounded-md border px-4">{c('Refresh','Թարմացնել','Обновить')}</button></div>{error&&<p role="alert">{error}</p>}{loading?<p role="status">{c('Loading notifications…','Բեռնվում է…','Загрузка уведомлений…')}</p>:!items.length&&!error?<p>{c('No notifications yet. New care updates will appear here.','Դեռ ծանուցումներ չկան։','Уведомлений пока нет. Здесь появятся новые обновления по вашей медицинской помощи.')}</p>:<ul className="space-y-3">{items.map(n=><li key={n.id} className={`rounded-xl border p-4 ${n.readAt?'bg-background':'bg-accent'}`}><p className="text-body2 font-semibold">{c(eventLabels[n.kind]??'Care update',eventLabelsHy[n.kind]??'Խնամքի ընթացքը թարմացվել է',eventLabelsRu[n.kind]??'Обновление медицинской помощи')}{!n.readAt&&<span className="ml-2 text-caption">{c('New','Նոր','Новое')}</span>}</p><p className="mt-1 text-caption text-muted-foreground">{new Intl.DateTimeFormat(c('en-GB','hy-AM','ru-RU'),{dateStyle:'medium',timeStyle:'short',hourCycle:'h23',timeZone:'Asia/Yerevan'}).format(new Date(n.at))} · {c('Yerevan','Yerevan','Ереван')}</p><div className="mt-3 flex flex-wrap gap-3"><Link className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-body2 text-primary-foreground" href={(staff?`/staff/case/${n.caseId}`:'/patient/dashboard') as Route}>{c(staff?'Open case':'See your next step','Տեսնել ընթացքը',staff?'Открыть случай':'Посмотреть следующий шаг')}</Link>{!n.readAt&&<button disabled={busy!==null} onClick={()=>void mark(n.id)} className="min-h-11 rounded-md border px-4 text-body2 disabled:opacity-50">{busy===n.id?(c('Saving…','Պահպանվում է…','Сохраняется…')):(c('Mark as read','Նշել որպես կարդացված','Отметить как прочитанное'))}</button>}</div></li>)}</ul>}</section>;
}
