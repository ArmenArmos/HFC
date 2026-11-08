import Link from 'next/link';
import {notFound,unstable_rethrow} from 'next/navigation';
import {CalendarClock,House,Building2} from 'lucide-react';
import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {yerevanStamp} from '@/lib/staff/yerevan-time';
import {readNurseVisits,type NurseVisitRpc} from '@/lib/nurse-visit/runtime';
import type {NurseVisitList} from '@/lib/nurse-visit/schema';
import {NurseVisitTimeline,staffStepLabel} from '@/components/staff/nurse-visit-timeline';

type Row=Extract<NurseVisitList,{enabled:true}>['visits'][number];
const yerevanDay=(iso:string)=>new Date(Date.parse(iso)+4*3600_000).toISOString().slice(0,10);
const time=(iso:string)=>new Date(Date.parse(iso)+4*3600_000).toISOString().slice(11,16);

export default async function NurseVisitsPage(){
 const {client,identity}=await requireRealStaffForRender();
 if(identity.role!=='nurse'&&identity.role!=='admin')notFound();
 const admin=identity.role==='admin';
 const locale=await staffLocale(identity.role);
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 let list:NurseVisitList|null=null;
 try{list=await readNurseVisits(client as unknown as NurseVisitRpc);}catch(error){unstable_rethrow(error);}
 const header=<header className="space-y-1"><p className="text-caption text-muted-foreground">{admin?t('Operations','Գործերի կառավարում','Операционная работа'):t('Nurse workspace','Բուժքրոջ աշխատատարածք','Рабочее пространство медсестры')}</p><h1 className="text-h1">{admin?t('Nurse visits','Բուժքրոջ այցեր','Визиты медсестры'):t('Your visits','Ձեր այցերը','Ваши визиты')}</h1><p className="text-body2 text-muted-foreground">{admin?t('Arranged visits of every member with the nurse steps recorded so far: who and when. Open a member for comments.','Բոլոր անդամների նշանակված այցերը՝ բուժքրոջ գրանցած քայլերով․ ով և երբ է կատարել դրանք։ Մեկնաբանությունները տեսնելու համար բացեք անդամի էջը։','Назначенные визиты всех участников с отмеченными действиями медсестры: кто и когда их выполнил. Откройте карту участника, чтобы увидеть комментарии.'):t('Open a visit to see what to do there, tick each item as you go and complete the visit.','Բացեք այցը՝ տեսնելու անելիքները, նշեք յուրաքանչյուր կետը և ավարտեք այցը։','Откройте визит, чтобы увидеть задачи, отмечайте выполненные пункты и завершите визит.')}</p></header>;
 if(!list)return <div className="mx-auto max-w-3xl space-y-6">{header}<p role="status" className="rounded-xl border bg-card p-4 text-body2">{t('Visits are unavailable. Reload to check them.','Այցերն անհասանելի են։ Թարմացրեք էջը՝ ստուգելու համար։','Визиты недоступны. Обновите страницу, чтобы проверить их.')}</p></div>;
 if(!list.enabled)return <div className="mx-auto max-w-3xl space-y-6">{header}<p role="status" className="rounded-xl border bg-card p-4 text-body2">{t('The visit list is not switched on yet. Use My members to open a member.','Այցերի ցանկը դեռ միացված չէ։ Անդամին բացելու համար օգտագործեք «Իմ անդամները»։','Список визитов ещё не включён. Откройте карту участника в разделе «Мои участники».')}</p></div>;
 const today=list.today;
 const groups:[string,Row[]][]=[
  [t('Today','Այսօր','Сегодня'),list.visits.filter(v=>!v.completion&&yerevanDay(v.startsAt)===today)],
  [t('Not completed from earlier days','Նախորդ օրերից չավարտված','Незавершённые визиты за прошлые дни'),list.visits.filter(v=>!v.completion&&yerevanDay(v.startsAt)<today)],
  [t('Upcoming','Առաջիկա','Предстоящие'),list.visits.filter(v=>!v.completion&&yerevanDay(v.startsAt)>today)],
  [t('Completed','Ավարտված','Завершённые'),list.visits.filter(v=>v.completion).reverse()],
 ];
 return <div className="mx-auto max-w-3xl space-y-6">{header}
  {list.visits.length===0&&<p role="status" className="rounded-xl border bg-card p-4 text-body2">{t('No visits are arranged for your members.','Ձեր անդամների համար այցեր նշանակված չեն։','Для ваших участников визиты не назначены.')}</p>}
  {groups.filter(([,rows])=>rows.length).map(([title,rows])=><section key={title} aria-label={title} className="space-y-2"><h2 className="text-h3">{title}</h2><ul className="divide-y rounded-xl border bg-card">{rows.map(v=><li key={`${v.source}:${v.id}`}>
   <Link href={admin?`/staff/real/members/${v.memberId}`:`/staff/real/visits/${v.memberId}/${v.source}/${v.id}`} className="flex min-h-11 flex-col gap-1 p-4 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring sm:flex-row sm:items-center sm:justify-between">
    <span className="min-w-0"><span className="block text-body1 font-medium">{v.memberName}</span><span className="flex items-center gap-1 text-caption text-muted-foreground">{v.mode==='home'?<House className="size-4" aria-hidden/>:<Building2 className="size-4" aria-hidden/>}{v.mode==='home'?t('Home visit','Տնային այց','Визит на дом'):v.clinic??t('Clinic visit','Այց կլինիկա','Визит в клинику')}{v.location?` · ${v.location}`:''}</span>{admin&&<span className="block text-caption text-muted-foreground">{v.nurseName?t(`Nurse: ${v.nurseName}`,`Բուժքույր՝ ${v.nurseName}`,`Медсестра: ${v.nurseName}`):t('No nurse assigned','Բուժքույր կցված չէ','Медсестра не назначена')}{v.steps.length?` · ${t('Latest:','Վերջին քայլը՝','Последнее действие:')} ${staffStepLabel[v.steps[v.steps.length-1].step][locale]}`:t(' · No steps yet',' · Քայլեր դեռ գրանցված չեն',' · Действий пока нет')}</span>}{admin&&v.steps.length>0&&<span className="mt-1 block"><NurseVisitTimeline steps={v.steps} locale={locale} compact/></span>}</span>
    <span className="flex shrink-0 flex-col text-body2 sm:items-end"><span className="flex items-center gap-1"><CalendarClock className="size-4" aria-hidden/>{yerevanDay(v.startsAt)===today?`${time(v.startsAt)}${v.endsAt?`–${time(v.endsAt)}`:''}`:yerevanStamp(v.startsAt,locale)}</span>
     <span className="text-caption text-muted-foreground">{v.completion?t(`Completed · ${v.samplesTaken} of ${v.samplesPlanned} samples`,`Ավարտված · նմուշներ՝ ${v.samplesTaken}/${v.samplesPlanned}`,`Завершён · образцы: ${v.samplesTaken} из ${v.samplesPlanned}`):t(`${v.samplesPlanned} ${v.samplesPlanned===1?'sample':'samples'} · ${v.openItems} to do`,`Նմուշներ՝ ${v.samplesPlanned} · անելիք՝ ${v.openItems}`,`Образцы: ${v.samplesPlanned} · задачи: ${v.openItems}`)}</span></span>
   </Link></li>)}</ul></section>)}
 </div>;
}
