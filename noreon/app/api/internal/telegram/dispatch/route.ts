import {runMemberPushSweep} from '@/lib/member-push/server';
import {runV3PlanJobs} from '@/lib/zoe-chat-actions/plan-jobs';
import {serviceRpc} from '@/lib/zoe-chat-actions/server';
import {zoeAppV3Enabled} from '@/lib/patient/zoe-app-v3';
import {pushFits} from '@/lib/member-push/sweep';
import {logSweep} from '@/lib/observability/with-logging';
import {jobRoute} from '@/lib/jobs/contract';
import {telegramOutcome} from '@/lib/jobs/summary';
import {telegramEnabled} from '@/lib/telegram-runtime/config';
import {runConfiguredAuthCleanup,runConfiguredLdlResponseSweep,runConfiguredProgrammeRun,runConfiguredTelegramSweep} from '@/lib/telegram-runtime/server';
export const runtime='nodejs';
export const maxDuration=60;
/**
 * Vercel Cron sweep: session cleanup, programme checkpoints, the LDL response loop, inbox processing, stale reconciliation and
 * queued sends. Zoe runs on its own cron (/api/internal/zoe/run), so a model call never eats this budget.
 * Job contract: lib/jobs/contract.ts.
 */
export const GET=jobRoute({name:'telegram_dispatch',maxDurationSec:maxDuration,failureCode:'telegram_sweep_failed'},async({remainingMs,deadline})=>{
 const started=performance.now();
 // V3 reminders are app cards. They do not depend on Telegram being enabled.
 if(zoeAppV3Enabled()){
  const plan=await runV3PlanJobs(serviceRpc()).catch(()=>({failed:1}));
  logSweep('zoe_v3_plan',plan,started,plan.failed?'error':'ok');
 }
 const cleaned=await runConfiguredAuthCleanup().catch(()=>null);
 logSweep('auth_cleanup',cleaned,started,cleaned?'ok':'skipped');
 const programmeStarted=performance.now();
 const programme=await runConfiguredProgrammeRun().catch(()=>null);
 logSweep('programme_run',programme,programmeStarted,programme?'ok':'skipped');
 const ldlStarted=performance.now();
 const ldl=await runConfiguredLdlResponseSweep().catch(()=>null);
 logSweep('ldl_response',ldl,ldlStarted,ldl?'ok':'skipped');
 // After the sends, so a reminder this run queued can alert on the phone in the same run.
 if(!telegramEnabled()){if(pushFits(remainingMs()))await runMemberPushSweep().catch(()=>null);return {outcome:'skipped',report:{state:'disabled',cleaned,programme,ldl},status:200};}
 const report=await runConfiguredTelegramSweep({withZoe:false,deadlineAt:deadline});
 if(pushFits(remainingMs()))await runMemberPushSweep().catch(()=>null);
 if(!report)return {outcome:'skipped',report:{state:'unconfigured',cleaned,programme,ldl},status:503};
 const outcome=telegramOutcome(report);
 return {outcome,report:{...report,cleaned,programme,ldl},errorCode:outcome==='ok'?null:'telegram_items_failed'};
});
