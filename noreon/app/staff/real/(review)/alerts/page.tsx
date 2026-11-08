import Link from 'next/link';
import {doctorChatV2Enabled} from '@/lib/staff-zoe/workspace-config';
import type {Route} from 'next';
import {notFound,unstable_rethrow} from 'next/navigation';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {staffLocale} from '@/lib/staff/staff-locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {careAlertInboxSchema,careAlertsEnabled,noticeLabel,resolutionLabel,type CareAlert} from '@/lib/care-alerts/contracts';
import {AlertCardLines} from '@/components/staff/alert-card';
import {alertCardFields} from '@/lib/staff/alert-card';
import {CareAlertResolve} from '@/components/staff/care-alert-resolve';
import {acknowledgeCareAlert,resolveCareAlert} from '@/lib/care-alerts/actions';
import {readDoctorUrgentInbox} from '@/lib/doctor-inbox/urgent-inbox-server';
import {urgentCount,type UrgentWindow} from '@/lib/doctor-inbox/urgent-windows';
import {UrgentWindowRow} from '@/components/doctor-inbox/urgent-window';
import {readNurseAlerts} from '@/lib/care-alerts/nurse';
import {NurseUrgentAlerts} from '@/components/staff/nurse-urgent-alerts';
import {log} from '@/lib/observability/logger';
export const dynamic='force-dynamic';

import type {Locale} from '@/lib/locale';
type L=Locale;
const notices:Record<string,[string,string,string]>={
 acknowledged:['Alert acknowledged. It stays in the list until you resolve it.','Ահազանգը հաստատված է։ Այն կմնա ցանկում, մինչև լուծեք։','Оповещение подтверждено. Оно останется в списке, пока вы его не закроете.'],
 resolved:['Alert resolved.','Ահազանգը լուծված է։','Оповещение закрыто.'],
 changed:['This alert changed while you were looking at it, for example the member wrote again. Check it and try again.','Ահազանգը փոխվել է, օրինակ՝ անդամը կրկին գրել է։ Ստուգեք և փորձեք նորից։','Это оповещение изменилось, пока вы его просматривали, например участник написал снова. Проверьте его и повторите попытку.'],
 invalid:['Choose an outcome and write the reason. An alert is closed with both.','Ընտրեք արդյունքը և գրեք պատճառը։ Ահազանգը փակվում է երկուսով։','Выберите исход и напишите причину. Оповещение закрывается с обоими.'],
 access:['Your assignment determines which alerts you can act on.','Ձեր նշանակումը որոշում է՝ որ ահազանգերով կարող եք զբաղվել։','Ваше назначение определяет, какие оповещения вы можете обрабатывать.'],
 unavailable:['That did not go through. Reload and try again.','Չստացվեց։ Թարմացրեք էջը և փորձեք նորից։','Не удалось выполнить действие. Обновите страницу и повторите попытку.'],
};

function AlertCard({a,l,closer,openChat=false}:{a:CareAlert;l:L;closer:string;openChat?:boolean}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 return <li className="space-y-3 py-4 first:pt-0 last:pb-0">
  <div className="flex flex-wrap items-center gap-2">
   <Status tone={a.state==='open'?'attention':a.state==='acknowledged'?'due':'complete'}>{a.state==='open'?(a.acknowledgedAt?t('Open again','Կրկին բաց','Открыт повторно'):t('Open','Բաց','Открыт')):a.state==='acknowledged'?t('Acknowledged','Հաստատված','Подтвержден'):t('Resolved','Լուծված','Закрыт')}</Status>
   {a.escalatedAt&&a.state!=='resolved'&&<Status tone="attention">{a.escalatedTo==='nurse'?t('Escalated to the nurse','Փոխանցվել է բուժքրոջը','Передано медсестре'):t('Escalated to the doctor','Փոխանցվել է բժշկին','Передано врачу')} · {stamp(a.escalatedAt,l)}</Status>}
   {a.occurrences>1&&<span className="text-caption text-muted-foreground">{t(`${a.occurrences} times`,`${a.occurrences} անգամ`,`Число случаев: ${a.occurrences}`)}</span>}
  </div>
  <p className="text-body2"><Link href={`/staff/real/members/${a.memberId}` as Route} className="font-medium underline underline-offset-4">{a.memberName||t('Member without a name','Անանուն անդամ','Участник без имени')}</Link></p>
  {openChat&&<Link href={`/staff/real/doctor-chat-v2/patient/${a.memberId}` as Route} className="inline-flex min-h-11 items-center text-body2 underline">{t("Open chat","Բացել զրույցը","Открыть чат")}</Link>}
  <AlertCardLines alert={a} locale={l}/>
  {a.lastReason&&a.lastReason!==a.reason&&<p className="text-body2 font-medium">{t('Latest','Վերջինը','Последнее')}: {alertCardFields({...a,reason:a.lastReason},l).symptom}</p>}
  <p className="text-caption text-muted-foreground">{t('Raised','Ստեղծվել է','Создан')} {stamp(a.createdAt,l)}{a.lastSeenAt!==a.createdAt?` · ${t('last','վերջին','последнее')} ${stamp(a.lastSeenAt,l)}`:''} · {a.doctorName?`${t('Doctor','Բժիշկ','Врач')}: ${a.doctorName}`:t('No assigned doctor','Նշանակված բժիշկ չկա','Врач не назначен')}</p>
  {a.acknowledgedAt&&<p className="text-caption text-muted-foreground">{a.state==='open'?t('Earlier acknowledged by','Նախկինում հաստատել է','Ранее подтвердил'):t('Acknowledged by','Հաստատել է','Подтвердил')} {a.acknowledgedBy??'-'} · {stamp(a.acknowledgedAt,l)}{a.state==='open'?t('. New signals arrived after that.','։ Դրանից հետո նոր ազդանշաններ են եկել։','. После этого поступили новые сигналы.'):''}</p>}
  {a.resolvedAt&&a.resolution&&<p className="text-caption text-muted-foreground">{resolutionLabel(a.resolution,l)} · {a.resolvedBy??'-'} · {stamp(a.resolvedAt,l)}{a.resolutionNote?`: ${a.resolutionNote}`:''}</p>}
  {a.telegram.length>0&&<p className="text-caption text-muted-foreground">Telegram: {a.telegram.map(n=>`${n.recipient||'-'} (${noticeLabel(n.state,l)})`).join(', ')}</p>}
  {a.state!=='resolved'&&<div className="flex flex-wrap items-start gap-3">
   {a.state==='open'&&<form action={acknowledgeCareAlert}><input type="hidden" name="alertId" value={a.id}/><input type="hidden" name="seq" value={a.stateSeq}/>
    <button className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring">{t('Acknowledge','Հաստատել','Подтвердить')}</button></form>}
   <CareAlertResolve alert={a} locale={l} closer={closer} action={resolveCareAlert}/>
  </div>}
 </li>;
}

/** Assigned nurses own the same urgent alert records they acknowledge and resolve. */
async function NurseAlertsView({client,l}:{client:{rpc:unknown};l:L}){
 const t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const read=await readNurseAlerts(client);
 return <div className="space-y-6">
  <header className="max-w-3xl space-y-2"><h1 className="text-h1">{t('Alerts','Ահազանգեր','Оповещения')}</h1>
   <p className="text-body2 text-muted-foreground">{t('Urgent signals for your members. An alert means something needs a person to look at it. It does not mean anyone has read it or that emergency services were called. You can acknowledge, record a next action and resolve alerts.','Ձեր անդամների շտապ ազդանշանները։ Ահազանգը նշանակում է, որ մեկը պետք է նայի։ Դա չի նշանակում, թե որևէ մեկը կարդացել է այն կամ շտապ օգնություն է կանչվել։ Կարող եք հաստատել ահազանգերը, գրանցել հաջորդ գործողությունը և լուծել դրանք։','Срочные сигналы по вашим участникам. Оповещение значит, что кто-то должен на него посмотреть. Это не значит, что его кто-то прочитал или что вызвана скорая помощь. Вы можете подтвердить оповещения, записать следующее действие и закрыть их.')}</p></header>
  <NurseUrgentAlerts read={read} locale={l}/>
  {read.kind==='ready'&&!read.alerts.length&&<CareSection title={t('No open alerts','Բաց ահազանգեր չկան','Нет открытых оповещений')}><p className="text-body2">{t('Nothing urgent for your members right now.','Այս պահին ձեր անդամների համար շտապ ոչինչ չկա։','Сейчас по вашим участникам нет срочных оповещений.')}</p></CareSection>}
  {read.kind==='ready'&&<p className="text-caption text-muted-foreground">{t('Open and acknowledged alerts only.','Միայն բաց և հաստատված ահազանգեր։','Только открытые и подтверждённые оповещения.')}</p>}
 </div>;
}

/** Care-team alerts for admins (all) and doctors (their members). Dark behind NOREON_CARE_ALERTS_ENABLED. */
export default async function CareAlertsPage({searchParams}:{searchParams:Promise<{view?:string;notice?:string}>}){
 if(!careAlertsEnabled())notFound();
 const {client,identity}=await requireRealStaff();
 if(identity.role==='nurse')return <NurseAlertsView client={client} l={await staffLocale(identity.role)}/>;
 if(identity.role!=='admin'&&identity.role!=='doctor')notFound();
 const l=await staffLocale(identity.role),t=(en:string,hy:string,ru:string)=>st(l,en,hy,ru);
 const {view:rawView,notice}=await searchParams,view=rawView==='resolved'?'resolved':'live';
 let inbox:ReturnType<typeof careAlertInboxSchema.parse>,windows:UrgentWindow[]=[],windowsTotal=0,windowsUnavailable=false,urgentCapped=false,liveUrgentTotal=0;
 let urgent:Awaited<ReturnType<typeof readDoctorUrgentInbox>>|undefined;
 if(identity.role==='doctor'&&view==='live'){
  urgent=await readDoctorUrgentInbox(client);
  inbox={ok:true,role:'doctor',asOf:urgent.asOf,alerts:urgent.alerts.map(item=>item.alert)};
 }else try{
  const {data,error}=await client.rpc('care_alert_inbox',{p_view:view,p_limit:identity.role==='doctor'?200:100});if(error)throw Error('unavailable');inbox=careAlertInboxSchema.parse(data);
  liveUrgentTotal=inbox.alerts.filter(a=>a.state!=='resolved').length;
 }
 catch(error){unstable_rethrow(error);log.warn('Staff urgent alerts could not be read');return <CareSection title={t('Alerts unavailable','Ահազանգերը հասանելի չեն','Оповещения недоступны')}><p className="text-body2">{t('Urgent alerts could not be read. Reload to try again.','Շտապ ահազանգերը չհաջողվեց կարդալ։ Թարմացրեք էջը։','Не удалось прочитать срочные оповещения. Обновите страницу, чтобы повторить попытку.')}</p></CareSection>;}
 if(identity.role==='doctor'){
  try{
   urgent??=await readDoctorUrgentInbox(client);
   windowsTotal=urgent.windowsTotal;
   urgentCapped=urgent.capped;
   windowsUnavailable=urgent.unavailable.length>0;
   liveUrgentTotal=urgentCount(urgent.alerts,urgent.windows);
   // Keep resolved history intact. Only the aggregated current alerts cover window rows.
   if(view==='live')inbox={...inbox,alerts:urgent.alerts.map(item=>item.alert)};
   const covered=new Set(urgent.alerts.map(item=>item.memberId));
   windows=urgent.windows.filter(w=>!covered.has(w.memberId));
  }catch(error){unstable_rethrow(error);windowsUnavailable=true;}
 }
 const msg=notice?notices[notice]:undefined;
 return <div className="space-y-6">
  <header className="max-w-3xl space-y-2"><h1 className="text-h1">{t('Alerts','Ահազանգեր','Оповещения')}{view==='live'&&<span data-urgent-count={liveUrgentTotal} className="ml-2 text-body2 font-normal text-muted-foreground">{liveUrgentTotal}</span>}</h1>
   <p className="text-body2 text-muted-foreground">{inbox.role==='admin'
    ?t('Urgent signals from questionnaires, member messages, lab results and Zoe. An alert means something needs a person to look at it. It does not mean anyone has read it or that emergency services were called.','Հարցաշարերից, անդամների հաղորդագրություններից, լաբորատոր արդյունքներից և Զոյայից ստացված շտապ ազդանշանները։ Ահազանգը նշանակում է, որ իրավիճակը պետք է ստուգի թիմի անդամը։ Այն չի նշանակում, որ որևէ մեկն այն արդեն կարդացել է կամ շտապ օգնություն է կանչվել։','Срочные сигналы из анкет, сообщений участников, результатов анализов и Зои. Оповещение означает, что ситуацию должен проверить человек. Оно не означает, что кто-либо уже прочитал его или вызвал скорую помощь.')
    :t('Urgent signals for your members. An alert means something needs you to look at it. It does not mean anyone has read it or that emergency services were called.','Ձեր անդամների շտապ ազդանշանները։ Ահազանգը նշանակում է, որ ինչ-որ բան պետք է նայեք։ Այն չի նշանակում, որ որևէ մեկն այն կարդացել է կամ շտապ օգնություն է կանչվել։','Срочные сигналы по вашим участникам. Оповещение означает, что вам нужно проверить ситуацию. Оно не означает, что кто-либо уже прочитал его или вызвал скорую помощь.')}</p></header>
  {msg&&<p role="status" className="rounded-md border bg-background p-3 text-body2">{t(msg[0],msg[1],msg[2])}</p>}
  {windowsUnavailable&&<p role="alert" className="rounded-md border bg-background p-3 text-body2">{t('Some urgent items are unavailable. This list is incomplete. Reload to try again.','Որոշ շտապ տարրեր չբեռնվեցին։ Այս ցանկն ամբողջական չէ։ Թարմացրեք էջը՝ կրկին փորձելու համար։','Некоторые срочные элементы недоступны. Список неполный. Обновите страницу, чтобы повторить попытку.')}</p>}
  <nav className="flex gap-2" aria-label={t('Alert lists','Ահազանգերի ցանկեր','Списки оповещений')}>
   {(['live','resolved']as const).map(v=><Link key={v} href={`/staff/real/alerts${v==='resolved'?'?view=resolved':''}` as Route} aria-current={view===v?'page':undefined}
    className={`inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium ${view===v?'bg-primary text-primary-foreground':'border'}`}>{v==='live'?t('Open and acknowledged','Բաց և հաստատված','Открытые и подтвержденные'):t('Resolved','Լուծված','Закрыт')}</Link>)}
  </nav>
  {urgentCapped&&<p className="rounded-md border bg-background p-3 text-body2">{t('Only the first urgent items are shown. Open My members for the rest.','Ցուցադրված են միայն առաջին շտապ տարրերը։ Մնացածը՝ «Իմ անդամները» բաժնում։','Показаны только первые срочные элементы. Остальные доступны в разделе «Мои участники».')} <Link href={'/staff/real/members' as Route} className="font-medium underline underline-offset-4">{t('Open My members','Բացել «Իմ անդամները»','Открыть «Мои участники»')}</Link></p>}
  {windows.length>0&&<CareSection title={t('Urgent conversations','Շտապ զրույցներ','Срочные разговоры')}><ul className="divide-y">{windows.map(window=><UrgentWindowRow key={window.memberId} window={window} locale={l}/>)}</ul></CareSection>}
  {!inbox.alerts.length?(view==='live'&&(windowsTotal>0||windowsUnavailable||urgentCapped)?null:<CareSection title={view==='live'?t('No open alerts','Բաց ահազանգեր չկան','Нет открытых оповещений'):t('No resolved alerts','Լուծված ահազանգեր չկան','Нет закрытых оповещений')}><p className="text-body2">{t('Nothing to show here right now.','Այստեղ առայժմ ոչինչ չկա։','Пока здесь ничего нет.')}</p></CareSection>)
   :<CareSection title={view==='live'?t('Open and acknowledged','Բաց և հաստատված','Открытые и подтвержденные'):t('Resolved','Լուծված','Закрыт')}><ul className="divide-y">{inbox.alerts.map(a=><AlertCard key={a.id} a={a} l={l} closer={identity.name} openChat={identity.role==='doctor'&&doctorChatV2Enabled()}/>)}</ul></CareSection>}
  <p className="text-caption text-muted-foreground">{t('As of','Առ','По состоянию на')} {stamp(inbox.asOf,l)}</p>
 </div>;
}
