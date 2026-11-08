import {Suspense} from 'react';
import {redirect} from 'next/navigation';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {getAdminMessageView} from '@/lib/messaging/admin-repository';
import {messageOperationsPageEnabled} from '@/lib/messaging/operations-page';
import {telegramEnabled} from '@/lib/telegram-runtime/config';
import {AdminMessageStatus} from '@/components/messaging/admin-message-status';
export const dynamic='force-dynamic';
async function MessageStatus({query}:{query:Record<string,string|string[]|undefined>}){
 return <AdminMessageStatus view={await getAdminMessageView(query)}/>;
}
export default async function MessagesPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requireRealAdmin();
 // Legacy SMS/WhatsApp page; Noreon is Telegram-only, so send admins to Telegram delivery problems.
 if(!messageOperationsPageEnabled())redirect(telegramEnabled()?'/staff/real/delivery-problems':'/staff/real/operations');
 const query=await searchParams;
 return <Suspense fallback={<p role="status" className="rounded-xl border bg-background p-5 text-body2">Loading message status…</p>}><MessageStatus query={query}/></Suspense>;
}
