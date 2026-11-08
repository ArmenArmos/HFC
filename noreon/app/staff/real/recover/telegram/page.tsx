import type {Metadata} from 'next';
import {parseLocale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {notFound} from 'next/navigation';
import {TelegramRecoverySteps} from '@/components/real-review/telegram-recovery-steps';
import {staffTelegramRecoveryReady} from '@/lib/telegram-auth/staff-recovery';
export const metadata:Metadata={referrer:'no-referrer',robots:{index:false,follow:false}};
export default async function StaffTelegramRecoveryPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!staffTelegramRecoveryReady())notFound();
 const locale=parseLocale((await searchParams).locale,'hy');
 return <main lang={locale} className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-8"><p className="text-h2 font-semibold">Noreon</p><h1 className="text-h1">{st(locale,'Set a new password','Նոր գաղտնաբառ','Задайте новый пароль')}</h1><TelegramRecoverySteps locale={locale}/></main>;
}
