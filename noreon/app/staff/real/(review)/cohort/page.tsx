import{notFound,unstable_rethrow}from'next/navigation';
import{requireRealAdmin}from'@/lib/staff/real-admin';
import{gmDashboardEnabled,pilotPaymentsEnabled}from'@/lib/pilot-commerce/config';
import{readGmOverview,type PilotRpc}from'@/lib/pilot-commerce/runtime';
import{GmOverviewView}from'@/components/pilot-commerce/gm-overview';
import{buttonClass,fieldClass}from'@/components/staff/shell';
import{yerevanDay,yerevanToday}from'@/lib/pilot-commerce/format';
export const dynamic='force-dynamic';

const dayMs=86400000;
// Round-trip so an impossible day such as 2026-02-31 is refused rather than rolled over.
const valid=(v:unknown)=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(`${v}T00:00:00Z`))&&new Date(`${v}T00:00:00Z`).toISOString().slice(0,10)===v;

export default async function CohortPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 if(!gmDashboardEnabled())notFound();
 const{client}=await requireRealAdmin();
 const query=await searchParams;
 const today=yerevanToday();
 const to=valid(query.to)?query.to as string:today;
 const from=valid(query.from)?query.from as string:yerevanDay(Date.parse(`${to}T00:00:00Z`)-89*dayMs);
 const rangeOk=from<=to&&Date.parse(`${to}T00:00:00Z`)-Date.parse(`${from}T00:00:00Z`)<=366*dayMs;
 let data:Awaited<ReturnType<typeof readGmOverview>>|null=null;
 if(rangeOk)try{data=await readGmOverview(client as unknown as PilotRpc,from,to);}catch(error){unstable_rethrow(error);}
 return <div className="mx-auto max-w-5xl space-y-6">
  <header className="space-y-2"><p className="text-caption text-muted-foreground">Operations</p><h1 className="text-h1">Pilot cohort</h1>
   <p className="text-body2 text-muted-foreground">How members are moving through the pilot, built from existing records. Totals only; no member is named.</p></header>
  <form method="get" className="flex flex-wrap items-end gap-3 rounded-xl border bg-background p-4">
   <label className="block space-y-1 text-body2"><span className="font-medium">From</span><input type="date" name="from" defaultValue={from} max={today} className={fieldClass}/></label>
   <label className="block space-y-1 text-body2"><span className="font-medium">To</span><input type="date" name="to" defaultValue={to} max={today} className={fieldClass}/></label>
   <button className={buttonClass}>Show period</button>
  </form>
  {!rangeOk?<p role="alert" className="text-body2">Choose a start date before the end date, at most a year apart.</p>
   :data?<GmOverviewView data={data} payments={pilotPaymentsEnabled()}/>:<p role="status" className="text-body2">The cohort overview is unavailable. Reload to check it.</p>}
 </div>;
}
