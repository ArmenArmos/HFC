import {pick, type Locale} from "@/lib/locale";
import type {PilotBookingData} from './appointment-schema';
/** One line for My progress. Only confirmed visits are counted as confirmed (WP-5 item 12): a
 * cancelled visit is not a confirmed one. */
export function visitSummary(data:PilotBookingData|undefined,locale:Locale):string|null{
 if(!data?.appointments.length)return null;
 const t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
 const statuses=data.appointments.map(appointment=>appointment.status);
 if(statuses.some(status=>['failed','unknown','reconciliation'].includes(status)))return t('Scheduling needs attention. Check the saved visit status.','Այցի գրանցումը ուշադրության կարիք ունի։ Ստուգեք պահպանված վիճակը։','Запись на визит требует внимания. Проверьте сохранённый статус визита.');
 if(statuses.some(status=>status==='notification-pending'))return t('Scheduling is pending. Check the saved visit status.','Այցի կազմակերպումը ընթացքի մեջ է։ Ստուգեք պահպանված վիճակը։','Запись на визит ожидает подтверждения. Проверьте сохранённый статус визита.');
 const confirmed=statuses.filter(status=>status==='confirmed').length;
 if(!confirmed){
  const one=statuses.length===1;
  return t(one?'No confirmed visit. Your visit was cancelled.':'No confirmed visit. Your visits were cancelled.',one?'Հաստատված այց չկա։ Ձեր այցը չեղարկվել է։':'Հաստատված այց չկա։ Ձեր այցերը չեղարկվել են։',one?'Подтверждённых визитов нет. Ваш визит отменён.':'Подтверждённых визитов нет. Ваши визиты отменены.');
 }
 return t(`${confirmed} confirmed ${confirmed===1?'visit':'visits'}.`,`${confirmed} հաստատված այց։`,`Подтверждённые визиты: ${confirmed}.`);
}
