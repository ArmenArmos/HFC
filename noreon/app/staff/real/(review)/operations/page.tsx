import {Suspense} from 'react';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {getCleanupView} from '@/lib/cleanup/admin-repository';
import {getRealOperationsSummary} from '@/lib/staff/real-operations-summary';
import {RealOperationsSummaryStatus} from '@/lib/staff/real-operations-summary-view';
import {CleanupStatus} from '@/components/cleanup/cleanup-status';
import {getJobsView} from '@/lib/jobs/admin-repository';
import {JobStatus} from '@/components/jobs/job-status';
import {createClient} from '@/lib/supabase/server';
import {readAdminLdlRetests,type LdlUserRpc} from '@/lib/ldl/response-runtime';
import {LdlRetestsAdmin} from '@/components/staff/ldl-retests-admin';
export const dynamic='force-dynamic';
async function Summary(){return <RealOperationsSummaryStatus view={await getRealOperationsSummary()}/>;}
async function LdlRetests(){return <LdlRetestsAdmin items={await readAdminLdlRetests((await createClient()) as unknown as LdlUserRpc)}/>;}
async function Jobs(){return <JobStatus view={await getJobsView()}/>;}
async function Status({query}:{query:Record<string,string|string[]|undefined>}){return <CleanupStatus embedded view={await getCleanupView(query)}/>;}
export default async function OperationsPage({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){
 await requireRealAdmin();
 const query=await searchParams;
 return <div className="space-y-8"><h1 className="text-h1">Operations</h1>
  <Suspense fallback={<p role="status" className="rounded-xl border p-5">Loading native operations counts…</p>}><Summary/></Suspense>
  <Suspense fallback={<p role="status" className="rounded-xl border p-5">Loading LDL re-tests…</p>}><LdlRetests/></Suspense>
  <Suspense fallback={<p role="status" className="rounded-xl border p-5">Loading job records…</p>}><Jobs/></Suspense>
  <Suspense fallback={<p role="status" className="rounded-xl border p-5">Loading cleanup records…</p>}><Status query={query}/></Suspense>
 </div>;
}
