import 'server-only';
import {z} from 'zod';
import {runMemberIdentitySearch} from '@/lib/staff/member-search-command';
import {conversationReadSchema,type ConversationRead,type StaffZoeRole,type ToolId,type ToolResult} from './contracts';
import {emptyResult} from './facts';
import {AccessLost} from './turn';

type Rpc={rpc:(name:string,args?:Record<string,unknown>)=>PromiseLike<{data:unknown;error:{code?:string}|null}>};
type Read=(tool:ToolId,memberId:string,role:StaffZoeRole)=>Promise<ToolResult>;
const GLANCE:readonly ToolId[]=['overview','bp','ldl','plan','adherence','visits','open_items'];

/** The conversation is the sole source of the selected member ID. Every record reader checks permission and audit. */
export async function readWorkspaceSelection(client:Rpc,conversationId:string|undefined,read:Read,includeLabs=false){
 let conversation:ConversationRead|null=null,refused=false;
 if(conversationId!==undefined){
  const id=z.uuid().safeParse(conversationId);
  if(!id.success)refused=true;
  else{
   const r=await client.rpc('staff_zoe_read',{p_conversation:id.data}).then(r=>r,()=>({data:null,error:{code:'unavailable'}}));
   const parsed=conversationReadSchema.safeParse(r.data);
   if(r.error||!parsed.success||!parsed.data.enabled)refused=true;else conversation=parsed.data;
  }
 }
 let glance:ToolResult[]=[];
 if(conversation){
  const memberId=conversation.member.id;
  try{glance=await Promise.all((includeLabs?[...GLANCE,'labs' as const,'member_messages' as const]:GLANCE).map(async tool=>{
   try{return await read(tool,memberId,'doctor');}
   catch(e){if(e instanceof AccessLost)throw e;return emptyResult(tool,'unavailable',memberId,'doctor');}
  }));}catch{conversation=null;refused=true;}
 }
 return {conversation,refused,glance};
}

/** Authenticated server render only. The page checks the screen flag before calling this; the DB checks every read. */
export async function readDoctorWorkspace(client:Rpc,role:string,conversationId:string|undefined,read:Read){
 if(role!=='doctor')return null;
 const status=await client.rpc('staff_zoe_status').then(r=>!r.error&&r.data===true,()=>false);
 if(!status)return null;
 // The search RPC audits every returned member in the same transaction, including this first page.
 const result=await runMemberIdentitySearch({query:'',cursor:null},client);
 return {members:result.ok?result.page:null,...await readWorkspaceSelection(client,conversationId,read)};
}
