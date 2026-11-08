import{amd}from'@/lib/pilot-commerce/format';
import{yerevanStamp}from'@/lib/staff/yerevan-time';
import type{GmOverview}from'@/lib/pilot-commerce/schema';

const LOW_SAMPLE=5;
function Tile({label,value,note}:{label:string;value:number|string;note?:string}){
 return <div className="rounded-xl border bg-background p-4"><p className="text-caption text-muted-foreground">{label}</p><p className="text-h2 font-semibold tabular-nums">{value}</p>{note&&<p className="text-caption text-muted-foreground">{note}</p>}</div>;
}
const pct=(part:number,whole:number)=>whole?`${Math.round(part/whole*100)}% of ${whole}`:'No members yet';

/** Admin cohort overview. Aggregates only: no member is named or linked. */
export function GmOverviewView({data,payments}:{data:GmOverview;payments:boolean}){
 const enrolled=data.enrolled.total;
 return <div className="space-y-6">
  <p className="text-caption text-muted-foreground">Counted {yerevanStamp(data.asOf,'en')} (UTC+4) for {data.from} to {data.to}, both days included. Cohort is every member with a clinical case; a Davidyants cohort marker and the agreed KPI definitions are still awaited.</p>
  {enrolled<LOW_SAMPLE&&<p role="note" className="rounded-xl border p-4 text-body2">Fewer than {LOW_SAMPLE} members are enrolled. Read percentages with care.</p>}
  <section aria-labelledby="gm-funnel" className="space-y-3"><h2 id="gm-funnel" className="text-h3">Members through the pilot</h2>
   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <Tile label="Enrolled" value={enrolled} note={`${data.enrolled.inRange} joined in this period`}/>
    <Tile label="Booked tests" value={data.booked.members} note={`${pct(data.booked.members,enrolled)} · ${data.booked.testRequests} requests, ${data.booked.appointments} bookings`}/>
    <Tile label="Visits done" value={data.visits.members} note={`${data.visits.recorded} visit records`}/>
    <Tile label="Results received" value={data.results.receivedMembers} note="Members with a clinic result or lab result recorded"/>
    <Tile label="Results released" value={data.results.releasedMembers} note="Members whose doctor published a review"/>
    <Tile label="Cancelled bookings" value={data.cancelled}/>
   </div></section>
  <section aria-labelledby="gm-monitoring" className="space-y-3"><h2 id="gm-monitoring" className="text-h3">Monitoring and messages</h2>
   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <Tile label="BP readings" value={data.bp.manualReadings+data.bp.deviceReadings} note={`${data.bp.manualReadings} entered, ${data.bp.deviceReadings} from monitors`}/>
    <Tile label="Members measuring" value={data.bp.membersWithReadings} note={pct(data.bp.membersWithReadings,enrolled)}/>
    <Tile label="Messages awaiting reply" value={data.awaitingReply} note="Right now, not limited to the period"/>
    <Tile label="Members without a doctor" value={data.unassignedMembers}/>
   </div>
   <p className="text-caption text-muted-foreground">Reading counts only. These are not clinical outcomes, and no BP trend is shown until the metric is agreed.</p></section>
  {payments&&<section aria-labelledby="gm-payments" className="space-y-3"><h2 id="gm-payments" className="text-h3">Payments</h2>
   <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
    <Tile label="Paid" value={data.payments.paid} note={amd(data.payments.paidAmd)}/>
    <Tile label="Awaiting payment" value={data.payments.pending}/>
    <Tile label="Failed" value={data.payments.failed}/>
    <Tile label="Refunded or waived" value={data.payments.refunded+data.payments.waived}/>
   </div>
   {data.payments.staging>0&&<p className="text-caption text-muted-foreground">{data.payments.staging} records use STAGING placeholder prices.</p>}</section>}
  <section aria-labelledby="gm-doctors" className="space-y-3 rounded-xl border bg-background p-4 sm:p-6"><h2 id="gm-doctors" className="text-h3">Doctor load</h2>
   {data.doctors.length?<table className="w-full text-body2"><thead><tr className="text-left text-caption text-muted-foreground"><th className="py-2 font-medium">Doctor</th><th className="py-2 text-right font-medium">Members</th><th className="py-2 text-right font-medium">Awaiting reply</th></tr></thead>
    <tbody className="divide-y">{data.doctors.map((d,i)=><tr key={`${d.name}-${i}`}><td className="break-words py-2 pr-2">{d.name}</td><td className="py-2 text-right tabular-nums">{d.assignedMembers}</td><td className="py-2 text-right tabular-nums">{d.awaitingReply}</td></tr>)}</tbody></table>
    :<p className="text-body2">No active doctors.</p>}
  </section>
 </div>;
}
