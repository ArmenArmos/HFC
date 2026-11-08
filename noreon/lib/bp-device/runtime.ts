import 'server-only';
import{bpDeviceCommandSchema,bpDeviceResultSchema,bpInventorySchema,bpMemberDevicesSchema,type BpDeviceResult,type BpInventory,type BpMemberDevices}from'./schema';
export type BpRpc={rpc(name:string,args?:Record<string,unknown>):PromiseLike<{data:unknown;error:{code?:string;message?:string}|null}>};

/** Reads use the signed-in staff client only; the database decides scope. */
export async function readBpInventory(client:BpRpc):Promise<BpInventory>{
 const response=await client.rpc('bp_admin_device_inventory');
 if(response.error)throw Object.assign(Error('BP monitors are unavailable.'),{code:response.error.code});
 const parsed=bpInventorySchema.safeParse(response.data);if(!parsed.success)throw Error('BP monitors are unavailable.');
 return parsed.data;
}
export async function readBpMemberDevices(client:BpRpc,memberId:string):Promise<BpMemberDevices>{
 const response=await client.rpc('bp_staff_member_devices',{p_member:memberId});
 if(response.error)throw Object.assign(Error('BP monitor details are unavailable.'),{code:response.error.code});
 const parsed=bpMemberDevicesSchema.safeParse(response.data);
 if(!parsed.success||parsed.data.memberId!==memberId)throw Error('BP monitor details are unavailable.');
 return parsed.data;
}
/** A resend of the same submission replays the stored result, so an unknown
 * outcome can be checked by sending the same command again. */
export async function sendBpDeviceCommand(client:BpRpc,raw:unknown):Promise<BpDeviceResult>{
 const parsed=bpDeviceCommandSchema.safeParse(raw);if(!parsed.success)return{status:'invalid'};
 const command=parsed.data.action==='register'?{...parsed.data,serial:parsed.data.serial.toUpperCase()}:parsed.data;
 try{
  const response=await client.rpc('bp_device_command',{p_command:command});
  if(response.error)return{status:response.error.code==='55P03'?'unavailable':'outcome-unknown'};
  const result=bpDeviceResultSchema.safeParse(response.data);
  return result.success?result.data:{status:'outcome-unknown'};
 }catch{return{status:'outcome-unknown'};}
}
