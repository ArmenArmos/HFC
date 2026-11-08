'use client';
import{useState}from'react';
import{useRouter}from'next/navigation';
import type{ClinicTeam,TeamCommand,TeamResult}from'@/lib/clinic-scheduling/schema';
import {SelectField} from '@/components/ui/select-field';
import{pick,type Locale}from'@/lib/locale';
const tr=(locale:Locale,en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
const control='min-h-12 rounded-md border bg-background px-3 text-body2 disabled:opacity-60';
export function ClinicTeamList({team,locale,run}:{team:ClinicTeam;locale:Locale;run:(input:TeamCommand)=>Promise<TeamResult>}){
 return team.members.length?<><dl className="grid gap-1 text-body2 sm:grid-cols-[auto_1fr] sm:gap-x-3"><dt className="font-medium">{tr(locale,'Admin','Ադմինիստրատոր','Администратор')}</dt><dd className="text-muted-foreground">{tr(locale,'Bookings, check-in, uploads, hours and team.','Այցեր, ներկայություն, ֆայլեր, ժամեր և թիմ։','Записи, отметки о прибытии, загрузки, часы работы и команда.')}</dd><dt className="font-medium">{tr(locale,'Staff','Աշխատակից','Сотрудник')}</dt><dd className="text-muted-foreground">{tr(locale,'Bookings, check-in and uploads.','Այցեր, ներկայություն և ֆայլեր։','Записи, отметки о прибытии и загрузки.')}</dd></dl><ul className="divide-y rounded-lg border bg-background">{team.members.map(member=><TeamRow key={`${member.membershipId}:${member.revision}`} member={member} locale={locale} run={run}/>)}</ul></>:<p className="text-body2">{tr(locale,'No one yet.','Դեռ ոչ ոք։','Пока никого нет.')}</p>;
}
function TeamRow({member,locale,run}:{member:ClinicTeam['members'][number];locale:Locale;run:(input:TeamCommand)=>Promise<TeamResult>}){
 const router=useRouter();
 const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 async function change(role:'admin'|'staff',active:boolean){
  setBusy(true);setError(null);
  let result:TeamResult;try{result=await run({membershipId:member.membershipId,expectedRevision:member.revision,role,active});}catch{result={status:'unknown'};}
  setBusy(false);
  if(result.status==='saved'){router.refresh();return;}
  const texts:Record<Exclude<TeamResult['status'],'saved'>,[string,string,string]>={invalid:['That change is not possible.','Այդ փոփոխությունը հնարավոր չէ։','Это изменение невозможно.'],self:['You cannot change your own access.','Դուք չեք կարող փոխել ձեր սեփական մուտքը։','Вы не можете изменить свой доступ.'],
   stale:['This person changed. Reload the page.','Տվյալները փոխվել են։ Վերբեռնեք էջը։','Данные этого сотрудника изменились. Обновите страницу.'],'last-admin':['Your clinic needs at least one active admin.','Կլինիկան պետք է ունենա առնվազն մեկ ակտիվ ադմինիստրատոր։','В вашей клинике должен быть хотя бы один активный администратор.'],
   'noreon-only':['Ask Noreon to restore this person’s access.','Խնդրեք Noreon-ին վերականգնել այս անձի մուտքը։','Попросите Noreon восстановить доступ этого сотрудника.'],unavailable:['Couldn’t save right now. Try again.','Այժմ չհաջողվեց պահպանել։ Նորից փորձեք։','Сейчас не удалось сохранить. Попробуйте снова.'],access:['Only a clinic admin can change the team.','Թիմը կարող է փոխել միայն կլինիկայի ադմինիստրատորը։','Только администратор клиники может менять состав команды.'],
   unknown:['We couldn’t confirm the result. Reload to check.','Չհաջողվեց հաստատել արդյունքը։ Վերբեռնեք՝ ստուգելու համար։','Не удалось подтвердить результат. Обновите страницу, чтобы проверить.']};
  setError(tr(locale,...texts[result.status]));
 }
 const roleId=`role-${member.membershipId}`;
 return <li className="space-y-3 p-4">
  <div className="flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><p className="break-words text-body2 font-medium">{member.displayName}{member.self&&<span className="text-muted-foreground"> · {tr(locale,'you','դուք','вы')}</span>}</p><p className="text-caption text-muted-foreground">{member.active?tr(locale,'Has access','Մուտք ունի','Есть доступ'):tr(locale,'Access switched off','Մուտքն անջատված է','Доступ отключён')}</p></div>
   {member.self?<p className="text-body2">{member.role==='admin'?tr(locale,'Admin','Ադմինիստրատոր','Администратор'):tr(locale,'Staff','Աշխատակից','Сотрудник')}</p>
   :<div className="flex w-full flex-wrap items-end gap-2 sm:w-auto"><label htmlFor={roleId} className="sr-only">{tr(locale,'Role','Դեր','Роль')}</label><SelectField id={roleId} className="w-auto min-w-44" size="sm" value={member.role} disabled={busy} onValueChange={value=>void change(value as 'admin'|'staff',member.active)} options={[{value:'admin',label:tr(locale,'Admin','Ադմինիստրատոր','Администратор')},{value:'staff',label:tr(locale,'Staff','Աշխատակից','Сотрудник')}]}/>
    {member.active?<button type="button" disabled={busy} onClick={()=>void change(member.role,false)} className={control}>{tr(locale,'Switch off access','Անջատել մուտքը','Отключить доступ')}</button>:<p className="text-caption text-muted-foreground">{tr(locale,'Ask Noreon to restore access.','Մուտքը վերականգնելու համար դիմեք Noreon-ին։','Чтобы восстановить доступ, обратитесь в Noreon.')}</p>}</div>}
  </div>
  {error&&<p role="alert" className="text-body2">{error}</p>}
 </li>;
}
