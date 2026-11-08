import {clinicLocale} from '@/lib/clinic-portal/locale';
import type {Locale} from '@/lib/locale';
import Link from'next/link';import{notFound,redirect}from'next/navigation';import{requireClinicPortal}from'@/lib/clinic-portal/identity';import{ClinicShell}from'@/components/clinic-portal/shell';import{ClinicTeamList}from'@/components/clinic-portal/team';
import{clinicSchedulingEnabled}from'@/lib/clinic-scheduling/schema';import{readClinicTeam}from'@/lib/clinic-scheduling/runtime';import{clinicTeamCommand}from'@/lib/clinic-scheduling/actions';
const tx=(locale:Locale,hy:string,en:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hy:en;
export default async function ClinicTeamPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!clinicSchedulingEnabled())notFound();
 const query=await searchParams,locale=await clinicLocale(query.locale);
 const context=await requireClinicPortal(typeof query.clinic==='string'?query.clinic:null,{page:true}),clinicId=context.identity.clinicId;
 if(context.identity.capability!=='clinic_admin')redirect(`/clinic/real/bookings?clinic=${clinicId}&locale=${locale}`);
 const team=await readClinicTeam(context.rpc,clinicId);
 return <ClinicShell identity={context.identity} locale={locale} current="team">
  <div className="space-y-2"><h1 className="text-h1">{tx(locale,'Թիմ','Team','Команда')}</h1><p className="text-body2 text-muted-foreground">{tx(locale,'Սահմանեք յուրաքանչյուրի դերը։ Նոր մարդկանց հրավիրում է Նորեոն Հելթը։','Set each person’s role. Noreon invites new people.','Укажите роль каждого сотрудника. Новых сотрудников приглашает Нореон Хелс.')}</p></div>
  {team?<ClinicTeamList team={team} locale={locale} run={clinicTeamCommand.bind(null,clinicId,context.actorScope)}/>
  :<div role="alert" className="space-y-3 rounded-lg border bg-background p-4"><p className="text-body2">{tx(locale,'Թիմը չհաջողվեց բեռնել։','The team could not load.','Не удалось загрузить команду.')}</p><Link className="inline-flex min-h-12 items-center rounded-md border px-4 text-body2" href={`/clinic/real/team?clinic=${clinicId}&locale=${locale}`}>{tx(locale,'Փորձել կրկին','Try again','Попробовать снова')}</Link></div>}
 </ClinicShell>;
}
