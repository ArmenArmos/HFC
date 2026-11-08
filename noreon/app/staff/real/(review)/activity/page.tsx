import Link from 'next/link';
import type {Route} from 'next';
import {unstable_rethrow} from 'next/navigation';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {CareSection,stamp} from '@/components/patient-care/common';
import {buttonClass,fieldClass} from '@/components/staff/shell';
import {SelectField} from '@/components/ui/select-field';
import {DEFAULT_DAYS,EXPORT_LIMIT,auditCategories,auditPageSchema,auditPeopleSchema,filterQuery,parseFilters,rpcArgs,withDefaultWindow,type AuditRpc} from '@/lib/activity-log/contracts';
import {actionLabel,sourceLabel,auditCategoryLabel,profileChangeLines} from '@/lib/activity-log/labels';
export const dynamic='force-dynamic';

/** Admin only: who signed in, who opened or changed which member's data. Never health content. */
export default async function ActivityLogPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {client:sessionClient}=await requireRealAdmin();
 const client=sessionClient as unknown as AuditRpc;
 const asked=parseFilters(await searchParams);
 const filters=withDefaultWindow(asked);
 const base={...filters,cursor:null,memberInvalid:null};
 let page:ReturnType<typeof auditPageSchema.parse>|null=null;
 let people:ReturnType<typeof auditPeopleSchema.parse>['people']=[];
 try{
  const [log,who]=await Promise.all([
   asked.memberInvalid?Promise.resolve(null):client.rpc('admin_audit_log',{p_profile_values:true,...rpcArgs(filters),p_cursor:filters.cursor??undefined,p_limit:100}),
   client.rpc('admin_audit_people'),
  ]);
  if(log?.error||who.error)throw Error('unavailable');
  page=log?auditPageSchema.parse(log.data):null;people=auditPeopleSchema.parse(who.data).people;
 }catch(error){unstable_rethrow(error);}
 const filtered=Boolean(asked.actor||asked.member||asked.memberInvalid||asked.category||asked.from||asked.to);
 const exportHref=`/staff/real/activity/export${filterQuery(base)?`?${filterQuery(base)}`:''}`;
 return <div className="mx-auto max-w-5xl space-y-6">
  <header className="space-y-2"><p className="text-caption text-muted-foreground">Operations</p><h1 className="text-h1">Activity log</h1>
   <p className="text-body2 text-muted-foreground">Who signed in, who opened or changed a member’s records, and what they did. Each row says who, whose record and what kind of action. What was read is never shown here.</p>
   <p className="text-body2 text-muted-foreground">An “Opened” row means Noreon fetched that part of the record for the person, signed in as themselves. Parts of a page load together, so if the page then failed to load they may not have seen it.</p></header>
  <form method="get" className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-2 lg:grid-cols-3">
   <label className="block space-y-1 text-body2"><span className="font-medium">Person</span>
    <SelectField name="actor" defaultValue={filters.actor??''} placeholder="Anyone" options={[{value:'',label:'Anyone'},...people.map(p=>({value:p.id,label:p.name,description:p.role}))]}/></label>
   <label className="block space-y-1 text-body2"><span className="font-medium">Member reference</span>
    <input name="member" defaultValue={filters.member??asked.memberInvalid??''} placeholder="Any member" inputMode="text" autoComplete="off" aria-invalid={asked.memberInvalid?true:undefined} aria-describedby="member-help" className={fieldClass}/>
    <span id="member-help" className="block text-caption text-muted-foreground">The member reference shown on the member’s page, or pick a member name in a row below.</span></label>
   <label className="block space-y-1 text-body2"><span className="font-medium">Type of action</span>
    <SelectField name="category" defaultValue={filters.category??''} placeholder="All actions" options={[{value:'',label:'All actions'},...auditCategories.map(c=>({value:c,label:auditCategoryLabel[c]}))]}/></label>
   <label className="block space-y-1 text-body2"><span className="font-medium">From</span><input type="date" name="from" defaultValue={filters.from??''} className={fieldClass}/></label>
   <label className="block space-y-1 text-body2"><span className="font-medium">To</span><input type="date" name="to" defaultValue={filters.to??''} className={fieldClass}/></label>
   <div className="flex flex-wrap items-end gap-3"><button className={buttonClass}>Show activity</button>
    {filtered&&<Link href={'/staff/real/activity' as Route} className="text-body2 underline underline-offset-4">Clear filters</Link>}</div>
  </form>
  {asked.memberInvalid?<p role="alert" className="rounded-xl border bg-background p-5 text-body2">“{asked.memberInvalid}” is not a member reference. Copy the reference from the member’s page, or pick the member’s name in a row of the log.</p>
   :!page?<p role="status" className="rounded-xl border bg-background p-5 text-body2">The audit log could not load. Try again.</p>
   :<CareSection title={filtered?'Matching activity':'Latest activity'} detail={`Newest first, Yerevan time, from ${filters.from}${asked.from?'':` (the last ${DEFAULT_DAYS} days unless you choose a start date)`}. Downloading the list is itself recorded.`}>
    <p className="text-body2"><a href={exportHref} className="font-semibold underline underline-offset-4">Download these rows as CSV</a><span className="text-muted-foreground"> (up to {EXPORT_LIMIT.toLocaleString('en')} rows; if more match, narrow the filters first)</span></p>
    {!page.rows.length?<p className="text-body2">Nothing recorded for these filters.</p>
     :<ul className="divide-y">{page.rows.map(r=><li key={r.key} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr]">
      <p className="text-caption text-muted-foreground"><time dateTime={r.at}>{stamp(r.at,'en')}</time></p>
      <div className="min-w-0 space-y-1">
       <p className="text-body2"><span className="font-semibold">{r.actorName||(r.actorId?'Unnamed account':'System')}</span>{r.actorRole&&<span className="text-muted-foreground"> · {r.actorRole}</span>} {actionLabel(r.source,r.action)}</p>
       {profileChangeLines(r.profileChange).map(line=><p key={line} className="break-words text-body2">{line}</p>)}
       <p className="break-words text-caption text-muted-foreground">
        {r.memberId&&<><Link href={`/staff/real/activity?${filterQuery({...base,member:r.memberId})}` as Route} className="underline underline-offset-4">{r.memberName||'Member'}</Link>{' · '}</>}
        {sourceLabel(r.source)}{r.ref&&<> · <span className="break-all">{r.ref}</span></>}
        {r.actorId&&<>{' · '}<Link href={`/staff/real/activity?${filterQuery({...base,actor:r.actorId})}` as Route} className="underline underline-offset-4">Only this person</Link></>}
       </p></div></li>)}</ul>}
    {page.next&&<p><Link href={`/staff/real/activity?${filterQuery({...base,cursor:page.next})}` as Route} className="text-body2 font-semibold underline underline-offset-4">Older activity</Link></p>}
   </CareSection>}
  <p className="text-caption text-muted-foreground">How long these records are kept is not decided yet (open question for legal). Nothing is deleted in the meantime.</p>
 </div>;
}
