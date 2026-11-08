import {jobRoute} from '@/lib/jobs/contract';
import {labOutcome} from '@/lib/jobs/summary';
import {runConfiguredLabSweep} from '@/lib/lab-ai/server';
export const runtime='nodejs';
export const maxDuration=300;
/** Vercel Cron sweep: reads queued clinic lab PDFs (dark; see lib/lab-ai/server.ts). Job contract: lib/jobs/contract.ts. */
export const GET=jobRoute({name:'lab_ai',maxDurationSec:maxDuration,failureCode:'lab_sweep_failed'},async()=>{
 const report=await runConfiguredLabSweep();
 const unconfigured='state'in report&&report.state==='unconfigured';
 const outcome=labOutcome(report);
 return {outcome,report,status:unconfigured?503:200,errorCode:outcome==='ok'||outcome==='skipped'?null:'lab_read_failed'};
});
