import type {Locale} from '@/lib/locale';
import Link from 'next/link';
import {staffDisplayText,staffCodeLabel} from '@/lib/staff/display-text';
import type {Route} from 'next';
import {Bot,Eye,Stethoscope,UserRound} from 'lucide-react';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {ZoeRuns} from '@/components/conversation/zoe-runs';
import {SymptomSummaries} from '@/components/conversation/symptom-summaries';
import {adminThread,deliveryStateLabel,draftStateLabel,zoeAnswerKindLabel,type AdminConversation,type ThreadItem} from '@/lib/admin-conversations/contracts';
import {actorText,outcomeLabel,traceReason,traceTitle} from '@/lib/conversation-trace/contracts';

const bubble={member:'border-border bg-background',zoe:'border-primary/30 bg-surface-subtle-teal',doctor:'border-primary/40 bg-card'};
function Item({item,locale}:{item:ThreadItem;locale:Locale}){
 const Icon=item.kind==='member'?UserRound:item.kind==='zoe'?Bot:Stethoscope;
 const who=item.kind==='member'?`Member · ${item.channel==='telegram'?'Telegram':'App'} · message ${item.seq}`:item.kind==='zoe'?`${zoeAnswerKindLabel(item.answerKind)} · to message ${item.messageSeq}`:`Doctor reply · ${item.doctorName}`;
 const state=item.kind==='zoe'?(item.heldReason?<Status tone="attention">{`Held: ${item.heldReason.replace(/_/g,' ')}`}</Status>:item.telegramState?<Status>{`Telegram: ${deliveryStateLabel(item.telegramState)}`}</Status>:null)
  :item.kind==='doctor'?<Status tone={item.deliveryState==='definitely_failed'||item.deliveryState==='unknown'||item.deliveryState==='held'?'attention':'neutral'}>{deliveryStateLabel(item.deliveryState)}{item.deliveryReason?` (${item.deliveryReason.replace(/_/g,' ')})`:''}</Status>:null;
 return <li className={`space-y-2 rounded-xl border p-4 ${bubble[item.kind]} ${item.kind==='member'?'mr-8':'ml-8'}`}>
  <p className="flex flex-wrap items-center gap-2 text-caption font-medium text-muted-foreground"><Icon className="size-4 shrink-0" aria-hidden/><span>{who}</span><span>· {stamp(item.at,locale)}</span>{state}</p>
  <p className="whitespace-pre-wrap text-body2 [overflow-wrap:anywhere]">{item.text}</p>
 </li>;
}

/** Read-only admin view of one member's conversation. No send, approve, edit or claim controls exist here. */
export function AdminConversationView({view,locale='en'}:{view:AdminConversation;locale?:Locale}){
 const thread=adminThread(view);
 return <div className="mx-auto max-w-4xl space-y-6">
  <div role="note" className="flex items-start gap-3 rounded-xl border-2 border-[var(--status-warning-accent)] bg-[var(--status-warning-bg)] p-4">
   <Eye className="mt-0.5 size-5 shrink-0" aria-hidden/>
   <p className="text-body2"><span className="font-semibold">Read-only (admin).</span> You can read this conversation but not reply, approve or edit. Replies stay with the assigned doctor. This open is recorded in the activity log.</p>
  </div>
  <header className="space-y-2">
   <Link href={'/staff/real/conversations' as Route} className="inline-flex min-h-11 items-center text-body2 underline underline-offset-4">All conversations</Link>
   <h1 className="text-h1">{view.memberName||'Member without a name'}</h1>
   <p className="text-body2 text-muted-foreground">{view.doctorName?`Assigned doctor: ${view.doctorName}`:'No assigned doctor'} · <Link href={`/staff/real/members/${view.memberId}` as Route} className="underline underline-offset-4">Member page</Link></p>
   <p className="text-caption text-muted-foreground">As of {stamp(view.asOf,locale)}</p>
  </header>
  <CareSection title="Conversation" detail="Member messages from the app and Telegram, Zoe’s answers and the doctor’s approved replies, oldest first.">
   {view.window.olderBefore&&<p><Link href={`/staff/real/conversations/${view.memberId}?before=${encodeURIComponent(view.window.olderBefore)}` as Route} className="inline-flex min-h-11 items-center text-body2 font-semibold underline underline-offset-4">Show older messages</Link></p>}
   {view.window.from&&<p className="text-caption text-muted-foreground">Showing from {stamp(view.window.from,locale)}{view.window.before?` to ${stamp(view.window.before,locale)}`:''}. Drafts below are for the same period.</p>}
   {thread.length===0?<p className="text-body2">{view.window.before?'No messages in this period.':'No messages yet.'}</p>:<ol className="space-y-3">{thread.map(item=><Item key={item.key} item={item} locale={locale}/>)}</ol>}
   {view.window.before&&<p><Link href={`/staff/real/conversations/${view.memberId}` as Route} className="inline-flex min-h-11 items-center text-body2 font-semibold underline underline-offset-4">Back to the newest messages</Link></p>}
  </CareSection>
  <SymptomSummaries intakes={view.intakes} locale={locale}/>
  {view.intakesTotal>view.intakes.length&&<p className="text-caption text-muted-foreground">Showing the latest {view.intakes.length} of {view.intakesTotal} symptom summaries.</p>}
  <CareSection title="Drafts" detail="Reply drafts for the doctor, from Zoe or the doctor, and what happened to each.">
   {view.drafts.length===0?<p className="text-body2">No drafts.</p>:<ol className="space-y-4">{view.drafts.map(d=><li key={d.id} className="space-y-2 border-l-2 border-primary/20 pl-4">
    <p className="flex flex-wrap items-center gap-2"><span className="text-body2 font-semibold">{d.latest?.authorKind==='ai_assistant'?'Zoe draft':`Draft by ${d.latest?.authorName??'staff'}`}</span><Status tone={d.state==='pending'?'due':d.state==='approved'?'complete':'neutral'}>{draftStateLabel[d.state]}</Status></p>
    {d.latest&&<p className="whitespace-pre-wrap text-body2 [overflow-wrap:anywhere]">{d.latest.text}</p>}
    {d.latest&&<details className="text-body2"><summary className="min-h-11 cursor-pointer py-2 text-caption font-medium">Summary for the doctor</summary><p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{d.latest.summary}</p></details>}
    <p className="text-caption text-muted-foreground">Created {stamp(d.createdAt,locale)}{d.revisions>1?` · ${d.revisions} revisions`:''}</p>
   </li>)}</ol>}
  </CareSection>
  <ZoeRuns runs={view.zoeRuns} audience="admin" locale={locale}/>
  {view.zoeRunsTotal>view.zoeRuns.length&&<p className="text-caption text-muted-foreground">Showing the latest {view.zoeRuns.length} of {view.zoeRunsTotal} Zoe runs. Each answer and draft is in the conversation above.</p>}
  <CareSection title="Decision trace" detail="Each decision with the rule or guard that made it, oldest first.">
   {view.trace.length===0?<p className="text-body2">No traced events.</p>:<details><summary className="min-h-11 cursor-pointer py-2 text-body2 font-medium">Show {view.trace.length} {view.trace.length===1?'event':'events'}{view.traceTotal>view.trace.length?` (latest of ${view.traceTotal})`:''}</summary>
    {view.traceTotal>view.trace.length&&<p className="text-caption text-muted-foreground">The Trace page in the backoffice shows the earlier events.</p>}
    <ol className="mt-2 space-y-0 border-l-2 pl-4">{view.trace.map(e=><li key={e.id} className="space-y-1 py-2">
     <p className="flex flex-wrap items-center gap-2"><span className="text-body2 font-semibold">{staffDisplayText(traceTitle(e),locale)}</span><Status tone={outcomeLabel[e.outcome].tone}>{outcomeLabel[e.outcome].label}</Status></p>
     {traceReason(e)&&<p className="text-body2">Because {staffDisplayText(traceReason(e)??'',locale)}.</p>}
     <p className="text-caption text-muted-foreground">{stamp(e.at,locale)} · {actorText(e)}{e.rule?` · ${staffCodeLabel(e.rule,locale)}`:''}</p>
    </li>)}</ol></details>}
  </CareSection>
 </div>;
}
