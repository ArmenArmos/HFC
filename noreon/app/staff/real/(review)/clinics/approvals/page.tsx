import type {ClinicRpc} from '@/lib/clinic-portal/runtime';
import Link from 'next/link';
import type {Route} from 'next';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {readChangeRequests} from '@/lib/clinic-admin/approvals';
import {staffClinicChangeDecide} from '@/lib/clinic-admin/approval-actions';
import {ChangeApprovals} from '@/components/clinic-portal/change-approvals';
export default async function StaffClinicApprovalsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 const context=await requireRealAdmin(),query=await searchParams,state=query.state==='decided'?'decided':'pending';
 const list=await readChangeRequests(context.client as unknown as ClinicRpc,null,state);
 return <div className="space-y-5"><Link className="inline-flex min-h-12 items-center text-body2 underline" href="/staff/real/clinics">Back to clinics</Link><h1 className="text-h1">Clinic change approvals</h1><p className="text-body2 text-muted-foreground">Review changes to care teams across clinics. Requests expire after 7 days.</p>
  <nav aria-label="Request status" className="flex gap-3"><Link className="inline-flex min-h-12 items-center rounded-md border px-4 text-body2" aria-current={state==='pending'?'page':undefined} href={"/staff/real/clinics/approvals" as Route}>Waiting</Link><Link className="inline-flex min-h-12 items-center rounded-md border px-4 text-body2" aria-current={state==='decided'?'page':undefined} href={"/staff/real/clinics/approvals?state=decided" as Route}>Decided</Link></nav>
  {list.status==='loaded'?list.requests.length?<ChangeApprovals requests={list.requests} locale="en" staff decide={staffClinicChangeDecide.bind(null,context.actorScope)}/>:<p role="status" className="text-body2">{state==='pending'?'No changes waiting for approval.':'No decided requests yet.'}</p>:<p role="alert" className="text-body2">{list.status==='disabled'?'Change approvals are not switched on yet.':'Requests could not load. Try again.'}</p>}
  {list.status==='loaded'&&list.requests.length===100&&<p className="text-caption text-muted-foreground">Showing up to 100 requests.</p>}
 </div>;
}
