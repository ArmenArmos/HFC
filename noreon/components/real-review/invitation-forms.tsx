'use client';

import {startTransition, useActionState, useEffect, useRef, useState} from 'react';
import {acceptRealDoctorInvitation, acceptTelegramDoctorInvitation, sendTelegramInvitationCode, setRealDoctorPassword, retryRealDoctorActivation} from '@/lib/staff/real-invitation-actions';

type ActionState = {ok: boolean; message: string; passwordSaved?: boolean};
type Invitation = {token: string; invitationId: string; generation: string; type: 'invite' | 'recovery'; telegram?: string};
const initial: ActionState = {ok: false, message: ''};
const inputClass = 'mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-body2';
const buttonClass = 'min-h-11 rounded-md bg-primary px-4 py-2 text-body2 text-primary-foreground disabled:opacity-50';

function parseInvitation(fragment: string): Invitation | null {
  if (fragment.length > 1024) return null;
  const fields = new URLSearchParams(fragment.replace(/^#/, ''));
  // Telegram invitations carry no Supabase token, only the bot start token (T-auth B-2a).
  if (fields.has('telegram')) {
    const tkeys = ['invitation', 'generation', 'telegram'];
    if (tkeys.some(key => fields.getAll(key).length !== 1) || [...fields.keys()].some(key => !tkeys.includes(key))) return null;
    const telegram = fields.get('telegram') ?? '', invitationId = fields.get('invitation') ?? '', generation = fields.get('generation') ?? '';
    if (!/^[A-Za-z0-9_-]{32}$/.test(telegram) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitationId) || !/^[1-9]\d{0,9}$/.test(generation) || Number(generation) > 2147483647) return null;
    return {token: '', invitationId, generation, type: 'invite', telegram};
  }
  const keys = ['token', 'invitation', 'generation', 'type'];
  if (keys.some(key => fields.getAll(key).length !== 1) || [...fields.keys()].some(key => !keys.includes(key))) return null;
  const token = fields.get('token') ?? '';
  const invitationId = fields.get('invitation') ?? '';
  const generation = fields.get('generation') ?? '';
  const type = fields.get('type');
  if (!/^[a-zA-Z0-9_-]{32,256}$/.test(token) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(invitationId)) return null;
  if (!/^[1-9]\d{0,9}$/.test(generation) || !Number.isSafeInteger(Number(generation)) || Number(generation) > 2147483647 || (type !== 'invite' && type !== 'recovery')) return null;
  return {token, invitationId, generation, type};
}

function Feedback({state}: {state: ActionState}) {
  return state.message ? <p role={state.ok ? 'status' : 'alert'} className="text-body2">{state.message}</p> : null;
}

function TelegramInvitationSteps({invitation, botUsername}: {invitation: Invitation; botUsername: string | null}) {
  const [sent, send, sending] = useActionState(sendTelegramInvitationCode, initial);
  const [state, accept, accepting] = useActionState(acceptTelegramDoctorInvitation, initial);
  return <div className="space-y-6">
    <section className="space-y-2" aria-label="Step 1"><p className="text-body2">1. Open the Noreon bot in Telegram and share your phone number when it asks. Use the number your administrator has for you.</p>
      {botUsername ? <a href={`https://t.me/${botUsername}?start=${invitation.telegram}`} target="_blank" rel="noopener noreferrer" className={`${buttonClass} inline-flex items-center`}>Open Telegram</a> : <p role="alert" className="text-body2">Telegram is not available right now.</p>}</section>
    <form action={send} className="space-y-2" aria-label="Step 2">
      <p className="text-body2">2. Then ask for a code. We send it to that Telegram account.</p>
      <input type="hidden" name="invitationId" value={invitation.invitationId}/><input type="hidden" name="generation" value={invitation.generation}/><input type="hidden" name="telegram" value={invitation.telegram}/>
      <button type="submit" disabled={sending} className="min-h-11 rounded-md border px-4 py-2 text-body2 disabled:opacity-50">{sending ? 'Sending…' : sent.ok ? 'Send a new code' : 'Send me a code'}</button>
      <Feedback state={sent}/>
    </form>
    <form action={accept} className="space-y-2" aria-label="Step 3" aria-busy={accepting}>
      <input type="hidden" name="invitationId" value={invitation.invitationId}/><input type="hidden" name="generation" value={invitation.generation}/>
      <label className="block text-body2">3. Code from Telegram<input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required className={inputClass}/></label>
      <button type="submit" disabled={accepting} className={buttonClass}>{accepting ? 'Checking…' : 'Confirm and continue'}</button>
      <Feedback state={state}/>
    </form>
  </div>;
}

export function AcceptDoctorInvitationForm({botUsername = null}: {botUsername?: string | null}) {
  const [invitation, setInvitation] = useState<Invitation | null | undefined>(undefined);
  const parsed = useRef(false);
  const [state, action, pending] = useActionState(acceptRealDoctorInvitation, initial);
  useEffect(() => {
    if (parsed.current) return;
    parsed.current = true;
    const payload = parseInvitation(window.location.hash);
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    startTransition(() => setInvitation(payload));
  }, []);
  if (invitation === undefined) return <p role="status" className="text-body2 text-muted-foreground">Checking your invitation…</p>;
  if (!invitation) return <p role="alert" className="text-body2">Open your invitation link again. If it still does not work, ask your administrator for a new invitation.</p>;
  if (invitation.telegram) return <TelegramInvitationSteps invitation={invitation} botUsername={botUsername}/>;
  return <form action={action} className="space-y-4" aria-label="Accept invitation" aria-busy={pending}>
    <input type="hidden" name="token" value={invitation.token}/>
    <input type="hidden" name="invitationId" value={invitation.invitationId}/>
    <input type="hidden" name="generation" value={invitation.generation}/>
    <input type="hidden" name="type" value={invitation.type}/>
    <button type="submit" disabled={pending || state.ok} className={buttonClass}>{pending ? 'Verifying invitation…' : 'Verify email'}</button>
    <Feedback state={state}/>
  </form>;
}

function PasswordFields({disabled}: {disabled: boolean}) {
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  return <fieldset disabled={disabled} className="space-y-3">
    <label className="block text-body2">Password<input type="password" name="password" value={password} onChange={event => setPassword(event.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" className={inputClass}/></label>
    <label className="block text-body2">Confirm password<input type="password" name="confirmation" value={confirmation} onChange={event => setConfirmation(event.target.value)} required minLength={12} maxLength={128} autoComplete="new-password" className={inputClass}/></label>
    <p className="text-caption text-muted-foreground">Use at least 12 characters.</p>
  </fieldset>;
}

export function SetDoctorPasswordForm() {
  const [state, action, pending] = useActionState(setRealDoctorPassword, initial);
  if (state.passwordSaved) return <div className="space-y-4"><Feedback state={state}/><RetryDoctorActivationForm/></div>;
  return <form action={action} className="space-y-4" aria-label="Set your password" aria-busy={pending}>
    <PasswordFields disabled={pending || state.ok}/>
    <button type="submit" disabled={pending || state.ok} className={buttonClass}>{pending ? 'Saving your password…' : 'Set password'}</button>
    <Feedback state={state}/>
  </form>;
}

export function RetryDoctorActivationForm() {
  const [state, action, pending] = useActionState(retryRealDoctorActivation, initial);
  return <form action={action} className="space-y-4" aria-label="Activate your workspace" aria-busy={pending}>
    <button type="submit" disabled={pending || state.ok} className={buttonClass}>{pending ? 'Activating your workspace…' : 'Retry activation'}</button>
    <Feedback state={state}/>
  </form>;
}
