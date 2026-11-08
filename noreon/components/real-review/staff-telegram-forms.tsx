'use client';
import {pick,type Locale} from '@/lib/locale';
import {useActionState, useState} from 'react';
import {issueStaffTelegramLink, revokeStaffTelegram, sendStaffTelegramRecovery, type StaffTelegramState} from '@/lib/staff/real-telegram-actions';

const idle: StaffTelegramState = {ok: false, message: ''};
const buttonClass = 'inline-flex min-h-11 items-center rounded-md border px-4 text-body2 disabled:opacity-60';

export function StaffTelegramControls({staffId, name, recovery = false, locale='en'}: {locale?:Locale;staffId: string; name: string; recovery?: false | 'staff' | 'clinic'}) {
  const t=(en:string,hy:string,ru:string)=>pick(locale,{en,hy,ru});
  const [link, issue, issuing] = useActionState(issueStaffTelegramLink, idle);
  const [revoked, revoke, revoking] = useActionState(revokeStaffTelegram, idle);
  const [confirmed, setConfirmed] = useState(false);
  const [reset, sendReset, resetting] = useActionState(sendStaffTelegramRecovery, idle);
  return <div className="space-y-5">
    <form action={issue} className="space-y-3" aria-label={t(`Telegram link for ${name}`,`Telegram-ի հղում՝ ${name}`,`Ссылка на Telegram для ${name}`)}>
      <input type="hidden" name="locale" value={locale}/><input type="hidden" name="staffId" value={staffId}/>
      <label className="block text-caption">{t("Their phone number","Հեռախոսահամարը","Номер телефона")}<input name="phone" type="tel" required placeholder="+374" className="mt-2 block min-h-12 w-full rounded-md border bg-background px-4 text-body2"/></label>
      <p className="text-caption text-muted-foreground">{t("They open the link and share this number in the Noreon bot. A new link replaces any earlier one.","Հղումը բացելուց հետո պետք է այս համարը փոխանցել Նորեոն Հելթ բոտին։ Նոր հղումը փոխարինում է նախորդին։","После открытия ссылки нужно передать этот номер боту Нореон Хелс. Новая ссылка заменяет предыдущую.")}</p>
      {link.needsReplace && <label className="flex min-h-11 items-start gap-2 text-caption"><input type="checkbox" name="replace" value="true" className="mt-1"/>{t("Replace their current Telegram","Փոխարինել գործող Telegram-ը","Заменить текущий Telegram")}</label>}
      <button type="submit" disabled={issuing} className={buttonClass}>{issuing ? t("Creating link…","Հղումը ստեղծվում է…","Создание ссылки…") : t("Create Telegram link","Ստեղծել Telegram-ի հղում","Создать ссылку на Telegram")}</button>
      {link.message && <p role={link.ok ? 'status' : 'alert'} className={link.ok ? 'text-caption' : 'text-caption text-destructive'}>{link.message}</p>}
      {link.url && <p className="break-all rounded-md bg-background p-3 font-mono text-caption">{link.url}</p>}
    </form>
    {recovery && <form action={sendReset} className="space-y-3" aria-label={t(`Password reset for ${name}`,`Գաղտնաբառի վերականգնում՝ ${name}`,`Сброс пароля для ${name}`)}>
      <input type="hidden" name="locale" value={locale}/><input type="hidden" name="staffId" value={staffId}/><input type="hidden" name="portal" value={recovery}/>
      <p className="text-caption text-muted-foreground">{t("Sends a password reset link to their connected Telegram. It works for 24 hours; a new one replaces it. For safety, a different administrator must send it if you connected their Telegram, and no one can send it in the first 24 hours after Telegram is connected.","Գաղտնաբառի վերականգնման հղումն ուղարկվում է միացված Telegram-ին։ Այն գործում է 24 ժամ․ նոր հղումը փոխարինում է նախորդին։ Եթե Telegram-ը միացրել եք դուք, անվտանգության համար հղումը պետք է ուղարկի մեկ այլ ադմինիստրատոր։ Միացումից հետո առաջին 24 ժամում ոչ ոք չի կարող այն ուղարկել։","Ссылка для сброса пароля отправляется в подключённый Telegram. Она действует 24 часа; новая ссылка заменяет предыдущую. Если Telegram подключили вы, для безопасности ссылку должен отправить другой администратор. В первые 24 часа после подключения её не может отправить никто.")}</p>
      <button type="submit" disabled={resetting} className={buttonClass}>{resetting ? t("Sending…","Ուղարկվում է…","Отправка…") : t("Send password reset to Telegram","Ուղարկել գաղտնաբառի վերականգնման հղումը Telegram-ին","Отправить ссылку для сброса пароля в Telegram")}</button>
      {reset.message && <p role={reset.ok ? 'status' : 'alert'} className={reset.ok ? 'text-caption' : 'text-caption text-destructive'}>{reset.message}</p>}
    </form>}
    <form action={revoke} className="space-y-3" aria-label={t(`Revoke Telegram for ${name}`,`Անջատել Telegram-ը՝ ${name}`,`Отключить Telegram для ${name}`)}>
      <input type="hidden" name="locale" value={locale}/><input type="hidden" name="staffId" value={staffId}/>
      <label className="flex min-h-11 items-start gap-2 text-caption"><input type="checkbox" name="confirmed" value="true" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1"/>{t("Disconnect their Telegram and sign them out everywhere. Their account access stays.","Անջատել Telegram-ը և ավարտել բոլոր մուտքերը։ Հաշվի հասանելիությունը մնում է։","Отключить Telegram и завершить все сеансы. Доступ к учётной записи сохранится.")}</label>
      <button type="submit" disabled={!confirmed || revoking} className={buttonClass}>{revoking ? t("Revoking…","Անջատվում է…","Отключение…") : t("Revoke Telegram and sessions","Անջատել Telegram-ը և բոլոր մուտքերը","Отключить Telegram и завершить все сеансы")}</button>
      {revoked.message && <p role={revoked.ok ? 'status' : 'alert'} className={revoked.ok ? 'text-caption' : 'text-caption text-destructive'}>{revoked.message}</p>}
    </form>
  </div>;
}
