import Link from 'next/link';
import {ArrowLeft,ArrowRight,ChevronDown,RefreshCw} from 'lucide-react';
const actionClass='inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-border bg-background px-4 py-2 text-body2 font-medium transition-colors hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';
import type {AdminMessageView} from '@/lib/messaging/admin-view';
const reasons={
 'submission-unknown':'Submission outcome is unknown',
 'submission-pending':'Submission is pending',
 'submission-rejected':'Submission was rejected',
 'delivery-conflict':'Conflicting delivery receipts',
 'delivery-failed':'Delivery failed',
 'reconciliation-failed':'Receipt lookup failed',
 'no-delivery-receipt':'No final delivery receipt',
 'delivery-overdue':'Delivery receipt is overdue',
};
const pauses={'provider-rejected':'Provider rejected a submission','provider-unknown':'Provider outcome is unknown','stale-submission':'A submission did not finish'};
const startedTime=(date:string)=>new Intl.DateTimeFormat('en',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZone:'Asia/Yerevan'}).format(new Date(date));
const money=(amount:number,currency:string|null)=>currency?`${(amount/1_000_000).toLocaleString('en',{maximumFractionDigits:6})} ${currency}`:'Not configured';
export function AdminMessageStatus({view}:{view:AdminMessageView}){
 const ready=view.state==='ready';
 return <div className="space-y-6">
  <header className="space-y-2"><h1 className="text-h1">Messages</h1><p className="max-w-3xl text-body2 text-muted-foreground">Check notification delivery issues and your messaging allowance.</p></header>
  <section className="space-y-3 rounded-xl border bg-background p-5" aria-labelledby="message-readiness">
   <h2 id="message-readiness" className="text-h3">{view.readiness.delivery&&view.readiness.recovery?'Notification delivery flags are enabled':'Notification delivery is inactive'}</h2>
   <p className="text-body2 text-muted-foreground">These switches apply to member notifications. Registration SMS codes and staff invitation or password recovery emails use separate settings. Sender setup and template approval must be confirmed with your provider.</p>
   <details className="group border-t pt-2"><summary className="flex min-h-11 cursor-pointer items-center justify-between gap-3 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring">Configuration details<ChevronDown className="size-4 transition-transform group-open:rotate-180" aria-hidden /></summary>
   <p className="mb-3 text-caption text-muted-foreground">These switches show server settings, not provider connectivity or delivery. This page does not change them.</p>
   <dl className="grid grid-cols-2 gap-x-5 gap-y-3 text-body2 lg:grid-cols-3">{([
    ['Operations',view.readiness.operations],['Sending',view.readiness.delivery],['Delivery recovery',view.readiness.recovery],['Delivery receipts',view.readiness.callbacks],['SMS',view.readiness.sms],['WhatsApp',view.readiness.whatsapp],
   ] as const).map(([label,on])=><div key={label} className="border-b pb-3"><dt className="text-caption text-muted-foreground">{label}</dt><dd className="mt-1 font-medium">{on?'Enabled':'Disabled'}</dd></div>)}</dl></details>
  </section>
  {!ready?<section role={view.state==='disabled'?'status':'alert'} className="space-y-2 rounded-xl border bg-background p-5"><h2 className="text-h3">{view.state==='disabled'?'Message operations are disabled':view.state==='invalid'?'This page cursor is invalid':'Message status is unavailable'}</h2><p className="text-body2 text-muted-foreground">{view.state==='disabled'?'Your queue and spending status are unavailable until operations access is configured.':view.state==='invalid'?'Return to the newest items to read the current queue.':'Your queue and spending status could not be read. This does not mean there are no attention items.'}</p><Link href="/staff/real/messages" className={actionClass}><RefreshCw className="size-4" aria-hidden />{view.state==='invalid'?'See newest items':'Refresh status'}</Link></section>:<>
   <div className="grid gap-4 lg:grid-cols-2">
    <section className="space-y-3 rounded-xl border bg-background p-5" aria-labelledby="dispatch-status"><h2 id="dispatch-status" className="text-h3">Dispatch status</h2>
     <p className="text-body2 font-medium">{view.status.control.paused_reason?`Delivery is paused: ${pauses[view.status.control.paused_reason]}`:'Dispatch is not paused'}</p>
     <p className="text-caption text-muted-foreground">Sending still depends on your channel settings and provider setup.</p>
     <dl className="space-y-2 text-body2"><div><dt className="text-caption text-muted-foreground">Attempts started for {view.status.control.budget_day} (UTC)</dt><dd>{view.status.control.started_count} of {view.status.control.daily_limit}</dd></div></dl>
    </section>
    <section className="space-y-3 rounded-xl border bg-background p-5" aria-labelledby="spending-status"><h2 id="spending-status" className="text-h3">Estimated reservations</h2>
     <p className="text-body2 font-medium">{!view.spending.policy.enabled?'Spending policy is disabled':!view.spending.policy.valid_until||Date.parse(view.spending.policy.valid_until)<=view.observedAt?'Spending policy has expired':'Spending policy is enabled'}</p>
     <dl className="space-y-2 text-body2"><div><dt className="text-caption text-muted-foreground">Reserved for {view.spending.budgetDay} (UTC)</dt><dd>{money(view.spending.reservedMicros,view.spending.policy.currency)}</dd></div><div><dt className="text-caption text-muted-foreground">Daily reservation limit</dt><dd>{money(view.spending.policy.daily_limit_micros,view.spending.policy.currency)}</dd></div><div><dt className="text-caption text-muted-foreground">Remaining allowance</dt><dd>{money(view.spending.remainingMicros,view.spending.policy.currency)}</dd></div></dl>
     <p className="text-caption text-muted-foreground">Conservative estimates, not actual provider billing. Failed and unknown attempts retain their reservations. No automatic refunds.</p>
    </section>
   </div>
   <section className="space-y-4 rounded-xl border bg-background p-5" aria-labelledby="attention-items"><div className="space-y-1"><h2 id="attention-items" className="text-h3">Delivery attention</h2><p className="text-caption text-muted-foreground">{view.status.attention.length} items on this page. Up to 50 unreviewed items per page; this is not the total queue count.</p></div>
    {!view.status.attention.length?<p className="text-body2">No messages need attention on this page.</p>:<ul className="divide-y">{view.status.attention.map(item=><li key={item.attempt_id} className="space-y-2 py-4 first:pt-0"><p className="text-body2 font-medium">{reasons[item.reason]}</p><details><summary className="cursor-pointer text-caption text-muted-foreground">Delivery reference</summary><p className="mt-2 break-all font-mono text-caption text-muted-foreground">{item.attempt_id}</p></details><p className="text-caption text-muted-foreground">Started {startedTime(item.started_at)} Yerevan time · Submission {item.submission_status} · Lookup failures {item.reconcile_failures}</p></li>)}</ul>}
    <div className="flex flex-wrap gap-x-6 gap-y-2"><Link href="/staff/real/messages" className={actionClass}><ArrowLeft className="size-4" aria-hidden />See newest items</Link>{view.status.nextCursor&&<Link href={`/staff/real/messages?${new URLSearchParams({before:view.status.nextCursor.startedAt,attempt:view.status.nextCursor.attemptId})}`} className={actionClass}>See older items<ArrowRight className="size-4" aria-hidden /></Link>}</div>
   </section>
  </>}
 </div>;
}
