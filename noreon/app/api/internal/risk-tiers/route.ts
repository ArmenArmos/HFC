import {jobRoute} from '@/lib/jobs/contract';
import {outcomeFromFailures} from '@/lib/jobs/summary';
import {riskTiersEnabled} from '@/lib/clinical-review/config';
import {runRiskTierJob} from '@/lib/clinical-review/jobs';
import {serviceRpc} from '@/lib/telegram-runtime/server';
export const runtime='nodejs';
export const maxDuration=120;
/**
 * Recomputes every member's risk tier (lib/clinical/rules/risk-tier.ts, RISK_TIER_VERSION) in pages and records it with
 * member_risk_tier_record (service role). Vercel Cron, CRON_SECRET only; job contract: lib/jobs/contract.ts.
 */
export const GET=jobRoute({name:'risk_tiers',maxDurationSec:maxDuration,failureCode:'risk_tiers_failed'},async({deadline})=>{
 if(!riskTiersEnabled())return {outcome:'skipped',report:{state:'disabled'},status:200};
 const rpc=serviceRpc(deadline);
 if(!rpc)throw Error('risk_tiers_unconfigured');
 const report=await runRiskTierJob((name,args)=>rpc(name,args),{deadline});
 const outcome=outcomeFromFailures(report.failed,report.members);
 return {outcome,report,errorCode:outcome==='ok'?null:'risk_tiers_items_failed'};
});
