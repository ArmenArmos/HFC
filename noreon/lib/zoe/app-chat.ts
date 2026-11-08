import 'server-only';
import {createClient as createServiceClient} from '@supabase/supabase-js';
import {z} from 'zod';
import type {Database} from '@/lib/db/types';
import {createClient} from '@/lib/supabase/server';
import {authenticatedMemberConversation} from '@/lib/conversation-persistence/server';
import {careAlertsEnabled} from '@/lib/care-alerts/contracts';
import {screenPendingMessages,type CareAlertRpc} from '@/lib/care-alerts/server';
import {threadSchema,ZOE_CHAT_MAX,zoeStoreCode,type ZoeStoreCode,type ZoeThread} from './app-chat-contracts';
import {memberNoticesInChatEnabled,readMemberNotices,type MemberNoticesRpc} from './member-notices';

/**
 * Server side of the member app Zoe chat. It stores the member's text in their one conversation
 * and reads the thread back, both with the member's own session (the database functions use
 * auth.uid(), never a member argument). It never calls the Zoe pipeline or a model: the Telegram
 * sweep claims the stored message like any Telegram one, and only a doctor's approval answers.
 */

/** The member's own thread, or why there is none ('failed' when it could not be read). */
export async function readZoeThreadState():Promise<ZoeThread|'unavailable'|'not_eligible'|'failed'>{
 const client=await createClient();
 const {data,error}=await client.rpc('conversation_member_thread');
 if(error)return 'failed';
 const parsed=threadSchema.safeParse(data);
 if(!parsed.success)return 'failed';
 if(!parsed.data.ok)return parsed.data.code;
 if(!memberNoticesInChatEnabled())return parsed.data;
 const notices=await readMemberNotices(client as unknown as MemberNoticesRpc);
 return notices?{...parsed.data,notices:notices.notices,firstUnseenNotice:notices.firstUnseen}:parsed.data;
}

/** The member's own thread; null when the chat is switched off, unavailable or unreadable. */
export async function readZoeThread():Promise<ZoeThread|null>{
 const state=await readZoeThreadState();
 return typeof state==='string'?null:state;
}

const intakeStateSchema=z.object({ok:z.literal(true),enabled:z.boolean(),active:z.boolean()});
/** The member's symptom-intake state (switch on, an intake active); null when unreadable (then no extra red-flag step). */
export async function readIntakeState():Promise<{enabled:boolean;active:boolean}|null>{
 const client=await createClient();
 const {data,error}=await client.rpc('zoe_symptom_intake_member');
 if(error)return null;
 const parsed=intakeStateSchema.safeParse(data);
 return parsed.success?{enabled:parsed.data.enabled,active:parsed.data.active}:null;
}

const newTopicSchema=z.union([z.object({ok:z.literal(true)}),z.object({ok:z.literal(false),code:z.string()})]);
/** The member's "New question" divider after their newest message (conversation_member_new_topic, idempotent). */
export async function storeNewTopic():Promise<boolean>{
 const client=await createClient();
 const {data,error}=await client.rpc('conversation_member_new_topic');
 if(error)return false;
 const parsed=newTopicSchema.safeParse(data);
 return parsed.success&&parsed.data.ok;
}

/** UTF-16 code units, as the database and Telegram count them. */
export const utf16Length=(text:string)=>text.length;

export type StoreResult={ok:true}|{ok:false;code:ZoeStoreCode};

/** Stores one member message under an idempotent request id (a retry replays, never duplicates). */
export async function storeZoeMessage(requestId:string,text:string,toDoctor=false):Promise<StoreResult>{
 if(!text.trim()||utf16Length(text)>ZOE_CHAT_MAX)return {ok:false,code:'invalid'};
 const repo=await authenticatedMemberConversation();
 if(!repo)return {ok:false,code:'unavailable'};
 try{
  const r=await repo.receive({requestId,text},toDoctor);
  if(r.ok)return {ok:true};
  return {ok:false,code:zoeStoreCode(r.code)};
 }catch{return {ok:false,code:'failed'};}
}

/**
 * Right after a send: the same care-alert screening the Telegram sweep runs, so an urgent app
 * message reaches the care team without waiting for the next sweep. Screening is idempotent per
 * message, so the sweep never screens it twice. Never throws.
 */
export async function screenNewMessages(env:Record<string,string|undefined>=process.env){
 if(!careAlertsEnabled(env))return null;
 const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return null;
 const client=createServiceClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const rpc:CareAlertRpc=async(name,args)=>{
  const {data,error}=await client.rpc(name as keyof Database['public']['Functions'],args as never);
  if(error)throw Error(`Care alert database unavailable (${error.code??'rpc'})`);
  return data;
 };
 return screenPendingMessages(rpc).catch(()=>null);
}
