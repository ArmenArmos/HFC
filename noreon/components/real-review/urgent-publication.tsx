import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';
export function UrgentPublicationBlock({memberId,locale}:{memberId:string;locale:StaffLocale}){
 return <div role="alert" className="space-y-2">
  <p>{st(locale,"Can't publish while urgent alerts are open. Resolve them first.",'Բաց շտապ ահազանգերի դեպքում հրապարակել հնարավոր չէ։ Նախ լուծեք դրանք։','Публикация недоступна, пока открыты срочные оповещения. Сначала закройте их.')}</p>
  <a href={`/staff/real/members/${memberId}#member-alerts`} className="inline-flex min-h-11 items-center underline">{st(locale,'Open member alerts','Բացել անդամի ահազանգերը','Открыть оповещения участника')}</a>
 </div>;
}
