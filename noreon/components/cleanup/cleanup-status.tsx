import Link from 'next/link';
import {ArrowLeft, ArrowDown, ChevronDown, RefreshCw} from 'lucide-react';
import {buttonVariants} from '@/components/ui/button';
import {cn} from '@/lib/utils';
import type {CleanupView} from '@/lib/cleanup/admin-view';
const navigationClass=cn(buttonVariants({variant:'outline',className:'min-h-11 min-w-11 gap-2 px-4'}));
export function CleanupStatus({view,embedded=false}:{view:CleanupView;embedded?:boolean}){
 const RunHeading=embedded?'h3':'h2';
 return <section className="space-y-5" aria-labelledby="cleanup-heading">
  <div>{embedded?<h2 id="cleanup-heading" className="text-h2">Data cleanup</h2>:<h1 id="cleanup-heading" className="text-h2">Operations</h1>}<p className="mt-2 text-body2 text-muted-foreground">Report cleanup execution records</p></div>
  <p className="text-body2 text-muted-foreground">Incomplete means no recorded completion. Missing executions may be unrecorded.</p>
  {view.state==='unavailable'?<div className="space-y-3 rounded-xl border p-5"><p role="status">Cleanup records are unavailable.</p><a href="/staff/real/operations" className={navigationClass}><RefreshCw aria-hidden="true" className="size-4"/>Refresh records</a></div>:view.state==='invalid'?<div className="space-y-3"><p role="status">This page link is invalid.</p><Link href="/staff/real/operations" className={navigationClass}><ArrowLeft aria-hidden="true" className="size-4"/>See latest runs</Link></div>:<>
   {view.runs.length===0?<p role="status" className="rounded-xl border p-5">{view.older?'No older recorded runs.':'No cleanup runs have been recorded. Scheduled execution is unconfirmed.'}</p>:<ul className="space-y-3">{view.runs.map(run=><li key={run.run_id} className="rounded-xl border bg-background p-5">
    <RunHeading className="text-body1 font-semibold">{run.status==='running'?'Incomplete: no recorded completion':run.status==='failed'?'Cleanup failed':'Cleanup succeeded'}</RunHeading>
    <dl className="mt-3 grid gap-2 text-body2 sm:grid-cols-2"><div><dt className="text-muted-foreground">Started (UTC)</dt><dd><time dateTime={run.started_at}>{new Date(run.started_at).toISOString().slice(0,19).replace("T"," ")}</time></dd></div><div><dt className="text-muted-foreground">Ended (UTC)</dt><dd>{run.ended_at?<time dateTime={run.ended_at}>{new Date(run.ended_at).toISOString().slice(0,19).replace('T',' ')}</time>:'Not recorded'}</dd></div><div><dt className="text-muted-foreground">Attempted / cleaned / failed</dt><dd>{run.status==='running'?'Not recorded':`${run.attempted} / ${run.cleaned} / ${run.failed}`}</dd></div><div><dt className="text-muted-foreground">Failure category</dt><dd>{run.status==='running'?'Not recorded':run.failure_category??'None recorded'}</dd></div></dl>
   </li>)}</ul>}
   {(view.runs.length===50||view.older)&&<nav aria-label="Cleanup run pages" className="flex flex-wrap gap-3">
   {view.runs.length===50&&<Link className={navigationClass} href={`/staff/real/operations?before=${encodeURIComponent(view.runs[49].started_at)}&run=${view.runs[49].run_id}`}><ArrowDown aria-hidden="true" className="size-4"/>See older runs</Link>}
   {view.older&&<Link className={navigationClass} href="/staff/real/operations"><ArrowLeft aria-hidden="true" className="size-4"/>See latest runs</Link>}
   </nav>}
  </>}
  <details className="group rounded-xl border bg-background p-4">
   <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-md text-body2 font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50">About these records<ChevronDown aria-hidden="true" className="size-4 shrink-0 transition-transform group-open:rotate-180"/></summary>
   <div className="mt-3 space-y-3 text-body2 text-muted-foreground">
    <p>Records belong to this environment. They do not confirm scheduled delivery or notification coverage. The function has a 60-second runtime limit; interruption or a recording failure can leave a run incomplete.</p>
    <p>Attempts include report, expired-case, and queued storage operations. Cleaned counts report and expired-case cleanup. Failures also include database query failures. Incomplete runs have no final counts.</p>
   </div>
  </details>
 </section>;
}
