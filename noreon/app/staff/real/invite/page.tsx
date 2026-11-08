import Link from 'next/link';
import {AcceptDoctorInvitationForm} from '@/components/real-review/invitation-forms';
import {staffInvitationPageAvailable} from '@/lib/staff/real-invitation-session';
import {telegramBotUsername} from '@/lib/telegram-runtime/config';

export default async function DoctorInvitationPage() {
  const ready = await staffInvitationPageAvailable();
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-8">
    <Link href="/staff/real/login" className="text-h2">Noreon</Link>
    <h1 className="text-h1">Your staff invitation</h1>
    {ready ? <AcceptDoctorInvitationForm botUsername={telegramBotUsername()}/> : <p role="status" className="text-body2">Invitations are unavailable. Please try again later.</p>}
    <Link href="/staff/real/login" className="inline-flex min-h-11 items-center text-body2 underline">Staff sign in</Link>
  </main>;
}
