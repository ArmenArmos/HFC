import {runLabCardSweep} from '@/lib/zoe-chat-actions/lab-sweep';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {jobRoute} from '@/lib/jobs/contract';
import {outcomeFromFailures} from '@/lib/jobs/summary';
import {runUnreadUrgentPass,runZoeSweep,zoePipelineEnabled,zoeServiceRpc} from '@/lib/zoe/server';
export const runtime='nodejs';
export const maxDuration=300;
/** Up to this many messages per pass, one claimed at a time. */
const PASS_LIMIT=5;
/**
 * A message is claimed only with this much time left. One run's worst case is about two minutes: up to
 * four model calls of 20 s each (primary, retry, fallback, schema retry), the reply judge, and its writes.
 * A claimed run that is killed is lost for ten minutes and then not retried (zoe_run_claim), so the budget
 * is generous rather than tight.
 */
const CLAIM_BUDGET_MS=150_000;
/**
 * Zoe passes: every five minutes on its own Vercel Cron, and right after a member writes in the app
 * (lib/zoe/sweep-trigger.ts) so the reply comes in seconds. Same claim either way: consent, one run per
 * newest message (a second caller claims nothing), the spend reservation. Messages are claimed one at a
 * time and only while the job's deadline leaves room for a whole run (quality review item 25).
 * This job sends nothing to Telegram: the webhook's own sweep runs Zoe and sends at once after a Telegram
 * update, and anything a cron pass queues goes out with the next Telegram dispatch (at most 5 minutes).
 * A send loop here would have no deadline of its own. CRON_SECRET only. Job contract: lib/jobs/contract.ts.
 */
export const GET=jobRoute({name:'zoe_run',maxDurationSec:maxDuration,failureCode:'zoe_run_failed'},async({remainingMs,request})=>{
 const rpc=zoePipelineEnabled()?zoeServiceRpc():null;
 if(!rpc)return {outcome:'skipped',report:{state:'disabled'}};
 // Scheduled card posting belongs to V3 cron passes only: a member's message must never wait on it.
 const labs=zoeAppV3Enabled()&&(request?.headers.get('user-agent')??'').startsWith('vercel-cron')?await runLabCardSweep():{posted:0,replayed:0,failed:0,stoppedForTime:false};
 const report={labs,claimed:0,finished:{} as Record<string,number>,failed:labs.failed,stoppedForTime:false};
 for(let i=0;i<PASS_LIMIT;i++){
  if(remainingMs()<CLAIM_BUDGET_MS){report.stoppedForTime=true;break;}
  const pass=await runZoeSweep(rpc,{limit:1});
  report.claimed+=pass.claimed;report.failed+=pass.failed;
  for(const [outcome,n] of Object.entries(pass.finished))report.finished[outcome]=(report.finished[outcome]??0)+n;
  if(pass.claimed===0)break;
 }
 // The fixed 103 text for members Zoe skipped. Quick and no model, so it needs no time budget; it goes out with the next dispatch.
 const unread=await runUnreadUrgentPass(rpc);
 report.failed+=unread.failed;
 if(unread.sent)report.finished.urgent_unread=unread.sent;
 const outcome=outcomeFromFailures(report.failed,Object.values(report.finished).reduce((n,x)=>n+x,0));
 return {outcome,report,errorCode:outcome==='ok'?null:'zoe_job_failed'};
});
