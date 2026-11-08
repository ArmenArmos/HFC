'use client';
import {usePathname} from 'next/navigation';
import Link from 'next/link';
import {ChatShellMenu} from '@/components/staff/chat-menu-items';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

/** Only the flagged admin chat hides the desktop backoffice navigation in Menu. */
export function AdminChatShell({fallback,children,nav,actions,locale}:{fallback:React.ReactNode;children?:React.ReactNode;nav:React.ReactNode;actions:React.ReactNode;locale:StaffLocale}){
 if(usePathname()!=='/staff/real/admin-chat')return fallback;
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <div lang={locale} className="min-h-screen bg-muted/30" data-admin-chat-shell>
  <a href="#staff-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:p-4">{t('Skip to content','Անցնել բովանդակությանը','Перейти к содержимому')}</a>
  <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-2">
   <Link href="/staff/real/admin-chat" className="text-h2">Noreon</Link>
   <div className="flex flex-wrap items-center gap-3">
    <ChatShellMenu><summary className="min-h-11 cursor-pointer content-center rounded-md border px-3 text-body2">{t('Menu','Ընտրացանկ','Меню')}</summary>
     <div className="absolute right-0 z-30 max-h-[70dvh] w-64 overflow-y-auto rounded-xl border bg-card p-3 shadow-lg">{nav}</div>
    </ChatShellMenu>
    {actions}
   </div>
  </header>
  <main id="staff-content" className="mx-auto max-w-6xl px-2 py-4 sm:px-5">{children}</main>
 </div>;
}
