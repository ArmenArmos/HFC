import { currentLogContext, nextRequestHeader, noteActor, runWithLogContext, type LogContext } from "./context";
import { errorFields, log } from "./logger";
import { REQUEST_ID_HEADER, newRequestId, validRequestId, requestIdFrom } from "./request-id";

/**
 * One line per route handler call and per server action call: route, method, status,
 * duration and who acted (ids only). Errors are logged with a scrubbed message and stack
 * and rethrown unchanged; Next's redirect and not-found signals are logged as outcomes,
 * not errors, and their digests (which carry the target path) are never logged.
 */

const MEMBER_IN_PATH = /\/members\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i;

type NextSignal = { outcome: "redirect" | "not_found" | "denied"; status: number };

/** Next's control-flow throws. Only the kind and status are read from the digest. */
export function nextSignal(error: unknown): NextSignal | null {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest !== "string") return null;
  if (digest.startsWith("NEXT_REDIRECT;")) {
    const status = Number(digest.split(";").at(-2));
    return { outcome: "redirect", status: Number.isInteger(status) ? status : 307 };
  }
  if (digest.startsWith("NEXT_HTTP_ERROR_FALLBACK;")) {
    const status = Number(digest.split(";")[1]);
    return { outcome: status === 404 ? "not_found" : "denied", status: Number.isInteger(status) ? status : 404 };
  }
  return null;
}

function memberFromPath(path: string | undefined): string | undefined {
  return path?.match(MEMBER_IN_PATH)?.[1];
}

function pathOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url, "http://local").pathname;
  } catch {
    return undefined;
  }
}

type ActionLogOptions = { failureCode?: string; failureCodes?: readonly string[] };

async function timed<T>(line: string, fields: Record<string, unknown>, run: () => Promise<T>, statusOf: (value: T) => number, options?: ActionLogOptions): Promise<T> {
  const started = performance.now();
  try {
    const value = await run();
    const refused = options !== undefined && value !== null && typeof value === "object" && "ok" in value && value.ok === false;
    const code = value !== null && typeof value === "object" && "code" in value && typeof value.code === "string" ? value.code : undefined;
    // Result codes are data too: only explicitly named constants may enter a log.
    const failureCode = code && options?.failureCodes?.includes(code) ? code : options?.failureCode ?? "action_refused";
    const status = refused ? 409 : statusOf(value);
    log[status >= 500 ? "error" : "info"](line, { ...fields, status, outcome: refused ? "denied" : status >= 400 ? "error" : "ok", ...(refused ? { error_code: failureCode } : {}), duration_ms: performance.now() - started });
    return value;
  } catch (error) {
    const signal = nextSignal(error);
    if (signal) log.info(line, { ...fields, status: signal.status, outcome: signal.outcome, duration_ms: performance.now() - started });
    // Messaging operations can throw provider/database errors containing member text.
    // Log their fixed code only, while rethrowing unchanged for uncertain-result recovery.
    else log.error(line, { ...fields, status: 500, outcome: "error", duration_ms: performance.now() - started, ...(options?.failureCode ? { error_code: options.failureCode } : errorFields(error)) });
    throw error;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- keeps each handler's own parameter types for Next's route type check.
type RouteHandler = (...args: any[]) => Response | Promise<Response>;

/** Wraps a route handler export: `export const GET = withRouteLogging(async function GET(request) { ... })`. */
export function withRouteLogging<H extends RouteHandler>(handler: H, options: { actor?: "system" } = {}): H {
  const wrapped = async (...args: Parameters<H>) => {
    const request = args[0] instanceof Request ? args[0] : undefined;
    let path: string | undefined;
    try {
      path = request ? new URL(request.url).pathname : undefined;
    } catch {
      path = undefined;
    }
    const context: LogContext = {
      request_id: requestIdFrom(request?.headers),
      route: path,
      method: request?.method,
      route_type: "route",
      member_id: memberFromPath(path),
      ...(options.actor ? { actor_kind: options.actor } : {}),
    };
    return runWithLogContext(context, () => timed("route", {}, async () => handler(...args), (response) => response.status));
  };
  return wrapped as H;
}

type Action<A extends unknown[], R> = (...args: A) => Promise<R>;

/**
 * Wraps a server action export: `export const save = loggedAction("save", async function save(...) { ... })`.
 * Next only requires a "use server" export to be a function, which this returns.
 */
export function loggedAction<A extends unknown[], R>(name: string, action: Action<A, R>, options: ActionLogOptions = {}): Action<A, R> {
  return async (...args: A) => {
    const inbound = nextRequestHeader(REQUEST_ID_HEADER);
    const requestId = validRequestId(inbound) ? inbound : currentLogContext()?.request_id ?? newRequestId();
    const route = pathOf(nextRequestHeader("referer"));
    const context: LogContext = { request_id: requestId, route, method: "POST", route_type: "action", member_id: memberFromPath(route) };
    return runWithLogContext(context, () => timed("action", { action: name }, () => action(...args), () => 200, options));
  };
}

/** Sweep summary: counts and duration from the report a cron sweep returns. */
export function logSweep(sweep: string, report: unknown, startedAt: number, outcome: "ok" | "error" | "skipped" = "ok", error?: unknown): void {
  const context = currentLogContext();
  if (context && !context.actor_kind) noteActor("system");
  log[outcome === "error" ? "error" : "info"]("sweep", { sweep, route_type: "sweep", outcome, counts: report, duration_ms: performance.now() - startedAt, ...(error === undefined ? {} : errorFields(error)) });
}
