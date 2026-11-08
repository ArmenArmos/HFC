'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {requireRealStaff} from '@/lib/patient-care/clinical-case-repository';
import {doctorChatHomeEnabled,doctorHomePath} from '@/lib/staff-zoe/workspace-config';
import type {Route} from 'next';
import {staffNoticeReturnPath} from '@/lib/staff-zoe/notice-link';
import {redirect} from 'next/navigation';
import {parseLocale} from '@/lib/locale';
import {st} from '@/lib/staff/staff-locale-copy';
import {sendStaffCode,verifyStaffCode} from '@/lib/telegram-auth/staff-signin';

export type StaffVerifyState={status:'idle'|'sent'|'error';message:string};
const say=(form:FormData|undefined)=>(en:string,hy:string,ru:string)=>st(parseLocale(form?.get('locale'),'hy'),en,hy,ru);

export const sendStaffTelegramCode=loggedAction("sendStaffTelegramCode",async function sendStaffTelegramCode(_previous:StaffVerifyState,form?:FormData):Promise<StaffVerifyState>{
 const t=say(form);
 try{
  const r=await sendStaffCode();
  if(r.ok)return {status:'sent',message:t('We sent a code to your Telegram. Enter it below.','Կոդն ուղարկվել է ձեր Telegram-ին։ Մուտքագրեք այն ստորև։','Мы отправили код в ваш Telegram. Введите его ниже.')};
  return {status:'error',message:r.reason==='not_enrolled'?t('Telegram is not set up for your account yet. Contact your administrator.','Telegram-ը դեռ կարգավորված չէ ձեր հաշվի համար։ Կապվեք ադմինիստրատորի հետ։','Telegram ещё не настроен для вашей учётной записи. Свяжитесь с администратором.'):r.reason==='busy'?t('You asked for several codes. Wait a few minutes and try again.','Դուք մի քանի կոդ եք խնդրել։ Սպասեք մի քանի րոպե և կրկին փորձեք։','Вы запросили несколько кодов. Подождите несколько минут и попробуйте ещё раз.'):t('We could not send a code. Try again.','Չհաջողվեց ուղարկել կոդը։ Կրկին փորձեք։','Не удалось отправить код. Попробуйте ещё раз.')};
 }catch{return {status:'error',message:t('We could not send a code. Try again.','Չհաջողվեց ուղարկել կոդը։ Կրկին փորձեք։','Не удалось отправить код. Попробуйте ещё раз.')};}
});

export const verifyStaffTelegramCode=loggedAction("verifyStaffTelegramCode",async function verifyStaffTelegramCode(_previous:StaffVerifyState,form:FormData):Promise<StaffVerifyState>{
 const t=say(form);
 let r;
 try{r=await verifyStaffCode(String(form.get('code')??'').trim());}catch{return {status:'error',message:t('We could not check the code. Try again.','Չհաջողվեց ստուգել կոդը։ Կրկին փորձեք։','Не удалось проверить код. Попробуйте ещё раз.')};}
 if(!r.ok)return {status:'error',message:r.reason==='invalid'?t('That code is not right. Check it and try again.','Կոդը ճիշտ չէ։ Ստուգեք և կրկին փորձեք։','Неверный код. Проверьте его и попробуйте ещё раз.'):r.reason==='resend'?t('This code no longer works. Send a new code.','Այս կոդն այլևս չի գործում։ Ուղարկեք նոր կոդ։','Этот код больше не действует. Запросите новый код.'):t('We could not check the code. Try again.','Չհաջողվեց ստուգել կոդը։ Կրկին փորձեք։','Не удалось проверить код. Попробуйте ещё раз.')};
 const next=staffNoticeReturnPath(form.get('next'));
 if(next){await requireRealStaff();redirect(next as Route);}
 if(!doctorChatHomeEnabled())redirect('/staff/real/members');
 const {identity}=await requireRealStaff();
 redirect(doctorHomePath(identity.role));
});
