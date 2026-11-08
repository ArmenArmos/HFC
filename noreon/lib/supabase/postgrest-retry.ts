/**
 * PostgREST before v14.18 / v16.3 can validate the first request after an idle
 * period against a stale cached clock, so a token minted a moment earlier is
 * rejected as 401 PGRST303 "JWT issued at future". The token is valid and the
 * request never reached the database, so one repeat of a read is safe.
 *
 * Only that exact rejection of a table GET or HEAD is repeated, once; RPCs are
 * never repeated, whatever their method.
 * Every other status, error and method passes through unchanged, and a second
 * rejection is returned as is so the caller's own error handling still applies.
 */
export const STALE_CLOCK_RETRY_DELAY_MS = 1000;

const FUTURE_IAT = /error_description="JWT issued at future"/;

export function isStaleClockRejection(response: Response): boolean {
  return response.status === 401 &&
    FUTURE_IAT.test(response.headers.get("www-authenticate") ?? "");
}

type Wait = (ms: number) => Promise<void>;
const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function withStaleClockRetry(
  base: typeof fetch = fetch,
  wait: Wait = sleep,
): typeof fetch {
  return async (input, init) => {
    const response = await base(input, init);
    if (!isStaleClockRejection(response)) return response;

    const request = input instanceof Request ? input : null;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const url = new URL(request ? request.url : String(input));
    const signal = init?.signal ?? request?.signal;
    if ((method !== "GET" && method !== "HEAD") ||
        !url.pathname.startsWith("/rest/v1/") ||
        url.pathname.startsWith("/rest/v1/rpc/") || signal?.aborted)
      return response;

    // Next may hand back a tee of this body and keep the other branch, so the
    // cancel can stay pending until that branch is read. Do not wait for it.
    response.body?.cancel().catch(() => {});
    console.warn(`PostgREST rejected a fresh token as issued in the future; repeating ${method} ${url.pathname} once.`);
    await wait(STALE_CLOCK_RETRY_DELAY_MS);
    // Next dedupes identical GETs within a render and would replay the cached
    // 401. Passing a signal is its documented opt-out, so the repeat is sent.
    return base(input, { ...init, signal: signal ?? new AbortController().signal });
  };
}
