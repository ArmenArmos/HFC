import Link from 'next/link';
import type {Route} from 'next';
import {calendarDate} from '@/lib/staff/yerevan-time';
import {ackLdlRetest} from '@/lib/ldl/response-actions';
import type {AdminLdlRetest} from '@/lib/ldl/response-schema';

const button='inline-flex min-h-11 items-center rounded-md px-4 text-body2 font-medium focus-visible:outline-2 focus-visible:outline-ring';
/**
 * Operations: LDL re-test blood draws the admin must act on (phase 2, dark). Overdue: the window passed without a
 * result. Fenced: the member already had an open visit or request, so the lipid panel is added there. Nothing when
 * empty or switched off; "unavailable" when the read failed (null).
 */
export function LdlRetestsAdmin({items}:{items:AdminLdlRetest[]|null}){
 if(items!==null&&items.length===0)return null;
 return <section aria-labelledby="ldl-retests" className="space-y-3 rounded-xl border bg-background p-5">
  <h2 id="ldl-retests" className="text-h2">LDL re-tests to arrange <span className="text-body2 font-normal text-muted-foreground">{items?.length??''}</span></h2>
  <p className="text-body2 text-muted-foreground">Blood draws the member&apos;s doctor booked after a change to cholesterol treatment. Call the member, arrange the home visit in the member&apos;s test requests, then mark it handled. The member gets a reminder from Noreon; no result is shown here.</p>
  {items===null?<p role="alert" className="text-body2">Unavailable. Reload to check.</p>:<ul className="divide-y">{items.map(r=><li key={r.id} className="space-y-2 py-4 first:pt-0 last:pb-0">
   <p className="text-body2"><Link href={`/staff/real/members/${r.memberId}` as Route} className="font-semibold underline underline-offset-4">{r.memberName||'Member without a name'}</Link>
    {' · '}{r.kind==='overdue'?<strong>Overdue</strong>:'Due'}: {calendarDate(r.dueFrom,'en')} to {calendarDate(r.dueTo,'en')}{r.doctorName?` · ${r.doctorName}`:''}</p>
   <p className="text-body2">{r.state==='fenced'?r.fenceReason==='not_eligible'
     ?'No request could be created: the member has no confirmed phone or consent in Noreon, or an urgent hold. Help them finish it; Noreon creates the home-visit request as soon as they can have one.'
     :'The member has another open visit or request. Ask the lab to add a lipid panel (LDL cholesterol) to that blood draw: the result reaches the doctor as usual. When that visit is completed or cancelled, Noreon creates the home-visit request by itself.'
    :r.state==='requested'?`A home-visit request is in the member's test requests${r.requestStatus?` (${r.requestStatus})`:''}. Agree a time with the member.`
    :'No request yet. Arrange the blood draw with the member.'}</p>
   <form action={ackLdlRetest} className="flex flex-wrap items-end gap-3"><input type="hidden" name="retestId" value={r.id}/>
    <label className="block min-w-0 flex-1 space-y-1 text-body2"><span className="font-medium">Note (optional, staff only)</span><input name="note" maxLength={500} className="block min-h-11 w-full rounded-md border bg-background px-3"/></label>
    <button className={`${button} bg-primary text-primary-foreground`}>Mark handled</button></form>
  </li>)}</ul>}
 </section>;
}
