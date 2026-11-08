import Link from 'next/link';
import type {Route} from 'next';
import {notFound,unstable_rethrow} from 'next/navigation';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {traceMembersSchema,traceViewEnabled} from '@/lib/conversation-trace/contracts';
export const dynamic='force-dynamic';

/** Admin only: conversations with decision-journal events in the last 30 days. No message text. */
export default async function TraceIndexPage(){
 if(!traceViewEnabled())notFound();
 const {client}=await requireRealAdmin();
 let members:ReturnType<typeof traceMembersSchema.parse>['members'];
 try{const {data,error}=await client.rpc('conversation_trace_members',{p_limit:100});if(error)throw Error('unavailable');members=traceMembersSchema.parse(data).members;}
 catch(error){unstable_rethrow(error);return <CareSection title="Trace unavailable"><p className="text-body2">The list could not be loaded. Reload to try again.</p></CareSection>;}
 return <div className="space-y-6">
  <header className="max-w-3xl space-y-2"><h1 className="text-h1">Trace</h1>
   <p className="text-body2 text-muted-foreground">Every decision in a member conversation: what arrived, which rule or guard checked it, whether an acknowledgement went out, who approved a reply and what Telegram answered. Message text is never shown here.</p></header>
  {!members.length&&<CareSection title="No traced conversations"><p className="text-body2">Nothing was recorded in the last 30 days.</p></CareSection>}
  {members.length>0&&<CareSection title="Conversations, last 30 days"><ul className="divide-y">{members.map(m=><li key={m.memberId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
   <div className="min-w-0 space-y-1"><Link href={`/staff/real/trace/${m.memberId}` as Route} className="text-body2 font-semibold underline underline-offset-4">{m.memberName||'Member without a name'}</Link>
    <p className="text-caption text-muted-foreground">Last event {stamp(m.lastAt,'en')} · {m.events} {m.events===1?'event':'events'}</p></div>
   {m.blocked>0&&<Status tone="attention">{m.blocked} blocked, held or failed</Status>}</li>)}</ul></CareSection>}
 </div>;
}
