import {requireRealStaffForRender} from '@/lib/staff/real-staff-render';
import {doctorChatHomeEnabled,doctorHomePath} from '@/lib/staff-zoe/workspace-config';
import type {Route} from 'next';
import {staffNoticeReturnPath,staffNoticeSignInPath} from '@/lib/staff-zoe/notice-link';
import {notFound,redirect} from 'next/navigation';
import {parseLocale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {realReviewEnabled} from '@/lib/patient-care/real-review-config';
import {readStaffSigninState,staffTelegramSigninEnabled} from '@/lib/telegram-auth/staff-signin';
import {StaffTelegramVerifyForm} from '@/components/real-review/staff-telegram-verify';
import {SigninLanguageLinks} from '@/components/real-review/signin-language';
export default async function StaffTelegramVerifyPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!realReviewEnabled(process.env)||!staffTelegramSigninEnabled())notFound();
 const params=await searchParams,next=staffNoticeReturnPath(params.next),locale=parseLocale(params.locale,'hy');
 const state=await readStaffSigninState();
 if(!state||!state.staffEligible){const login=new URL(staffNoticeSignInPath('/staff/real/login',next),'https://backoffice.noreon.health');if(locale!=='en')login.searchParams.set('locale',locale);redirect(`${login.pathname}${login.search}` as Route);}
 if(!state.required||state.admitted){if(next)redirect(next as Route);if(!doctorChatHomeEnabled())redirect('/staff/real/members');const {identity}=await requireRealStaffForRender();redirect(doctorHomePath(identity.role));}
 return <main lang={locale} className="mx-auto max-w-md space-y-6 px-5 py-12"><SigninLanguageLinks path="/staff/real/verify" locale={locale} extra={next?new URLSearchParams({next}).toString():''}/><h1 className="text-h1">{st(locale,'Confirm it is you','Հաստատեք, որ դուք եք','Подтвердите, что это вы')}</h1><p className="text-body2">{st(locale,'We send a 6-digit code to the Telegram account connected to your staff account.','Վեցանիշ կոդ կուղարկենք ձեր աշխատակցի հաշվին միացված Telegram-ին։','Мы отправим шестизначный код в Telegram, связанный с вашей учётной записью сотрудника.')}</p><StaffTelegramVerifyForm locale={locale} next={next??''}/></main>;
}
