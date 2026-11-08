import { createHmac } from 'node:crypto';
import { networkPrefix } from './admission-source';

/**
 * Abuse limits for the real entry points (docs/operations/abuse-protection.md). Pure parts:
 * which buckets a request falls in and their keyed digests. The limits themselves live in the
 * database (`_rate_limit_policy`), never here, so a caller cannot widen them.
 */
export type RateOperation = 'member_code' | 'member_verify' | 'member_link' | 'staff_signin' | 'member_upload' | 'member_speech' | 'clinic_upload' | 'bp_photo' | 'member_live' | 'staff_live' | 'realtime_token';
export type RateMode = 'take' | 'peek' | 'record';
export type RateBucket = { kind: 'source'; mode?: RateMode } | { kind: 'phone' | 'email' | 'user'; value: string; mode?: RateMode };
export type RateEnv = { vercel: boolean; secret: string | undefined };
export type RateClaim = { kinds: string[]; keys: string[]; modes: RateMode[] };

/** A request whose Vercel client address is missing or malformed shares one bucket. */
export const UNKNOWN_SOURCE = 'unknown';

/**
 * The network bucket of the caller. On Vercel only Vercel's own header counts; off Vercel
 * (local development, CI) there is no trustworthy address, so the source bucket is skipped.
 */
export function sourceBucket(headers: Pick<Headers, 'get'>, env: RateEnv): string | null {
  if (!env.vercel) return null;
  return networkPrefix(headers.get('x-vercel-forwarded-for')) ?? UNKNOWN_SOURCE;
}

/** HMAC key for bucket digests, derived from the service secret so no new variable is needed. */
export function rateKey(env: RateEnv): Buffer {
  if (!env.secret || env.secret.length < 32) throw new Error('rate_limit_unavailable');
  return createHmac('sha256', env.secret).update('noreon-rate-limit-v1').digest();
}

const normalize = (kind: string, value: string) => (kind === 'email' ? value.trim().toLowerCase() : value.trim());

/** The digests sent to `rate_limit_claim`; null when no bucket applies (nothing to check). */
export function rateClaim(buckets: RateBucket[], source: string | null, key: Buffer): RateClaim | null {
  const claim: RateClaim = { kinds: [], keys: [], modes: [] };
  for (const bucket of buckets) {
    const value = bucket.kind === 'source' ? source : normalize(bucket.kind, bucket.value);
    if (value === null) continue;
    if (!value || value.length > 320) throw new Error('rate_limit_unavailable');
    claim.kinds.push(bucket.kind);
    claim.keys.push(createHmac('sha256', key).update(`${bucket.kind}\0${value}`).digest('hex'));
    claim.modes.push(bucket.mode ?? 'take');
  }
  return claim.kinds.length ? claim : null;
}

/** 0 admits; a positive integer is Retry-After seconds. Anything else is a limiter fault. */
export function parseRetry(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > 86400) throw new Error('rate_limit_unavailable');
  return value;
}

/**
 * Log fields for refusals and for a missing Vercel address, sent through the structured logger
 * (Axiom). Operation and bucket kinds only: never a key, an address, a phone, an email or a
 * user id. Axiom alerts count `msg:"rate_limited"`; every field is allow-listed in redact.ts.
 */
export const refusalFields = (operation: RateOperation, kinds: string[], retryAfter: number) => ({ operation, limit_kinds: kinds.join(','), retry_after: retryAfter });
export const unknownSourceFields = (operation: RateOperation) => ({ operation });
