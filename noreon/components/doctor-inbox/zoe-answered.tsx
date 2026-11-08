import Link from 'next/link';
import type {Route} from 'next';
import {Bot} from 'lucide-react';
import {Status,stamp} from '@/components/patient-care/common';
import {markZoeAnsweredAction} from '@/app/staff/real/(review)/today/actions';
import {zoeAnsweredEmpty,zoeAnsweredIntro,zoeAnsweredSummary,zoeAnsweredTitle,type ZoeAnsweredItem} from '@/lib/doctor-inbox/zoe-answered';

import {st,type StaffLocale as L} from '@/lib/staff/staff-locale-copy';
const button='inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring';

/** Doctor inbox, part 2: threads Zoe fully answered. Each row: read the conversation, mark reviewed, or reopen for a reply. */
export function ZoeAnsweredSection({items,total,l,from}:{items:ZoeAnsweredItem[];total?:number;l:L;from:'today'|'replies'}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru),count=total??items.length;
 return <section aria-labelledby="zoe-answered" className="space-y-3 rounded-xl border bg-background p-4">
  <h2 id="zoe-answered" className="flex flex-wrap items-baseline gap-2 text-h3">{l==='ru'?'Ответила Зоя':zoeAnsweredTitle(l)}<span className="text-body2 font-normal text-muted-foreground">{count}</span></h2>
  <p className="text-body2 text-muted-foreground">{l==='ru'?'Зоя полностью ответила этим участникам, и ваше участие не потребовалось: срочных признаков нет, вам ничего не передано, и участник не просил связать его с вами. Прочитайте ответ Зои, затем отметьте его как проверенный или откройте разговор снова, чтобы ответить самостоятельно.':zoeAnsweredIntro(l)}</p>
  {items.length===0?<p className="text-body2 text-muted-foreground">{l==='ru'?'Ответов Зои, ожидающих вашей проверки, нет.':zoeAnsweredEmpty(l)}</p>:<ul className="divide-y">{items.map(i=>{
   const bound=<><input type="hidden" name="memberId" value={i.memberId}/><input type="hidden" name="version" value={i.version}/><input type="hidden" name="from" value={from}/></>;
   return <li key={i.conversationId} className="space-y-2 py-4 first:pt-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2">
     <Bot className="size-5 shrink-0 text-brand-teal" aria-hidden/>
     <span className="text-body2 font-semibold">{i.memberName||t('Member without a name','Անանուն անդամ',"Участник без имени")}</span>
     <Status>{t('Answered by Zoe','Պատասխանել է Զոյան',"Ответила Зоя")}</Status>
    </div>
    <p className="text-body2">{l==='ru'?[`Сообщений: ${i.unanswered}`,`Срочность по оценке Зои: ${{none:'не срочно',self_monitoring:'самопомощь и наблюдение',planned:'следующий плановый визит',doctor_soon:'врач в ближайшие дни'}[i.urgency]}`,...(i.declined?['участник отказался передать это вам']:[])].join(' · '):zoeAnsweredSummary(i,l)}</p>
    <p className="text-caption text-muted-foreground">{t('Zoe answered','Զոյան պատասխանել է',"Зоя ответила")} {stamp(i.answeredAt,l)}</p>
    <div className="flex flex-wrap items-start gap-3">
     <Link href={`/staff/real/conversations/${i.memberId}` as Route} className={`${button} border`}>{t('Read conversation','Կարդալ զրույցը',"Прочитать разговор")}</Link>
     <form action={markZoeAnsweredAction}>{bound}<input type="hidden" name="action" value="reviewed"/>
      <button className={`${button} bg-primary text-primary-foreground`}>{t('Mark reviewed','Նշել որպես դիտված',"Отметить как проверенное")}</button></form>
     <form action={markZoeAnsweredAction}>{bound}<input type="hidden" name="action" value="reopen"/>
      <button className={`${button} border`}>{t('Reopen for my reply','Վերաբացել՝ պատասխանելու համար',"Открыть снова для моего ответа")}</button></form>
    </div>
   </li>;})}</ul>}
  {count>items.length&&<p className="text-caption text-muted-foreground">{t(`Showing ${items.length} of ${count}. Mark some reviewed to see the rest.`,`Ցուցադրված են ${items.length}-ը ${count}-ից։ Նշեք որոշները որպես դիտված՝ մնացածը տեսնելու համար։`,`Показано ${items.length} из ${count}. Отметьте часть ответов как проверенные, чтобы увидеть остальные.`)}</p>}
 </section>;
}
