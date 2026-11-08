import {SigninLanguageLinks} from '@/components/real-review/signin-language';
import {clinicLocale} from '@/lib/clinic-portal/locale';
import type {Locale} from '@/lib/locale';
import {headers} from 'next/headers';
import {notFound} from 'next/navigation';
import {clinicHostAllowed,clinicPortalEnabled} from '@/lib/clinic-portal/config';
import {clinicTelegramInvitesReady} from '@/lib/telegram-auth/clinic-invite-config';
import {telegramBotUsername} from '@/lib/telegram-runtime/config';
import {ClinicInvitationSteps} from '@/components/clinic-portal/invitation-steps';

const tx=(locale:Locale,hy:string,en:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hy:en;
export default async function ClinicInvitationPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!clinicPortalEnabled()||!clinicHostAllowed((await headers()).get('host')??'')||!clinicTelegramInvitesReady())notFound();
 const locale=await clinicLocale((await searchParams).locale);
 return <main lang={locale} className="mx-auto max-w-md space-y-6 px-5 py-12"><SigninLanguageLinks path="/clinic/real/invite" locale={locale}/><p className="text-h2 font-semibold">Noreon</p><h1 className="text-h1">{tx(locale,'Ձեր կլինիկայի հրավերը','Your clinic invitation','Ваше приглашение в клинику')}</h1><ClinicInvitationSteps botUsername={telegramBotUsername()} locale={locale}/></main>;
}
