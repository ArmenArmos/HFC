import Link from 'next/link';
import type {Route} from 'next';
import {notFound,unstable_rethrow} from 'next/navigation';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {deliveryProblemsSchema,type DeliveryProblems} from '@/lib/conversation-persistence/contracts';
import {telegramEnabled} from '@/lib/telegram-runtime/config';
import {staffLocale} from '@/lib/staff/staff-locale';
import {deliveryDetailText,deliveryLabelText,deliveryDetail,deliveryLabel} from '@/lib/telegram-runtime/delivery-copy';
export const dynamic='force-dynamic';

const templateName:Record<string,string>={'telegram.ack':'Automatic acknowledgement','telegram.link_confirmed':'Telegram connected confirmation','telegram.unsupported_media':'Text-only reply to a non-text message'};
type History=DeliveryProblems['system'][number]['history'];
const historyLabel=(kind:string,detail:Record<string,unknown>)=>{
 if(kind==='delivery.held')return deliveryDetailText('held',typeof detail.reason==='string'?detail.reason:null);
 if(detail.outcomeKind==='accepted')return deliveryLabelText('accepted_by_provider');
 if(detail.outcomeKind==='definitely_failed')return deliveryLabelText('definitely_failed');
 if(detail.outcomeKind==='unknown')return deliveryLabelText('unknown');
 return ({'delivery.retry_requested':'Retry requested','delivery.claimed':'Sent','delivery.queued':'Sent'} as Record<string,string>)[kind]??'Delivery updated';
};
function HistoryList({history}:{history:History}){
 if(!history?.length)return null;
 return <details className="text-body2"><summary className="min-h-11 cursor-pointer py-2 text-caption font-medium">History</summary><ol className="space-y-1 border-l-2 pl-4">{history.map((h,i)=><li key={i} className="text-caption text-muted-foreground">{stamp(h.at,'en')} · {historyLabel(h.kind,h.detail)}</li>)}</ol></details>;
}

/** Operational oversight. Only an authorized doctor can retry from the conversation. */
export default async function DeliveryProblemsPage(){
 const {client}=await requireRealAdmin();
 const locale=await staffLocale('admin');
 if(!telegramEnabled())notFound();
 let view:DeliveryProblems;
 try{const {data,error}=await client.rpc('telegram_delivery_problems');if(error)throw Error('unavailable');view=deliveryProblemsSchema.parse(data);}
 catch(error){unstable_rethrow(error);return <CareSection title="Delivery problems unavailable"><p className="text-body2">The list could not be loaded. Reload to try again.</p></CareSection>;}
 const empty=!view.system.length&&!view.replies.length&&!view.unapprovedHeld;
 return <div className="space-y-6">
  <header className="max-w-3xl space-y-2"><h1 className="text-h1">Telegram delivery problems</h1>
   <p className="text-body2 text-muted-foreground">Messages from the last 30 days that were not sent, are held, or whose delivery we can’t confirm. Nothing here is resent automatically. Open a doctor reply to review its reason and any safe retry. For an unconfirmed delivery, contact the member another way. Replies held only because the member wrote again are left to the doctor.</p>
   <p className="text-caption text-muted-foreground">As of {stamp(view.asOf,'en')} · {view.inbox.pending} incoming waiting · {view.inbox.dead} incoming could not be processed</p></header>
  {view.unapprovedHeld>0&&<p role="status" className="rounded-xl border bg-muted/40 p-4 text-body2">{view.unapprovedHeld===1?'1 automatic message is':`${view.unapprovedHeld} automatic messages are`} held because its wording is not approved yet. Nothing was sent.</p>}
  {empty&&<CareSection title="No delivery problems"><p className="text-body2">No Telegram message in the last 30 days needs attention.</p></CareSection>}
  {view.replies.length>0&&<CareSection title="Doctor replies"><ul className="divide-y">{view.replies.map(r=><li key={r.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
   <div className="flex flex-wrap items-center gap-2"><Link href={`/staff/real/conversations/${r.memberId}` as Route} className="text-body2 font-semibold underline underline-offset-4">{r.memberName||'Member'}</Link><Status tone={deliveryLabel[r.state].tone}>{deliveryLabelText(r.state,locale)}</Status></div>
   <p className="text-body2">{deliveryDetailText(r.state,r.reason,locale)}</p>
   <p className="text-caption text-muted-foreground">Approved by {r.doctorName} · {stamp(r.approvedAt,'en')}</p>
   <HistoryList history={r.history}/></li>)}</ul></CareSection>}
  {view.system.length>0&&<CareSection title="Automatic messages"><ul className="divide-y">{view.system.map(m=><li key={m.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
   <div className="flex flex-wrap items-center gap-2"><Link href={`/staff/real/members/${m.memberId}` as Route} className="text-body2 font-semibold underline underline-offset-4">{m.memberName||'Member'}</Link><Status tone={deliveryLabel[m.state].tone}>{deliveryLabel[m.state].label}</Status></div>
   <p className="text-body2">{templateName[m.template]??m.template}. {m.template==='telegram.ack'&&m.state!=='held'?(m.state==='unknown'?'We can’t confirm the acknowledgement with the Call 103 line arrived. Contact the member another way if their message may be urgent.':'The acknowledgement with the Call 103 line did not reach the member. Contact the member another way if their message may be urgent.'):deliveryDetail(m.state,m.reason)}</p>
   <p className="text-caption text-muted-foreground">Queued {stamp(m.createdAt,'en')} · updated {stamp(m.updatedAt,'en')}</p>
   <HistoryList history={m.history}/></li>)}</ul></CareSection>}
 </div>;
}
