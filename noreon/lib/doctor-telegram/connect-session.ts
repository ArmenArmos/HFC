import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {validatedStaffSession} from '@/lib/staff/real-session-binding';
import {staffSessionMethodAllowed} from '@/lib/staff/staff-session-method';

/** Auth owns password checks and throttling. The separate client never has a cookie adapter. */
export async function passwordSession(client:SupabaseClient,doctorId:string,email:string,password:string){
 const result=await client.auth.signInWithPassword({email,password});
 if(result.error||!result.data.session)return {kind:'password' as const};
 const token=result.data.session;
 const session=await validatedStaffSession(client.auth,token.access_token);
 if(!session||session.user.id!==doctorId||!staffSessionMethodAllowed(session.claims.amr)){
  await client.auth.signOut({scope:'local'}).catch(()=>null);
  return {kind:'unavailable' as const};
 }
 return {kind:'session' as const,sessionId:session.sessionId,accessToken:token.access_token,refreshToken:token.refresh_token};
}
