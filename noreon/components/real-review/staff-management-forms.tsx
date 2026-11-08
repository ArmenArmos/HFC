'use client';
import {yerevanStamp} from '@/lib/staff/yerevan-time';

import {useActionState, useState} from 'react';
import {useRouter} from 'next/navigation';
import {updateRealStaff, removeRealStaffAccess} from '@/lib/staff/real-admin-actions';
import {StaffTelegramControls} from './staff-telegram-forms';
import {RequestStaffRecoveryForm} from './recovery-forms';
import {Plus, Pencil, UserRoundMinus, Stethoscope, HeartPulse, Send, KeyRound} from 'lucide-react';
import {StaffActionDialog} from './staff-action-dialog';
import {SelectField} from '@/components/ui/select-field';
import {AddStaffForm, ReissueDoctorInvitationForm, ClinicSelect, type ClinicOption} from './admin-forms';

type State = {ok: boolean; message: string; operationCreated?: boolean; outcomeUnknown?: boolean; submittedVersion?: string};
export type RealStaffRow = {id: string; name: string; email: string; role: 'doctor' | 'nurse'; clinicId: string; clinicName: string; active: boolean; version: string; assignmentCount: number; status: string; invitationId?: string; generation?: number; sendStatus?: string; expiresAt?: string};
const initial: State = {ok: false, message: ''};
const inputClass = 'mt-1 min-h-11 w-full rounded-md border bg-background px-3 py-2 text-body2 focus-visible:outline-2 focus-visible:outline-ring';
const buttonClass = 'inline-flex min-h-11 items-center justify-center rounded-md border px-4 py-2 text-body2 font-medium hover:bg-muted disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-ring';
function Feedback({state}: {state: State}) {return state.message ? <p role={state.ok ? 'status' : 'alert'} className="text-caption">{state.message}</p> : null;}
function useManagementAction(serverAction: (previous: State, form: FormData) => Promise<State>, onSubmit?: () => void) {
  const router = useRouter();
  const result = useActionState(async (previous: State, form: FormData): Promise<State> => {
    onSubmit?.();
    const submittedVersion = String(form.get('expectedVersion') ?? '');
    try {
      const next = await serverAction(previous, form);
      router.refresh();
      return {...next, submittedVersion};
    } catch {
      router.refresh();
      return {ok: false, outcomeUnknown: true, submittedVersion, message: 'The result is unconfirmed. Check the current details before making another change.'};
    }
  }, initial);
  return {...{state: result[0], action: result[1], pending: result[2]}, refresh: () => router.refresh()};
}

export function EditRealStaffForm({staff, clinics, requestId}: {staff: RealStaffRow; clinics: ClinicOption[]; requestId: string}) {
  const [editor, setEditor] = useState({name: staff.name, clinicId: staff.clinicId, baseline: staff, requestId});
  const [reviewedVersion, setReviewedVersion] = useState<string | null>(null);
  const {state, action, pending, refresh} = useManagementAction(updateRealStaff, () => setReviewedVersion(null));
  const dirty = editor.name !== editor.baseline.name || editor.clinicId !== editor.baseline.clinicId;
  const changed = staff.version !== editor.baseline.version;
  const confirmedSave = state.ok && staff.name === editor.name.trim() && staff.clinicId === editor.clinicId;
  if (changed && !pending && !state.outcomeUnknown && (!dirty || confirmedSave)) setEditor({name: staff.name, clinicId: staff.clinicId, baseline: staff, requestId});
  const conflict = changed && dirty && !confirmedSave;
  const unknown = !!state.outcomeUnknown && reviewedVersion !== staff.version;
  const completed = state.ok && state.submittedVersion === editor.baseline.version;
  const clinicBlocked = staff.assignmentCount > 0;
  const availableClinics = clinics.filter(clinic => clinic.active || clinic.id === editor.baseline.clinicId);
  return <form action={action} className="space-y-3" aria-label={`Edit ${staff.name}`} aria-busy={pending}>
    <input type="hidden" name="staffId" value={staff.id}/><input type="hidden" name="expectedVersion" value={editor.baseline.version}/><input type="hidden" name="requestId" value={editor.requestId}/>
    <p className="text-caption text-muted-foreground">{staff.role === 'nurse' ? 'Nurse' : 'Doctor'} · {staff.email}</p>
    <fieldset disabled={pending || unknown || completed} className="grid min-w-0 gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-body2">Full name<input name="name" value={editor.name} onChange={event => setEditor({...editor, name: event.target.value})} required maxLength={160} className={inputClass}/></label>
      <div className="min-w-0"><ClinicSelect clinics={availableClinics} value={editor.clinicId} onChange={clinicId => setEditor({...editor, clinicId})} disabled={pending || unknown || completed || clinicBlocked}/></div>
    </fieldset>
    {clinicBlocked && <p className="text-caption text-muted-foreground">Reassign {staff.assignmentCount} {staff.assignmentCount === 1 ? 'member' : 'members'} before changing clinic. You can still edit the name.</p>}
    {!clinics.find(clinic => clinic.id === editor.clinicId)?.active && <p className="text-caption text-muted-foreground">Current clinic is inactive.</p>}
    {(conflict || unknown) && <div className="space-y-2 rounded-md border p-3" aria-label="Staff details changed">
      <p role="alert" className="text-caption">{unknown && !changed ? 'Last loaded details' : 'Review the current details'}: {staff.name} · {staff.clinicName}.</p>
      <div className="flex flex-wrap gap-3">{(!unknown || changed) && <button type="button" onClick={refresh} className={buttonClass}>Reload current details</button>}{(!unknown || changed) && <button type="button" className={buttonClass} onClick={() => {setEditor({name: staff.name, clinicId: staff.clinicId, baseline: staff, requestId: changed ? requestId : editor.requestId}); setReviewedVersion(staff.version);}}>Use current details</button>}{unknown && !changed && <a href="/staff/real/doctors" className="inline-flex min-h-11 items-center text-caption underline">Reload directory</a>}</div>
    </div>}
    <button type="submit" className={buttonClass} disabled={pending || conflict || unknown || completed || !dirty}>{pending ? 'Saving changes…' : 'Save changes'}</button>
    <Feedback state={state}/>
  </form>;
}

export function RemoveRealStaffAccessForm({staff, requestId}: {staff: RealStaffRow; requestId: string}) {
  const [operation, setOperation] = useState({version: staff.version, requestId, confirmed: false});
  const {state, action, pending} = useManagementAction(removeRealStaffAccess);
  if (!pending && operation.version !== staff.version) setOperation({version: staff.version, requestId, confirmed: false});
  const alreadyRemoved = staff.status === 'revoked' || staff.status === 'removed';
  const blocked = staff.assignmentCount > 0 || alreadyRemoved || !!state.outcomeUnknown || (state.ok && state.submittedVersion === staff.version);
  return <form action={action} className="space-y-3" aria-label={`Remove access for ${staff.name}`} aria-busy={pending}>
    <input type="hidden" name="staffId" value={staff.id}/><input type="hidden" name="expectedVersion" value={operation.version}/><input type="hidden" name="requestId" value={operation.requestId}/>
    <label className="flex min-h-11 items-start gap-2 text-caption"><input type="checkbox" name="confirmed" value="true" required checked={operation.confirmed} disabled={blocked || pending} onChange={event => setOperation({...operation, confirmed: event.target.checked})} className="mt-1"/>Remove this team member’s workspace access.</label>
    {staff.assignmentCount > 0 && <p className="text-caption text-muted-foreground">Reassign {staff.assignmentCount} {staff.assignmentCount === 1 ? 'member' : 'members'} before removing access.</p>}
    {alreadyRemoved && <p className="text-caption text-muted-foreground">Access has been removed.</p>}
    <button type="submit" disabled={blocked || pending || !operation.confirmed} className={buttonClass}>{pending ? 'Removing access…' : 'Remove access'}</button>
    <Feedback state={state}/>
    {state.outcomeUnknown && <a href="/staff/real/doctors" className="inline-flex min-h-11 items-center text-caption underline">Reload directory</a>}
  </form>;
}


function staffStatus(staff: RealStaffRow, clinicActive: boolean) {
  if (staff.status === 'revoked' || staff.status === 'removed') return 'Removed';
  if (staff.active) return clinicActive ? 'Available' : 'Clinic inactive';
  if (staff.status === 'accepted') return 'Access inactive';
  if (staff.expiresAt && new Date(staff.expiresAt).getTime() <= Date.now()) return 'Invitation expired';
  if (staff.status === 'verified') return 'Password setup pending';
  if (staff.status === 'password_set') return 'Activation pending';
  if (staff.sendStatus === 'unknown') return 'Delivery unknown';
  if (staff.sendStatus === 'failed') return 'Delivery failed';
  return staff.invitationId ? 'Invitation pending' : 'Access inactive';
}

const chip = 'inline-flex items-center rounded-md px-2.5 py-1 text-caption';
function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map(word => word[0] ?? '').join('').toUpperCase() || '?';
}
export type StaffTelegramStatus = {enrolled: boolean; pendingLink: boolean};
type DirectoryRecord = {staff: RealStaffRow; editRequestId: string; removeRequestId: string; reissueRequestId: string; recoveryRequestId: string};
type RecoverySummary = {id: string; staffId: string; generation: number; status: string; dispatchState: string; issuedAt: string; expiresAt: string; failureCategory: string | null};
export function RealStaffDirectory({clinics, records, recoveries = [], ready, requestId, telegram = false, telegramInvites = false, telegramRecovery = false, telegramStatuses = {}}: {telegramStatuses?: Record<string, StaffTelegramStatus>; clinics: ClinicOption[]; records: DirectoryRecord[]; recoveries?: RecoverySummary[]; ready: boolean; requestId: string; telegram?: boolean; telegramRecovery?: boolean; telegramInvites?: boolean}) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<'all' | 'doctor' | 'nurse'>('all');
  const [status, setStatus] = useState('current');
  const term = query.trim().toLowerCase();
  const shown = records.filter(({staff}) => {
    const available = staff.active && clinics.some(clinic => clinic.id === staff.clinicId && clinic.active);
    const removed = staff.status === 'revoked' || staff.status === 'removed';
    return (role === 'all' || role === staff.role) && (status === 'all' || (status === 'current' ? !removed : status === 'removed' ? removed : !removed && available === (status === 'active'))) && `${staff.name} ${staff.email} ${staff.clinicName}`.toLowerCase().includes(term);
  });
  return <div className="space-y-6">
    <nav aria-label="Clinical team roles" className="flex flex-wrap gap-2">{([['all','All staff'],['doctor','Doctors'],['nurse','Nurses']] as const).map(([value,label]) => <button key={value} type="button" aria-pressed={role === value} onClick={() => setRole(value)} className={`inline-flex min-h-11 items-center rounded-md border px-4 text-body2 ${role === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}>{label}</button>)}</nav>
    <details className="rounded-xl border bg-background p-5">
      <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-body2 font-semibold text-primary"><Plus className="size-4" aria-hidden/>Add a doctor or nurse</summary>
      <div className="max-w-3xl border-t pt-5"><AddStaffForm clinics={clinics} ready={ready} requestId={requestId} telegram={telegramInvites}/></div>
    </details>
    <section className="overflow-hidden rounded-xl border bg-background" aria-label="Clinical staff directory">
      <div className="flex flex-wrap items-end gap-4 border-b p-5">
        <label className="min-w-0 flex-1 basis-48 text-caption">Find a team member or clinic<input value={query} onChange={event => setQuery(event.target.value)} type="search" placeholder="Name, email or clinic" className="mt-2 min-h-12 w-full rounded-md border bg-background px-4 text-body2"/></label>
        <label className="text-caption">Availability<SelectField value={status} onValueChange={setStatus} className="mt-2 min-w-48" options={[{value:'current',label:'Current staff'},{value:'all',label:'All'},{value:'removed',label:'Removed'},{value:'active',label:'Available'},{value:'inactive',label:'Unavailable'}]}/></label>
      </div>
      <p role="status" className="px-5 py-3 text-caption text-muted-foreground">{shown.length} {shown.length === 1 ? 'team member' : 'team members'} shown</p>
      <div className="divide-y">{shown.map(({staff,editRequestId,removeRequestId,reissueRequestId,recoveryRequestId}) => {
        const clinicActive = clinics.some(clinic => clinic.id === staff.clinicId && clinic.active);
        const available = staff.active && clinicActive;
        const removed = staff.status === 'revoked' || staff.status === 'removed';
        const Icon = staff.role === 'nurse' ? HeartPulse : Stethoscope;
        const telegramStatus = telegram && (staff.active || staff.status === 'accepted') ? telegramStatuses[staff.id] : undefined;
        return <article key={staff.id} className="space-y-4 px-4 py-4 sm:px-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span className="relative mt-0.5 inline-flex size-11 shrink-0 items-center justify-center rounded-full bg-surface-subtle-teal text-body2 font-semibold text-brand-teal" aria-hidden>
              {initials(staff.name)}
              <span className="absolute -right-1 -bottom-1 inline-flex size-5 items-center justify-center rounded-full bg-background text-primary ring-1 ring-border"><Icon className="size-3"/></span>
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="break-words text-body1 font-semibold">{staff.name}</h2>
              <p className="break-all text-caption text-muted-foreground">{staff.email}</p>
              <p className="mt-1 break-words text-caption">{staff.role === 'nurse' ? 'Nurse' : 'Doctor'} · {staff.clinicName}</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <span className={`${chip} ${available ? 'bg-surface-subtle-teal text-foreground' : 'bg-muted text-muted-foreground'}`}>{staffStatus(staff,clinicActive)}</span>
                {telegramStatus && <span className={`${chip} gap-1.5 ${telegramStatus.enrolled ? 'bg-surface-subtle-teal text-foreground' : 'bg-muted text-muted-foreground'}`}><Send className="size-3.5 shrink-0" aria-hidden/>{telegramStatus.enrolled ? 'Telegram connected' : telegramStatus.pendingLink ? 'Telegram link not used yet' : 'Telegram not connected'}</span>}
              </div>
            </div>
          </div>
          {!removed && <div className="flex flex-wrap gap-2 lg:shrink-0 lg:flex-nowrap lg:justify-end">
            <StaffActionDialog label="Edit details" icon={<Pencil/>} title={`Edit ${staff.name}`}><EditRealStaffForm staff={staff} clinics={clinics} requestId={editRequestId}/></StaffActionDialog>
            {telegram && (staff.active || staff.status === 'accepted') && <StaffActionDialog label="Telegram sign-in" icon={<Send/>} title={`Telegram sign-in for ${staff.name}`}><StaffTelegramControls staffId={staff.id} name={staff.name} recovery={telegramRecovery ? 'staff' : false}/></StaffActionDialog>}
            {staff.active && clinicActive && <StaffActionDialog label="Password recovery" icon={<KeyRound/>} title={`Password recovery for ${staff.name}`}><RequestStaffRecoveryForm key={`${staff.id}:${staff.version}`} staffId={staff.id} version={staff.version} requestId={recoveryRequestId} disabled={!ready}/></StaffActionDialog>}
            <StaffActionDialog label="Remove access" icon={<UserRoundMinus/>} tone="destructive" title={`Remove access for ${staff.name}`}><RemoveRealStaffAccessForm staff={staff} requestId={removeRequestId}/></StaffActionDialog>
          </div>}
          </div>
          {!removed && !staff.active && staff.status !== 'accepted' && staff.invitationId && staff.generation !== undefined && <div className="space-y-2 sm:pl-14">{!clinicActive && <p className="text-caption text-muted-foreground">Clinic is inactive. Invitations are unavailable.</p>}<ReissueDoctorInvitationForm key={staff.invitationId} invitationId={staff.invitationId} generation={staff.generation} requestId={reissueRequestId} replaceSetup={staff.status === 'verified' || staff.status === 'password_set'} disabled={!ready || !clinicActive} telegram={telegramInvites}/></div>}
        </article>;
      })}</div>
      {!shown.length && <div className="p-8 text-body2"><p>{records.length ? 'No staff match this view.' : 'No doctors or nurses yet.'}</p>{records.length ? <button type="button" className="mt-2 min-h-11 underline" onClick={() => {setQuery('');setRole('all');setStatus('current');}}>Clear filters</button> : <p className="mt-2 text-caption text-muted-foreground">Add a doctor or nurse above.</p>}</div>}
    </section>
    {recoveries.length > 0 && <section aria-label="Recent password recovery" className="space-y-3 rounded-xl border bg-background p-5"><h2 className="text-h2">Recent password recovery</h2><p className="text-caption text-muted-foreground">Delivery status records the email provider response. Check with your team member when delivery is unconfirmed.</p><ul className="divide-y">{recoveries.map(item => <li key={item.id} className="space-y-1 py-3 text-body2"><p className="break-words">{records.find(row => row.staff.id === item.staffId)?.staff.name ?? 'Team member'}</p><p className="text-caption text-muted-foreground">{item.status === 'completed' ? 'Password reset confirmed' : item.status === 'cancelled' ? 'Recovery cancelled' : item.status === 'expired' ? 'Recovery expired' : item.status === 'changing' ? 'Password confirmation pending' : item.status === 'verified' ? 'Email verified' : 'Recovery pending'} · {item.dispatchState === 'accepted' ? 'Email queued' : item.dispatchState === 'unknown' ? 'Delivery unconfirmed' : item.dispatchState === 'failed' ? 'Email rejected' : 'Delivery pending'}</p><p className="text-caption text-muted-foreground">Requested {yerevanStamp(item.issuedAt,'en')}</p></li>)}</ul></section>}
  </div>;
}
