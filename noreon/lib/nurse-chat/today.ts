import type {CoordinationTask} from '@/lib/staff/real-coordination/schema';
import type {NurseAlert} from '@/lib/care-alerts/nurse';
import type {NurseVisitList} from '@/lib/nurse-visit/schema';

type Visit=Extract<NurseVisitList,{enabled:true}>['visits'][number];
const day=(at:Date)=>new Date(at.getTime()+4*3600_000).toISOString().slice(0,10);
export function dueState(at:string|null,completed:boolean,now:Date){
 if(completed)return 'completed' as const;
 if(!at)return 'open' as const;
 if(Date.parse(at)<now.getTime())return 'overdue' as const;
 return day(new Date(at))===day(now)?'due' as const:'open' as const;
}
/** A visit is overdue only when it is past its start and nothing has happened: the clinic recorded the visit as attended, or she started it.
 * An arrived visit is in progress, never "Overdue". */
export function visitState(visit:Pick<Visit,'startsAt'|'completion'|'bookingStatus'>&{steps?:readonly {step:string}[]},now:Date){
 if(visit.completion)return 'completed' as const;
 const begun=visit.bookingStatus==='attended'||(visit.steps??[]).some(step=>step.step==='started');
 return begun?(day(new Date(visit.startsAt))===day(now)?'due' as const:'open' as const):dueState(visit.startsAt,false,now);
}
export function todayItems(tasks:CoordinationTask[],visits:Visit[],now:Date,alerts:NurseAlert[]=[]){
 const rows=[
  ...alerts.map(alert=>({kind:'alert' as const,id:`alert:${alert.id}`,at:alert.createdAt,state:alert.state,alert})),
  ...tasks.map(task=>({kind:'task' as const,id:`task:${task.id}`,at:task.dueAt,state:task.status==='cancelled'?'cancelled' as const:dueState(task.dueAt,task.status==='completed',now),task})),
  ...visits.map(visit=>({kind:'visit' as const,id:`visit:${visit.source}:${visit.id}`,at:visit.startsAt,state:visitState(visit,now),visit})),
 ];
 const terminal=(state:string)=>state==='completed'||state==='cancelled'||state==='resolved';
 // Urgent alerts lead the list. Doctor handovers lead the remaining open work.
 const handedOver=(row:{kind:'task';task:CoordinationTask}|{kind:'visit'|'alert'})=>row.kind==='task'&&Boolean(row.task.sourceConversationId);
 return rows.sort((a,b)=>Number(terminal(a.state))-Number(terminal(b.state))||Number(b.kind==='alert')-Number(a.kind==='alert')||(a.kind==='alert'&&b.kind==='alert'?Number(a.state!=='open')-Number(b.state!=='open')||alerts.indexOf(a.alert)-alerts.indexOf(b.alert):0)||Number(!handedOver(a))-Number(!handedOver(b))||(a.at?Date.parse(a.at):Infinity)-(b.at?Date.parse(b.at):Infinity)||a.id.localeCompare(b.id));
}
