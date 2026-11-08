import {createHash} from 'node:crypto';
export type ScheduledLab={appointmentId:string;revision:number;startsAt:string;quietStart:string;quietEnd:string};
const clock=(v:string)=>/^([01]\d|2[0-3]):[0-5]\d$/.test(v)?Number(v.slice(0,2))*60+Number(v.slice(3)):null;
const day=(v:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Yerevan',year:'numeric',month:'2-digit',day:'2-digit'}).format(v);
const minute=(v:Date)=>{const p=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Yerevan',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(v);return clock(p)!;};
const quiet=(at:number,start:number,end:number)=>start===end||(start<end?at>=start&&at<end:at>=start||at<end);
/** Evening at 20:00; morning at the member's saved wake time. Missed ticks catch up only while awake and before the lab. */
export function labCardDue(a:ScheduledLab,kind:'prep'|'fasting',now:Date):boolean{
 const start=clock(a.quietStart),end=clock(a.quietEnd),visit=new Date(a.startsAt);
 if(start===null||end===null||start===end||!Number.isFinite(visit.getTime())||now>=visit||quiet(minute(now),start,end))return false;
 const labDay=day(visit),previous=new Date(`${labDay}T12:00:00+04:00`);previous.setUTCDate(previous.getUTCDate()-1);
 const due=kind==='prep'?Date.parse(`${day(previous)}T20:00:00+04:00`):Date.parse(`${labDay}T${a.quietEnd}:00+04:00`);
 return now.getTime()>=due;
}
/** zoe_chat_cards(member_id,request_id) is the durable idempotency constraint, including across cron workers. */
export function labCardRequestId(a:Pick<ScheduledLab,'appointmentId'|'revision'>,kind:'prep'|'fasting'):string{
 return createHash('sha256').update(`zoe-v3-lab:${a.appointmentId}:${a.revision}:${kind}`).digest('hex').replace(/^(.{8})(.{4}).(.{3}).(.{3})(.{12}).*$/,'$1-$2-5$3-8$4-$5');
}
