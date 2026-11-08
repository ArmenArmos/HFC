import {z} from 'zod';
const ts=z.iso.datetime({offset:true});
const jobSchema=z.object({job:z.string(),last_started_at:ts,last_ok_at:ts.nullable(),last_error_at:ts.nullable(),runs_24h:z.number().int().nonnegative(),errors_24h:z.number().int().nonnegative(),lost_24h:z.number().int().nonnegative(),p95_ms_24h:z.number().int().nonnegative().nullable()}).strict();
const runSchema=z.object({id:z.uuid(),job:z.string(),trigger:z.enum(['cron','request']),started_at:ts,finished_at:ts.nullable(),status:z.enum(['ok','partial','skipped','error','lost','running']),error_code:z.string().nullable(),duration_ms:z.number().int().nonnegative().nullable(),counts:z.record(z.string(),z.unknown())}).strict();
export type JobHealth=z.infer<typeof jobSchema>;
export type JobRun=z.infer<typeof runSchema>;
export type JobsView={state:'ready';jobs:(JobHealth&{overdue:boolean})[];runs:JobRun[]}|{state:'unavailable'};

/** Jobs Noreon schedules, with the most time that may pass between runs before Operations flags it. */
export const JOB_SCHEDULE:Record<string,{label:string;everyMinutes:number|null}>={
 care_alert_sweep:{label:'Care alerts',everyMinutes:1},
 telegram_dispatch:{label:'Telegram sends',everyMinutes:5},
 zoe_run:{label:'Zoe replies',everyMinutes:5},
 lab_ai:{label:'Lab PDF reading',everyMinutes:5},
 report_cleanup:{label:'Report cleanup',everyMinutes:60},
 message_dispatch:{label:'SMS and email dispatch',everyMinutes:null},
};
export const jobLabel=(job:string)=>JOB_SCHEDULE[job]?.label??job;

/** Overdue: a scheduled job whose last start is more than two intervals old. */
export function jobOverdue(job:JobHealth,now:number):boolean{
 const every=JOB_SCHEDULE[job.job]?.everyMinutes;
 return !!every&&now-Date.parse(job.last_started_at)>2*every*60_000;
}

export async function readJobsView(deps:{read:()=>Promise<{data:unknown;error:unknown}>;now?:number}):Promise<JobsView>{
 try{
  const result=await deps.read();
  if(result.error)return {state:'unavailable'};
  const parsed=z.object({jobs:z.array(jobSchema).max(50),runs:z.array(runSchema).max(200)}).strict().parse(result.data);
  const now=deps.now??Date.now();
  // Scheduled jobs with no run in 30 days still appear, as overdue.
  const seen=new Set(parsed.jobs.map(j=>j.job));
  const missing=Object.entries(JOB_SCHEDULE).filter(([job,s])=>s.everyMinutes&&!seen.has(job)).map(([job])=>job);
  return {state:'ready',runs:parsed.runs,jobs:[
   ...parsed.jobs.map(j=>({...j,overdue:jobOverdue(j,now)})),
   ...missing.map(job=>({job,last_started_at:new Date(0).toISOString(),last_ok_at:null,last_error_at:null,runs_24h:0,errors_24h:0,lost_24h:0,p95_ms_24h:null,overdue:true})),
  ]};
 }catch{return {state:'unavailable'};}
}
