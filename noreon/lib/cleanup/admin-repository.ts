import 'server-only';
import {requireRealAdmin} from '@/lib/staff/real-admin';
import {readCleanupView} from './admin-view';
export async function getCleanupView(query:Record<string,string|string[]|undefined>){
 // Authenticated admin RPC performs the current database gate again. No service client.
 const staff=await requireRealAdmin();
 return readCleanupView(query,{authorize:async()=>staff,read:async cursor=>staff.client.rpc('real_admin_cleanup_runs',cursor)});
}
