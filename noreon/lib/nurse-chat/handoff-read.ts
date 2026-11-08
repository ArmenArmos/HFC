import 'server-only';
import {handoffPageSchema,type HandoffPage} from './handoffs';
type HandoffRpc={rpc:(name:'conversation_nurse_handoffs',args?:{p_member?:string})=>PromiseLike<{data:unknown;error:unknown}>};

export async function readHandoffs(client:HandoffRpc,memberId?:string):Promise<HandoffPage|null>{
 try{
  const r=await client.rpc('conversation_nurse_handoffs',memberId?{p_member:memberId}:{});
  const parsed=handoffPageSchema.safeParse(r.data);
  return !r.error&&parsed.success?parsed.data:null;
 }catch{return null;}
}
