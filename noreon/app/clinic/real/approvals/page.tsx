import {clinicLocale} from '@/lib/clinic-portal/locale';
import Link from 'next/link';
import {redirect} from 'next/navigation';
import type {Route} from 'next';
import {requireClinicPortal} from '@/lib/clinic-portal/identity';
import {ClinicShell} from '@/components/clinic-portal/shell';
import {ChangeApprovals} from '@/components/clinic-portal/change-approvals';
import {readChangeRequests} from '@/lib/clinic-admin/approvals';
import {clinicChangeDecide} from '@/lib/clinic-admin/approval-actions';
export default async function ClinicApprovalsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const query=await searchParams,locale=await clinicLocale(query.locale),t=(en:string,hy:string,ru:string)=>locale==='hy'?hy:locale==='ru'?ru:en;
 const context=await requireClinicPortal(typeof query.clinic==='string'?query.clinic:null,{page:true}),clinicId=context.identity.clinicId;
 if(context.identity.capability!=='clinic_admin')redirect(`/clinic/real/bookings?clinic=${clinicId}&locale=${locale}` as Route);
 const state=query.state==='decided'?'decided':'pending',list=await readChangeRequests(context.rpc,clinicId,state);
 return <ClinicShell identity={context.identity} locale={locale} current="approvals"><h1 className="text-h1">{t('Change approvals','Փոփոխությունների հաստատում','Согласование изменений')}</h1>
  <p className="text-body2 text-muted-foreground">{t('Review changes to care teams. Requests expire after 7 days.','Դիտեք խնամքի թիմերի փոփոխությունները։ Հարցումների ժամկետը լրանում է 7 օր անց։','Рассматривайте изменения медицинских команд. Срок запросов истекает через 7 дней.')}</p>
  <nav className="flex gap-3" aria-label={t('Request status','Հարցման կարգավիճակ','Статус запроса')}>{(['pending','decided'] as const).map(value=><Link key={value} aria-current={state===value?'page':undefined} className="inline-flex min-h-12 items-center rounded-md border px-4 text-body2" href={`/clinic/real/approvals?clinic=${clinicId}&locale=${locale}&state=${value}` as Route}>{value==='pending'?t('Waiting','Սպասող','Ожидающие'):t('Decided','Որոշված','Рассмотренные')}</Link>)}</nav>
  {list.status==='loaded'?list.requests.length?<ChangeApprovals requests={list.requests} locale={locale} decide={clinicChangeDecide.bind(null,clinicId,context.actorScope)}/>:<p role="status" className="text-body2">{state==='pending'?t('No changes waiting for approval.','Հաստատման սպասող փոփոխություններ չկան։','Нет изменений, ожидающих согласования.'):t('No decided requests yet.','Որոշված հարցումներ դեռ չկան։','Рассмотренных запросов пока нет.')}</p>:<p role="alert" className="text-body2">{list.status==='disabled'?t('Change approvals are not switched on yet.','Փոփոխությունների հաստատումը դեռ միացված չէ։','Согласование изменений пока не включено.'):t('Requests could not load. Try again.','Հարցումները չհաջողվեց բեռնել։ Նորից փորձեք։','Не удалось загрузить запросы. Попробуйте снова.')}</p>}
  {list.status==='loaded'&&list.requests.length===100&&<p className="text-caption text-muted-foreground">{t('Showing up to 100 requests.','Ցուցադրվում է մինչև 100 հարցում։','Показано не более 100 запросов.')}</p>}
 </ClinicShell>;
}
