import {taskTitle} from '@/lib/staff/real-coordination/task-copy';
import {staffDisplayText} from '@/lib/staff/display-text';
import Link from 'next/link';
import type {Route} from 'next';
import type {L} from '@/lib/staff-zoe/contracts';
import {st} from '@/lib/staff/staff-locale-copy';
import {stamp} from '@/components/patient-care/common';
import type {CareAlert} from '@/lib/care-alerts/contracts';
import {alertCardFields} from '@/lib/staff/alert-card';
import {AlertCardLines} from '@/components/staff/alert-card';
import {itemSummary,primaryAction,orderInbox} from '@/lib/doctor-inbox/contracts';
import type {DoctorDay} from '@/lib/doctor-inbox/day';
import {ZoeTurn} from '@/components/patient/zoe-kit/thread';
import {homeTime} from './home-presentation';
import {doctorDayCounts} from '@/lib/doctor-inbox/day-counts';
import {mergeUrgent,urgentWindowLine} from '@/lib/doctor-inbox/urgent-windows';

export type DayItem={id:string;revision:string;memberId:string;name:string;label:string;at:string;source:string;href:string;decision:boolean;alert?:CareAlert};
/** Only records and existing code-written descriptions. No model or new clinical calculation. */
export function dayItems(day:DoctorDay,locale:L):DayItem[]{
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),{inbox}=day;
 return [
  ...mergeUrgent(inbox.p0,day.windows).map(i=>i.kind==='care_alert'
   ?{id:i.id,revision:JSON.stringify(i),memberId:i.memberId,name:i.memberName,label:alertCardFields(i.alert,locale).symptom,alert:i.alert,at:i.at,source:t('Care alert','Խնամքի ահազանգ','Оповещение'),href:'/staff/real/alerts',decision:true}
   :{id:`urgent-window:${i.memberId}`,revision:JSON.stringify(i),memberId:i.memberId,name:i.memberName,label:urgentWindowLine(i.since,locale),at:i.since,source:t('Urgent conversation','Շտապ զրույց','Срочный разговор'),href:`/staff/real/members/${i.memberId}`,decision:false}),
  ...orderInbox(inbox.items).map(i=>({id:i.id,revision:JSON.stringify(i),memberId:i.memberId,name:i.memberName,label:itemSummary(i,locale)+(i.unanswered===undefined?'':` · ${t('Messages waiting','Սպասող հաղորդագրություններ','Ожидающие сообщения')}: ${i.unanswered}`),at:i.at,source:i.kind.startsWith('lab_')?t('Lab result','Լաբորատոր արդյունք','Лабораторный результат'):i.kind.startsWith('reply_')?t('Member conversation','Անդամի զրույց','Разговор с участником'):t('Saved care record','Պահպանված խնամքի գրառում','Сохранённая запись помощи'),href:primaryAction(i,locale).href,decision:['reply_draft','reply_overdue','reply_not_delivered'].includes(i.kind)})),
  ...(day.firstNotes?.enabled?day.firstNotes.items:[]).map(i=>({id:`first:${i.memberId}`,revision:JSON.stringify(i),memberId:i.memberId,name:i.memberName??'',label:t('First note: approve by','Առաջին գրառում. հաստատել մինչև','Первое сообщение: утвердить до'),at:i.dueAt,source:t('First note queue','Առաջին գրառումների ցանկ','Очередь первых сообщений'),href:`/staff/real/members/${i.memberId}`,decision:false})),
  ...(day.ldl??[]).map(i=>({id:`ldl:${i.id}`,revision:JSON.stringify(i),memberId:i.memberId,name:i.memberName,label:t('LDL review waiting','ՑԽԼ վերանայումը սպասում է','Ожидает проверки ЛПНП'),at:i.observedOn,source:t('Reviewed LDL result','Վերանայված ՑԽԼ արդյունք','Проверенный результат ЛПНП'),href:`/staff/real/members/${i.memberId}`,decision:true})),
  ...(day.medicines??[]).map(i=>({id:`medicine:${i.id}`,revision:JSON.stringify(i),memberId:i.memberId,name:i.memberName,label:t('Medicine concern waiting','Դեղի մասին հարցը սպասում է','Ожидает вопрос о лекарстве'),at:i.createdAt,source:t('Member medicine response','Անդամի պատասխանը դեղի մասին','Ответ участника о лекарстве'),href:`/staff/real/members/${i.memberId}`,decision:true})),
  ...(day.tasks?.items??[]).map(i=>({id:`task:${i.id}`,revision:JSON.stringify(i),memberId:i.caseId,name:i.memberName??'',label:taskTitle(i,locale),at:i.dueAt!,source:t('Overdue coordination task','Ժամկետանց համակարգման առաջադրանք','Просроченная задача координации'),href:`/staff/real/members/${i.caseId}`,decision:false})),
 ];
}
export function overdueDayItems(day:DoctorDay,locale:L){
 return dayItems(day,locale).filter(i=>i.id.startsWith('task:')||
  i.id.startsWith('first:')&&Date.parse(i.at)<=Date.parse(day.inbox.asOf)||
  day.inbox.items.some(x=>x.id===i.id&&(x.overdue||x.kind==='reply_overdue')));
}
export function DayItemCards({items,locale,onSelect,decisions,alerts=false}:{items:DayItem[];locale:L;onSelect?:(id:string)=>void;decisions?:boolean;alerts?:boolean}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <ul className="dw-action-cards">{items.map(i=><li key={i.id} className="zk-card space-y-2" data-day-item={i.id}>
  <p className="text-body2 font-semibold">{i.name}</p>{i.alert?<AlertCardLines alert={i.alert} locale={locale}/>:<p className="text-body2">{staffDisplayText(i.label,locale,true)}</p>}
  <p className="text-caption text-muted-foreground">{i.source} · <time dateTime={i.at}>{stamp(i.at,locale)}</time></p>
  {onSelect&&decisions&&i.decision&&(!i.id.startsWith('care_alert:')||alerts)&&<button type="button" className="dw-pill" onClick={()=>onSelect(i.memberId)}>{t('Open decision card','Բացել որոշման քարտը','Открыть карточку решения')}</button>}<Link href={i.href as Route} className="inline-flex min-h-11 items-center text-body2 underline">{t('Open item','Բացել տարրը','Открыть элемент')}</Link>
 </li>)}</ul>;
}
export function dayStatus(day:DoctorDay,locale:L){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),counts=doctorDayCounts(day);
 const missing=[...day.inbox.unavailable,...(day.firstNotes?[]:['first_notes']),...(day.ldl?[]:['ldl']),...(day.medicines?[]:['medicines']),...(day.tasks===null?['tasks']:[]),...(day.handoffs===null?['handoffs']:[])];
 return {counts,missing,incomplete:missing.length>0||day.urgentCapped,text:missing.length?t('Some sources are unavailable','Որոշ աղբյուրներ անհասանելի են','Некоторые источники недоступны'):day.urgentCapped?t('Your urgent list is incomplete','Ձեր շտապ գործերի ցանկն ամբողջական չէ','Ваш список срочных задач неполный'):counts.total?t(`${counts.total} items are waiting for your review`,`${counts.total} գործ սպասում է ձեր վերանայմանը`,`Ожидают вашей проверки: ${counts.total}`):t('nothing needs your decision','ոչինչ ձեր որոշման կարիքը չունի','ничего не требует вашего решения')};
}
export function DaySummary({day,locale}:{day:DoctorDay;locale:L}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru),{counts,missing,incomplete}=dayStatus(day,locale);
 const waiting=[
  [counts.alerts,t('urgent items','շտապ գործեր','срочные задачи')],
  [counts.today,t('for today','այսօրվա համար','на сегодня')],
  [counts.week,t('for this week','այս շաբաթվա համար','на эту неделю')],
  [counts.routine,t('for routine review','ընթացիկ վերանայման համար','для плановой проверки')],
  [counts.firstNotes,t('first notes','առաջին գրառումներ','первые сообщения')],
  [counts.ldl,t('LDL reviews','ՑԽԼ վերանայումներ','проверки ЛПНП')],
  [counts.medicines,t('medicine concerns','դեղերի հարցեր','вопросы о лекарствах')],
  [counts.tasks,t('overdue tasks','ժամկետանց առաջադրանքներ','просроченные задачи')],
 ]as const;
 const details=waiting.filter(([count])=>count>0).map(([count,label])=>`${count} ${label}`).join(' · ');
 const say=counts.total?[t(`You have ${counts.total} items waiting across your care queues. I have put the available cards below for you to review.`,`Ձեր խնամքի ցանկերում ${counts.total} գործ է սպասում։ Հասանելի քարտերը տեղադրել եմ ներքևում՝ ձեր վերանայման համար։`,`В ваших очередях помощи ожидают проверки ${counts.total} записей. Доступные карточки я собрала ниже.`),...(details?[details]:[])]:[incomplete?t('I could not read all your care queues. I cannot tell you that nothing is waiting.','Չհաջողվեց կարդալ խնամքի բոլոր ցանկերը։ Չեմ կարող հաստատել, որ սպասող գործեր չկան։','Не удалось прочитать все очереди. Я не могу подтвердить, что ожидающих записей нет.'):t('You are up to date. In the available care queues, nothing needs your decision.','Հասանելի խնամքի ցանկերում ոչինչ ձեր որոշման կարիքը չունի։','В доступных очередях помощи ничего не требует вашего решения.')];
 if(counts.handoffs)say.push(t(`Open nurse handoffs: ${counts.handoffs}`,`Բուժքրոջ բաց փոխանցումներ՝ ${counts.handoffs}`,`Открытые передачи медсестры: ${counts.handoffs}`));
 return <ZoeTurn locale={locale} say={say} at={homeTime(day.inbox.asOf,locale)}>
  {missing.length>0&&<p role="alert" className="zk-bubble">{t('Some sources are unavailable. These counts are incomplete. Open Today and the full record to check.','Որոշ աղբյուրներ անհասանելի են։ Քանակները թերի են։ Ստուգեք «Այսօր» բաժինը և ամբողջական գրառումը։','Некоторые источники недоступны. Количество неполное. Проверьте раздел «Сегодня» и полную запись.')}</p>}
  {(day.urgentCapped||day.inbox.p0Total>day.inbox.p0.length||day.inbox.items.some(i=>day.inbox.items.filter(x=>x.lane===i.lane).length>=day.inbox.laneCap)||day.tasks?.hasMore)&&<p className="zk-bubble">{t('This is a bounded queue, like Today. Open the full pages for more items.','Սա սահմանափակ ցանկ է, ինչպես «Այսօր» բաժինը։ Մյուս տարրերի համար բացեք ամբողջական էջերը։','Здесь показана ограниченная очередь, как в разделе «Сегодня». Остальные элементы доступны на полных страницах.')}</p>}
  <p className="zk-time">{t('Source: Today queues. As of','Աղբյուր՝ «Այսօր» ցանկերը։ Առ','Источник: очереди «Сегодня». По состоянию на')} {stamp(day.inbox.asOf,locale)}</p>
  <Link href={'/staff/real/today' as Route} className="zk-link">{t('Open Today','Բացել «Այսօր» բաժինը','Открыть «Сегодня»')}</Link>
 </ZoeTurn>;
}
export function OverdueTaskCards({tasks,locale}:{tasks:DoctorDay['tasks'];locale:L}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <section className="space-y-3"><h2 className="text-h3">{t('Overdue tasks','Ժամկետանց առաջադրանքներ','Просроченные задачи')} {tasks?.items.length??''}</h2>
  {!tasks&&<p role="alert">{t('Tasks could not be read.','Առաջադրանքները չհաջողվեց կարդալ։','Не удалось прочитать задачи.')}</p>}
  {tasks?.items.map(i=><p key={i.id} className="text-body2"><Link href={`/staff/real/members/${i.caseId}` as Route} className="underline">{i.memberName}: {taskTitle(i,locale)}</Link> · {stamp(i.dueAt!,locale)}</p>)}
  {tasks?.hasMore&&<Link href={'/staff/real/tasks' as Route} className="text-body2 underline">{t('Open all tasks','Բացել բոլոր առաջադրանքները','Открыть все задачи')}</Link>}
 </section>;
}
