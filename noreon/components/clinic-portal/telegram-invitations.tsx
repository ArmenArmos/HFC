'use client';

import {pick, type Locale} from '@/lib/locale';
import {useActionState, useState} from 'react';
import {inviteClinicUser, reissueClinicUserInvitation, revokeClinicUserInvitation, type ClinicInviteAdminState} from '@/lib/clinic-portal/invitation-admin-actions';
import type {ClinicInvitation} from '@/lib/telegram-auth/clinic-invite';

/** Admin: invite a new clinic user by Telegram, and manage open invitations (T-auth B-2b-2). */
const initial: ClinicInviteAdminState = {ok: false, message: ''};
const inputClass = 'mt-1 block min-h-12 w-full rounded-md border bg-background px-4 text-body2';
const buttonClass = 'min-h-12 rounded-md border px-4 text-body2 disabled:opacity-50';

function Result({state, locale}: {state: ClinicInviteAdminState; locale: Locale}) {
  if (!state.message) return null;
  return <div role={state.ok ? 'status' : 'alert'} className="space-y-2 text-body2"><p>{state.message}</p>
    {state.url && <><input readOnly value={state.url} aria-label={pick(locale, {en: 'Invitation link', hy: 'Հրավերի հղում', ru: 'Ссылка приглашения'})} className={inputClass} onFocus={event => event.currentTarget.select()}/>
      <button type="button" className={buttonClass} onClick={() => navigator.clipboard?.writeText(state.url!)}>{pick(locale, {en: 'Copy link', hy: 'Պատճենել հղումը', ru: 'Скопировать ссылку'})}</button></>}
  </div>;
}

function OpenInvitation({invitation, clinicId, locale}: {invitation: ClinicInvitation; clinicId: string; locale: Locale}) {
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  const [reissued, reissue, reissuing] = useActionState(reissueClinicUserInvitation, initial);
  const [revoked, revoke, revoking] = useActionState(revokeClinicUserInvitation, initial);
  const [confirmed, setConfirmed] = useState(false);
  const status = {pending: t('Waiting for the user', 'Սպասում է օգտատիրոջը', 'Ожидает сотрудника'), verified: t('Code confirmed, password not set', 'Կոդը հաստատված է, գաղտնաբառը սահմանված չէ', 'Код подтверждён, пароль не задан'), revoked: t('Cancelled', 'Չեղարկված', 'Отменено'), expired: t('Expired', 'Ժամկետանց', 'Срок действия истёк'), accepted: t('Accepted', 'Ընդունված', 'Принято')}[invitation.status];
  const hidden = <><input type="hidden" name="clinicId" value={clinicId}/><input type="hidden" name="invitationId" value={invitation.id}/><input type="hidden" name="generation" value={invitation.generation}/><input type="hidden" name="locale" value={locale}/></>;
  return <li className="space-y-3 p-4">
    <p className="text-body2 font-medium break-words">{invitation.name} · {invitation.email}</p>
    <p className="text-caption text-muted-foreground">{invitation.phone} · {status}</p>
    <details><summary className="min-h-11 cursor-pointer text-body2">{t('New link', 'Նոր հղում', 'Новая ссылка')}</summary>
      <form action={reissue} className="mt-2 space-y-2">{hidden}
        <label className="block text-caption">{t('Phone number', 'Հեռախոսահամար', 'Номер телефона')}<input name="phone" type="tel" required defaultValue={invitation.phone} className={inputClass}/></label>
        <button type="submit" disabled={reissuing} className={buttonClass}>{t('Create a new link', 'Ստեղծել նոր հղում', 'Создать новую ссылку')}</button>
        <p className="text-caption text-muted-foreground">{t('The previous link stops working.', 'Նախորդ հղումն այլևս չի գործի։', 'Предыдущая ссылка перестанет работать.')}</p>
        <Result state={reissued} locale={locale}/>
      </form>
    </details>
    {invitation.status !== 'revoked' && <form action={revoke} className="space-y-2">{hidden}
      <label className="flex min-h-11 items-start gap-2 text-caption"><input type="checkbox" name="confirmed" value="true" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} className="mt-1"/>{t('Cancel this invitation. Its link stops working.', 'Չեղարկել այս հրավերը։ Հղումն այլևս չի գործի։', 'Отменить это приглашение. Его ссылка перестанет работать.')}</label>
      <button type="submit" disabled={!confirmed || revoking} className={buttonClass}>{t('Cancel invitation', 'Չեղարկել հրավերը', 'Отменить приглашение')}</button>
      <Result state={revoked} locale={locale}/>
    </form>}
  </li>;
}

export function ClinicTelegramInvitations({clinicId, invitations, requestId, locale}: {clinicId: string; invitations: ClinicInvitation[] | null; requestId: string; locale: Locale}) {
  const t = (en: string, hy: string, ru: string) => pick(locale, {en, hy, ru});
  const [state, invite, inviting] = useActionState(inviteClinicUser, initial);
  return <section className="space-y-4 rounded-xl border p-4" aria-labelledby="clinic-telegram-invite">
    <h2 id="clinic-telegram-invite" className="text-h3">{t('Invite a new clinic user by Telegram', 'Հրավիրել կլինիկայի նոր օգտատիրոջ Telegram-ով', 'Пригласить нового сотрудника клиники через Telegram')}</h2>
    <p className="text-body2 text-muted-foreground">{t('For someone without a Noreon account. No email is sent: you pass on one link.', 'Նորեոն Հելթ հաշիվ չունեցողի համար։ Էլ. նամակ չի ուղարկվում. դուք փոխանցում եք մեկ հղում։', 'Для человека без аккаунта Нореон Хелс. Письмо не отправляется: вы передаёте одну ссылку.')}</p>
    <form action={invite} className="space-y-3">
      <input type="hidden" name="clinicId" value={clinicId}/><input type="hidden" name="requestId" value={requestId}/><input type="hidden" name="locale" value={locale}/>
      <label className="block text-caption">{t('Name', 'Անուն', 'Имя')}<input name="name" required maxLength={180} className={inputClass}/></label>
      <label className="block text-caption">{t('Email (their sign-in name)', 'Էլ. հասցե (մուտքի անունը)', 'Электронная почта (для входа)')}<input name="email" type="email" required maxLength={320} className={inputClass}/></label>
      <label className="block text-caption">{t('Phone number in Telegram', 'Հեռախոսահամարը Telegram-ում', 'Номер телефона в Telegram')}<input name="phone" type="tel" required placeholder="+374" className={inputClass}/></label>
      <button type="submit" disabled={inviting} className={buttonClass}>{t('Create invitation link', 'Ստեղծել հրավերի հղում', 'Создать ссылку приглашения')}</button>
      <Result state={state} locale={locale}/>
    </form>
    <h3 className="text-body1 font-medium">{t('Open invitations', 'Բաց հրավերներ', 'Открытые приглашения')}</h3>
    {invitations === null ? <p role="alert" className="text-body2">{t('Invitations could not be loaded.', 'Հրավերները չհաջողվեց բեռնել։', 'Не удалось загрузить приглашения.')}</p>
      : invitations.length === 0 ? <p className="text-body2 text-muted-foreground">{t('No open invitations.', 'Բաց հրավերներ չկան։', 'Нет открытых приглашений.')}</p>
      : <ul className="divide-y rounded-lg border">{invitations.map(i => <OpenInvitation key={i.id} invitation={i} clinicId={clinicId} locale={locale}/>)}</ul>}
  </section>;
}
