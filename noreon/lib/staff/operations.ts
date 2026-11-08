import type {ReviewTask} from '@/lib/service-workflow/review-task';
import type { DemoState } from '@/lib/patient/demo-model';
import type { ServiceWorkflow } from '@/lib/service-workflow/types';
import { queueItem } from '@/lib/staff/queue';
import { serviceProgress } from '@/lib/service-workflow/progress';
export function operationsItem(id:string,data:DemoState,w:ServiceWorkflow|null,assignedDoctorId:string|null,doctor:string,available:boolean,now=new Date(),reviewTask:ReviewTask|null=null) {
 const q=queueItem(id,data,w,now,reviewTask), p=w?serviceProgress(w,now):null;
 const flags:string[]=[];
 if(q.status==='urgent')flags.push('Urgent');
 if(!assignedDoctorId||!available)flags.push('Needs assignment');
 if(p?.outstanding.length)flags.push('Missing results');
 if(w?.appointment?.status==='needs-reschedule')flags.push('Needs rescheduling');
 if(q.overdue)flags.push('Overdue review');
 if(q.status==='review')flags.push('Needs review');
 if(w?.publication)flags.push('Published');
 return {id,name:q.name,next:!available||!assignedDoctorId?'Assign an available GP at an active clinic. '+q.next:q.next,doctor,assignedDoctorId,flags,priority:q.status==='urgent'?0:!available||!assignedDoctorId?1:q.overdue?2:w?.appointment?.status==='needs-reschedule'?3:q.priority+4};
}
