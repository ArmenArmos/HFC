'use client';

import {useActionState, useState} from 'react';
import {useRouter} from 'next/navigation';
import {Select} from '@base-ui/react/select';
import {ChevronDown, Check} from 'lucide-react';
import {createRealClinic, inviteRealStaff, reissueRealStaffInvitation} from '@/lib/staff/real-admin-actions';

type ActionState = {ok: boolean; message: string; reservationCreated?: boolean; submittedGeneration?: number; outcomeUnknown?: boolean; operationCreated?: boolean};
const initial: ActionState = {ok: false, message: ''};
const inputClass = 'mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-body2';
const buttonClass = 'min-h-11 rounded-md bg-primary px-4 py-2 text-body2 text-primary-foreground disabled:opacity-50';

function Feedback({state}: {state: ActionState}) {
  return state.message ? <p role={state.ok ? 'status' : 'alert'} className="text-body2">{state.message}</p> : null;
}

function useAdminAction(serverAction: (previous: ActionState, data: FormData) => Promise<ActionState>) {
  const router = useRouter();
  return useActionState(async (previous: ActionState, data: FormData): Promise<ActionState> => {
    const generation = Number(data.get('generation'));
    try {
      const result = await serverAction(previous, data);
      if (result.ok || result.reservationCreated || result.outcomeUnknown) router.refresh();
      return {...result, submittedGeneration: Number.isSafeInteger(generation) && generation > 0 ? generation : undefined};
    } catch {
      router.refresh();
      return {ok: false, outcomeUnknown: true, submittedGeneration: Number.isSafeInteger(generation) && generation > 0 ? generation : undefined, message: 'The result is unconfirmed. Check the directory before making another change.'};
    }
  }, initial);
}

export function AddClinicForm() {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [state, action, pending] = useAdminAction(createRealClinic);
  return <form action={action} className="space-y-3" aria-label="Add clinic" aria-busy={pending}>
    <fieldset disabled={pending || state.ok} className="grid gap-3 sm:grid-cols-2">
      <label className="text-body2">Clinic name<input name="name" value={name} onChange={event => setName(event.target.value)} required maxLength={160} className={inputClass}/></label>
      <label className="text-body2">Address<input name="address" value={address} onChange={event => setAddress(event.target.value)} required maxLength={500} className={inputClass}/></label>
    </fieldset>
    <button type="submit" disabled={pending || state.ok} className={buttonClass}>{pending ? 'Saving clinic…' : 'Add clinic'}</button>
    <Feedback state={state}/>
    {state.ok && <a href="/staff/real/clinics" className="inline-flex min-h-11 items-center text-body2 underline">Add another clinic</a>}
  </form>;
}

export type ClinicOption = {id: string; name: string; active: boolean};
export function AddStaffForm({clinics, ready, requestId, telegram = false}: {clinics: ClinicOption[]; ready: boolean; requestId: string; telegram?: boolean}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [clinicId, setClinicId] = useState('');
  const [role, setRole] = useState<'doctor' | 'nurse'>('doctor');
  const [operationId] = useState(requestId);
  const [state, action, pending] = useAdminAction(inviteRealStaff);
  const activeClinics = clinics.filter(clinic => clinic.active);
  const disabled = !ready || activeClinics.length === 0 || pending || state.ok || !!state.reservationCreated || !!state.outcomeUnknown;
  return <form action={action} className="space-y-3" aria-label="Add clinical staff" aria-busy={pending}>
    <input type="hidden" name="requestId" value={operationId}/>
    <fieldset disabled={disabled} className="grid gap-3 sm:grid-cols-2">
      <div className="flex gap-4 sm:col-span-2" role="group" aria-label="Staff role">{(['doctor', 'nurse'] as const).map(value => <label key={value} className="flex min-h-11 items-center gap-2 text-body2"><input type="radio" name="role" value={value} checked={role === value} onChange={() => setRole(value)}/>{value === 'doctor' ? 'Doctor' : 'Nurse'}</label>)}</div>
      <label className="text-body2">Full name<input name="name" value={name} onChange={event => setName(event.target.value)} required maxLength={160} autoComplete="name" className={inputClass}/></label>
      <label className="text-body2">Email<input type="email" name="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={254} autoComplete="email" className={inputClass}/></label>
      {telegram && <label className="text-body2 sm:col-span-2">Phone number for Telegram<input type="tel" name="phone" required placeholder="+374" autoComplete="off" className={inputClass}/><span className="mt-1 block text-caption text-muted-foreground">They confirm this number in the Noreon bot before they can set a password.</span></label>}
      <div className="min-w-0 sm:col-span-2"><ClinicSelect clinics={activeClinics} value={clinicId} onChange={setClinicId} disabled={disabled}/></div>
    </fieldset>
    <button type="submit" disabled={disabled} className={buttonClass}>{pending ? 'Sending invitation…' : role === 'nurse' ? 'Add nurse' : 'Add doctor'}</button>
    {!ready ? <p role="status" className="text-body2 text-muted-foreground">Invitations are unavailable until invitation setup is complete.</p> : activeClinics.length === 0 ? <p role="status" className="text-body2 text-muted-foreground">Add an active clinic before inviting staff. <a href="/staff/real/clinics" className="underline">Open Clinics</a>.</p> : null}
    <Feedback state={state}/>
    {'inviteUrl' in state && typeof state.inviteUrl === 'string' && <p className="break-all rounded-md bg-muted/40 p-3 font-mono text-caption">{state.inviteUrl}</p>}
    {(state.ok || state.reservationCreated || state.outcomeUnknown) && <div className="flex flex-wrap gap-x-4"><a href="/staff/real/doctors" className="inline-flex min-h-11 items-center text-body2 underline">Back to staff list</a><a href="/staff/real/doctors" className="inline-flex min-h-11 items-center text-body2 underline">Add another team member</a></div>}
  </form>;
}

export function ReissueDoctorInvitationForm({invitationId, generation, requestId, disabled = false, replaceSetup = false, telegram = false}: {invitationId: string; generation: number; requestId: string; disabled?: boolean; replaceSetup?: boolean; telegram?: boolean}) {
  const [state, action, pending] = useAdminAction(reissueRealStaffInvitation);
  const [operation, setOperation] = useState({generation, requestId, confirmed: false});
  if (!pending && operation.generation !== generation) setOperation({generation, requestId, confirmed: false});
  const completedGeneration = state.ok && state.submittedGeneration === generation;
  const unknownGeneration = state.outcomeUnknown && (state.submittedGeneration === undefined || state.submittedGeneration === generation);
  return <form action={action} className="space-y-2" aria-label="Send new invitation" aria-busy={pending}>
    <input type="hidden" name="invitationId" value={invitationId}/>
    <input type="hidden" name="generation" value={generation}/>
    <input type="hidden" name="requestId" value={operation.requestId}/>
    {telegram && <label className="block max-w-xs text-caption">Phone number for Telegram<input type="tel" name="phone" required placeholder="+374" autoComplete="off" disabled={disabled || pending} className="mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-body2"/></label>}
    {replaceSetup && <label className="flex max-w-xs items-start gap-2 text-caption"><input type="checkbox" required checked={operation.confirmed} onChange={event => setOperation({...operation, confirmed: event.target.checked})} disabled={disabled || pending} className="mt-1"/>Replacing this invitation invalidates the current setup.</label>}
    <button type="submit" disabled={disabled || pending || completedGeneration || unknownGeneration || (replaceSetup && !operation.confirmed)} className="min-h-11 rounded-md border px-3 py-2 text-body2 disabled:opacity-50">{pending ? 'Sending invitation…' : replaceSetup ? 'Replace invitation' : 'Send new invitation'}</button>
    <Feedback state={state}/>
    {'inviteUrl' in state && typeof state.inviteUrl === 'string' && <p className="break-all rounded-md bg-muted/40 p-3 font-mono text-caption">{state.inviteUrl}</p>}
    {unknownGeneration && <a href="/staff/real/doctors" className="inline-flex min-h-11 items-center text-caption underline">Reload directory</a>}
  </form>;
}

// Keep the existing import usable while the real directory now offers both roles.
export const AddDoctorForm = AddStaffForm;

export function ClinicSelect({clinics, value, onChange, disabled = false}: {clinics: ClinicOption[]; value: string; onChange: (value: string) => void; disabled?: boolean}) {
  const selected = clinics.find(clinic => clinic.id === value);
  return <div className="min-w-0 space-y-1">
    <span className="text-body2">Clinic</span>
    {disabled && <input type="hidden" name="clinicId" value={value}/>}
    <Select.Root name={disabled ? undefined : 'clinicId'} value={value || null} onValueChange={next => onChange(next ?? '')} disabled={disabled} required>
      <Select.Trigger aria-label="Clinic" className="flex min-h-11 w-full min-w-0 items-center justify-between gap-3 rounded-md border bg-background px-3 py-2 text-left text-body2 focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50">
        <span className="min-w-0 flex-1 whitespace-normal break-words">{selected?.name ?? 'Choose a clinic'}</span><Select.Icon><ChevronDown className="size-4 shrink-0" aria-hidden/></Select.Icon>
      </Select.Trigger>
      <Select.Portal><Select.Positioner sideOffset={4} align="start" alignItemWithTrigger={false} className="z-50"><Select.Popup className="max-h-(--available-height) w-(--anchor-width) max-w-(--available-width) overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        <Select.List>{clinics.map(clinic => <Select.Item key={clinic.id} value={clinic.id} className="flex min-h-11 w-full min-w-0 cursor-pointer items-start gap-2 rounded-md px-3 py-2 text-body2 outline-none data-highlighted:bg-muted">
          <Select.ItemText className="min-w-0 flex-1 whitespace-normal break-words">{clinic.name}</Select.ItemText>{clinic.id === value && <Check className="mt-1 size-4 shrink-0" aria-hidden/>}
        </Select.Item>)}</Select.List>
      </Select.Popup></Select.Positioner></Select.Portal>
    </Select.Root>
  </div>;
}
