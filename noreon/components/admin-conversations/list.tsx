import Link from 'next/link';
import type {Route} from 'next';
import {ChevronRight,MessagesSquare} from 'lucide-react';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {adminConversationFilterLabel,adminConversationFilters,type AdminConversationFilter,type AdminConversationList} from '@/lib/admin-conversations/contracts';

/** Admin oversight list: who has a conversation and what needs attention. Never message text. */
export function AdminConversationListView({view,filter}:{view:AdminConversationList;filter:AdminConversationFilter|null}){
 const chip=(value:AdminConversationFilter|null,label:string)=>{const on=value===filter;return <Link key={label} href={(value?`/staff/real/conversations?filter=${value}`:'/staff/real/conversations') as Route}
  aria-current={on?'page':undefined} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${on?'border-primary bg-primary text-primary-foreground':'bg-background hover:bg-muted'}`}>{label}</Link>;};
 return <div className="mx-auto max-w-4xl space-y-6">
  <header className="space-y-2"><h1 className="text-h1">Conversations</h1>
   <p className="text-body2 text-muted-foreground">Every member conversation, newest activity first. Read-only: replies stay with the member’s assigned doctor. Each conversation you open is recorded in the activity log.</p></header>
  {!view.enabled?<CareSection title="Admin reading is off"><p className="text-body2">Reading member conversations as an admin is switched off for this environment.</p></CareSection>:<>
  <nav aria-label="Filter conversations" className="flex flex-wrap gap-2">{chip(null,'All')}{adminConversationFilters.map(f=>chip(f,adminConversationFilterLabel[f]))}</nav>
  {view.items.length===0?<p className="text-body2">{filter?'No conversation matches this filter.':'No member has a conversation yet.'}</p>:
  <ul className="divide-y rounded-xl border bg-background">{view.items.map(item=><li key={item.memberId}>
   <Link href={`/staff/real/conversations/${item.memberId}` as Route} className="flex min-h-16 items-center gap-3 px-4 py-3 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring">
    <MessagesSquare className="size-5 shrink-0 text-brand-teal" aria-hidden/>
    <span className="min-w-0 flex-1 space-y-1">
     <span className="block break-words text-body2 font-semibold">{item.memberName||'Member without a name'}</span>
     <span className="block text-caption text-muted-foreground">{item.lastActivityAt?`Last activity ${stamp(item.lastActivityAt,'en')}`:'No messages yet'}{item.channel?` · ${item.channel==='telegram'?'Telegram':'App'}`:''} · {item.doctorName?`Dr ${item.doctorName.replace(/^Dr\.?\s+/i,'')}`:'No assigned doctor'}</span>
    </span>
    <span className="flex flex-wrap justify-end gap-1.5">
     {item.urgentToday&&<Status tone="attention">Urgent today</Status>}
     {item.needsReply&&<Status tone="due">Needs reply</Status>}
     {item.intakeActive&&<Status>Zoe intake active</Status>}
    </span>
    <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden/>
   </Link></li>)}</ul>}
  {view.items.length>=200&&<p className="text-caption text-muted-foreground">Showing the 200 most recent.</p>}
  </>}
 </div>;
}
