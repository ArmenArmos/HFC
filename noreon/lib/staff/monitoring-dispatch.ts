import 'server-only';
import {workspaceAdmin} from './auth';
import {sharedDemoEnabled} from './cases';

/** Cron owns reconciliation; due time stays the doctor-set end, never dispatch time. */
export async function dispatchMonitoring(actorId?: string) {
  if (!sharedDemoEnabled()) return {processed: 0, failed: 0, hasMore: false};
  const db = workspaceAdmin();
  const deadline = Date.now() + 45_000;
  const seen = new Set<string>();
  let processed = 0, failed = 0;
  const signal = () => AbortSignal.timeout(Math.max(1, Math.min(10_000, deadline - Date.now())));
  // The active demo cap is 1,000. Bound both work and wall time so the 60s
  // function can return a result; unfinished work remains due for the next run.
  while (seen.size < 1000 && Date.now() < deadline) {
    const candidates = await db.rpc('workspace_due_monitoring_cases', {p_actor: actorId, p_limit: 100, p_excluded: [...seen]}).abortSignal(signal());
    if (candidates.error) throw new Error('Monitoring follow-up processing is unavailable.');
    const ids = (candidates.data ?? []).filter(id => !seen.has(id)).slice(0, 1000 - seen.size);
    if (!ids.length) return {processed, failed, hasMore: !!candidates.data?.length};
    for (let offset = 0; offset < ids.length; offset += 5) {
      if (Date.now() >= deadline) return {processed, failed, hasMore: true};
      const batch = ids.slice(offset, offset + 5);
      batch.forEach(id => seen.add(id));
      const results = await Promise.allSettled(batch.map(id =>
        db.rpc('workspace_reconcile_monitoring', {p_id: id}).abortSignal(signal()),
      ));
      for (const result of results) {
        if (result.status === 'rejected' || result.value.error) failed++;
        else processed += result.value.data ?? 0;
      }
    }
    if ((candidates.data?.length ?? 0) < 100) return {processed, failed, hasMore: failed > 0};
  }
  return {processed, failed, hasMore: true};
}
