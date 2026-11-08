'use client';
import {usePathname,useSearchParams} from 'next/navigation';
import Link from 'next/link';
import {useChatViewport} from '@/components/patient/use-chat-viewport';
import {ChatShellMenu} from '@/components/staff/chat-menu-items';
import {st,type StaffLocale} from '@/lib/staff/staff-locale-copy';

/** Only the flagged nurse chat uses the full-width thread; legacy pages keep their shell. */
export function NurseChatShell({fallback,children,nav,actions,locale,newChat=false}:{fallback:React.ReactNode;children?:React.ReactNode;nav:React.ReactNode;actions:React.ReactNode;locale:StaffLocale;newChat?:boolean}){
 const path=usePathname(),query=useSearchParams();
 const bare=newChat&&path==='/staff/real/nurse-chat'&&!query?.size;
 useChatViewport(path==='/staff/real/nurse-chat'&&!bare);
 if(bare)return children;
 if(path!=='/staff/real/nurse-chat')return fallback;
 const t=(en:string,hy:string,ru:string)=>st(locale,en,hy,ru);
 return <div lang={locale} className="min-h-screen bg-muted/30" data-nurse-chat-shell>
  <a href="#staff-content" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:bg-background focus:p-4">{t('Skip to content','Անցնել բովանդակությանը','Перейти к содержимому')}</a>
  <header className="flex flex-wrap items-center justify-between gap-3 border-b bg-background px-4 py-2">
   <Link href="/staff/real/nurse-chat" className="text-h2">Noreon</Link>
   <div className="flex flex-wrap items-center gap-3">
    <ChatShellMenu><summary className="min-h-11 cursor-pointer list-none content-center rounded-md border px-3 text-body2 [&::-webkit-details-marker]:hidden">{t('Menu','Ընտրացանկ','Меню')}</summary>
     <div className="absolute right-0 z-30 max-h-[70dvh] w-64 overflow-y-auto rounded-xl border bg-card p-3 shadow-lg"><div id="nurse-chat-menu"/><nav className="mb-3 grid gap-2" aria-label={t('Your workspace','Ձեր աշխատատարածքը','Ваше рабочее пространство')}>
      <Link className="min-h-11 content-center" href="/staff/real/nurse-chat?view=today">{t('Your work today','Ձեր այսօրվա աշխատանքը','Ваша работа на сегодня')}</Link>
      <Link className="min-h-11 content-center" href="/staff/real/nurse-chat?view=visits">{t('Your visits','Ձեր այցերը','Ваши визиты')}</Link>
      <Link className="min-h-11 content-center" href="/staff/real/nurse-chat?view=members">{t('Your members','Ձեր անդամները','Ваши участники')}</Link>
     </nav>{nav}<div className="mt-3 border-t pt-3">{actions}</div></div>
    </ChatShellMenu>
   </div>
  </header>
  <main id="staff-content" className="px-2 py-4 sm:px-5">{children}</main>
 </div>;
}
