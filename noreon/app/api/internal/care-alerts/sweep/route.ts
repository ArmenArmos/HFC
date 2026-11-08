import {careAlertsEnabled} from '@/lib/care-alerts/contracts';
import {runCareAlertSweep} from '@/lib/care-alerts/server';
import {jobRoute} from '@/lib/jobs/contract';
import {outcomeFromFailures} from '@/lib/jobs/summary';
import {serviceRpc} from '@/lib/telegram-runtime/server';
export const runtime='nodejs';
export const maxDuration=60;
/** Escalation, retries and message screening run independently of Telegram. Notices stay queued for dispatch. */
export const GET=jobRoute({name:'care_alert_sweep',maxDurationSec:maxDuration,failureCode:'care_alert_sweep_failed'},async({deadline})=>{
 if(!careAlertsEnabled())return {outcome:'skipped',report:{state:'disabled'},status:200};
 const rpc=serviceRpc(deadline);
 if(!rpc)throw Error('care_alert_sweep_unconfigured');
 const report=await runCareAlertSweep(rpc,undefined,deadline);
 const outcome=outcomeFromFailures(report.failed,report.screened);
 return {outcome,report,errorCode:outcome==='ok'?null:'care_alert_items_failed'};
});
