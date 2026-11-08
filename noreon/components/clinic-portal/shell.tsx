import {Suspense} from 'react';
import {ClinicApprovalNavigation} from './approval-navigation';
import {ClinicChatViewport} from './chat-viewport';
import {ClinicMenu} from './menu';
import Link from 'next/link';
import{clinicChatEnabled}from'@/lib/clinic-chat/config';
import{pick,type Locale}from'@/lib/locale';
import{clinicSignOut}from'@/lib/clinic-portal/actions';import type{ClinicIdentity}from'@/lib/clinic-portal/schema';import{clinicSchedulingEnabled}from'@/lib/clinic-scheduling/schema';
import{AppShell,ShellSignOut}from'@/components/app-shell/app-shell';import{ClinicLocaleSwitch,ClinicNavigation,type ClinicSection}from'./navigation';
/** The staff backoffice shell with clinic sections. Scheduling links appear only while clinic scheduling is
 * switched on; member records, hours and team are for clinic admins (records also need the database switch). Without scheduling there is one section, so no menu. */
export function ClinicShell({identity,locale,children,current}:{identity:ClinicIdentity;locale:Locale;children:React.ReactNode;current?:ClinicSection}){
 const admin=identity.capability==='clinic_admin',scheduling=clinicSchedulingEnabled();
 // With full access on, results are uploaded from the member record only; batch pages stay reachable by URL.
 const full=admin&&identity.fullAccess===true;
 const items:ClinicSection[]=scheduling?[...(clinicChatEnabled()?['chat']as ClinicSection[]:[]),'bookings',...(full?['records','approvals','audit']as ClinicSection[]:['members']as ClinicSection[]),...(full?[]:['batches']as ClinicSection[]),...(admin?['hours','team']as ClinicSection[]:[])]:full?['audit']:[];
 const role=admin?(pick(locale,{en:'Clinic admin',hy:'Կլինիկայի ադմինիստրատոր',ru:'Администратор клиники'})):(pick(locale,{en:'Clinic staff',hy:'Կլինիկայի աշխատակից',ru:'Сотрудник клиники'}));
 if(current==='chat')return <ClinicChatViewport locale={locale}>
  <a href="#clinic-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:p-4">{pick(locale,{en:'Skip to content',hy:'Անցնել բովանդակությանը',ru:'Перейти к содержимому'})}</a>
  <header className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-2 sm:px-6">
   <Link href={`/clinic/real/chat?clinic=${identity.clinicId}&locale=${locale}`} className="text-h3 font-semibold">Noreon</Link>
   <p className="min-w-0 truncate text-body2">{identity.clinicName}</p>
   <ClinicMenu locale={locale}>
     <div className="text-caption text-muted-foreground">{identity.displayName} · {role}</div>
     <div id="clinic-chat-menu"/>
     <ClinicLocaleSwitch clinicId={identity.clinicId} locale={locale}/>
     <ShellSignOut action={clinicSignOut} label={pick(locale,{en:'Sign out',hy:'Դուրս գալ',ru:'Выйти'})}/>
   </ClinicMenu>
  </header>
  <noscript><div className="border-b px-4 py-2"><ClinicLocaleSwitch clinicId={identity.clinicId} locale={locale}/></div></noscript>
  <main id="clinic-content" className="min-h-0 flex-1 px-4 pt-5 pb-3 sm:px-6">{children}</main>
 </ClinicChatViewport>;
 return <AppShell
  lang={locale}
  contentId="clinic-content"
  skipLabel={pick(locale,{en:'Skip to content',hy:'Անցնել բովանդակությանը',ru:'Перейти к содержимому'})}
  menuLabel={pick(locale,{en:'Menu',hy:'Ընտրացանկ',ru:'Меню'})}
  brandHref={`/clinic/real/${clinicChatEnabled()?'chat':scheduling?'bookings':'batches'}?clinic=${identity.clinicId}&locale=${locale}`}
  badge={pick(locale,{en:'Clinic',hy:'Կլինիկա',ru:'Клиника'})}
  sidebarHeader={<div className="space-y-1"><p className="break-words text-body2 font-medium text-foreground">{identity.clinicName}</p><p className="break-words">{identity.displayName}</p><p>{role}</p></div>}
  nav={items.length?<Suspense fallback={<ClinicNavigation items={items} clinicId={identity.clinicId} locale={locale} current={current}/>}>{full?<ClinicApprovalNavigation items={items} clinicId={identity.clinicId} locale={locale} current={current}/>:<ClinicNavigation items={items} clinicId={identity.clinicId} locale={locale} current={current}/>}</Suspense>:null}
  title={identity.clinicName}
  actions={<><ClinicLocaleSwitch clinicId={identity.clinicId} locale={locale}/><span className="text-caption text-muted-foreground lg:hidden">{identity.displayName} · {role}</span><ShellSignOut action={clinicSignOut} label={pick(locale,{en:'Sign out',hy:'Դուրս գալ',ru:'Выйти'})}/></>}
 >{children}</AppShell>;
}
