import {telegramBotUsername} from "@/lib/telegram-runtime/config";
import {staffTelegramRecoveryReady} from '@/lib/telegram-auth/staff-recovery';
import {staffTelegramEnrolmentEnabled} from "@/lib/telegram-auth/staff-signin";
import {telegramStaffInvitationReady} from "@/lib/telegram-auth/staff-invite-config";
import {randomUUID} from 'node:crypto';
import {Suspense} from 'react';
import {Stethoscope} from 'lucide-react';
import {RealStaffDirectory, type StaffTelegramStatus} from '@/components/real-review/staff-management-forms';
import {OwnTelegramEnrol} from '@/components/real-review/own-telegram-enrol';
import {getRealClinics, getRealStaffDirectory, getRealStaffRecoverySummaries, realStaffInvitationReady} from '@/lib/staff/real-admin';
import {requireRealAdminForRender} from '@/lib/staff/real-staff-render';

/** Read-only, through the same admin-checked RPC as the own-Telegram card. A row whose
 * status cannot be read shows no Telegram indicator rather than a guess. */
async function staffTelegramStatuses(ids: string[]): Promise<Record<string, StaffTelegramStatus>> {
  const {client} = await requireRealAdminForRender();
  const entries = await Promise.all(ids.map(id => client.rpc('staff_telegram_status', {p_staff: id}).then(r => {
    const data = r.data as {ok?: boolean; enrolled?: boolean; pendingLink?: boolean} | null;
    return r.error || data?.ok !== true ? null : [id, {enrolled: data.enrolled === true, pendingLink: data.pendingLink === true}] as const;
  }, () => null)));
  return Object.fromEntries(entries.filter(entry => entry !== null));
}

async function StaffAdministration() {
  let clinics: Awaited<ReturnType<typeof getRealClinics>>;
  let staff: Awaited<ReturnType<typeof getRealStaffDirectory>>;
  let recoveries: Awaited<ReturnType<typeof getRealStaffRecoverySummaries>>;
  try { const admin = await requireRealAdminForRender(); [clinics, staff, recoveries] = await Promise.all([getRealClinics(admin), getRealStaffDirectory(admin), getRealStaffRecoverySummaries(admin)]); }
  catch { return <p role="alert" className="rounded-xl border bg-background p-5 text-body2">Staff are unavailable. <a href="/staff/real/doctors" className="underline">Try again</a>.</p>; }
  const telegram = staffTelegramEnrolmentEnabled() && telegramBotUsername() !== null;
  const telegramStatuses = telegram ? await staffTelegramStatuses(staff.filter(row => row.active || row.status === 'accepted').map(row => row.id)) : {};
  return <RealStaffDirectory telegramStatuses={telegramStatuses} clinics={clinics} records={staff.map(row => ({staff: row, editRequestId: randomUUID(), removeRequestId: randomUUID(), reissueRequestId: randomUUID(), recoveryRequestId: randomUUID()}))} recoveries={recoveries} ready={realStaffInvitationReady() || telegramStaffInvitationReady()} telegramInvites={telegramStaffInvitationReady()} requestId={randomUUID()} telegram={telegram} telegramRecovery={staffTelegramRecoveryReady()}/>;
}

export default async function RealStaffPage() {
  const {client, identity} = await requireRealAdminForRender();
  const own = staffTelegramEnrolmentEnabled() ? await client.rpc('staff_telegram_status', {p_staff: identity.id}).then(r => (r.data as {enrolled?: boolean} | null)?.enrolled === true, () => false) : false;
  return <div className="space-y-6">
    <h1 className="flex items-center gap-3 text-h1"><Stethoscope className="size-7 shrink-0 text-primary" aria-hidden/>Doctors &amp; nurses</h1>
    {staffTelegramEnrolmentEnabled() && telegramBotUsername() !== null && <OwnTelegramEnrol staffId={identity.id} connected={own}/>}
    <Suspense fallback={<p role="status" className="rounded-xl border bg-background p-5 text-body2 text-muted-foreground">Loading staff…</p>}><StaffAdministration/></Suspense>
  </div>;
}
