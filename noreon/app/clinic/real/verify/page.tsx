import {SigninLanguageLinks} from '@/components/real-review/signin-language';
import {clinicLocale} from '@/lib/clinic-portal/locale';
import type {Route} from 'next';
import type {Locale} from '@/lib/locale';
import {headers} from 'next/headers';
import {notFound,redirect} from 'next/navigation';
import {clinicHostAllowed,clinicPortalEnabled} from '@/lib/clinic-portal/config';
import {readStaffSigninState,staffTelegramSigninEnabled} from '@/lib/telegram-auth/staff-signin';
import {StaffTelegramVerifyForm} from '@/components/real-review/staff-telegram-verify';
import {sendClinicTelegramCode,verifyClinicTelegramCode} from './actions';
const tx=(locale:Locale,hy:string,en:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hy:en;
export default async function ClinicTelegramVerifyPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!clinicPortalEnabled()||!clinicHostAllowed((await headers()).get('host')??'')||!staffTelegramSigninEnabled())notFound();
 const locale=await clinicLocale((await searchParams).locale);
 const state=await readStaffSigninState('clinic');
 if(!state||!state.clinicEligible)redirect(`/clinic/real/login${locale==='en'?'':`?locale=${locale}`}` as Route);
 if(!state.required||state.admitted)redirect(`/clinic/real/select${locale==='en'?'':`?locale=${locale}`}` as Route);
 // Shared staff form currently supports en/hy and is outside this Russian clinic copy batch.
 return <main lang={locale} className="mx-auto max-w-md space-y-6 px-5 py-12"><SigninLanguageLinks path="/clinic/real/verify" locale={locale}/><h1 className="text-h1">{tx(locale,'Հաստատեք, որ դուք եք','Confirm it is you','Подтвердите, что это вы')}</h1><p className="text-body2">{tx(locale,'Վեցանիշ կոդ կուղարկենք ձեր կլինիկայի հաշվին միացված Telegram-ին։','We send a 6-digit code to the Telegram account connected to your clinic account.','Мы отправим шестизначный код в Telegram, связанный с вашим аккаунтом клиники.')}</p><StaffTelegramVerifyForm send={sendClinicTelegramCode} verify={verifyClinicTelegramCode} locale={locale==='ru'?'en':locale}/></main>;
}
