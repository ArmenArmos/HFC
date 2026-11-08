import 'server-only';
import {requireRealAdmin} from './real-admin';
import {readRealOperationsSummary} from './real-operations-summary-model';
export async function getRealOperationsSummary() {
  const {client}=await requireRealAdmin();
  return readRealOperationsSummary(()=>client.rpc('real_admin_operations_summary'));
}
