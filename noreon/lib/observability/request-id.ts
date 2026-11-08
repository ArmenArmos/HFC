/**
 * One id per incoming request, set or carried by proxy.ts and returned in the response.
 * An inbound id is kept only when it looks like an id; anything else is replaced, so a
 * caller cannot smuggle text into the logs through this header.
 */
export const REQUEST_ID_HEADER = "x-request-id";

const SAFE_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function validRequestId(value: unknown): value is string {
  return typeof value === "string" && SAFE_ID.test(value);
}

export function newRequestId(): string {
  return globalThis.crypto.randomUUID();
}

/** The inbound id when it is safe, otherwise a new one. */
export function requestIdFrom(headers: Pick<Headers, "get"> | null | undefined): string {
  const inbound = headers?.get(REQUEST_ID_HEADER);
  return validRequestId(inbound) ? inbound : newRequestId();
}

/**
 * Makes the id visible to server components, actions and route handlers.
 *
 * A proxy response that continues (next or rewrite) carries the request headers the app
 * will see as `x-middleware-override-headers` plus one `x-middleware-request-*` per header.
 * When the response already overrides headers, the id is added to that list; when it does
 * not, the full current request headers are declared, which is what
 * `NextResponse.next({ request })` would have done. Every response also returns the id.
 */
export function propagateRequestId(response: Response, requestHeaders: Headers, requestId: string): void {
  const out = response.headers;
  out.set(REQUEST_ID_HEADER, requestId);
  if (!out.has("x-middleware-next") && !out.has("x-middleware-rewrite")) return;
  const override = out.get("x-middleware-override-headers");
  if (override !== null) {
    const keys = override.split(",").map((key) => key.trim()).filter(Boolean);
    if (!keys.includes(REQUEST_ID_HEADER)) out.set("x-middleware-override-headers", [...keys, REQUEST_ID_HEADER].join(","));
    out.set(`x-middleware-request-${REQUEST_ID_HEADER}`, requestId);
    return;
  }
  const keys: string[] = [];
  for (const [key, value] of requestHeaders) {
    out.set(`x-middleware-request-${key}`, value);
    keys.push(key);
  }
  if (!keys.includes(REQUEST_ID_HEADER)) {
    out.set(`x-middleware-request-${REQUEST_ID_HEADER}`, requestId);
    keys.push(REQUEST_ID_HEADER);
  }
  out.set("x-middleware-override-headers", keys.join(","));
}
