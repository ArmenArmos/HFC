'use client';

import {pick, type Locale} from '@/lib/locale';
import {startTransition, useActionState, useEffect, useState} from 'react';
import {acceptClinicInvitation, sendClinicInvitationCode, type ClinicInviteState} from '@/app/clinic/real/invite/actions';

/** Clinic invitation by Telegram (T-auth B-2b-2): open the bot, share the number, get a code, set a password. */
type Invitation = {invitationId: string; generation: string; telegram: string};
const initial: ClinicInviteState = {ok: false, message: ''};
const inputClass = 'mt-1 min-h-12 w-full rounded-md border bg-background px-3 py-2 text-body2';
const buttonClass = 'min-h-12 rounded-md bg-primary px-4 py-2 text-body2 text-primary-foreground disabled:opacity-50';

function parseInvitation(fragment: string): Invitation | null {
  if (fragment.length > 512) return null;
  const fields = new URLSearchParams(fragment.replace(/^#/, ''));
  const keys = ['invitation', 'generation', 'telegram'];
  if (keys.some(key => fields.getAll(key).length !== 1) || [...fields.keys()].some(key => !keys.includes(key))) return null;
  const telegram = fields.get('telegram') ?? '', invitationId = fields.get('invitation') ?? '', generation = fields.get('generation') ?? '';
  if (!/^[A-Za-z0-9_-]{32}$/.test(telegram) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitationId) || !/^[1-9]\d{0,9}$/.test(generation) || Number(generation) > 2147483647) return null;
  return {invitationId, generation, telegram};
}

function Feedback({state}: {state: ClinicInviteState}) {
  return state.message ? <p role={state.ok ? 'status' : 'alert'} className="text-body2">{state.message}</p> : null;
}

export function ClinicInvitationSteps({botUsername, locale}: {botUsername: string | null; locale: Locale}) {
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  const [invitation, setInvitation] = useState<Invitation | null | undefined>(undefined);
  const [sent, send, sending] = useActionState(sendClinicInvitationCode, initial);
  const [state, accept, accepting] = useActionState(acceptClinicInvitation, initial);
  useEffect(() => {
    // Read once, then keep the link out of the address bar and history.
    const parsed = parseInvitation(window.location.hash);
    if (parsed) sessionStorageSet(parsed);
    const found = parsed ?? sessionStorageGet();
    startTransition(() => setInvitation(found));
    if (window.location.hash) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }, []);
  if (invitation === undefined) return null;
  if (!invitation) return <p role="alert" className="text-body2">{t('This invitation link is not valid. Ask your Noreon administrator for a new one.', 'Հրավերի հղումը վավեր չէ։ Նորը խնդրեք Նորեոն Հելթի ադմինիստրատորից։', 'Эта ссылка приглашения недействительна. Попросите администратора Нореон Хелс прислать новую.')}</p>;
  const hidden = <><input type="hidden" name="invitationId" value={invitation.invitationId}/><input type="hidden" name="generation" value={invitation.generation}/><input type="hidden" name="telegram" value={invitation.telegram}/><input type="hidden" name="locale" value={locale}/></>;
  return <div className="space-y-6">
    <section className="space-y-2" aria-label={t('Step 1', 'Քայլ 1', 'Шаг 1')}>
      <p className="text-body2">{t('1. Open the Noreon bot in Telegram and share your phone number when it asks. Use the number your administrator has for you.', '1. Բացեք Նորեոն Հելթ բոտը Telegram-ում և կիսվեք ձեր հեռախոսահամարով, երբ այն խնդրի։ Օգտագործեք այն համարը, որը տվել եք ադմինիստրատորին։', '1. Откройте бота Нореон Хелс в Telegram и поделитесь своим номером телефона, когда бот попросит. Используйте номер, который указан у вашего администратора.')}</p>
      {botUsername ? <a href={`https://t.me/${botUsername}?start=${invitation.telegram}`} target="_blank" rel="noopener noreferrer" className={`${buttonClass} inline-flex items-center`}>{t('Open Telegram', 'Բացել Telegram-ը', 'Открыть Telegram')}</a> : <p role="alert" className="text-body2">{t('Telegram is not available right now.', 'Telegram-ն այս պահին հասանելի չէ։', 'Telegram сейчас недоступен.')}</p>}
    </section>
    <form action={send} className="space-y-2" aria-label={t('Step 2', 'Քայլ 2', 'Шаг 2')}>
      <p className="text-body2">{t('2. Then ask for a code. We send it to that Telegram account.', '2. Այնուհետև խնդրեք կոդը։ Այն կուղարկենք այդ Telegram հաշվին։', '2. Затем запросите код. Мы отправим его в этот аккаунт Telegram.')}</p>
      {hidden}
      <button type="submit" disabled={sending} className={buttonClass}>{t('Send the code', 'Ուղարկել կոդը', 'Отправить код')}</button>
      <Feedback state={sent}/>
    </form>
    <form action={accept} className="space-y-3" aria-label={t('Step 3', 'Քայլ 3', 'Шаг 3')}>
      {hidden}
      <label className="block text-body2">{t('3. Code from Telegram', '3. Կոդը Telegram-ից', '3. Код из Telegram')}<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className={inputClass}/></label>
      <label className="block text-body2">{t('New password (at least 12 characters)', 'Նոր գաղտնաբառ (առնվազն 12 նիշ)', 'Новый пароль (не менее 12 символов)')}<input name="password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required className={inputClass}/></label>
      <label className="block text-body2">{t('Repeat the password', 'Կրկնեք գաղտնաբառը', 'Повторите пароль')}<input name="confirmation" type="password" autoComplete="new-password" minLength={12} maxLength={128} required className={inputClass}/></label>
      <button type="submit" disabled={accepting} className={buttonClass}>{t('Set password and continue', 'Պահպանել գաղտնաբառը և շարունակել', 'Сохранить пароль и продолжить')}</button>
      <Feedback state={state}/>
    </form>
  </div>;
}

// Keeps the invitation across a reload after the fragment was removed (this tab only).
const KEY = 'noreon-clinic-invitation';
function sessionStorageSet(value: Invitation) { try { window.sessionStorage.setItem(KEY, JSON.stringify(value)); } catch {} }
function sessionStorageGet(): Invitation | null {
  try { const v = JSON.parse(window.sessionStorage.getItem(KEY) ?? 'null'); return v && parseInvitation(new URLSearchParams({invitation: v.invitationId, generation: v.generation, telegram: v.telegram}).toString()); } catch { return null; }
}
