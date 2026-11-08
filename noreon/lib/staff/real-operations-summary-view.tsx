import type {RealOperationsSummaryView} from './real-operations-summary-model';
export function RealOperationsSummaryStatus({view}:{view:RealOperationsSummaryView}) {
  return <section aria-labelledby="native-operations-heading" className="space-y-4">
    <div><h2 id="native-operations-heading" className="text-h2">Current operational records</h2>
      <p className="mt-2 text-body2 text-muted-foreground">All native member cases, test requests and coordination tasks in this environment, across all dates. Demo workspace records are excluded.</p></div>
    {view.status==='unavailable'?<div className="space-y-2 rounded-xl border p-5"><p role="status">Native operations counts are unavailable.</p><a className="inline-flex min-h-11 items-center underline" href="/staff/real/operations">Refresh counts</a></div>:<>
      <p className="text-caption text-muted-foreground">Snapshot (UTC): <time dateTime={view.summary.asOf}>{new Date(view.summary.asOf).toISOString().slice(0,19).replace('T',' ')}</time>. Refresh this page for current counts.</p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Counts title="Member cases" rows={[
          ['Total cases',view.summary.cases.total],
          ['Doctor assigned',view.summary.cases.doctorAssigned],['Doctor unassigned',view.summary.cases.doctorUnassigned],
          ['Nurse assigned',view.summary.cases.nurseAssigned],['Nurse unassigned',view.summary.cases.nurseUnassigned],
        ]}/>
        <Counts title="Test requests" rows={[
          ['Total requests',view.summary.bookings.total],['Requested',view.summary.bookings.requested],
          ['Provider proposed',view.summary.bookings.providerProposed],['Confirmed',view.summary.bookings.confirmed],
          ['Change pending',view.summary.bookings.changePending],['Cancelled',view.summary.bookings.cancelled],
        ]}/>
        <Counts title="Coordination tasks" rows={[
          ['Total tasks',view.summary.coordination.total],['Open',view.summary.coordination.open],
          ['Awaiting member',view.summary.coordination.awaitingMember],['Awaiting doctor',view.summary.coordination.awaitingDoctor],
          ['Completed',view.summary.coordination.completed],['Cancelled',view.summary.coordination.cancelled],
          ['Need reassignment',view.summary.coordination.needsReassignment],
        ]}/>
      </div>
      <p className="text-body2 text-muted-foreground">Assignment counts reflect recorded doctor and nurse assignments. Each pair adds up to total cases. Need reassignment is a subset of unfinished tasks whose recorded owner is no longer eligible. Totals include cancelled test requests and completed or cancelled tasks. These are recorded request states, not confirmation of an external service.</p>
    </>}
  </section>;
}
function Counts({title,rows}:{title:string;rows:[string,number][]}) {
  return <section className="min-w-0 rounded-xl border bg-background p-5"><h3 className="text-body1 font-semibold">{title}</h3>
    <dl className="mt-3 space-y-2 text-body2">{rows.map(([label,value])=><div key={label} className="flex items-start justify-between gap-4"><dt className="text-muted-foreground">{label}</dt><dd className="shrink-0 font-semibold tabular-nums">{value.toLocaleString('en-GB')}</dd></div>)}</dl>
  </section>;
}
