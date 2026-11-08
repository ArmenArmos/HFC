import {RefreshCw} from 'lucide-react';
import {buttonVariants} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import {jobLabel,type JobsView} from '@/lib/jobs/admin-view';
const utc=(iso:string)=>new Date(iso).toISOString().slice(0,19).replace('T',' ');
const STATUS:Record<string,string>={ok:'Done',skipped:'Skipped (switched off)',partial:'Partly failed',error:'Failed',lost:'Lost: no finish before the time limit',running:'Running'};
const seconds=(ms:number|null)=>ms===null?'Not recorded':`${(ms/1000).toFixed(1)} s`;
export function JobStatus({view}:{view:JobsView}){
 return <section className="space-y-5" aria-labelledby="jobs-heading">
  <div><h2 id="jobs-heading" className="text-h2">Background jobs</h2><p className="mt-2 text-body2 text-muted-foreground">Every scheduled or triggered job records each run here. Times are UTC. Records are kept for 30 days.</p><p className="mt-1 text-body2 text-muted-foreground">Done for Telegram sends means every message was processed and its result recorded. Messages Telegram refused are listed under <a href="/staff/real/delivery-problems" className="underline underline-offset-4">Delivery problems</a>.</p></div>
  {view.state==='unavailable'?<div className="space-y-3 rounded-xl border p-5"><p role="status">Job records are unavailable.</p><a href="/staff/real/operations" className={cn(buttonVariants({variant:'outline',className:'min-h-11 gap-2 px-4'}))}><RefreshCw aria-hidden="true" className="size-4"/>Refresh records</a></div>:<>
   <ul className="grid gap-3 sm:grid-cols-2">{view.jobs.map(j=><li key={j.job} className={cn('rounded-xl border bg-background p-5',(j.overdue||j.errors_24h||j.lost_24h)&&'border-destructive')}>
    <h3 className="text-body1 font-semibold">{jobLabel(j.job)}</h3>
    {j.overdue&&<p className="mt-1 text-body2 text-destructive">{j.runs_24h||j.last_ok_at?'No run recently: the schedule may have stopped.':'No run recorded in 30 days.'}</p>}
    <dl className="mt-3 grid grid-cols-2 gap-2 text-body2">
     <div><dt className="text-muted-foreground">Last run</dt><dd>{j.runs_24h||j.last_ok_at||j.last_error_at?utc(j.last_started_at):'None'}</dd></div>
     <div><dt className="text-muted-foreground">Last success</dt><dd>{j.last_ok_at?utc(j.last_ok_at):'None'}</dd></div>
     <div><dt className="text-muted-foreground">Runs / failed / lost (24 h)</dt><dd>{j.runs_24h} / {j.errors_24h} / {j.lost_24h}</dd></div>
     <div><dt className="text-muted-foreground">95% of runs within (24 h)</dt><dd>{seconds(j.p95_ms_24h)}</dd></div>
    </dl>
   </li>)}</ul>
   <h3 className="text-body1 font-semibold">Latest runs</h3>
   {view.runs.length===0?<p role="status" className="rounded-xl border p-5">No job runs have been recorded yet.</p>:<div className="overflow-x-auto rounded-xl border"><table className="w-full text-left text-body2">
    <thead className="text-muted-foreground"><tr><th scope="col" className="p-3 font-medium">Job</th><th scope="col" className="p-3 font-medium">Started</th><th scope="col" className="p-3 font-medium">Result</th><th scope="col" className="p-3 font-medium">Took</th><th scope="col" className="p-3 font-medium">Started by</th></tr></thead>
    <tbody>{view.runs.map(r=><tr key={r.id} className="border-t">
     <td className="p-3">{jobLabel(r.job)}</td><td className="p-3"><time dateTime={r.started_at}>{utc(r.started_at)}</time></td>
     <td className={cn('p-3',['error','lost','partial'].includes(r.status)&&'text-destructive')}>{STATUS[r.status]}{r.error_code?` (${r.error_code})`:''}</td>
     <td className="p-3">{seconds(r.duration_ms)}</td><td className="p-3">{r.trigger==='cron'?'Schedule':'App'}</td>
    </tr>)}</tbody></table></div>}
  </>}
 </section>;
}
