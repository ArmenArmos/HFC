import {jobRoute} from '@/lib/jobs/contract';
import {pruneRealtimeSignals} from '@/lib/realtime/retention';
import {serviceRpc} from '@/lib/telegram-runtime/server';
export const runtime='nodejs';
export const maxDuration=60;
/**
 * WP R: deletes realtime signals older than two days (ids and kinds only; realtime_signals_prune, service role).
 * Vercel Cron, CRON_SECRET only; job contract: lib/jobs/contract.ts. Runs whether or not NOREON_REALTIME is on, since the
 * database writes signals either way.
 */
export const GET=jobRoute({name:'realtime_signals_prune',maxDurationSec:maxDuration,failureCode:'realtime_signals_prune_failed'},async({deadline})=>{
 const rpc=serviceRpc(deadline);
 if(!rpc)throw Error('realtime_signals_prune_unconfigured');
 const report=await pruneRealtimeSignals((name,args)=>rpc(name,args),deadline);
 return {outcome:report.more?'partial':'ok',report,errorCode:report.more?'realtime_signals_backlog':null};
});
