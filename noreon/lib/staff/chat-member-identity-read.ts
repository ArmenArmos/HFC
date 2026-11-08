import 'server-only';
import {z} from 'zod';
import {staffMemberIdentityIdsSchema} from './member-search-schema';
import {chatMemberIdentitySchema,type ChatMemberIdentity} from './chat-member-identity-schema';

type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>};
/** Same session-bound, audited source as staff identity. Never service-role reads. */
export async function readChatMemberIdentities(client:Rpc,raw:unknown):Promise<ChatMemberIdentity[]|null>{
 const parsed=staffMemberIdentityIdsSchema.safeParse(raw);
 if(!parsed.success)return null;
 const ids=[...new Set(parsed.data)];if(!ids.length)return [];
 try{
  const result=await client.rpc('staff_chat_member_identities',{p_members:ids});
  const rows=z.array(chatMemberIdentitySchema).max(50).safeParse(result.data);
  if(result.error||!rows.success||new Set(rows.data.map(row=>row.id)).size!==rows.data.length||rows.data.some(row=>!ids.includes(row.id)))return null;
  return rows.data;
 }catch{return null;}
}

/** Enrich only confirmed resolver targets, without ever opening their records. */
export async function questionMemberIdentities(client:Rpc,result:import('@/lib/staff-zoe/chat-v2-zoe-read').ChatQuestionMemberResponse){
 if(result.kind!=='choose'&&result.kind!=='member')return result;
 const ids=result.kind==='choose'?result.rows.map(row=>row.id):[result.memberId];
 const identities=await readChatMemberIdentities(client,ids);
 if(!identities||ids.some(id=>!identities.some(row=>row.id===id)))return {kind:'unavailable' as const};
 if(result.kind==='member')return {...result,identity:identities[0]};
 return {...result,rows:result.rows.map(row=>({...row,...identities.find(identity=>identity.id===row.id),name:row.name}))};
}
