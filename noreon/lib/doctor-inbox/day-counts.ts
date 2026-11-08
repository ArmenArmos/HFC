import {laneGroups} from './contracts';
import type {DoctorDay} from './day';
import {urgentCount} from './urgent-windows';

export function doctorDayCounts(day:DoctorDay){
 const {inbox,medicines,ldl,firstNotes,tasks}=day,groups=laneGroups(inbox);
 const counts={alerts:urgentCount(inbox.p0,day.windows),today:groups.P1.length,week:groups.P2.length,routine:groups.P3.length,
  medicines:medicines?.length??0,ldl:ldl?.length??0,firstNotes:firstNotes?.enabled?firstNotes.items.length:0,tasks:tasks?.items.length??0};
 const handoffs=day.handoffs?.items.filter(item=>!['completed','cancelled'].includes(item.task.status)).length??0;
 return {...counts,...(day.handoffs!==undefined?{handoffs}:{}),total:counts.alerts+inbox.items.length+counts.medicines+counts.ldl+counts.firstNotes+counts.tasks+handoffs};
}
