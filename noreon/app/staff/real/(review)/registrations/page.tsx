import Link from 'next/link';
import type {Route} from 'next';
import {unstable_rethrow} from 'next/navigation';
import * as Sentry from '@sentry/nextjs';
import {log} from '@/lib/observability/logger';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {CareSection,stamp} from '@/components/patient-care/common';
import {buttonClass} from '@/components/staff/shell';
import {SelectField} from '@/components/ui/select-field';
import {STEPS,STUCK_CHOICES,channelLabel,daysSince,parseRegistrationFilters,reachedCounts,registrationQuery,registrationsSchema,stepDetail,stepLabel,type Registrations} from '@/lib/registrations/contracts';
export const dynamic='force-dynamic';

const base='/staff/real/registrations';
const href=(q:string)=>(q?`${base}?${q}`:base) as Route;

/** Admin only: everyone who signed up on the member side and the journey step each has reached. */
export default async function RegistrationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const {client}=await requireRealAdmin();
 const filters=parseRegistrationFilters(await searchParams);
 let data:Registrations|null=null;
 try{
  const {data:raw,error}=await client.rpc('admin_member_registrations',{p_step:filters.step??undefined,p_stuck_days:filters.stuck??undefined,p_limit:500});
  if(error)throw Object.assign(Error('Registrations read failed'),{code:error.code});
  const parsed=registrationsSchema.safeParse(raw);
  if(!parsed.success)throw Error('Registrations payload invalid');
  data=parsed.data;
 }catch(error){
  unstable_rethrow(error);
  // Fixed text and the database error code only: never member data (review F5).
  const code=typeof (error as {code?:unknown}).code==='string'?(error as {code:string}).code:undefined;
  log.error('staff.registrations.unavailable',{error_name:error instanceof Error?error.name:undefined,error_code:code});
  Sentry.captureException(Error(error instanceof Error&&error.message==='Registrations payload invalid'?'Registrations payload invalid':'Registrations read failed'),{tags:{surface:'registrations',code}});
 }
 const filtered=Boolean(filters.step||filters.stuck);
 const reached=data?reachedCounts(data.counts):null;
 const now=data?Date.parse(data.asOf):0;
 return <div className="mx-auto max-w-5xl space-y-6">
  <header className="space-y-2"><p className="text-caption text-muted-foreground">Operations</p><h1 className="text-h1">Registrations</h1>
   <p className="text-body2 text-muted-foreground">Everyone who signed up in the member app, including people who have not enrolled yet, and the furthest step each has reached. Staff, clinic and blocked accounts are not listed. Opening this page is recorded in the activity log.</p></header>
  {!data||!reached?<p role="status" className="rounded-xl border bg-background p-5 text-body2">Registrations are unavailable. Reload to try again.</p>:<>
   <CareSection title="Where people are" detail={`${data.total} member accounts. Each bar is how many reached that step or went further; the number on the right is how many are at that step now. Pick a step to list those people.`}>
    <ol className="space-y-2">{STEPS.map(s=>{
     const at=data.counts[String(s)]??0;const pct=data.total?Math.round(reached[s]/data.total*100):0;
     return <li key={s}><Link href={href(registrationQuery({step:s,stuck:filters.stuck}))} aria-current={filters.step===s?'true':undefined}
      className="grid grid-cols-[minmax(9rem,13rem)_1fr_auto] items-center gap-3 rounded-md px-2 py-1 text-body2 hover:bg-muted aria-[current=true]:bg-muted">
      <span className="font-medium">{s}. {stepLabel[s]}</span>
      <span className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden><span className="block h-full rounded-full bg-primary" style={{width:`${pct}%`}}/></span>
      <span className="font-heading tabular-nums" aria-label={`${reached[s]} reached, ${at} at this step`}>{reached[s]} <span className="text-muted-foreground">· {at} here</span></span>
     </Link></li>;})}</ol>
   </CareSection>
   <form method="get" action={base} className="grid gap-3 rounded-xl border bg-background p-4 sm:grid-cols-3">
    <label className="block space-y-1 text-body2"><span className="font-medium">Step</span>
     <SelectField name="step" defaultValue={filters.step?String(filters.step):''} placeholder="Any step" options={[{value:'',label:'Any step'},...STEPS.map(s=>({value:String(s),label:`${s}. ${stepLabel[s]}`}))]}/></label>
    <label className="block space-y-1 text-body2"><span className="font-medium">Stuck</span>
     <SelectField name="stuck" defaultValue={filters.stuck?String(filters.stuck):''} placeholder="Any time" options={[{value:'',label:'Any time'},...STUCK_CHOICES.map(d=>({value:String(d),label:`On the same step for more than ${d} days`}))]}/></label>
    <div className="flex flex-wrap items-end gap-3"><button className={buttonClass}>Show people</button>
     {filtered&&<Link href={href('')} className="text-body2 underline underline-offset-4">Clear filters</Link>}</div>
   </form>
   <CareSection title={filtered?'Matching people':'Everyone'} detail={`${data.matching} ${data.matching===1?'person':'people'}, most recently active first, Yerevan time.${data.matching>data.rows.length?` Showing the first ${data.rows.length}.`:''} “Stuck” counts days since the person reached their current step; people in the programme are never stuck.`}>
    {!data.rows.length?<p className="text-body2">Nobody matches these filters.</p>
     :<ul className="divide-y">{data.rows.map(r=>{const idle=daysSince(r.stepAt,now);return <li key={r.id} className="grid gap-2 py-3 first:pt-0 last:pb-0 md:grid-cols-[1fr_14rem_10rem]">
      <div className="min-w-0 space-y-1">
       <p className="text-body2 font-semibold break-words">{r.enrolled?<Link href={`/staff/real/members/${r.id}` as Route} className="underline underline-offset-4">{r.name??r.phoneMasked??'No name yet'}</Link>:(r.name??r.phoneMasked??'No name yet')}
        {r.urgent&&<span className="ml-2 rounded-md border border-destructive px-1.5 py-0.5 text-caption font-semibold text-destructive">Urgent answer</span>}</p>
       <p className="text-caption text-muted-foreground">Signed up <time dateTime={r.signedUpAt}>{stamp(r.signedUpAt,'en',false)}</time> · {channelLabel[r.channel]}{r.name&&r.phoneMasked&&<> · <span className="whitespace-nowrap">{r.phoneMasked}</span></>}</p>
      </div>
      <div className="space-y-1"><p className="text-body2"><span className="font-heading tabular-nums">{r.step}.</span> {stepDetail(r)}</p>
       {idle!==null&&r.step<10&&<p className="text-caption text-muted-foreground">On this step {idle===0?'since today':`for ${idle} ${idle===1?'day':'days'}`}</p>}</div>
      <p className="text-caption text-muted-foreground md:text-right">Last active<br/>{r.lastActivityAt?<time dateTime={r.lastActivityAt}>{stamp(r.lastActivityAt,'en')}</time>:'Not recorded'}</p>
     </li>;})}</ul>}
   </CareSection>
  </>}
 </div>;
}
