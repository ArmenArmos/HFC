import {SigninLanguageLinks} from '@/components/real-review/signin-language';
import {clinicLocale} from '@/lib/clinic-portal/locale';
import type {Locale} from '@/lib/locale';
import type {Metadata} from 'next';
import {headers} from 'next/headers';
import {notFound} from 'next/navigation';
import {clinicHostAllowed,clinicPortalEnabled} from '@/lib/clinic-portal/config';
import {TelegramRecoverySteps} from '@/components/real-review/telegram-recovery-steps';
import {staffTelegramRecoveryReady} from '@/lib/telegram-auth/staff-recovery';
export const metadata:Metadata={referrer:'no-referrer',robots:{index:false,follow:false}};
const tx=(locale:Locale,hy:string,en:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hy:en;
export default async function ClinicTelegramRecoveryPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!clinicPortalEnabled()||!clinicHostAllowed((await headers()).get('host')??'')||!staffTelegramRecoveryReady())notFound();
 const locale=await clinicLocale((await searchParams).locale);
 // Shared staff form currently supports en/hy and is outside this Russian clinic copy batch.
 return <main lang={locale} className="mx-auto max-w-md space-y-6 px-5 py-12"><SigninLanguageLinks path="/clinic/real/recover" locale={locale}/><p className="text-h2 font-semibold">Noreon</p><h1 className="text-h1">{tx(locale,'Նոր գաղտնաբառ','Set a new password','Установите новый пароль')}</h1><TelegramRecoverySteps locale={locale==='ru'?'en':locale}/></main>;
}
