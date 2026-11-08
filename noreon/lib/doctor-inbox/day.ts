import 'server-only';
import {doctorInboxSchema,inboxItemSchema} from './contracts';
import {readDoctorMedicineConcerns,type MedicinesRpc} from '@/lib/member-medicines/server';
import {readDoctorLdlResponses} from '@/lib/ldl/response-runtime';
import {readFirstNoteQueue} from '@/lib/first-note/runtime';
import {taskPageSchema,taskSnapshotSchema,type CoordinationTask} from '@/lib/staff/real-coordination/schema';
import {nurseChatEnabled} from '@/lib/nurse-chat/config';
import {readHandoffs} from '@/lib/nurse-chat/handoff-read';
import {readDoctorUrgentInbox} from './urgent-inbox-server';

/** Existing task queue is paged. Audit each overdue snapshot before returning it, and never hide a failed audit.
 * This is the same bounded page in Today and chat; the full task page remains the fallback.
 */
async function overdueTasks(client:MedicinesRpc,now:Date){
 const r=await client.rpc('patient_coordination_queue');
 if(r.error)throw Error('Task queue unavailable');
 const parsed=taskPageSchema.safeParse(r.data);
 if(!parsed.success)throw Error('Task queue unavailable');
 const page=parsed.data,items:CoordinationTask[]=[];
 for(const task of page.tasks){
  if(!task.dueAt||Date.parse(task.dueAt)>=now.getTime())continue;
  const snapshot=await client.rpc('patient_coordination_snapshot',{p_task:task.id});
  if(snapshot.error)throw Error('Task snapshot unavailable');
  const parsed=taskSnapshotSchema.safeParse(snapshot.data);
  if(!parsed.success)throw Error('Task snapshot unavailable');
  const current=parsed.data;
  if(current.status!=='completed'&&current.status!=='cancelled'&&current.dueAt&&Date.parse(current.dueAt)<now.getTime())items.push(current);
 }
 return {items,hasMore:page.nextCursor!==null};
}

/** One definition for Today and the workspace. All IO uses the signed-in staff client and existing scoped/audited RPCs. */
export async function readDoctorDay(client:MedicinesRpc,includeTasks=false,now=new Date(),includeFirstNotes=true){
 const r=await client.rpc('doctor_ai_inbox');
 if(r.error)throw Error('Doctor inbox unavailable');
 const parsed=doctorInboxSchema.safeParse(r.data);
 if(!parsed.success)throw Error('Doctor inbox unavailable');
 // Quiet notes are their own read, like the medicine and LDL queues below. A failure names itself and leaves the rest of the day.
 const notes=inboxItemSchema.array().safeParse(await client.rpc('doctor_bp_repeat_notes').then(x=>x.error?null:x.data,()=>null));
 const inbox=notes.success?{...parsed.data,items:[...parsed.data.items,...notes.data]}:{...parsed.data,unavailable:[...parsed.data.unavailable,'bp_repeat_notes']};
 const urgent=await readDoctorUrgentInbox(client,{inbox});
 inbox.p0=urgent.alerts;
 inbox.unavailable.push(...urgent.unavailable);
 const [medicines,ldl,firstNotes,tasks]=await Promise.all([
  readDoctorMedicineConcerns(client),readDoctorLdlResponses(client),includeFirstNotes?readFirstNoteQueue(client):Promise.resolve(null),
  includeTasks?overdueTasks(client,now).catch(()=>null):Promise.resolve(undefined),
 ]);
 const handoffs=nurseChatEnabled()?await readHandoffs(client):undefined;
 const handoffIds=new Set(handoffs?.items.map(item=>item.task.id));
 return {inbox,windows:urgent.windows,urgentWindowsTotal:urgent.windowsTotal,urgentCapped:urgent.capped,medicines,ldl,firstNotes,tasks:tasks?{...tasks,items:tasks.items.filter(task=>!handoffIds.has(task.id))}:tasks,...(handoffs!==undefined?{handoffs}:{})};
}
export type DoctorDay=Awaited<ReturnType<typeof readDoctorDay>>;
export {doctorDayCounts} from './day-counts';
