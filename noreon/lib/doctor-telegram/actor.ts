import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {staffAccessSession,staffAccessIdentity,staffAdmissionSchema,chatDoctorIdentity,chatDoctorEnabled,type StaffAccessClient} from '@/lib/staff/real-staff-access';
import {doctorTelegramEnabled} from './config';
/** The client carries only the exact access token; it neither persists nor refreshes cookies. */
export function doctorTokenClient(accessToken:string,env:Record<string,string|undefined>=process.env){
 if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.NEXT_PUBLIC_SUPABASE_ANON_KEY)throw Error('Doctor Telegram unavailable.');
 return createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL,env.NEXT_PUBLIC_SUPABASE_ANON_KEY,{global:{headers:{Authorization:`Bearer ${accessToken}`}},auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
export async function doctorBrokerActor(accessToken:string,expectedDoctorId:string,options:{client?:StaffAccessClient;env?:Record<string,string|undefined>;sessionId?:string}={}){
 if(!accessToken)return null;
 const env=options.env??process.env,client=options.client??doctorTokenClient(accessToken,env);
 const session=await staffAccessSession(client,accessToken);
 if(!session||options.sessionId&&session.sessionId!==options.sessionId||session.user.id!==expectedDoctorId)return null;
 const {parsed}=await staffAccessIdentity(client);
 if(!parsed.success||!chatDoctorIdentity(parsed.data,expectedDoctorId))return null;
 const admission=await client.rpc('staff_signin_state');
 const state=staffAdmissionSchema.safeParse(admission.data);
 if(admission.error||!state.success||state.data.required&&!state.data.admitted)return null;
 if(!chatDoctorEnabled(env)||!doctorTelegramEnabled(env))return null;
 const zoe=await client.rpc('staff_zoe_status');
 if(zoe.error||zoe.data!==true)return null;
 return {client,identity:parsed.data,sessionId:session.sessionId};
}
export type DoctorBrokerActor=NonNullable<Awaited<ReturnType<typeof doctorBrokerActor>>>;
