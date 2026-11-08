import 'server-only';
import {createClient} from '@/lib/supabase/server';

/** Whether the member's doctor is preparing their plan (a boolean only). False when off or unreadable. */
export async function readPlanPreparing():Promise<boolean>{
 try{const r=await (await createClient()).rpc('patient_plan_preparing');return !r.error&&r.data===true;}catch{return false;}
}
