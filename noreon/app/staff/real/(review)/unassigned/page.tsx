import Link from 'next/link';
import type {Route} from 'next';
import {notFound,unstable_rethrow} from 'next/navigation';
import {z} from 'zod';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {CareSection,Status,stamp} from '@/components/patient-care/common';
import {telegramEnabled} from '@/lib/telegram-runtime/config';
export const dynamic='force-dynamic';

const items=z.object({ok:z.literal(true),items:z.array(z.object({memberId:z.uuid(),memberName:z.string(),lastMessageAt:z.string().nullable(),messages:z.number().int(),channel:z.enum(['telegram','app'])}))});

/** Admin only: members who have written but have no doctor yet (lead decision, 17 Oct). No message text. */
export default async function UnassignedConversationsPage(){
 if(!telegramEnabled())notFound();
 const {client}=await requireRealAdmin();
 let list:z.infer<typeof items>['items'];
 try{const {data,error}=await client.rpc('conversation_unassigned_members');if(error)throw Error('unavailable');list=items.parse(data).items;}
 catch(error){unstable_rethrow(error);return <CareSection title="Unassigned conversations unavailable"><p className="text-body2">The list could not be loaded. Reload to try again.</p></CareSection>;}
 return <div className="space-y-6">
  <header className="max-w-3xl space-y-2"><h1 className="text-h1">Unassigned conversations</h1>
   <p className="text-body2 text-muted-foreground">Members who have written to their care team but have no doctor yet. Assign a doctor on the member’s page so their messages reach someone.</p></header>
  {!list.length&&<CareSection title="Nothing waiting"><p className="text-body2">Every member who has written has a doctor.</p></CareSection>}
  {list.length>0&&<CareSection title="Waiting for a doctor"><ul className="divide-y">{list.map(m=><li key={m.memberId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
   <div className="min-w-0 space-y-1"><Link href={`/staff/real/members/${m.memberId}` as Route} className="text-body2 font-semibold underline underline-offset-4">{m.memberName||'Member without a name'}</Link>
    <p className="text-caption text-muted-foreground">{m.lastMessageAt?`Last message ${stamp(m.lastMessageAt,'en')} · `:''}{m.messages} {m.messages===1?'message':'messages'}</p></div>
   <Status tone="attention">{m.channel==='telegram'?'Telegram':'In the app'}</Status></li>)}</ul></CareSection>}
 </div>;
}
