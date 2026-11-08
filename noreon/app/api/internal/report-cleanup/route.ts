import {jobRoute} from '@/lib/jobs/contract';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {workspaceAdmin} from '@/lib/staff/auth';
import {sharedDemoEnabled} from '@/lib/staff/cases';
import {createCleanupHandler} from '@/lib/cleanup/handler';
export const runtime='nodejs';
export const maxDuration=60;
const cleanup=createCleanupHandler({env:process.env,demoEnabled:sharedDemoEnabled,demo:workspaceAdmin,real:()=>createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}})});
/** Hourly report cleanup. Its detailed run record stays in cleanup_runs; the job ledger records the run like every other job. */
export const GET=jobRoute({name:'report_cleanup',maxDurationSec:maxDuration,enabled:()=>process.env.NOREON_DEPLOYMENT_TARGET==='app'||sharedDemoEnabled()},async({request})=>{
 const response=await cleanup(request!);
 const report=await response.json().catch(()=>null) as {cleaned?:number}|null;
 return {outcome:response.ok?'ok':(report?.cleaned??0)>0?'partial':'error',report,status:response.status,errorCode:response.ok?null:'cleanup_failed'};
});
