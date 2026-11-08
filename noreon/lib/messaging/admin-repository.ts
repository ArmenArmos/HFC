import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {messageOperatorRuntime} from './runtime';
import {runMessageOperation} from './operations';
import {readAdminMessageView} from './admin-view';
export async function getAdminMessageView(query:Record<string,string|string[]|undefined>){
 return readAdminMessageView(query,{
  authorize:requireRealAdmin,
  open:()=>messageOperatorRuntime(false).db(),
  operation:(args,db)=>runMessageOperation(args,db as SupabaseClient<Database>),
 });
}
