import 'server-only';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {readJobsView} from './admin-view';
export async function getJobsView(){
 // Authenticated admin RPC checks the admin role again in the database. No service client.
 const staff=await requireRealAdmin();
 return readJobsView({read:async()=>staff.client.rpc('real_admin_job_runs',{p_limit:50})});
}
