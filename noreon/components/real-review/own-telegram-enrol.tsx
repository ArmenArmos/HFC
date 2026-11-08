'use client';
import {useActionState} from 'react';
import {issueStaffTelegramLink, type StaffTelegramState} from '@/lib/staff/real-telegram-actions';

/** QA S-01: an admin connects their own Telegram (first time only) so they can pass the second step. */
const idle: StaffTelegramState = {ok: false, message: ''};
export function OwnTelegramEnrol({staffId, connected = false}: {staffId: string; connected?: boolean}) {
  const [link, issue, issuing] = useActionState(issueStaffTelegramLink, idle);
  return <section className="space-y-3 rounded-xl border bg-background p-5" aria-labelledby="own-telegram">
    <h2 id="own-telegram" className="text-h3">Your Telegram sign-in</h2>
    {connected ? <p className="text-body2">Your Telegram is connected. To change it, ask another administrator to revoke it, then connect again here.</p> : <>
    <p className="text-body2 text-muted-foreground">Connect your own Telegram before the sign-in code step is switched on, or you cannot sign in. Changing it later needs another administrator.</p>
    <form action={issue} className="space-y-3">
      <input type="hidden" name="staffId" value={staffId}/>
      <label className="block text-caption">Your phone number in Telegram<input name="phone" type="tel" required placeholder="+374" className="mt-2 block min-h-12 w-full rounded-md border bg-background px-4 text-body2"/></label>
      <button type="submit" disabled={issuing} className="inline-flex min-h-11 items-center rounded-md border px-4 text-body2 disabled:opacity-60">{issuing ? 'Creating link…' : 'Create my Telegram link'}</button>
      {link.message && <p role={link.ok ? 'status' : 'alert'} className={link.ok ? 'text-caption' : 'text-caption text-destructive'}>{link.message}</p>}
      {link.url && <a href={link.url} target="_blank" rel="noopener noreferrer" className="block break-all rounded-md bg-muted p-3 font-mono text-caption underline">{link.url}</a>}
    </form></>}
  </section>;
}
