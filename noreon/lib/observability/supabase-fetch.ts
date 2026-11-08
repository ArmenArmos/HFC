import { currentLogContext } from "./context";
import { log, type Logger } from "./logger";
import { REQUEST_ID_HEADER } from "./request-id";

/**
 * Times every call the server makes to Supabase and tags it with the request id, without
 * touching the ~300 `.rpc()` call sites or the ~30 places that build a client: supabase-js
 * resolves the global fetch on each call, so one wrapper installed at server start
 * (instrumentation.ts) sees them all.
 *
 * Logged: the RPC name, or the table name, the HTTP status and the duration. Never the
 * query string, the body, the response or any header. RPCs are logged every time; table
 * reads only when they fail or take longer than a second; auth and storage only on failure,
 * and only as their kind, because their paths can carry file names or tokens.
 */
const SLOW_TABLE_MS = 1000;
const MARK = "__noreonOriginalFetch";

type Classified = { db: "rpc" | "rest" | "auth" | "storage" | "functions"; rpc?: string; table?: string };

export function classifySupabaseUrl(url: URL, supabaseOrigin: string): Classified | null {
  if (url.origin !== supabaseOrigin) return null;
  const path = url.pathname;
  if (path.startsWith("/rest/v1/rpc/")) return { db: "rpc", rpc: path.slice("/rest/v1/rpc/".length).split("/", 1)[0] };
  if (path.startsWith("/rest/v1/")) return { db: "rest", table: path.slice("/rest/v1/".length).split("/", 1)[0] };
  if (path.startsWith("/auth/v1/")) return { db: "auth" };
  if (path.startsWith("/storage/v1/")) return { db: "storage" };
  if (path.startsWith("/functions/v1/")) return { db: "functions" };
  return null;
}

function supabaseOrigin(env: Record<string, string | undefined>): string | null {
  try {
    return env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL).origin : null;
  } catch {
    return null;
  }
}

export function withSupabaseLogging(
  base: typeof fetch,
  options: { env?: Record<string, string | undefined>; logger?: Logger; clock?: () => number } = {},
): typeof fetch {
  const env = options.env ?? process.env;
  const logger = options.logger ?? log;
  const clock = options.clock ?? (() => performance.now());
  const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const origin = supabaseOrigin(env);
    let target: Classified | null = null;
    let method = "GET";
    try {
      const request = input instanceof Request ? input : null;
      target = origin ? classifySupabaseUrl(new URL(request ? request.url : String(input)), origin) : null;
      method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    } catch {
      target = null;
    }
    if (!target) return base(input, init);

    const context = currentLogContext();
    let nextInit = init;
    if (context?.request_id) {
      try {
        const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
        headers.set(REQUEST_ID_HEADER, context.request_id);
        nextInit = { ...init, headers };
      } catch {
        nextInit = init;
      }
    }

    const started = clock();
    let response: Response;
    try {
      response = await base(input, nextInit);
    } catch (error) {
      safeLog(() =>
        logger.warn("db.fetch_failed", {
          db: target.db,
          rpc: target.rpc,
          table: target.table,
          method,
          rpc_ms: clock() - started,
          error_name: error instanceof Error ? error.name : "unknown",
        }),
      );
      throw error;
    }
    const elapsed = clock() - started;
    safeLog(() => {
      const status = response.status;
      const level = status >= 500 ? "error" : status >= 400 ? "warn" : "info";
      if (target.db === "rpc") {
        logger[level]("db.rpc", { db: "rpc", rpc: target.rpc, method, db_status: status, rpc_ms: elapsed });
      } else if (target.db === "rest") {
        if (status >= 400 || elapsed >= SLOW_TABLE_MS)
          logger[status >= 400 ? level : "warn"]("db.rest", { db: "rest", table: target.table, method, db_status: status, rpc_ms: elapsed });
      } else if (status >= 500) {
        logger.error("db.call", { db: target.db, method, db_status: status, rpc_ms: elapsed });
      }
    });
    return response;
  }) as typeof fetch & { [MARK]?: typeof fetch };
  wrapped[MARK] = base;
  // When Next has already patched fetch, carry its markers so it does not patch a second time.
  const patched = base as typeof fetch & { __nextPatched?: boolean; _nextOriginalFetch?: typeof fetch };
  if (patched.__nextPatched) Object.assign(wrapped, { __nextPatched: true, _nextOriginalFetch: patched._nextOriginalFetch });
  return wrapped;
}

function safeLog(write: () => void) {
  try {
    write();
  } catch {
    // Never let logging break a database call.
  }
}

/** Installs the wrapper once per server instance. Safe to call more than once. */
export function installSupabaseFetchLogging(): void {
  const current = globalThis.fetch as typeof fetch & { [MARK]?: typeof fetch };
  if (!current || current[MARK]) return;
  globalThis.fetch = withSupabaseLogging(current);
}
