import type {CoordinationSnapshot} from '@/lib/staff/real-coordination/schema';

/** Where a nurse's handoff stands, from the task and its events only. There is no read receipt: "seen" is not claimed.
 * - sent: nobody but the nurse has acted on it.
 * - working: the doctor (or an admin) has acted on it and it is not finished.
 * - answered: it is completed and a doctor or admin wrote the closing note.
 * - closed: it is completed or cancelled with no note from a doctor (for example the nurse closed it). */
export type HandoffState={state:'sent'|'working'|'answered'|'closed';by:string|null;note:string|null;at:string|null};

export function handoffState(task:Pick<CoordinationSnapshot,'status'|'events'>):HandoffState{
 const doctorEvents=[...task.events].filter(event=>event.actor_role==='doctor'||event.actor_role==='admin').sort((a,b)=>a.id-b.id);
 const last=doctorEvents.at(-1)??null;
 const done=task.status==='completed'||task.status==='cancelled';
 const note=last?.note?.trim()||null;
 if(done)return last&&note&&task.status==='completed'?{state:'answered',by:last.actor_name,note,at:last.created_at}:{state:'closed',by:last?.actor_name??null,note,at:last?.created_at??null};
 return last?{state:'working',by:last.actor_name,note,at:last.created_at}:{state:'sent',by:null,note:null,at:null};
}
