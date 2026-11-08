import Link from 'next/link';
import {RetryDoctorActivationForm, SetDoctorPasswordForm} from '@/components/real-review/invitation-forms';
import {readDoctorSetup, staffInvitationPageAvailable} from '@/lib/staff/real-invitation-session';

export default async function DoctorPasswordPage() {
  const ready = await staffInvitationPageAvailable();
  const setup = ready ? await readDoctorSetup() : null;
  return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-8">
    <Link href="/staff/real/login" className="text-h2">Noreon</Link>
    <h1 className="text-h1">{setup?.stage === 'password_set' ? 'Activate your workspace' : setup?.stage === 'accepted' ? 'Your workspace is ready' : 'Set your password'}</h1>
    {!ready ? <p role="status" className="text-body2">Password setup is unavailable. Please try again later.</p> : !setup ? <p role="alert" className="text-body2">Your invitation is incomplete or expired. Ask your administrator for a new invitation.</p> : setup.stage === 'unavailable' ? <><p role="alert" className="text-body2">Account setup is temporarily unavailable. Try again in a moment.</p><Link href="/staff/real/set-password" className="inline-flex min-h-11 items-center text-body2 underline">Try again</Link></> : setup.stage === 'accepted' ? <p className="text-body2">You can sign in to your staff workspace.</p> : <>
      <p className="break-words text-body2">{setup.name}</p>
      {setup.stage === 'password_set' ? <><p className="text-body2">Your password is saved. Retry to open your workspace.</p><RetryDoctorActivationForm/></> : <SetDoctorPasswordForm/>}
    </>}
    <Link href="/staff/real/login" className="inline-flex min-h-11 items-center text-body2 underline">Staff sign in</Link>
  </main>;
}
