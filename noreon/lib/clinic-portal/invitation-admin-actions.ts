'use server';
import {pick} from '@/lib/locale';
import {clinicLocale} from '@/lib/clinic-portal/locale';
import {loggedAction} from '@/lib/observability/with-logging';
import {headers} from 'next/headers';
import {revalidatePath} from 'next/cache';
import {z} from 'zod';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {clinicInviteOrigin,clinicTelegramInvitesReady} from '@/lib/telegram-auth/clinic-invite-config';
import {issueClinicInvitation,reissueClinicInvitation,revokeClinicInvitation,type ClinicInviteIssue} from '@/lib/telegram-auth/clinic-invite';

/** Admin controls for clinic invitations by Telegram (T-auth B-2b-2). The link is shown once. */
export type ClinicInviteAdminState={ok:boolean;message:string;url?:string};
const phoneOf=(form:FormData)=>String(form.get('phone')??'').replace(/[\s()-]/g,'');
const t=async(form:FormData)=>{const locale=await clinicLocale(form.get('locale'));return(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});};
function issueMessage(r:ClinicInviteIssue,tr:(en:string,hy:string,ru:string)=>string):ClinicInviteAdminState{
 if(r.ok)return {ok:true,url:r.url,message:tr('Send this link to the clinic user. They open it, share their phone number in the Noreon bot and set a password with the code it sends. It works for 72 hours and is shown only once.','Ուղարկեք այս հղումը կլինիկայի օգտատիրոջը։ Նա կբացի այն, կկիսվի իր համարով Նորեոն Հելթ բոտում և կսահմանի գաղտնաբառ ստացված կոդով։ Գործում է 72 ժամ և ցուցադրվում է միայն մեկ անգամ։','Отправьте эту ссылку сотруднику клиники. Он откроет её, поделится номером телефона в боте Нореон Хелс и задаст пароль с помощью полученного кода. Ссылка действует 72 часа и показывается только один раз.')};
 return {ok:false,message:r.reason==='email_in_use'?tr('This email already has a Noreon account or an open invitation. Use "Add existing account" or the invitation below.','Այս էլ. հասցեն արդեն ունի Նորեոն Հելթ հաշիվ կամ բաց հրավեր։ Օգտագործեք «Ավելացնել առկա հաշիվ» կամ ստորև նշված հրավերը։','Для этой электронной почты уже есть аккаунт Нореон Хелс или открытое приглашение. Используйте «Добавить существующий аккаунт» или приглашение ниже.')
  :r.reason==='invalid'?tr('Check the name, email and phone number (with the country code, for example +37499123456).','Ստուգեք անունը, էլ. հասցեն և հեռախոսահամարը (երկրի կոդով, օրինակ՝ +37499123456)։','Проверьте имя, электронную почту и номер телефона (с кодом страны, например +37499123456).')
  :r.reason==='clinic_unavailable'?tr('This clinic is not active.','Այս կլինիկան ակտիվ չէ։','Эта клиника неактивна.')
  :r.reason==='changed'?tr('The invitation changed. Reload the page and check before trying again.','Հրավերը փոխվել է։ Թարմացրեք էջը և ստուգեք։','Приглашение изменилось. Обновите страницу и проверьте его перед повторной попыткой.')
  :r.reason==='accepted'?tr('This invitation was already accepted.','Այս հրավերն արդեն ընդունված է։','Это приглашение уже принято.')
  :tr('The invitation could not be prepared. Reload the page and check the list before trying again.','Չհաջողվեց պատրաստել հրավերը։ Թարմացրեք էջը և ստուգեք ցանկը։','Не удалось подготовить приглашение. Обновите страницу и проверьте список перед повторной попыткой.')};
}
async function origin(){return clinicInviteOrigin((await headers()).get('host'));}

export const inviteClinicUser=loggedAction("inviteClinicUser",async function inviteClinicUser(_previous:ClinicInviteAdminState,form:FormData):Promise<ClinicInviteAdminState>{
 const tr=await t(form);
 if(!clinicTelegramInvitesReady())return {ok:false,message:tr('Telegram invitations are not available yet.','Telegram հրավերները դեռ հասանելի չեն։','Приглашения через Telegram пока недоступны.')};
 const input=z.object({clinicId:z.uuid(),requestId:z.uuid(),name:z.string().trim().min(1).max(180),email:z.email().max(320),phone:z.string().regex(/^\+[1-9]\d{6,14}$/)})
  .safeParse({clinicId:form.get('clinicId'),requestId:form.get('requestId'),name:form.get('name'),email:String(form.get('email')??'').trim().toLowerCase(),phone:phoneOf(form)});
 if(!input.success)return issueMessage({ok:false,reason:'invalid'},tr);
 const base=await origin();
 if(!base)return issueMessage({ok:false,reason:'unavailable'},tr);
 const {client}=await requireRealAdmin();
 const r=await issueClinicInvitation(client,input.data,base).catch(()=>({ok:false,reason:'unavailable'}) as const);
 revalidatePath(`/staff/real/clinics/${input.data.clinicId}/access`);
 return issueMessage(r,tr);
});

export const reissueClinicUserInvitation=loggedAction("reissueClinicUserInvitation",async function reissueClinicUserInvitation(_previous:ClinicInviteAdminState,form:FormData):Promise<ClinicInviteAdminState>{
 const tr=await t(form);
 if(!clinicTelegramInvitesReady())return {ok:false,message:tr('Telegram invitations are not available yet.','Telegram հրավերները դեռ հասանելի չեն։','Приглашения через Telegram пока недоступны.')};
 const input=z.object({clinicId:z.uuid(),invitationId:z.uuid(),generation:z.coerce.number().int().positive(),phone:z.string().regex(/^\+[1-9]\d{6,14}$/)})
  .safeParse({clinicId:form.get('clinicId'),invitationId:form.get('invitationId'),generation:form.get('generation'),phone:phoneOf(form)});
 if(!input.success)return issueMessage({ok:false,reason:'invalid'},tr);
 const base=await origin();
 if(!base)return issueMessage({ok:false,reason:'unavailable'},tr);
 const {client}=await requireRealAdmin();
 const r=await reissueClinicInvitation(client,input.data,base).catch(()=>({ok:false,reason:'unavailable'}) as const);
 revalidatePath(`/staff/real/clinics/${input.data.clinicId}/access`);
 return issueMessage(r,tr);
});

export const revokeClinicUserInvitation=loggedAction("revokeClinicUserInvitation",async function revokeClinicUserInvitation(_previous:ClinicInviteAdminState,form:FormData):Promise<ClinicInviteAdminState>{
 const tr=await t(form);
 const input=z.object({clinicId:z.uuid(),invitationId:z.uuid(),generation:z.coerce.number().int().positive()}).safeParse({clinicId:form.get('clinicId'),invitationId:form.get('invitationId'),generation:form.get('generation')});
 if(!input.success||form.get('confirmed')!=='true')return {ok:false,message:tr('Confirm before cancelling.','Հաստատեք չեղարկելուց առաջ։','Подтвердите отмену.')};
 const {client}=await requireRealAdmin();
 const ok=await revokeClinicInvitation(client,input.data).catch(()=>false);
 revalidatePath(`/staff/real/clinics/${input.data.clinicId}/access`);
 return ok?{ok:true,message:tr('The invitation is cancelled. Its link no longer works.','Հրավերը չեղարկված է։ Հղումն այլևս չի գործում։','Приглашение отменено. Его ссылка больше не работает.')}:{ok:false,message:tr('Cancelling was not confirmed. Reload the page and check.','Չեղարկումը չհաստատվեց։ Թարմացրեք էջը և ստուգեք։','Отмена не подтверждена. Обновите страницу и проверьте.')};
});
