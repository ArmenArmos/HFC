import Link from 'next/link';
import type {Route} from 'next';
import type {Locale} from '@/lib/locale';
import {Status} from '@/components/patient-care/common';
import {st} from '@/lib/staff/staff-locale-copy';
import {urgentWindowLine,type UrgentWindow} from '@/lib/doctor-inbox/urgent-windows';

/** Open windows are conversation work, with no care-alert acknowledge or resolve command. */
export function UrgentWindowRow({window,locale}:{window:UrgentWindow;locale:Locale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <li data-urgent-window={window.memberId} className="space-y-2 py-4 first:pt-0 last:pb-0">
  <div className="flex flex-wrap items-center gap-2"><Status tone="attention">{t('Urgent','Շտապ','Срочно')}</Status>
   <Link href={`/staff/real/members/${window.memberId}` as Route} className="text-body2 font-medium underline underline-offset-4">{window.memberName||t('Member without a name','Անանուն անդամ','Участник без имени')}</Link></div>
  <p className="text-body2">{urgentWindowLine(window.since,locale)}</p>
  <Link href={`/staff/real/members/${window.memberId}` as Route} className="inline-flex min-h-11 items-center rounded-md border px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring">{t('Open member','Բացել անդամի էջը','Открыть участника')}</Link>
 </li>;
}
