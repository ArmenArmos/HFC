import 'server-only';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
/** Use only after requireRealStaff plus the assigned-case RPC has authenticated the actor. */
export function clinicalWriteClient(){
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)throw Error('Clinical review is unavailable.');
 return createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
}
