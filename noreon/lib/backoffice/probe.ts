import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
/** A one-request Auth client that writes no cookie. The unified sign-in signs in here once,
 * decides staff or clinic, and only then stores the session under that portal's cookie. */
export function probeAuthClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
 if(!url||!key)throw Error('Sign-in is temporarily unavailable.');
 return createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
}
