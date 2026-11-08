import 'server-only';
import {ZONE_RULES_V1} from '@/lib/clinical/zones/config-v1';
import type {Rpc} from './server';
/** Logistics reach the admin queue only, with a fixed reason. See supabase care_queue_raise.
 * Only an authenticated card action calls this adapter, after checking the member's own live appointment.
 * No clinical free text, zone or summary can enter an admin task through this interface.
 */
export type AdminTask={memberId:string;appointmentId:string;requestId:string;reason:'fasting_failed'|'lab_reschedule'};
export type AdminQueueRpc={rpc(name:string,args:Record<string,unknown>):PromiseLike<{data:unknown;error:unknown}>};
export async function raiseAdminTask(client:AdminQueueRpc,input:AdminTask):Promise<boolean>{
 try{
  const {data,error}=await client.rpc('care_queue_raise',{p_member:input.memberId,p_queue:'admin',p_zone:null,p_reason:input.reason,p_rule_version:ZONE_RULES_V1.version,
   p_red_flags:null,p_action:'rebook',p_summary:{},p_sla:null,p_source_ref:input.requestId});
  return !error&&(data as {ok?:unknown}|null)?.ok===true;
 }catch{return false;}
}

/** A visit preference is kept in the care-team conversation, never in the admin queue. */
export async function raiseVisitRequestTask(rpc:Rpc|null,memberId:string,sourceRef:string):Promise<boolean>{
 if(!rpc)return false;
 try{
  const data=await rpc('care_queue_raise',{p_member:memberId,p_queue:'admin',p_zone:null,p_reason:'lab_booking_needed',p_rule_version:ZONE_RULES_V1.version,
   p_red_flags:null,p_action:'book',p_summary:{},p_sla:null,p_source_ref:sourceRef});
  return (data as {ok?:unknown}|null)?.ok===true;
 }catch{return false;}
}
