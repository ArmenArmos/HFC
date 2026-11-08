"use server";
import {parseLocale,pick} from '@/lib/locale';
import {calendarDate} from '@/lib/staff/yerevan-time';
import {loggedAction} from '@/lib/observability/with-logging';
import {z} from "zod";
import {requireRealAdmin} from "./real-admin";
import {telegramBotUsername} from "@/lib/telegram-runtime/config";
import {staffTelegramEnrolmentEnabled} from "@/lib/telegram-auth/staff-signin";
import {issueStaffRecovery, staffTelegramRecoveryReady} from "@/lib/telegram-auth/staff-recovery";
import {clinicInviteOrigin} from "@/lib/telegram-auth/clinic-invite-config";
import {doctorInvitationOrigin} from "@/lib/messaging/brevo-email";
import {headers} from "next/headers";

/** Admin Telegram controls for staff accounts (T-auth B-1). The link is shown once and never stored here. */
export type StaffTelegramState = {ok: boolean; message: string; url?: string; needsReplace?: boolean};
const issued = z.union([z.object({ok: z.literal(true), token: z.string().regex(/^[A-Za-z0-9_-]{32}$/), expiresAt: z.string()}), z.object({ok: z.literal(false), code: z.string(), since: z.string().nullable().optional(), connectedBy: z.string().nullable().optional()})]);

export const issueStaffTelegramLink=loggedAction("issueStaffTelegramLink",async function issueStaffTelegramLink(_previous: StaffTelegramState, form: FormData): Promise<StaffTelegramState> {
  const locale=parseLocale(form.get('locale'),'en'),t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
  const username = telegramBotUsername();
  if (!staffTelegramEnrolmentEnabled() || !username) return {ok: false, message: t("Telegram is not available yet.","Telegram-ը դեռ հասանելի չէ։","Telegram пока недоступен.")};
  const input = z.object({staffId: z.uuid(), phone: z.string().trim().regex(/^\+[1-9]\d{6,14}$/)}).safeParse({staffId: form.get("staffId"), phone: String(form.get("phone") ?? "").replace(/[\s()-]/g, "")});
  if (!input.success) return {ok: false, message: t("Enter the team member's phone number with the country code, for example +37499123456.","Մուտքագրեք աշխատակցի հեռախոսահամարը՝ երկրի կոդով, օրինակ՝ +37499123456։","Введите номер телефона сотрудника с кодом страны, например +37499123456.")};
  const {client, identity} = await requireRealAdmin();
  const own = identity.id === input.data.staffId;
  try {
    const result = await client.rpc("staff_telegram_enrolment_issue", {p_staff: input.data.staffId, p_phone: input.data.phone, p_replace: form.get("replace") === "true"});
    const parsed = issued.safeParse(result.data);
    if (result.error || !parsed.success) return {ok: false, message: t("The link could not be created. Try again.","Չհաջողվեց ստեղծել հղումը։ Նորից փորձեք։","Не удалось создать ссылку. Попробуйте снова.")};
    if (!parsed.data.ok) {
      const code = parsed.data.code;
      // Fable F-3: an existing connection is replaced only after the admin has seen it and confirmed.
      if (code === "has_binding") return {ok: false, needsReplace: true, message: `${t('Their Telegram is already connected','Telegram-ն արդեն միացված է','Telegram уже подключён')}${parsed.data.since ? ` ${t('since','սկսած','с')} ${calendarDate(new Date(Date.parse(parsed.data.since)+4*3600000).toISOString().slice(0,10),locale)}` : ''}${parsed.data.connectedBy ? ` (${t('connected by','միացրել է՝','подключил(а)')} ${parsed.data.connectedBy})` : ''}. ${t('Creating a new link replaces it when they share their number, and signs them out everywhere. Tick "Replace their current Telegram" to continue.','Նոր հղումը փոխարինում է գործող միացմանը, երբ համարը փոխանցվում է բոտին, և ավարտում է բոլոր մուտքերը։ Շարունակելու համար նշեք «Փոխարինել գործող Telegram-ը»։','Новая ссылка заменит текущее подключение после передачи номера боту и завершит все сеансы. Чтобы продолжить, отметьте «Заменить текущий Telegram».')}`};
      return {ok: false, message: code === "rate_limited" ? t("Several links were created this hour. Try again later.","Այս ժամվա ընթացքում մի քանի հղում է ստեղծվել։ Փորձեք ավելի ուշ։","За этот час уже создано несколько ссылок. Попробуйте позже.")
        : code === "self" ? t("Your Telegram is already connected. To change it, ask another administrator to revoke it, then connect again here.","Ձեր Telegram-ն արդեն միացված է։ Այն փոխելու համար խնդրեք մեկ այլ ադմինիստրատորի անջատել այն, ապա կրկին միացրեք այստեղ։","Ваш Telegram уже подключён. Чтобы изменить его, попросите другого администратора отключить его, затем подключите снова здесь.")
        : code === "admin_target" ? t("Administrator accounts are not connected here. Use the break-glass procedure.","Ադմինիստրատորի հաշիվներն այստեղ չեն միացվում։ Օգտվեք արտակարգ հասանելիության վերականգնման կարգից։","Учётные записи администраторов здесь не подключаются. Используйте процедуру экстренного восстановления доступа.")
        : t("The link could not be created. Check the team member and phone.","Չհաջողվեց ստեղծել հղումը։ Ստուգեք աշխատակցին և հեռախոսահամարը։","Не удалось создать ссылку. Проверьте сотрудника и номер телефона.")};
    }
    if (own) return {ok: true, message: t("Open this link in your own Telegram and share your number in the Noreon bot. It works once, for 72 hours.","Բացեք այս հղումը ձեր Telegram-ում և ձեր համարը փոխանցեք Noreon բոտին։ Հղումը մեկանգամյա է և գործում է 72 ժամ։","Откройте эту ссылку в своём Telegram и передайте свой номер боту Noreon. Ссылка одноразовая и действует 72 часа."), url: `https://t.me/${username}?start=${parsed.data.token}`};
    return {ok: true, message: t("Send this link to the team member. It works once, for 72 hours, and only for that phone number.","Ուղարկեք այս հղումն աշխատակցին։ Այն մեկանգամյա է, գործում է 72 ժամ և միայն նշված հեռախոսահամարի համար։","Отправьте эту ссылку сотруднику. Она одноразовая, действует 72 часа и только для указанного номера телефона."), url: `https://t.me/${username}?start=${parsed.data.token}`};
  } catch {return {ok: false, message: t("The link could not be created. Try again.","Չհաջողվեց ստեղծել հղումը։ Նորից փորձեք։","Не удалось создать ссылку. Попробуйте снова.")};}
});

export const revokeStaffTelegram=loggedAction("revokeStaffTelegram",async function revokeStaffTelegram(_previous: StaffTelegramState, form: FormData): Promise<StaffTelegramState> {
  const locale=parseLocale(form.get('locale'),'en'),t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
  if (!staffTelegramEnrolmentEnabled()) return {ok: false, message: t("Telegram is not available yet.","Telegram-ը դեռ հասանելի չէ։","Telegram пока недоступен.")};
  const staffId = z.uuid().safeParse(form.get("staffId"));
  if (!staffId.success || form.get("confirmed") !== "true") return {ok: false, message: t("Confirm before revoking.","Հաստատեք՝ նախքան անջատելը։","Подтвердите отключение.")};
  const {client} = await requireRealAdmin();
  try {
    const result = await client.rpc("staff_telegram_revoke", {p_staff: staffId.data});
    if (result.error || !z.object({ok: z.literal(true)}).safeParse(result.data).success) return {ok: false, message: t("Revoking was not confirmed. Reload and check before trying again.","Անջատումը չի հաստատվել։ Նորից փորձելուց առաջ թարմացրեք և ստուգեք։","Отключение не подтверждено. Обновите и проверьте перед повторной попыткой.")};
    return {ok: true, message: t("Telegram and all sessions for this team member are revoked. They need a new Telegram link to sign in.","Աշխատակցի Telegram-ն անջատված է, բոլոր մուտքերն ավարտված են։ Մուտք գործելու համար նոր Telegram-ի հղում է պետք։","Telegram сотрудника отключён, все сеансы завершены. Для входа нужна новая ссылка на Telegram.")};
  } catch {return {ok: false, message: t("Revoking was not confirmed. Reload and check before trying again.","Անջատումը չի հաստատվել։ Նորից փորձելուց առաջ թարմացրեք և ստուգեք։","Отключение не подтверждено. Обновите и проверьте перед повторной попыткой.")};}
});

/** Password reset by Telegram (T-auth B-3): the link goes only to the account's own chat. */
export const sendStaffTelegramRecovery=loggedAction("sendStaffTelegramRecovery",async function sendStaffTelegramRecovery(_previous: StaffTelegramState, form: FormData): Promise<StaffTelegramState> {
  const locale=parseLocale(form.get('locale'),'en'),t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
  if (!staffTelegramRecoveryReady()) return {ok: false, message: t("Password reset by Telegram is not available yet.","Telegram-ով գաղտնաբառի վերականգնումը դեռ հասանելի չէ։","Сброс пароля через Telegram пока недоступен.")};
  const input = z.object({staffId: z.uuid(), portal: z.enum(["staff", "clinic"])}).safeParse({staffId: form.get("staffId"), portal: form.get("portal")});
  if (!input.success) return {ok: false, message: t("Reload the page and try again.","Թարմացրեք էջը և նորից փորձեք։","Обновите страницу и попробуйте снова.")};
  let origin: string | null;
  try { origin = input.data.portal === "clinic" ? clinicInviteOrigin((await headers()).get("host")) : doctorInvitationOrigin(); } catch { origin = null; }
  if (!origin) return {ok: false, message: t("Password reset by Telegram is not available yet.","Telegram-ով գաղտնաբառի վերականգնումը դեռ հասանելի չէ։","Сброс пароля через Telegram пока недоступен.")};
  const {client} = await requireRealAdmin();
  const result = await issueStaffRecovery(client, input.data.staffId, input.data.portal, origin).catch(() => ({ok: false, reason: "unavailable"}) as const);
  if (result.ok) return {ok: true, message: t("A password reset link was sent to their Telegram. It works for 24 hours.","Գաղտնաբառի վերականգնման հղումն ուղարկվել է Telegram-ին։ Այն գործում է 24 ժամ։","Ссылка для сброса пароля отправлена в Telegram. Она действует 24 часа.")};
  return {ok: false, message: result.reason === "not_enrolled" ? t("Their Telegram is not connected. Create a Telegram link first.","Telegram-ը միացված չէ։ Նախ ստեղծեք Telegram-ի հղում։","Telegram не подключён. Сначала создайте ссылку на Telegram.")
    : result.reason === "self" ? t("You cannot reset your own password here. Ask another administrator.","Այստեղ չեք կարող վերականգնել ձեր սեփական գաղտնաբառը։ Դիմեք մեկ այլ ադմինիստրատորի։","Здесь нельзя сбросить свой пароль. Обратитесь к другому администратору.")
    : result.reason === "admin_target" ? t("Administrator passwords are not reset here. Use the break-glass procedure.","Ադմինիստրատորի գաղտնաբառերն այստեղ չեն վերականգնվում։ Օգտվեք արտակարգ հասանելիության վերականգնման կարգից։","Пароли администраторов здесь не сбрасываются. Используйте процедуру экстренного восстановления доступа.")
    : result.reason === "recent_binding" ? t("Their Telegram was connected in the last 24 hours, or by you. Ask another administrator, or try again tomorrow.","Telegram-ը միացվել է վերջին 24 ժամում կամ ձեր կողմից։ Դիմեք մեկ այլ ադմինիստրատորի կամ նորից փորձեք վաղը։","Telegram подключён менее 24 часов назад или подключён вами. Обратитесь к другому администратору или попробуйте завтра.")
    : result.reason === "rate_limited" ? t("Several resets were sent this hour. Try again later.","Այս ժամվա ընթացքում մի քանի վերականգնման հղում է ուղարկվել։ Փորձեք ավելի ուշ։","За этот час уже отправлено несколько ссылок для сброса. Попробуйте позже.")
    : result.reason === "not_found" ? t("This account was not found. Reload the page.","Այս հաշիվը չի գտնվել։ Թարմացրեք էջը։","Учётная запись не найдена. Обновите страницу.")
    : t("The reset could not be confirmed as sent. If they did not receive it, send it again; a new link replaces the earlier one.","Չհաջողվեց հաստատել վերականգնման հղման ուղարկումը։ Եթե այն չի ստացվել, նորից ուղարկեք․ նոր հղումը փոխարինում է նախորդին։","Не удалось подтвердить отправку ссылки для сброса. Если она не получена, отправьте снова; новая ссылка заменяет предыдущую.")};
});
