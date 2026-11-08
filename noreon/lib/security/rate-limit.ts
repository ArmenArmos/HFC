import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { headers } from 'next/headers';
import type { Database } from '@/lib/db/types';
import { log } from '@/lib/observability/logger';
import { UNKNOWN_SOURCE, parseRetry, rateClaim, rateKey, refusalFields, sourceBucket, unknownSourceFields, type RateBucket, type RateOperation } from './rate-limit-core';

export type { RateBucket, RateOperation } from './rate-limit-core';
export type RateResult = { ok: true } | { ok: false; retryAfter: number };

function env() {
  return { vercel: process.env.VERCEL === '1', secret: process.env.SUPABASE_SERVICE_ROLE_KEY };
}

/**
 * Counts and checks one request against the database limits. Throws when the limiter cannot
 * answer, so callers refuse rather than admit; the one exception is a database that does not
 * have the function yet (app deployed before its migration), which admits and says so in the log.
 * Voice opts into failClosed, which also refuses a missing function or an empty claim.
 */
export async function rateLimit(operation: RateOperation, buckets: RateBucket[], requestHeaders?: Headers, options: { failClosed?: boolean } = {}): Promise<RateResult> {
  const e = env();
  const source = buckets.some(b => b.kind === 'source') ? sourceBucket(requestHeaders ?? (await headers()), e) : null;
  // Every caller would share one bucket if Vercel stopped sending its address: make that visible.
  if (source === UNKNOWN_SOURCE) log.warn('rate_limit_source_unknown', unknownSourceFields(operation));
  const claim = rateClaim(buckets, source, rateKey(e));
  if (!claim) {
    if (options.failClosed) throw new Error('rate_limit_unavailable');
    return { ok: true };
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !e.secret) throw new Error('rate_limit_unavailable');
  const client = createClient<Database>(url, e.secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { data, error } = await client
    .rpc('rate_limit_claim', { p_operation: operation, p_kinds: claim.kinds, p_keys: claim.keys, p_modes: claim.modes })
    .abortSignal(AbortSignal.timeout(3000));
  if (error?.code === 'PGRST202') {
    log.warn('rate_limit_claim_missing', { operation });
    if (options.failClosed) throw new Error('rate_limit_unavailable');
    return { ok: true };
  }
  if (error) throw new Error('rate_limit_unavailable');
  const retry = parseRetry(data);
  if (retry === 0) return { ok: true };
  // Sign-in refusals answer 200 with a reason, so this line (not a 429) is what alerts count.
  log.warn('rate_limited', refusalFields(operation, claim.kinds, retry));
  return { ok: false, retryAfter: retry };
}

/** For counting after the fact (a confirmed send, a failed password): never fails the request. */
export async function recordRateLimit(operation: RateOperation, buckets: RateBucket[], requestHeaders?: Headers): Promise<void> {
  await rateLimit(operation, buckets.map(b => ({ ...b, mode: 'record' as const })), requestHeaders).catch(() => undefined);
}
