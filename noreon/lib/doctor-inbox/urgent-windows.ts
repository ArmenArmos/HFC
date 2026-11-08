import {z} from 'zod';
import {pick,type Locale} from '@/lib/locale';
import {orderAlerts,type AlertItem} from './contracts';

export const urgentWindowSchema=z.object({memberId:z.uuid(),memberName:z.string(),since:z.iso.datetime({offset:true}),openedBy:z.enum(['rule','model'])});
export const urgentWindowsSchema=z.object({ok:z.literal(true),windows:z.array(urgentWindowSchema).max(200),total:z.number().int().nonnegative()});
export type UrgentWindow=z.infer<typeof urgentWindowSchema>;
export type UrgentWindowItem=UrgentWindow&{kind:'urgent_window'};

/** SQL decides which windows are open. Acknowledged alerts still need you until resolved. */
export function mergeUrgent(alerts:readonly AlertItem[],windows:readonly UrgentWindow[]):(AlertItem|UrgentWindowItem)[]{
 const live=orderAlerts(alerts.filter(item=>item.alert.state!=='resolved'));
 const members=new Set(live.map(item=>item.memberId));
 const extra=[...windows].sort((a,b)=>Date.parse(b.since)-Date.parse(a.since)||a.memberId.localeCompare(b.memberId))
  .filter(window=>{if(members.has(window.memberId))return false;members.add(window.memberId);return true;})
  .map(window=>({...window,kind:'urgent_window' as const}));
 return [...live,...extra];
}
export const urgentCount=(alerts:readonly AlertItem[],windows:readonly UrgentWindow[])=>mergeUrgent(alerts,windows).length;

/** The same line on lists and the member card, in the clinic's 24-hour clock. */
export function urgentWindowLine(since:string,locale:Locale):string{
 const time=new Intl.DateTimeFormat(locale,{timeZone:'Asia/Yerevan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(since));
 return pick(locale,{
  en:`The 103 text was sent to the member; no one has answered since ${time}`,
  hy:`Անդամին ուղարկվել է 103 զանգահարելու տեքստը։ ${time}-ից ի վեր ոչ ոք չի պատասխանել`,
  ru:`Участнику отправлен текст с рекомендацией позвонить 103; с ${time} никто не ответил`,
 });
}
