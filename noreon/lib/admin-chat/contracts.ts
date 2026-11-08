import type {RealOperationsSummary} from '@/lib/staff/real-operations-summary-model';

export const ADMIN_INTENTS=['operations','unassigned','registrations','callbacks','bookings','delivery','overdue','doctor-waiting','nurse-waiting','test-requests','tasks','ldl-overdue'] as const;
export type AdminIntent=typeof ADMIN_INTENTS[number];
export function adminIntent(value:unknown):AdminIntent|null{
 return typeof value==='string'&&ADMIN_INTENTS.includes(value as AdminIntent)?value as AdminIntent:null;
}
export type WorkKind='assignment'|'registration'|'callback'|'booking'|'delivery'|'task'|'test-request'|'ldl-retest';
export type WorkItem={
 id:string;kind:WorkKind;memberName:string|null;owner:'admin'|'doctor'|'nurse'|'member'|'clinic';ownerName:string|null;
 since:string|null;dueAt:string|null;href:string;
 bookingState?:'clinic-response'|'start-scheduling'|'check-scheduling'|'member-proposal';
 requestCount?:number;
};
export type OperationsView={
 intent:AdminIntent;asOf:string;summary:RealOperationsSummary|null;items:WorkItem[];
 unavailable:AdminIntent[];partial:AdminIntent[];disabled:AdminIntent[];
 notices:('held-wording'|'incoming-failed'|'incoming-pending')[];
};
export type AdminChatResult={kind:'ready';view:OperationsView}|{kind:'off'|'denied'|'invalid'|'unavailable'};
/** Unknown/invalid/future dates never become a zero-day wait. */
export function waitingAge(since:string|null,asOf:string):number|null{
 if(!since)return null;
 const elapsed=Date.parse(asOf)-Date.parse(since);
 return Number.isFinite(elapsed)&&elapsed>=0?Math.floor(elapsed/86_400_000):null;
}
/** Identity belongs to the persisted work, never to the member or its age bucket. */
export function uniqueWork(items:WorkItem[]):WorkItem[]{
 return [...new Map(items.map(item=>[item.id,item])).values()].sort((a,b)=>{
  const at=a.since?Date.parse(a.since):NaN,bt=b.since?Date.parse(b.since):NaN;
  return (Number.isFinite(at)?at:Infinity)-(Number.isFinite(bt)?bt:Infinity)||a.id.localeCompare(b.id);
 });
}
