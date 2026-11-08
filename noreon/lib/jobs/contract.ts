import 'server-only';
import {timingSafeEqual} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {logSweep,withRouteLogging} from '@/lib/observability/with-logging';
import {jobCounts,jobErrorCode,type JobOutcome} from './summary';

/**
 * The one contract every background job follows (architecture review ADR 2):
 *  - a Vercel Cron (or the app's own trigger) calls GET with CRON_SECRET; anything else is a 404;
 *  - the run is recorded in public.job_runs before work starts and finished once afterwards, with outcome,
 *    a fixed error code, duration and numeric counts (never member data);
 *  - the work gets a deadline a margin before the route's maxDuration, so it can stop claiming new items
 *    in time instead of being killed mid-item (a killed run shows as "lost" on Operations);
 *  - the ledger never blocks the job: if it cannot be written, the job still runs and the log says so.
 * The claim, lease and attempt rules of each queue stay in its own SQL (zoe_run_claim, lab_ai_jobs, ...).
 */
export type JobResult={outcome:JobOutcome;report:unknown;status?:number;errorCode?:string|null};
export type JobContext={runId:string|null;deadline:number;remainingMs:()=>number;request?:Request};
export type JobOptions={
 /** Ledger name: lower snake case, also the Axiom sweep name. */
 name:string;
 /** The route's maxDuration in seconds. */
 maxDurationSec:number;
 /** Extra gate before anything runs (a feature switch); false is a 404 like a bad secret. */
 enabled?:()=>boolean;
 /** Response body code when the work throws (kept stable for monitors); default `<name>_failed`. */
 failureCode?:string;
};
export type JobLedger={
 start:(job:string,trigger:'cron'|'request',maxSeconds:number)=>Promise<string|null>;
 finish:(runId:string,outcome:JobOutcome,errorCode:string|null,counts:Record<string,unknown>)=>Promise<void>;
};

/** Seconds kept back from maxDuration for the finish write and the response. */
export const JOB_DEADLINE_MARGIN_SEC=10;
const LEDGER_TIMEOUT_MS=2000;

export function cronAuthorized(request:Request,secret=process.env.CRON_SECRET):boolean{
 const supplied=request.headers.get('authorization')??'',expected=`Bearer ${secret??''}`;
 return !!secret&&Buffer.byteLength(supplied)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(expected));
}

/** Service-role ledger writes, each bounded so a slow database cannot eat the job's time. */
export function serviceJobLedger(env:Record<string,string|undefined>=process.env):JobLedger|null{
 const url=env.NEXT_PUBLIC_SUPABASE_URL,key=env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return null;
 const client=createClient<Database>(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const bounded=async<T>(query:PromiseLike<{data:T;error:unknown}>&{abortSignal?:(s:AbortSignal)=>unknown})=>{
  const signal=AbortSignal.timeout(LEDGER_TIMEOUT_MS);
  const q=(typeof query.abortSignal==='function'?query.abortSignal(signal):query) as PromiseLike<{data:T;error:unknown}>;
  const {data,error}=await q;
  if(error)throw new Error('job_ledger_write_failed');
  return data;
 };
 return {
  start:async(job,trigger,maxSeconds)=>{
   const id=await bounded(client.rpc('job_run_start',{p_job:job,p_trigger:trigger,p_max_seconds:maxSeconds}));
   return typeof id==='string'?id:null;
  },
  finish:async(runId,outcome,errorCode,counts)=>{
   await bounded(client.rpc('job_run_finish',{p_run:runId,p_outcome:outcome,p_error_code:errorCode as string,p_counts:counts as never}));
  },
 };
}

/** Run one job under the contract. Exported for tests; routes use jobRoute. */
export async function runJob(options:JobOptions&{trigger:'cron'|'request';ledger:JobLedger|null;now?:()=>number},work:(ctx:JobContext)=>Promise<JobResult>):Promise<JobResult&{runId:string|null}>{
 const now=options.now??(()=>Date.now());
 const startedAt=performance.now(),deadline=now()+Math.max(1,options.maxDurationSec-JOB_DEADLINE_MARGIN_SEC)*1000;
 let runId:string|null=null;
 try{runId=options.ledger?await options.ledger.start(options.name,options.trigger,options.maxDurationSec):null;}
 catch(error){logSweep('job_ledger',{job:options.name,step:'start'},startedAt,'error',error);}
 let result:JobResult;
 try{result=await work({runId,deadline,remainingMs:()=>deadline-now()});}
 catch(error){
  logSweep(options.name,null,startedAt,'error',error);
  result={outcome:'error',report:null,status:503,errorCode:jobErrorCode(error)};
 }
 if(runId&&options.ledger){
  try{await options.ledger.finish(runId,result.outcome,result.outcome==='error'||result.outcome==='partial'?result.errorCode??`${options.name}_failed`:null,jobCounts(result.report));}
  catch(error){logSweep('job_ledger',{job:options.name,step:'finish'},startedAt,'error',error);}
 }
 return {...result,runId};
}

/**
 * A GET route handler for a job: CRON_SECRET check, the ledger, the Axiom sweep log and a no-store JSON
 * response. The work returns its report and outcome; an exception becomes outcome 'error' with a 503.
 */
export function jobRoute(options:JobOptions,work:(ctx:JobContext)=>Promise<JobResult>){
 return withRouteLogging(async function GET(request:Request){
  if(!cronAuthorized(request)||(options.enabled&&!options.enabled()))return new Response(null,{status:404,headers:{'Cache-Control':'no-store'}});
  const started=performance.now();
  // Vercel Cron sends this user agent; the app's own trigger (lib/zoe/sweep-trigger.ts) does not.
  const trigger=(request.headers.get('user-agent')??'').startsWith('vercel-cron')?'cron':'request';
  const result=await runJob({...options,trigger,ledger:serviceJobLedger()},ctx=>work({...ctx,request}));
  if(result.outcome!=='error'||result.report!==null)logSweep(options.name,result.report,started,result.outcome==='partial'?'error':result.outcome);
  const body=result.outcome==='error'&&result.report===null?{error:options.failureCode??`${options.name}_failed`}:result.report;
  return Response.json(body,{status:result.status??(result.outcome==='error'?503:200),headers:{'Cache-Control':'no-store'}});
 },{actor:'system'});
}
