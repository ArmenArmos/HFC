import Link from 'next/link';
import {notFound} from 'next/navigation';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {adminChatEnabled} from '@/lib/admin-chat/config';
import {readAdminChat} from '@/lib/admin-chat/actions';
import {AdminChat} from '@/components/staff/admin-chat';
import {parseLocale} from '@/lib/locale';
import '../doctor-workspace/workspace.css';

export const dynamic='force-dynamic';
export default async function AdminChatPage({searchParams}:{searchParams:Promise<{lang?:string}>}){
 if(!adminChatEnabled())notFound();
 const {identity}=await requireRealAdmin();
 const locale=parseLocale((await searchParams).lang,'en');
 return <>
  <nav aria-label="Language" className="mb-3 flex gap-4 text-body2"><Link href="/staff/real/admin-chat" aria-current={locale==='en'?'page':undefined} className="inline-flex min-h-11 items-center underline" lang="en">English</Link><Link href="/staff/real/admin-chat?lang=hy" aria-current={locale==='hy'?'page':undefined} className="inline-flex min-h-11 items-center underline" lang="hy">Հայերեն</Link><Link href="/staff/real/admin-chat?lang=ru" aria-current={locale==='ru'?'page':undefined} className="inline-flex min-h-11 items-center underline" lang="ru">Русский</Link></nav>
  <AdminChat key={identity.id} locale={locale} initial={await readAdminChat('operations')} readAction={readAdminChat}/>
 </>;
}
