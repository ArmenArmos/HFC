'use server';
import type {Route} from 'next';
import {clinicLocale} from '@/lib/clinic-portal/locale';
import {loggedAction} from '@/lib/observability/with-logging';
import {redirect} from 'next/navigation';
import {sendStaffCode,verifyStaffCode} from '@/lib/telegram-auth/staff-signin';
import type {StaffVerifyState} from '@/app/staff/real/verify/actions';

/** Clinic portal Telegram second step (T-auth B-2b-1): same codes and admission as staff, clinic session. */
const say=async(form:FormData,en:string,hy:string,ru:string)=>{const locale=await clinicLocale(form.get('locale'));return locale==='ru'?ru:locale==='hy'?hy:en;};
export const sendClinicTelegramCode=loggedAction("sendClinicTelegramCode",async function sendClinicTelegramCode(_previous:StaffVerifyState,form:FormData):Promise<StaffVerifyState>{
 try{
  const r=await sendStaffCode('clinic');
  if(r.ok)return {status:'sent',message:await say(form,'We sent a code to your Telegram. Enter it below.','Կոդն ուղարկվել է ձեր Telegram-ին։ Մուտքագրեք այն ներքևում։','Мы отправили код в ваш Telegram. Введите его ниже.')};
  return {status:'error',message:r.reason==='not_enrolled'?await say(form,'Telegram is not set up for your account yet. Contact Noreon.','Ձեր հաշվի համար Telegram-ը դեռ միացված չէ։ Դիմեք Նորեոն Հելթին։','Telegram для вашего аккаунта пока не настроен. Обратитесь в Нореон Хелс.'):r.reason==='busy'?await say(form,'You asked for several codes. Wait a few minutes and try again.','Մի քանի կոդ եք խնդրել։ Սպասեք մի քանի րոպե և փորձեք նորից։','Вы запросили несколько кодов. Подождите несколько минут и попробуйте снова.'):await say(form,'We could not send a code. Try again.','Չհաջողվեց ուղարկել կոդը։ Փորձեք նորից։','Не удалось отправить код. Попробуйте снова.')};
 }catch{return {status:'error',message:await say(form,'We could not send a code. Try again.','Չհաջողվեց ուղարկել կոդը։ Փորձեք նորից։','Не удалось отправить код. Попробуйте снова.')};}
});
export const verifyClinicTelegramCode=loggedAction("verifyClinicTelegramCode",async function verifyClinicTelegramCode(_previous:StaffVerifyState,form:FormData):Promise<StaffVerifyState>{
 let r;
 try{r=await verifyStaffCode(String(form.get('code')??'').trim(),'clinic');}catch{return {status:'error',message:await say(form,'We could not check the code. Try again.','Չհաջողվեց ստուգել կոդը։ Փորձեք նորից։','Не удалось проверить код. Попробуйте снова.')};}
 if(!r.ok)return {status:'error',message:r.reason==='invalid'?await say(form,'That code is not right. Check it and try again.','Կոդը սխալ է։ Ստուգեք և փորձեք նորից։','Код неверный. Проверьте его и попробуйте снова.'):r.reason==='resend'?await say(form,'This code no longer works. Send a new code.','Այս կոդն այլևս չի գործում։ Ուղարկեք նոր կոդ։','Этот код больше не действует. Отправьте новый код.'):await say(form,'We could not check the code. Try again.','Չհաջողվեց ստուգել կոդը։ Փորձեք նորից։','Не удалось проверить код. Попробуйте снова.')};
 const locale=await clinicLocale(form.get('locale'));
 redirect(`/clinic/real/select${locale==='en'?'':`?locale=${locale}`}` as Route);
});
