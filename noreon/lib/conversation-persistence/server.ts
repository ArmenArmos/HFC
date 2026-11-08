import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {createClient} from '@/lib/supabase/server';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {ConversationRepository} from './repository';
import {realReviewEnabled} from '@/lib/patient-care/real-review-config';
import {nurseChatEnabled} from '@/lib/nurse-chat/config';
/** The adapter keeps the end-user client; service-role credentials are never substituted. */
function repository(client:SupabaseClient<Database>){return new ConversationRepository({rpc:(name,args)=>client.rpc(name as keyof Database['public']['Functions'],args as never)});}
export async function authenticatedMemberConversation(){
 if(!realReviewEnabled(process.env))return null;
 const client=await createClient();const {data,error}=await client.auth.getUser();
 if(error||!data.user?.phone||!data.user.phone_confirmed_at)return null;
 return repository(client);
}
export async function assignedDoctorConversation(){const {client,identity}=await requireRealStaff();if(identity.role!=='doctor')throw Error('Assigned doctor required');return repository(client);}

/** Separate capability: nurses never receive the doctor's compose, approval or takeover ports.
 * The end-user RPC rechecks assignment, clinic and live session on every request, including retries. */
export async function assignedNurseConversation(){
 if(!nurseChatEnabled())return null;
 const {client,identity}=await requireRealStaff();
 if(identity.role!=='nurse')return null;
 const repo=repository(client);
 return {read:repo.nurseWorkspace.bind(repo),send:repo.nurseReply.bind(repo)};
}

export async function assignedIntakeConversation(){const {client,identity}=await requireRealStaff();if(identity.role!=='doctor'&&identity.role!=='nurse')throw Error('Assigned intake staff required');return repository(client);}
