import {z} from 'zod';
import {VISIT_REQUEST} from './lab-visit-copy';
import type {CardLocale} from './copy';

export const visitWindows=['morning','afternoon','evening'] as const;
export const visitRequestFields=z.strictObject({
 day:z.iso.date(),window:z.enum(visitWindows),
 note:z.string().max(200).trim().refine(s=>!/[<>\p{Cc}\p{Cf}]/u.test(s)).default(''),
});
export const requestVisitInput=visitRequestFields.extend({cardId:z.uuid(),opId:z.uuid()});
export const visitRequestPayload=visitRequestFields.extend({kind:z.literal('visit_request'),locale:z.enum(['en','hy','ru']).default('en')});
export type VisitRequestFields=z.infer<typeof visitRequestFields>;
export type RequestVisitInput=z.infer<typeof requestVisitInput>;

/** Only a missing booking channel/offer opens logistics. Holds and existing arrangements keep their own UI. */
export function visitRequestAvailable(read:{hold:string|null;booking:{
 pilot:{available:boolean;unavailableReason:string|null;offers:readonly unknown[];appointments:readonly unknown[]};
 data:{available:boolean;requirements:readonly unknown[];clinicalHold?:boolean;requests:readonly {status:string}[]};
}|null}):boolean{
 const b=read.booking;
 return read.hold===null&&!!b&&b.data.available&&b.data.requirements.length>0&&!b.data.clinicalHold&&!b.pilot.available&&b.pilot.offers.length===0&&b.pilot.appointments.length===0
  &&['configuration-unavailable','source-unavailable'].includes(b.pilot.unavailableReason??'')
  &&b.data.requests.every(r=>r.status==='cancelled'||r.status==='completed');
}

/** Next fourteen calendar days in Yerevan, excluding today. Hours use ISO weekdays; no rows means weekdays. */
export function preferredVisitDays(hours:readonly {weekday:number}[],now=new Date()):string[]{
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).map(p=>[p.type,p.value]));
 const day=new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00Z`);
 const weekdays=new Set(hours.length?hours.map(h=>h.weekday):[1,2,3,4,5]);
 const days:string[]=[];
 for(let i=0;i<14;i++){
  day.setUTCDate(day.getUTCDate()+1);
  if(weekdays.has(day.getUTCDay()||7))days.push(day.toISOString().slice(0,10));
 }
 return days;
}
export function visitDayLabel(day:string,locale:string):string{
 return new Intl.DateTimeFormat(locale,{timeZone:'Asia/Yerevan',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(new Date(`${day}T12:00:00Z`));
}
/** The browser supplies fields only. The server constructs the message for the ordinary care-team conversation. */
export function visitRequestMessage(v:VisitRequestFields,locale:CardLocale='en'):string{
 const window=VISIT_REQUEST[v.window][locale].toLocaleLowerCase(locale);
 return `${VISIT_REQUEST.message[locale]}: ${visitDayLabel(v.day,locale==='en'?'en-GB':locale)}, ${window}.${v.note?` ${v.note}`:''}`;
}
