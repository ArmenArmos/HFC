'use server';
import {clinicLocale} from '@/lib/clinic-portal/locale';
import {loggedAction} from '@/lib/observability/with-logging';
import {redirect} from 'next/navigation';
import {z} from 'zod';
import {acceptClinicInvite,sendClinicInviteCode} from '@/lib/telegram-auth/clinic-invite';

export type ClinicInviteState={ok:boolean;message:string};
const ids=(form:FormData)=>z.object({invitationId:z.uuid(),generation:z.coerce.number().int().positive().max(2147483647),telegram:z.string().regex(/^[A-Za-z0-9_-]{32}$/)})
 .safeParse({invitationId:form.get('invitationId'),generation:form.get('generation'),telegram:form.get('telegram')});

export const sendClinicInvitationCode=loggedAction("sendClinicInvitationCode",async function sendClinicInvitationCode(_previous:ClinicInviteState,form:FormData):Promise<ClinicInviteState>{
 const locale=await clinicLocale(form.get('locale')),t=(en:string,hyText:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hyText:en;
 const input=ids(form);
 if(!input.success)return {ok:false,message:t('This invitation link is not valid. Ask your Noreon administrator for a new one.','Հրավերի հղումը վավեր չէ։ Նորը խնդրեք Նորեոն Հելթի ադմինիստրատորից։','Эта ссылка приглашения недействительна. Попросите новую у администратора Нореон Хелс.')};
 const r=await sendClinicInviteCode(input.data.invitationId,input.data.generation,input.data.telegram);
 if(r.ok)return {ok:true,message:t('We sent a code to your Telegram. It works for 5 minutes.','Կոդն ուղարկեցինք ձեր Telegram-ին։ Այն գործում է 5 րոպե։','Мы отправили код в ваш Telegram. Он действует 5 минут.')};
 return {ok:false,message:r.reason==='not_proven'?t('First open the Noreon bot with the button above and share your phone number there.','Նախ բացեք Նորեոն Հելթ բոտը վերևի կոճակով և այնտեղ կիսվեք ձեր հեռախոսահամարով։','Сначала откройте бот Нореон Хелс кнопкой выше и поделитесь там своим номером телефона.')
  :r.reason==='busy'?t('Too many codes were requested. Try again in 15 minutes.','Չափազանց շատ կոդ է խնդրվել։ Փորձեք 15 րոպեից։','Запрошено слишком много кодов. Попробуйте через 15 минут.')
  :t('This invitation is no longer available. Ask your Noreon administrator for a new link.','Այս հրավերն այլևս հասանելի չէ։ Նոր հղում խնդրեք Նորեոն Հելթի ադմինիստրատորից։','Это приглашение больше недоступно. Попросите новую ссылку у администратора Нореон Хелс.')};
});

export const acceptClinicInvitation=loggedAction("acceptClinicInvitation",async function acceptClinicInvitation(_previous:ClinicInviteState,form:FormData):Promise<ClinicInviteState>{
 const locale=await clinicLocale(form.get('locale')),t=(en:string,hyText:string,ru:string)=>locale==='ru'?ru:locale==='hy'?hyText:en;
 const input=ids(form);
 if(!input.success)return {ok:false,message:t('This invitation link is not valid. Ask your Noreon administrator for a new one.','Հրավերի հղումը վավեր չէ։ Նորը խնդրեք Նորեոն Հելթի ադմինիստրատորից։','Эта ссылка приглашения недействительна. Попросите новую у администратора Нореон Хелс.')};
 const fields=z.object({code:z.string().regex(/^\d{6}$/),password:z.string().min(12).max(128),confirmation:z.string()}).safeParse({code:form.get('code'),password:form.get('password'),confirmation:form.get('confirmation')});
 if(!fields.success)return {ok:false,message:t('Enter the 6-digit code and a password of at least 12 characters.','Մուտքագրեք 6 նիշանոց կոդը և առնվազն 12 նիշանոց գաղտնաբառ։','Введите шестизначный код и пароль длиной не менее 12 символов.')};
 if(fields.data.password!==fields.data.confirmation)return {ok:false,message:t('The two passwords do not match.','Գաղտնաբառերը չեն համընկնում։','Пароли не совпадают.')};
 const r=await acceptClinicInvite({invitationId:input.data.invitationId,generation:input.data.generation,code:fields.data.code,password:fields.data.password});
 if(!r.ok)return {ok:false,message:r.reason==='invalid_code'?t('That code is not correct. Check it and try again.','Կոդը ճիշտ չէ։ Ստուգեք և փորձեք նորից։','Код неверный. Проверьте его и попробуйте снова.')
  :r.reason==='telegram_in_use'?t('This Telegram account is already connected to another Noreon account. Contact your Noreon administrator.','Այս Telegram հաշիվն արդեն միացված է Նորեոն Հելթի այլ հաշվի։ Դիմեք Նորեոն Հելթի ադմինիստրատորին։','Этот аккаунт Telegram уже связан с другим аккаунтом Нореон Хелс. Обратитесь к администратору Нореон Хелс.')
  :r.reason==='already_member'?t('You already have access to this clinic. Sign in with your email and password.','Դուք արդեն ունեք այս կլինիկայի հասանելիություն։ Մուտք գործեք ձեր էլ. հասցեով և գաղտնաբառով։','У вас уже есть доступ к этой клинике. Войдите с электронной почтой и паролем.')
  :r.reason==='resend'?t('The code has expired or was already used. Ask for a new code.','Կոդի ժամկետն անցել է կամ այն արդեն օգտագործվել է։ Խնդրեք նոր կոդ։','Срок действия кода истёк или он уже использован. Запросите новый код.')
  :t('Setup could not be completed. Try again later.','Չհաջողվեց ավարտել։ Փորձեք ավելի ուշ։','Не удалось завершить настройку. Попробуйте позже.')};
 redirect(`/clinic/real/login?invited=1${locale==='en'?'':`&locale=${locale}`}`);
});
