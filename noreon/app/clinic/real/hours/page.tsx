import {clinicLocale} from '@/lib/clinic-portal/locale';
import type {Locale} from '@/lib/locale';
import Link from'next/link';import{notFound,redirect}from'next/navigation';import{requireClinicPortal}from'@/lib/clinic-portal/identity';import{ClinicShell}from'@/components/clinic-portal/shell';import{ScheduleSettingsForm}from'@/components/clinic-portal/schedule-settings';
import{clinicSchedulingEnabled}from'@/lib/clinic-scheduling/schema';import{readScheduleSettings}from'@/lib/clinic-scheduling/runtime';import{clinicSaveSchedule}from'@/lib/clinic-scheduling/actions';
const tx=(locale:Locale,hy:string,en:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hy:en;
export default async function ClinicHoursPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!clinicSchedulingEnabled())notFound();
 const query=await searchParams,locale=await clinicLocale(query.locale);
 const context=await requireClinicPortal(typeof query.clinic==='string'?query.clinic:null,{page:true}),clinicId=context.identity.clinicId;
 if(context.identity.capability!=='clinic_admin')redirect(`/clinic/real/bookings?clinic=${clinicId}&locale=${locale}`);
 const settings=await readScheduleSettings(context.rpc,clinicId);
 return <ClinicShell identity={context.identity} locale={locale} current="hours">
  <div className="space-y-2"><h1 className="text-h1">{tx(locale,'Ժամեր և տարողություն','Hours and capacity','Часы работы и количество мест')}</h1><p className="text-body2 text-muted-foreground">{tx(locale,'Անդամներին առաջարկվում են միայն այս ժամերի ազատ տեղերը՝ առաջիկա 4 շաբաթվա համար։','Members are offered only free times within these hours, for the next 4 weeks.','Участникам предлагаются только свободные места в эти часы на ближайшие 4 недели.')}</p></div>
  {!settings?<div role="alert" className="space-y-3 rounded-lg border bg-background p-4"><p className="text-body2">{tx(locale,'Ժամերը չհաջողվեց բեռնել։','Hours could not load.','Не удалось загрузить часы работы.')}</p><Link className="inline-flex min-h-12 items-center rounded-md border px-4 text-body2" href={`/clinic/real/hours?clinic=${clinicId}&locale=${locale}`}>{tx(locale,'Փորձել կրկին','Try again','Попробовать снова')}</Link></div>
  :!settings.enabled?<p role="status" className="rounded-lg border bg-background p-5 text-body2">{tx(locale,'Կլինիկաների համար այցերի կառավարումը դեռ միացված չէ։','Scheduling is not switched on for clinics yet.','Управление записями для клиник пока не включено.')}</p>
  :<><p className="text-body2">{tx(locale,'Հասցե','Address','Адрес')}: {settings.clinic.address||(tx(locale,'նշված չէ։ Խնդրեք Noreon-ին ավելացնել այն։','not set. Ask Noreon to add it.','не указан. Попросите Noreon добавить его.'))}</p><ScheduleSettingsForm key={settings.schedule?.revision??0} settings={settings} locale={locale} save={clinicSaveSchedule.bind(null,clinicId,context.actorScope)}/></>}
 </ClinicShell>;
}
