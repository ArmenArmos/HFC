import {RUN_WORST_MS} from './pipeline';

export type ZoePassReport={claimed:number;finished:Record<string,number>;failed:number};

/**
 * Zoe passes inside a caller's deadline (Codex F2-01): one message claimed at a time, and only while a whole run
 * (RUN_WORST_MS) still fits before deadlineAt, an absolute time (ms since the epoch) the caller carries from its
 * request's start, so the work before the Zoe step counts. A message not claimed waits for the zoe/run cron; a
 * claimed run is never cut off mid-way, which would lose it for ten minutes (zoe_run_claim).
 */
export async function runZoePasses(pass:()=>Promise<ZoePassReport>,options:{limit:number;deadlineAt:number;now?:()=>number;runWorstMs?:number}):Promise<ZoePassReport&{stoppedForTime:boolean}>{
 const now=options.now??Date.now,worst=options.runWorstMs??RUN_WORST_MS;
 const report={claimed:0,finished:{} as Record<string,number>,failed:0,stoppedForTime:false};
 for(let i=0;i<options.limit;i++){
  if(now()+worst>options.deadlineAt){report.stoppedForTime=true;break;}
  const p=await pass();
  report.claimed+=p.claimed;report.failed+=p.failed;
  for(const [outcome,n] of Object.entries(p.finished))report.finished[outcome]=(report.finished[outcome]??0)+n;
  if(p.claimed===0)break;
 }
 return report;
}
