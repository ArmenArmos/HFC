'use server';
import {loggedAction} from '@/lib/observability/with-logging';
import {parseLocale,pick} from '@/lib/locale';
import {redirect} from 'next/navigation';
import {z} from 'zod';
import {completeRecovery,sendRecoveryCode} from './staff-recovery';

/** Recovery-link holder actions (T-auth B-3); shared by the staff and clinic pages. */
export type RecoveryStepState={ok:boolean;message:string};
const ids=(form:FormData)=>z.object({recoveryId:z.uuid(),token:z.string().regex(/^[A-Za-z0-9_-]{32}$/)}).safeParse({recoveryId:form.get('recoveryId'),token:form.get('token')});
const tr=(form:FormData)=>(en:string,hy:string,ru:string)=>pick(parseLocale(form.get('locale'),'en'),{en,hy,ru});

export const sendTelegramRecoveryCode=loggedAction("sendTelegramRecoveryCode",async function sendTelegramRecoveryCode(_previous:RecoveryStepState,form:FormData):Promise<RecoveryStepState>{
 const t=tr(form),input=ids(form);
 if(!input.success)return {ok:false,message:t('This reset link is not valid. Ask your administrator to send a new one.','Վերականգնման հղումը վավեր չէ։ Խնդրեք ադմինիստրատորին ուղարկել նորը։', 'Эта ссылка для сброса недействительна. Попросите администратора отправить новую.')};
 const r=await sendRecoveryCode(input.data.recoveryId,input.data.token);
 if(r.ok)return {ok:true,message:t('We sent a code to your Telegram. It works for 5 minutes.','Կոդն ուղարկեցինք ձեր Telegram-ին։ Այն գործում է 5 րոպե։', 'Мы отправили код в ваш Telegram. Он действует 5 минут.')};
 return {ok:false,message:r.reason==='busy'?t('Too many codes were requested. Try again in 15 minutes.','Չափազանց շատ կոդ է խնդրվել։ Փորձեք 15 րոպեից։', 'Запрошено слишком много кодов. Попробуйте снова через 15 минут.')
  :r.reason==='busy_day'?t('Too many wrong codes today. Try again tomorrow or contact your administrator.','Այսօր չափազանց շատ սխալ կոդ է մուտքագրվել։ Փորձեք վաղը կամ դիմեք ադմինիստրատորին։', 'Сегодня введено слишком много неверных кодов. Попробуйте завтра или свяжитесь с администратором.')
  :t('This reset link no longer works. Ask your administrator to send a new one.','Այս հղումն այլևս չի գործում։ Խնդրեք ադմինիստրատորին ուղարկել նորը։', 'Эта ссылка для сброса больше не работает. Попросите администратора отправить новую.')};
});

export const completeTelegramRecovery=loggedAction("completeTelegramRecovery",async function completeTelegramRecovery(_previous:RecoveryStepState,form:FormData):Promise<RecoveryStepState>{
 const t=tr(form),input=ids(form),locale=parseLocale(form.get('locale'),'en');
 if(!input.success)return {ok:false,message:t('This reset link is not valid. Ask your administrator to send a new one.','Վերականգնման հղումը վավեր չէ։ Խնդրեք ադմինիստրատորին ուղարկել նորը։', 'Эта ссылка для сброса недействительна. Попросите администратора отправить новую.')};
 const fields=z.object({code:z.string().regex(/^\d{6}$/),password:z.string().min(12).max(128),confirmation:z.string()}).safeParse({code:form.get('code'),password:form.get('password'),confirmation:form.get('confirmation')});
 if(!fields.success)return {ok:false,message:t('Enter the 6-digit code and a password of at least 12 characters.','Մուտքագրեք 6 նիշանոց կոդը և առնվազն 12 նիշանոց գաղտնաբառ։', 'Введите 6-значный код и пароль длиной не менее 12 символов.')};
 if(fields.data.password!==fields.data.confirmation)return {ok:false,message:t('The two passwords do not match.','Գաղտնաբառերը չեն համընկնում։', 'Пароли не совпадают.')};
 const r=await completeRecovery({recoveryId:input.data.recoveryId,code:fields.data.code,password:fields.data.password});
 if(!r.ok)return {ok:false,message:r.reason==='invalid_code'?t('That code is not correct. Check it and try again.','Կոդը ճիշտ չէ։ Ստուգեք և փորձեք նորից։', 'Код неверный. Проверьте его и попробуйте снова.')
  :r.reason==='unconfirmed'?t('Your password was changed, but signing out your other devices was not confirmed. Tell your administrator.','Գաղտնաբառը փոխվել է, բայց այլ սարքերից դուրս գալը չհաստատվեց։ Տեղեկացրեք ադմինիստրատորին։', 'Ваш пароль изменён, но выход на других устройствах не подтверждён. Сообщите администратору.')
  :r.reason==='resend'?t('The code has expired or was already used. Ask for a new code.','Կոդի ժամկետն անցել է կամ այն արդեն օգտագործվել է։ Խնդրեք նոր կոդ։', 'Срок действия кода истёк или он уже использован. Запросите новый код.')
  :t('The password could not be changed. Try again later.','Չհաջողվեց փոխել գաղտնաբառը։ Փորձեք ավելի ուշ։', 'Не удалось изменить пароль. Попробуйте позже.')};
 redirect(r.portal==='clinic'?`/clinic/real/login?reset=1${locale==='en'?'':`&locale=${locale}`}`:'/staff/real/login?password-reset=complete');
});
