'use client';
import Link from 'next/link';
import {TaskRow} from './real-coordination-tasks';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
import type {HandoffPage} from '@/lib/nurse-chat/handoffs';
import type {CoordinationActor} from '@/lib/staff/real-coordination/schema';
import {handoffTopicLabel} from '@/lib/nurse-chat/handoff-copy';

export function NurseHandoffs({page,actor,locale,onChanged=()=>{}}:{page:HandoffPage|null;actor:CoordinationActor;locale:StaffLocale;onChanged?:()=>void}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <section className="space-y-3 rounded-xl bg-card p-4" aria-label={t('Nurse handoffs','Բուժքրոջ փոխանցումներ','Передачи медсестры')}>
  <h2 className="text-h3">{t('Nurse handoffs','Բուժքրոջ փոխանցումներ','Передачи медсестры')}</h2>
  {!page?<p role="alert">{t('Handoffs are unavailable. Reload to check them.','Փոխանցումներն անհասանելի են։ Թարմացրեք՝ ստուգելու համար։','Передачи недоступны. Обновите страницу для проверки.')}</p>:<>
   {!page.items.length&&<p className="text-body2">{t('No handoffs in this view.','Այս տեսքում փոխանցումներ չկան։','В этом списке нет передач.')}</p>}
   {page.items.map(item=><div key={item.task.id} id={`handoff-${item.task.id}`} className="space-y-2 border-t pt-3">
    <p className="text-body2 font-semibold">{handoffTopicLabel(locale,item.topic)}</p>
    <p className="text-caption text-muted-foreground">{item.nurseName} · {t('Selected message','Ընտրված հաղորդագրություն','Выбранное сообщение')}</p>
    <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-body2">{item.messageText}</blockquote>
    <p className="whitespace-pre-wrap break-words text-body2">{item.observation}</p>
    <Link href={actor.role==='nurse'?`/staff/real/nurse-chat?member=${item.task.caseId}#nurse-message-${item.messageId}`:`/staff/real/conversations/${item.task.caseId}#handoff-${item.task.id}`} className="inline-flex min-h-11 items-center text-body2 underline">{t('Open source conversation','Բացել սկզբնաղբյուր զրույցը','Открыть исходный разговор')}</Link>
    <ul><TaskRow initial={item.task} actor={actor} l={locale} onChanged={onChanged}/></ul>
   </div>)}
   {page.hasMore&&<p className="text-body2">{t('Showing the first 50 handoffs. Open all tasks for more work.','Ցուցադրված են առաջին 50 փոխանցումները։ Մյուս աշխատանքների համար բացեք բոլոր առաջադրանքները։','Показаны первые 50 передач. Остальные задачи доступны в полном списке.')}</p>}
  </>}
  <Link href="/staff/real/tasks" className="inline-flex min-h-11 items-center text-body2 underline">{t('Open all tasks','Բացել բոլոր առաջադրանքները','Открыть все задачи')}</Link>
 </section>;
}
