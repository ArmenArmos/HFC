import 'server-only';
import {handoffResolved,sentHandoffsSchema,type SentHandoffs} from './sent-handoffs';

/** Temporary RPC boundary until the lead regenerates database types after stamping the migration. */
export async function readSentHandoffs(client:{rpc:unknown}):Promise<SentHandoffs|null>{
 try{
  const rpc=client as {rpc(name:'nurse_sent_handoffs'):PromiseLike<{data:unknown;error:unknown}>};
  const result=await rpc.rpc('nurse_sent_handoffs');
  if(result.error)return null;
  const parsed=sentHandoffsSchema.safeParse(result.data);
  if(!parsed.success)return null;
  return {...parsed.data,items:parsed.data.items.map(item=>({...item,resolution:handoffResolved(item.status)?item.resolution:null}))};
 }catch{return null;}
}
