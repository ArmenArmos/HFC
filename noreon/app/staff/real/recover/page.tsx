import Link from 'next/link';
import type {Metadata} from 'next';
import {doctorInvitationAvailable} from '@/lib/staff/real-invitation-session';
import {VerifyStaffRecoveryForm} from '@/components/real-review/recovery-forms';
export const metadata:Metadata={referrer:'no-referrer',robots:{index:false,follow:false}};
export default async function StaffRecoveryPage(){const ready=await doctorInvitationAvailable();return <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-5 py-8"><Link href="/staff/real/login" className="text-h2">Noreon</Link><h1 className="text-h1">Recover your staff account</h1><p className="text-body2">Verify your email before choosing a new password.</p><VerifyStaffRecoveryForm ready={ready}/><Link href="/staff/real/login" className="inline-flex min-h-11 items-center underline">Staff sign in</Link></main>;}
