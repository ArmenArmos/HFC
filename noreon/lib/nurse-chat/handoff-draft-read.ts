import 'server-only';
import {readBpMemberDevices,type BpRpc} from '@/lib/bp-device/runtime';
import {readStaffMedicines,type MedicinesRpc} from '@/lib/member-medicines/server';
import {readNurseVisitRecord} from '@/lib/nurse-visit/runtime';
import {adherence,yerevanDate} from '@/lib/member-medicines/model';
import type {CoordinationTask} from '@/lib/staff/real-coordination/schema';
import type {HandoffFacts} from './handoff-draft';

/** The record facts for one member's hand-over summary, read with the signed-in nurse's own client: the database decides what she may see. Each
 * source is read on its own and a failure is `null` (said in the summary), never an empty claim. The member's words are added by the screen from
 * the conversation it already shows. */
export type HandoffFactsRead=Omit<HandoffFacts,'identity'|'memberMessage'>;
const addDays=(date:string,n:number)=>new Date(Date.parse(`${date}T00:00:00Z`)+n*86_400_000).toISOString().slice(0,10);
const DAYS=7;

export async function readHandoffFacts(client:{rpc:unknown},memberId:string,tasks:CoordinationTask[]|null,now=new Date()):Promise<HandoffFactsRead>{
 const to=yerevanDate(now),from=addDays(to,-(DAYS-1));
 let bp:HandoffFactsRead['bp']=null;
 try{
  const data=await readBpMemberDevices(client as unknown as BpRpc,memberId);
  if(data.readings)bp=data.readings
   .filter(r=>Date.parse(r.measuredAt)<=now.getTime()&&yerevanDate(new Date(r.measuredAt))>=from)
   .map(r=>({systolic:r.systolic,diastolic:r.diastolic,pulse:r.pulse,measuredAt:r.measuredAt,source:r.source,entrySource:r.entrySource}));
 }catch{bp=null;}
 // Blood pressure the nurse recorded in a visit is in the visit record, not in the readings list; without it the summary would say "no readings" over a measurement she took.
 if(bp){
  const visits=await readNurseVisitRecord(client as unknown as Parameters<typeof readNurseVisitRecord>[0],memberId);
  // An unreadable visit record cannot support "no readings": then the whole line says it could not be read.
  if(!visits&&bp.length===0)bp=null;
  if(bp&&visits&&visits.enabled)for(const entry of visits.visits)for(const item of entry.items){
   if(item.kind!=='measurement'||item.field!=='bp'||!item.mark?.done||!item.mark.values||!('systolic' in item.mark.values))continue;
   const at=item.mark.recordedAt;
   if(!at||Date.parse(at)>now.getTime()||yerevanDate(new Date(at))<from)continue;
   bp.push({systolic:item.mark.values.systolic,diastolic:item.mark.values.diastolic,pulse:item.mark.values.pulse,measuredAt:at,source:'visit'});
  }
 }
 let medicines:HandoffFactsRead['medicines']=null;
 try{
  const read=await readStaffMedicines(client as unknown as MedicinesRpc,memberId,DAYS);
  if(read.enabled){
   medicines=[...read.plan.map(m=>({m,source:'plan' as const})),...read.self.filter(m=>!m.stoppedAt).map(m=>({m,source:'self' as const}))]
    .map(({m,source})=>({name:m.name,dose:m.dose??null,source,...adherence(m,DAYS,now)}))
    .filter(row=>row.expected>0)
    .map(({name,dose,source,expected,taken,skipped,noReport})=>({name,dose,source,expected,taken,skipped,noReport}));
  }
 }catch{medicines=null;}
 return {
  asOf:now.toISOString(),bp,medicines,medicinesFrom:from,medicinesTo:to,
  tasks:tasks===null?null:tasks.filter(task=>task.caseId===memberId&&task.status!=='completed'&&task.status!=='cancelled').map(task=>({title:task.title,dueAt:task.dueAt})),
 };
}
