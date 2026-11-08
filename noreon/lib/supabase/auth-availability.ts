import { isAuthRetryableFetchError } from "@supabase/supabase-js";

/**
 * True when the auth service could not answer: a failed request, a 5xx from it or its database, or a rate limit. The
 * session may be perfectly good, so this is never "signed out" (QA A1-obs). A session that really ended is a 4xx.
 */
export function authServiceUnavailable(error: { status?: number } | null | undefined): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  return typeof error.status === "number" && (error.status >= 500 || error.status === 429);
}
