import 'server-only';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {careQueueInboxSchema,careQueueRaiseResultSchema,careQueueRaiseSchema,type CareQueueRaise,type CareQueueTask} from './contracts';

/** Service-role database calls, injected so checks need no database. */
export type CareQueueRpc=(name:string,args:Record<string,unknown>)=>Promise<unknown>;
export type CareQueueRaiseReport={raised:number;replayed:number;failed:number;
 /** The tasks that exist now, for the member's status chip. */taskIds:string[];tasks:CareQueueTask[]};

/** Raises each task on its own, so one failed queue never loses the other. Does nothing while the switch is off. */
export async function raiseCareQueueTasks(rpc:CareQueueRpc,raises:readonly CareQueueRaise[],env:Record<string,string|undefined>=process.env):Promise<CareQueueRaiseReport>{
 const report:CareQueueRaiseReport={raised:0,replayed:0,failed:0,taskIds:[],tasks:[]};
 if(!zoeAppV3Enabled(env))return report;
 for(const raise of raises){
  try{
   const r=careQueueRaiseSchema.parse(raise);
   const result=careQueueRaiseResultSchema.parse(await rpc('care_queue_raise',{p_member:r.memberId,p_queue:r.queue,p_zone:r.zone,p_reason:r.reason,p_rule_version:r.ruleVersion,
    p_red_flags:r.redFlagsStatus,p_action:r.suggestedAction,p_summary:r.summary,p_sla:r.slaDeadline,p_source_ref:r.sourceRef}));
   if(!result.ok){report.failed++;continue;}
   if(result.replayed)report.replayed++;else report.raised++;
   report.taskIds.push(result.task.id);
   report.tasks.push(result.task);
  }catch{report.failed++;}
 }
 return report;
}

/** The Tasks page reads the same rows as Care queue, with the same database permissions. */
export async function readReportedBpTasks(client:{rpc:unknown},view:'live'|'sandbox'){
 try{
  const r=await (client as {rpc:(name:string,args:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>}).rpc('care_queue_inbox',{p_queue:'nurse',p_view:view});
  if(r.error)return null;
  const parsed=careQueueInboxSchema.safeParse(r.data);
  return parsed.success?parsed.data.tasks.filter(t=>t.reason==='bp_member_reported_high'):null;
 }catch{return null;}
}
