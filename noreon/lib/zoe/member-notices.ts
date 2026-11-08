import 'server-only';
import {z} from 'zod';
import {memberNoticesSchema} from './app-chat-contracts';

/** The session client's two calls here, so a check can stand in for it. */
export type MemberNoticesRpc={rpc:(name:'member_notices_read'|'member_notices_mark_seen',args?:{p_id:string})=>PromiseLike<{data:unknown;error:unknown}>};
export const memberNoticesInChatEnabled=(env:Record<string,string|undefined>=process.env)=>env.NOREON_MEMBER_NOTICES_IN_CHAT==='true';

/** An unavailable additive projection must never make the conversation unavailable. */
export async function readMemberNotices(client:MemberNoticesRpc){
 try{
  const result=await client.rpc('member_notices_read');
  if(result.error)return null;
  const parsed=memberNoticesSchema.safeParse(result.data);
  return parsed.success?parsed.data:null;
 }catch{return null;}
}

const seenResultSchema=z.strictObject({ok:z.boolean()});
export async function markMemberNoticeSeen(client:MemberNoticesRpc,id:string):Promise<'seen'|'unavailable'|'failed'>{
 if(!z.uuid().safeParse(id).success)return 'unavailable';
 try{
  const result=await client.rpc('member_notices_mark_seen',{p_id:id});
  if(result.error)return 'failed';
  const parsed=seenResultSchema.safeParse(result.data);
  return parsed.success?(parsed.data.ok?'seen':'unavailable'):'failed';
 }catch{return 'failed';}
}
