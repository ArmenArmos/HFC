import Link from 'next/link';
import {AppShell, ShellSignOut} from '@/components/app-shell/app-shell';
import {realStaffSignOut} from '@/lib/patient-care/clinical-actions';
import {requireTestAccountOperator} from '@/lib/staff/test-accounts';

/** Test accounts live outside the staff review layout: a qa tester has no clinical identity and
 * sees only this page; an admin reaches it from the backoffice navigation. */
export default async function TestAccountsLayout({children}: {children: React.ReactNode}) {
  const {identity} = await requireTestAccountOperator();
  const admin = identity.role === 'admin';
  return <AppShell
    lang="en"
    contentId="test-accounts-content"
    skipLabel="Skip to content"
    menuLabel="Menu"
    brandHref="/staff/real/test-accounts"
    badge={admin ? 'Operations' : 'QA'}
    sidebarHeader={<p>{admin ? 'Backoffice' : 'QA testing'}</p>}
    nav={<nav aria-label="Test accounts" className="px-3 py-4"><ul className="space-y-1">
      <li><Link href="/staff/real/test-accounts" className="flex min-h-11 items-center rounded-md px-3 text-body2 font-semibold">Test accounts</Link></li>
      {admin && <li><Link href="/staff/real/members" className="flex min-h-11 items-center rounded-md px-3 text-body2">Back to requests</Link></li>}
    </ul></nav>}
    title={admin ? 'Noreon operations' : 'QA testing'}
    actions={<>
      <span className="text-caption text-muted-foreground">{identity.name}</span>
      <ShellSignOut action={realStaffSignOut} label="Sign out"/>
    </>}
  >{children}</AppShell>;
}
