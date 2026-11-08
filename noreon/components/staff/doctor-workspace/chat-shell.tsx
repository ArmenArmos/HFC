'use client';
import Link from 'next/link';
import {usePathname} from 'next/navigation';
import {ChatShellMenu} from '@/components/staff/chat-menu-items';
import {st} from '@/lib/staff/staff-locale-copy';
import type {Locale} from '@/lib/locale';

/** Old pages retain their shell. Only the flagged chat workspace loses its sidebar. */
export function DoctorChatShell({fallback,nav,actions,children,locale,chatV2=false}:{fallback:React.ReactNode;nav:React.ReactNode;actions:React.ReactNode;children:React.ReactNode;locale:Locale;chatV2?:boolean}){
 const path=usePathname(),t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 if((path==='/staff/real/doctor-chat-v2'||path.startsWith('/staff/real/doctor-chat-v2/patient/'))||chatV2&&path==='/staff/real/doctor-workspace')return children;
 if(path!=='/staff/real/doctor-workspace'&&path!=='/staff/real/doctor-workspace/classic')return fallback;
 return <div lang={locale} className="doctor-chat-shell flex h-dvh min-w-0 flex-col bg-background">
  <a href="#staff-content" className="sr-only focus:not-sr-only focus:fixed focus:z-50 focus:bg-background focus:p-4">{t('Skip to content','Անցնել բովանդակությանը','Перейти к содержимому')}</a>
  <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
   <Link href="/staff/real/doctor-workspace" className="text-h2 font-semibold">Noreon</Link>
   <div className="flex min-w-0 flex-wrap items-center gap-2">
    <ChatShellMenu><summary className="inline-flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-body2">{t('Menu','Ընտրացանկ','Меню')}</summary>
     <nav onClick={event=>{if((event.target as HTMLElement).closest('button,a'))event.currentTarget.closest('details')?.removeAttribute('open');}} aria-label={t('Full pages','Ամբողջական էջեր','Полные страницы')} className="absolute right-0 z-50 max-h-[70dvh] w-64 overflow-y-auto rounded-lg border bg-background p-2 shadow-lg"><div id="doctor-chat-menu"/><div id="doctor-record-menu"/><div className="flex flex-wrap items-center gap-2 border-b py-2 [&_form]:flex-wrap">{actions}</div><details><summary className="min-h-11 cursor-pointer px-2 py-2 text-body2">{t('Full pages','Ամբողջական էջեր','Полные страницы')}</summary>{nav}</details></nav>
    </ChatShellMenu>
   </div>
  </header>
  <main id="staff-content" className="min-h-0 min-w-0 flex-1">{children}</main>
 </div>;
}
