import type {PilotBookingData} from '@/lib/real-booking/appointment-schema';

/** One read-only line for the admin Requests row: the member's current visit. */
export type MemberBookingSummary={state:'waiting-clinic'|'confirmed'|'attention';mode:'home'|'clinic';startsAt:string;clinicName:string|null};

const order={'attention':0,'waiting-clinic':1,'confirmed':2} as const;
/** Picks the live appointment that most needs an admin's eye, then the earliest. */
export function summarizeMemberBooking(data:Pick<PilotBookingData,'appointments'|'clinics'>):MemberBookingSummary|null{
 const live=data.appointments.filter(a=>a.status!=='cancelled').map(a=>{
  const arrangement=a.status==='confirmed'?(a.current??a.proposed):a.proposed;
  const state:MemberBookingSummary['state']=a.status==='confirmed'?'confirmed':a.status==='notification-pending'?'waiting-clinic':'attention';
  return {state,mode:arrangement.mode,startsAt:arrangement.startsAt,clinicName:data.clinics?.[arrangement.clinicId]??null};
 });
 live.sort((x,y)=>order[x.state]-order[y.state]||Date.parse(x.startsAt)-Date.parse(y.startsAt));
 return live[0]??null;
}
