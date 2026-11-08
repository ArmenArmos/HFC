import 'server-only';
import type{BookingRpc,BookingRuntimeContext}from'./appointment-runtime';
import type{SchedulingRuntime}from'./scheduling-template';
/** The public repository supplies the verified member and server configuration.
 * Keep real RLS reads when the write kill switch is off. */
export async function createMemberBookingContext(input:{memberId:string;enabled:boolean;createRead:()=>BookingRpc|Promise<BookingRpc>;createWrite:()=>BookingRpc;createRuntime:()=>SchedulingRuntime|null;portal?:boolean;invalidate:()=>void}):Promise<BookingRuntimeContext>{
 const disabled:BookingRpc={rpc:async()=>({data:null,error:{code:'42501'}})};
 const enabled=input.enabled;
 return{memberId:input.memberId,actorId:input.memberId,read:await input.createRead(),write:enabled?input.createWrite():disabled,runtime:enabled?input.createRuntime():null,portal:enabled&&input.portal===true,allowRecovery:enabled,invalidate:input.invalidate};
}
