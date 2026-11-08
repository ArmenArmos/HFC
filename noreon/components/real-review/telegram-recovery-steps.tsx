'use client';

import {startTransition, useActionState, useEffect, useState} from 'react';
import {pick, type Locale} from '@/lib/locale';
import {completeTelegramRecovery, sendTelegramRecoveryCode, type RecoveryStepState} from '@/lib/telegram-auth/recovery-actions';

/** Password reset by Telegram (T-auth B-3): the link came to the account's own Telegram chat. */
type Recovery = {recoveryId: string; token: string};
const initial: RecoveryStepState = {ok: false, message: ''};
const inputClass = 'mt-1 min-h-12 w-full rounded-md border bg-background px-3 py-2 text-body2';
const buttonClass = 'min-h-12 rounded-md bg-primary px-4 py-2 text-body2 text-primary-foreground disabled:opacity-50';
const KEY = 'noreon-telegram-recovery';

function parse(fragment: string): Recovery | null {
  if (fragment.length > 256) return null;
  const fields = new URLSearchParams(fragment.replace(/^#/, '')), keys = ['recovery', 'token'];
  if (keys.some(key => fields.getAll(key).length !== 1) || [...fields.keys()].some(key => !keys.includes(key))) return null;
  const recoveryId = fields.get('recovery') ?? '', token = fields.get('token') ?? '';
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(recoveryId) || !/^[A-Za-z0-9_-]{32}$/.test(token)) return null;
  return {recoveryId, token};
}
function stored(): Recovery | null {
  try { const v = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null'); return v ? parse(new URLSearchParams({recovery: v.recoveryId, token: v.token}).toString()) : null; } catch { return null; }
}
function Feedback({state}: {state: RecoveryStepState}) {
  return state.message ? <p role={state.ok ? 'status' : 'alert'} className="text-body2">{state.message}</p> : null;
}

export function TelegramRecoverySteps({locale}: {locale: Locale}) {
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  const [recovery, setRecovery] = useState<Recovery | null | undefined>(undefined);
  const [sent, send, sending] = useActionState(sendTelegramRecoveryCode, initial);
  const [state, complete, completing] = useActionState(completeTelegramRecovery, initial);
  useEffect(() => {
    // Read once, then keep the link out of the address bar and history (this tab keeps a copy).
    const parsed = parse(window.location.hash);
    if (parsed) { try { window.sessionStorage.setItem(KEY, JSON.stringify(parsed)); } catch {} }
    const found = parsed ?? stored();
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
    startTransition(() => setRecovery(found));
  }, []);
  if (recovery === undefined) return null;
  if (!recovery) return <p role="alert" className="text-body2">{t('This reset link is not valid. Ask your administrator to send a new one.', 'Վերականգնման հղումը վավեր չէ։ Խնդրեք ադմինիստրատորին ուղարկել նորը։', 'Эта ссылка для восстановления недействительна. Попросите администратора отправить новую.')}</p>;
  const hidden = <><input type="hidden" name="recoveryId" value={recovery.recoveryId}/><input type="hidden" name="token" value={recovery.token}/><input type="hidden" name="locale" value={locale}/></>;
  return <div className="space-y-6">
    <form action={send} className="space-y-2">
      <p className="text-body2">{t('1. Ask for a code. We send it to the Telegram account connected to your Noreon account.', '1. Խնդրեք կոդը։ Այն կուղարկենք ձեր Noreon հաշվին միացված Telegram-ին։', '1. Запросите код. Мы отправим его в Telegram, связанный с вашей учётной записью Noreon.')}</p>
      {hidden}
      <button type="submit" disabled={sending} className={buttonClass}>{t('Send the code', 'Ուղարկել կոդը', 'Отправить код')}</button>
      <Feedback state={sent}/>
    </form>
    <form action={complete} className="space-y-3">
      {hidden}
      <label className="block text-body2">{t('2. Code from Telegram', '2. Կոդը Telegram-ից', '2. Код из Telegram')}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className={inputClass}/></label>
      <label className="block text-body2">{t('New password (at least 12 characters)', 'Նոր գաղտնաբառ (առնվազն 12 նիշ)', 'Новый пароль (не менее 12 символов)')}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required className={inputClass}/></label>
      <label className="block text-body2">{t('Repeat the password', 'Կրկնեք գաղտնաբառը', 'Повторите пароль')}<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required className={inputClass}/></label>
      <p className="text-caption text-muted-foreground">{t('This signs you out everywhere. Then sign in with the new password.', 'Սա դուրս կբերի ձեզ բոլոր սարքերից։ Այնուհետև մուտք գործեք նոր գաղտնաբառով։', 'Вы выйдете из учётной записи на всех устройствах. Затем войдите с новым паролем.')}</p>
      <button type="submit" disabled={completing} className={buttonClass}>{t('Set new password', 'Պահպանել նոր գաղտնաբառը', 'Установить новый пароль')}</button>
      <Feedback state={state}/>
    </form>
  </div>;
}
