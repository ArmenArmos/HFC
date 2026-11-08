import Link from 'next/link';
import type { Route } from 'next';
import { CareSection, Status, stamp } from '@/components/patient-care/common';
import { SelectField } from '@/components/ui/select-field';
import { readCallbackQueue, CALLBACK_OUTCOMES, type CallbackRow } from '@/lib/staff/member-callbacks';
import { closeMemberCallback } from '@/lib/staff/member-callback-actions';
export const dynamic = 'force-dynamic';

const notices: Record<string, string> = {
  closed: 'Request closed.',
  changed: 'This request was already closed, for example the member cancelled it.',
  invalid: 'Choose an outcome.',
  unavailable: 'That did not go through. Reload and try again.',
};
const outcomeLabel: Record<NonNullable<CallbackRow['outcome']>, string> = {
  reached: 'Member reached', no_answer: 'No answer', not_needed: 'Not needed', cancelled_by_member: 'Cancelled by the member',
};
const timeLabel = { morning: 'morning', afternoon: 'afternoon', evening: 'evening' } as const;

function Row({ r }: { r: CallbackRow }) {
  return <li className="space-y-2 py-4 first:pt-0 last:pb-0">
    <div className="flex flex-wrap items-center gap-2">
      <Status tone={r.state === 'open' ? 'attention' : 'complete'}>{r.state === 'open' ? 'Open' : r.state === 'done' ? 'Done' : 'Cancelled'}</Status>
      <Link href={`/staff/real/members/${r.memberId}` as Route} className="text-body2 font-semibold underline underline-offset-4">{r.memberName || 'Member without a name'}</Link>
      <span className="text-caption text-muted-foreground">asked for {r.requestedFrom === 'nurse' ? 'a nurse' : 'the care team'} · {stamp(r.createdAt, 'en')}</span>
    </div>
    <p className="text-body2">Prefers {r.contactChannel === 'phone' ? 'a phone call' : 'a Telegram message'}{r.contactTimes.length ? `, ${r.contactTimes.map(t => timeLabel[t]).join(', ')}` : ', any time'}. {r.contactChannel === 'phone' ? (r.phone ? `Phone: +${r.phone.replace(/^\+/, '')}.` : 'No phone on file.') : r.telegramLinked ? 'Telegram replies are linked.' : 'Telegram replies are not linked; call or ask them to link Telegram.'} Language: {r.locale === 'en' ? 'English' : 'Armenian'}.</p>
    {r.state !== 'open' && r.outcome && <p className="text-caption text-muted-foreground">{outcomeLabel[r.outcome]}{r.closedAt ? ` · ${stamp(r.closedAt, 'en')}` : ''}</p>}
    {r.state === 'open' && <form action={closeMemberCallback} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={r.id}/>
      <label className="block min-w-48 space-y-1 text-body2"><span className="font-medium">Outcome</span>
        <SelectField name="outcome" required placeholder="Choose one" options={CALLBACK_OUTCOMES.map(o => ({ value: o, label: outcomeLabel[o] }))}/></label>
      <button className="inline-flex min-h-11 items-center rounded-md bg-primary px-4 text-body2 font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-ring">Close request</button>
    </form>}
  </li>;
}

export default async function CallbacksPage({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const [rows, { notice }] = await Promise.all([readCallbackQueue(), searchParams]);
  const open = rows.filter(r => r.state === 'open'), closed = rows.filter(r => r.state !== 'open');
  return <div className="space-y-6">
    <header className="space-y-2"><h1 className="text-h1">Callback requests</h1>
      <p className="text-body2 text-muted-foreground">Members who asked to be contacted, with how and when they prefer. Routine only: the member screen sends anyone unwell to 103.</p></header>
    {notice && notices[notice] && <p role="status" className="rounded-xl border p-4 text-body2">{notices[notice]}</p>}
    <CareSection title={`Open (${open.length})`}>{open.length ? <ul className="divide-y">{open.map(r => <Row key={r.id} r={r}/>)}</ul> : <p className="text-body2 text-muted-foreground">No open requests.</p>}</CareSection>
    {closed.length > 0 && <CareSection title="Closed in the last 7 days"><ul className="divide-y">{closed.map(r => <Row key={r.id} r={r}/>)}</ul></CareSection>}
  </div>;
}
