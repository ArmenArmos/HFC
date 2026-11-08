import { withRouteLogging } from '@/lib/observability/with-logging';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types';
import { appHealth, reuse } from '@/lib/health/checks';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const check = reuse(() => appHealth(async signal => {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return false;
  const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client.rpc('health_ping').abortSignal(signal);
  return !error && data === true;
}, process.env.VERCEL_GIT_COMMIT_SHA));

/** Uptime probe: app up and database reachable. Fixed fields only. */
export const GET = withRouteLogging(async function GET() {
  const answer = await check();
  return Response.json(answer.body, { status: answer.status, headers: { 'Cache-Control': 'no-store' } });
});
export const HEAD = withRouteLogging(async () => new Response(null, { status: (await check()).status, headers: { 'Cache-Control': 'no-store' } }));
