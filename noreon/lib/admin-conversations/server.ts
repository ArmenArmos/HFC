import 'server-only';
import {z} from 'zod';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {adminConversationListSchema,adminConversationReadSchema,type AdminConversationFilter} from './contracts';

/** Admin oversight reads. Each call is one recording definer function; the database checks the admin and the switch. */
export async function readAdminConversationList(filter:AdminConversationFilter|null){
 const {client}=await requireRealAdmin();
 const {data,error}=await client.rpc('admin_conversation_list',filter?{p_filter:filter}:{});
 if(error)throw Error(`Admin conversation list unavailable (${error.code??'rpc'})`);
 return adminConversationListSchema.parse(data);
}
export async function readAdminConversation(memberId:string,before:string|null=null){
 const {client}=await requireRealAdmin();
 const {data,error}=await client.rpc('admin_conversation_read',before?{p_member:z.uuid().parse(memberId),p_before:before}:{p_member:z.uuid().parse(memberId)});
 if(error)throw Error(`Admin conversation unavailable (${error.code??'rpc'})`);
 return adminConversationReadSchema.parse(data);
}
