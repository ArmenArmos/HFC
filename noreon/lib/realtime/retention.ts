import {z} from 'zod';

/**
 * WP R: realtime_signals retention. Signals are hints for a live socket, useless once delivered; anything older than
 * two days is deleted by realtime_signals_prune (service role) in batches until it says there is no more or the job's
 * deadline is near. Framework-free with an injected rpc, so it runs in checks without a database.
 */
export type PruneRpc=(name:'realtime_signals_prune',args:{p_limit:number})=>Promise<unknown>;
const pruneResult=z.strictObject({deleted:z.number().int().nonnegative(),more:z.boolean()});
export const PRUNE_BATCH=5000,PRUNE_MAX_BATCHES=20,PRUNE_RESERVE_MS=5_000;
export async function pruneRealtimeSignals(rpc:PruneRpc,deadline:number,now:()=>number=Date.now){
 let deleted=0,batches=0,more=true;
 while(more&&batches<PRUNE_MAX_BATCHES&&deadline-now()>PRUNE_RESERVE_MS){
  const parsed=pruneResult.safeParse(await rpc('realtime_signals_prune',{p_limit:PRUNE_BATCH}));
  if(!parsed.success)throw Error('realtime_signals_prune returned an unexpected shape');
  deleted+=parsed.data.deleted;batches++;more=parsed.data.more;
 }
 return {deleted,batches,more};
}
