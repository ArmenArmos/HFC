import {jobRoute} from '@/lib/jobs/contract';
import {outcomeFromFailures} from '@/lib/jobs/summary';
import {clinicalAnomaliesEnabled} from '@/lib/clinical-review/config';
import {runClinicalAnomalySweep} from '@/lib/clinical-review/jobs';
import {serviceRpc} from '@/lib/telegram-runtime/server';
export const runtime='nodejs';
export const maxDuration=120;
/**
 * BP and LDL trend sweep (lib/clinical/rules/bp-anomaly.ts, lab-trend.ts): raises yellow or orange care-queue tasks for the
 * nurse or physician queue through care_queue_raise, one per member, rule and window. Never a care alert. Vercel Cron,
 * CRON_SECRET only; job contract: lib/jobs/contract.ts. Raising also needs NOREON_ZOE_APP_V3.
 */
export const GET=jobRoute({name:'clinical_anomalies',maxDurationSec:maxDuration,failureCode:'clinical_anomalies_failed'},async({deadline})=>{
 if(!clinicalAnomaliesEnabled())return {outcome:'skipped',report:{state:'disabled'},status:200};
 const rpc=serviceRpc(deadline);
 if(!rpc)throw Error('clinical_anomalies_unconfigured');
 const report=await runClinicalAnomalySweep((name,args)=>rpc(name,args),{deadline});
 const outcome=outcomeFromFailures(report.failed,report.members);
 return {outcome,report,errorCode:outcome==='ok'?null:'clinical_anomalies_items_failed'};
});
