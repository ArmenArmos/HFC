import {randomUUID, timingSafeEqual} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import type {Database} from '@/lib/db/types';
import {cleanClinicUploads, type ClinicCleanupClient} from './clinic-uploads';
type CleanupClient = SupabaseClient<Database>;
type FailureCategory = 'database' | 'storage' | 'unexpected' | 'mixed';
export type CleanupDependencies = {env:Record<string,string|undefined>;demoEnabled:()=>boolean;real:()=>CleanupClient;demo:()=>CleanupClient};
export function createCleanupHandler(deps: CleanupDependencies) {
 return async function GET(request: Request) {
  const expected = deps.env.CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  if (
    !expected ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(`Bearer ${expected}`) ||
    !timingSafeEqual(
      Buffer.from(supplied),
      Buffer.from(`Bearer ${expected}`),
    ) ||
    (deps.env.NOREON_DEPLOYMENT_TARGET !== "app" && !deps.demoEnabled())
  )
    return new Response(null, { status: 404 });
  const runId = randomUUID();
  let attempted = 0;
  let category: FailureCategory | null = null;
  let observable = true;
  let ledger: CleanupClient | undefined;
  const failure = (next: FailureCategory) => { category = category && category !== next ? 'mixed' : next; };
  try { ledger = deps.env.NOREON_DEPLOYMENT_TARGET === 'app' ? deps.real() : deps.demo(); } catch { observable = false; }
  const record = async (name: 'cleanup_run_start' | 'cleanup_run_finish', args: Record<string, unknown>) => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!ledger) { observable = false; return; }
      const query = ledger.rpc(name, args as never);
      const bounded = 'abortSignal' in query ? query.abortSignal(controller.signal) : query;
      const outcome = await Promise.race([
        bounded,
        new Promise<null>(resolve => { timer = setTimeout(() => { controller.abort(); resolve(null); }, 1000); }),
      ]);
      if (!outcome || outcome.error) observable = false;
    } catch { observable = false; }
    finally { if (timer) clearTimeout(timer); }
  };
  await record('cleanup_run_start', {p_run_id: runId});
  let cleaned = 0;
  let failed = 0;
  const execute = async () => {
  if (deps.env.NOREON_DEPLOYMENT_TARGET === "app") {
    const admin = ledger ?? deps.real();
    // Signed upload tokens last two hours. Keep tombstones until all such
    // tokens have expired, then remove again to catch late uploads.
    const cutoff = new Date(Date.now() - 3 * 3600000).toISOString();
    const rows = await admin
      .from("patient_reports")
      .select("id,object_path")
      .eq("state", "deleted")
      .is("storage_purged_at", null)
      .lt("deleted_at", cutoff)
      .order("deleted_at")
      .limit(200);
    if (rows.error) { failure('database'); failed++;
      return Response.json({ error: "cleanup_failed" }, { status: 500 }); }
    for (const r of rows.data) {
      attempted++;
      const removed = await admin.storage
        .from("patient-reports")
        .remove([r.object_path]);
      if (removed.error) {
        failure('storage'); failed++;
        continue;
      }
      const saved = await admin
        .from("patient_reports")
        .update({
          storage_purged_at: new Date().toISOString(),
          file_name: "Removed report",
          checksum: null,
          error_code: null,
        })
        .eq("id", r.id);
      if (saved.error) { failure('database'); failed++; }
      else cleaned++;
    }
    // Removed earlier-result files whose immediate Storage removal failed (privacy audit B3-3).
    const history = await admin
      .from("member_reported_documents")
      .select("id,object_path")
      .not("deleted_at", "is", null)
      .is("storage_purged_at", null)
      .order("deleted_at")
      .limit(200);
    if (history.error) { failure('database'); failed++; }
    else for (const r of history.data) {
      attempted++;
      const removed = await admin.storage.from("member-history").remove([r.object_path]);
      if (removed.error) { failure('storage'); failed++; continue; }
      const saved = await admin.from("member_reported_documents").update({ storage_purged_at: new Date().toISOString() }).eq("id", r.id);
      if (saved.error) { failure('database'); failed++; }
      else cleaned++;
    }
    const clinic = await cleanClinicUploads(admin as unknown as ClinicCleanupClient);
    attempted += clinic.attempted;
    cleaned += clinic.cleaned;
    if (clinic.failed) { failed += clinic.failed; failure(clinic.category ?? 'unexpected'); }
  }
  if (deps.demoEnabled()) {
    try {
      const shared = deps.env.NOREON_DEPLOYMENT_TARGET === 'app' ? deps.demo() : ledger ?? deps.demo();
      const now = new Date().toISOString();
      const expired = await shared
        .from("workspace_cases")
        .select("id")
        .lte("expires_at", now)
        .order("expires_at")
        .limit(100);
      if (expired.error) { failure('database'); failed++; }
      else {
        for (const item of expired.data) {
          attempted++;
          const deleted = await shared.rpc("workspace_delete_expired_case",{p_id:item.id});
          if (deleted.error) { failure('database'); failed++; }
          else if (deleted.data) cleaned++;
        }
      }
      const pending = await shared.from("workspace_report_cleanup").select("object_path").order("created_at").limit(200);
      if (pending.error) { failure('database'); failed++; }
      else for (const row of pending.data) {
        attempted++;
        const removed = await shared.storage.from("workspace-case-reports").remove([row.object_path]);
        if (removed.error) { failure('storage'); failed++; continue; }
        const acknowledged = await shared.from("workspace_report_cleanup").delete().eq("object_path", row.object_path);
        if (acknowledged.error) { failure('database'); failed++; }
      }
    } catch {
      failure('unexpected'); failed++;
    }
  }
  if (failed)
    return Response.json(
      { error: "cleanup_failed", cleaned, failed },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  return Response.json(
    { cleaned },
    { headers: { "Cache-Control": "no-store" } },
  );
  };
  let response: Response;
  try { response = await execute(); }
  catch { failure('unexpected'); failed++; response = Response.json({error:'cleanup_failed',cleaned,failed}, {status:500}); }
  await record('cleanup_run_finish', {p_run_id:runId,p_attempted:attempted,p_cleaned:cleaned,p_failed:failed,p_failure_category:category});
  // A telemetry outage never changes the cleanup's original HTTP outcome.
  const body = await response.json();
  return Response.json({...body,observability:observable?'recorded':'unavailable'}, {status:response.status,headers:{'Cache-Control':'no-store'}});
 };
}
