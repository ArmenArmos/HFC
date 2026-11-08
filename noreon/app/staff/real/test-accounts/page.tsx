import Link from 'next/link';
import type {Route} from 'next';
import {readTestAccounts, requireTestAccountOperator} from '@/lib/staff/test-accounts';
import {resetTestAccount} from '@/lib/staff/test-account-actions';
import {TestAccountBadge, TestAccountResetButton} from '@/components/staff/test-account-controls';
import {yerevanStamp} from '@/lib/staff/yerevan-time';

export default async function TestAccountsPage() {
  const {client, identity} = await requireTestAccountOperator();
  const rows = await readTestAccounts(client);
  const admin = identity.role === 'admin';
  return <>
    <h1 className="text-h1">Test accounts</h1>
    <p className="text-body2 text-muted-foreground">
      Reset a test account to sign up again with the same phone and Telegram. The old account and its history are kept.
      {admin ? ' Mark or unmark test accounts on the member page.' : ' Only accounts an administrator marked as test accounts appear here.'}
    </p>
    {rows.length === 0
      ? <p role="status" className="rounded-xl border bg-background p-5">No test accounts yet.</p>
      : <ul className="divide-y rounded-xl border bg-card">{rows.map(row => <li key={row.id} className="grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <div className="min-w-0 space-y-1">
          <h2 className="text-body1 font-semibold break-words">
            {admin ? <Link href={`/staff/real/members/${row.id}` as Route} className="underline underline-offset-4">{row.name || 'Member'}</Link> : (row.name || 'Member')} <TestAccountBadge/>
          </h2>
          <p className="text-caption text-muted-foreground">
            Joined {yerevanStamp(row.createdAt, 'en')}
            {' · '}{row.placeholder ? 'Phone moved to a +999 placeholder' : row.phoneEnding ? `Phone ending ${row.phoneEnding}` : 'No phone'}
            {' · '}{row.telegramLinked ? 'Telegram linked' : 'Telegram not linked'}
          </p>
          {row.resetAt && <p className="text-caption text-muted-foreground">Reset on {yerevanStamp(row.resetAt, 'en')}{row.resetCount > 1 ? ` (${row.resetCount} resets)` : ''}</p>}
          {row.resetPending && <p role="status" className="text-caption">The last reset has not finished changing the phone. Press Reset again to finish it.</p>}
        </div>
        <TestAccountResetButton memberId={row.id} name={row.name} action={resetTestAccount}/>
      </li>)}</ul>}
  </>;
}
