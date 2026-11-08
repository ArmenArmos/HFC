import Link from 'next/link';
import type {Route} from 'next';
import type {Locale} from '@/lib/locale';
import {AlertCardLines} from '@/components/staff/alert-card';
import {urgentWindowLine} from '@/lib/doctor-inbox/urgent-windows';
import type {MemberUrgent} from '@/lib/doctor-inbox/member-urgent';
import {st} from '@/lib/staff/staff-locale-copy';

/** The top of the member page: whatever is still urgent for this member, in the same words as Today and Alerts. */
export function MemberUrgentSection({urgent,locale}:{urgent:MemberUrgent;locale:Locale}){
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if(!urgent.alerts.length&&!urgent.window&&!urgent.incomplete)return null;
 return <section id="member-alerts" data-member-urgent="" aria-label={t('Urgent for this member','Շտապ այս անդամի համար','Срочно по этому участнику')} className="space-y-3 rounded-xl border border-destructive p-4">
  <h2 className="text-h3">{t('Urgent for this member','Շտապ այս անդամի համար','Срочно по этому участнику')}</h2>
  {urgent.window&&<p data-urgent-window={urgent.window.memberId} className="text-body2">{urgentWindowLine(urgent.window.since,locale)}</p>}
  {urgent.alerts.length>0&&<ul className="divide-y">{urgent.alerts.map(alert=><li key={alert.id} data-alert-id={alert.id} className="py-3 first:pt-0 last:pb-0"><AlertCardLines alert={alert} locale={locale}/></li>)}</ul>}
  {urgent.incomplete&&<p role="status" className="text-body2">{t('Some urgent items could not be read. Open Alerts to check.','Որոշ շտապ գործեր չհաջողվեց կարդալ։ Բացեք «Ահազանգեր» բաժինը՝ ստուգելու համար։','Не удалось прочитать часть срочных задач. Откройте раздел «Оповещения», чтобы проверить.')}</p>}
  {(urgent.alerts.length>0||urgent.window)&&<Link href={'/staff/real/alerts' as Route} className="inline-flex min-h-11 items-center text-body2 font-medium underline underline-offset-4">{t('Open Alerts to acknowledge or resolve','Բացել «Ահազանգեր»՝ հաստատելու կամ լուծելու համար','Открыть «Оповещения», чтобы подтвердить или закрыть')}</Link>}
 </section>;
}
