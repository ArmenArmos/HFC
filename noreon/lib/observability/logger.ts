import { after } from "next/server";

import { axiomConfig, sendToAxiom, type AxiomConfig } from "./axiom";
import { currentLogContext } from "./context";
import { redactEvent, type LogEvent, type LogLevel } from "./redact";

/**
 * Structured server logs: one JSON line per event to the console (Vercel's request logs)
 * and, when AXIOM_TOKEN is set, batched to Axiom after the response is sent. Every field
 * passes the allow-list in redact.ts. Logging never throws into the caller, never awaits
 * the network on the request path, and drops events rather than growing without bound.
 */
export type Logger = {
  debug(msg: string, fields?: Record<string, unknown>): void;
  info(msg: string, fields?: Record<string, unknown>): void;
  warn(msg: string, fields?: Record<string, unknown>): void;
  error(msg: string, fields?: Record<string, unknown>): void;
  flush(): Promise<void>;
  /** Events waiting to be sent, for tests. */
  pending(): number;
};

export type LoggerOptions = {
  env?: Record<string, string | undefined>;
  /** The network call for ingest; defaults to the platform fetch without Next's or our wrappers. */
  send?: typeof fetch;
  console?: Pick<Console, "log" | "warn" | "error">;
  /** Hands a flush promise to the platform so it outlives the response. */
  schedule?: (flush: () => Promise<void>) => void;
  now?: () => Date;
  batchSize?: number;
  maxBuffer?: number;
  timeoutMs?: number;
};

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

type Unwrappable = typeof fetch & { __noreonOriginalFetch?: typeof fetch; _nextOriginalFetch?: typeof fetch };

/** The ingest call must not pass through Next's fetch patch (caching, dynamic tracking) or our Supabase hook. */
export function platformFetch(): typeof fetch {
  let current = globalThis.fetch as Unwrappable;
  for (let i = 0; i < 4; i++) {
    const inner = current.__noreonOriginalFetch ?? current._nextOriginalFetch;
    if (!inner) break;
    current = inner as Unwrappable;
  }
  return current;
}

type WaitUntilContext = { get?: () => { waitUntil?: (promise: Promise<unknown>) => void } | undefined };

/** How long a fallback flush waits so the rest of the request's lines join the same batch. */
const FALLBACK_DELAY_MS = 250;

/**
 * Next's after() first: it runs once the response is sent, so one request's lines go in one
 * batch. Where after() is not allowed (a "use cache" scope, outside a request) Vercel's request
 * context keeps the function alive for a short delayed flush; outside any request, a timer.
 */
function defaultSchedule(flush: () => Promise<void>): void {
  try {
    after(flush);
    return;
  } catch {
    // Not allowed here; fall through.
  }
  const delayed = () => new Promise<void>((resolve) => {
    const timer = setTimeout(() => void flush().finally(resolve), FALLBACK_DELAY_MS);
    (timer as { unref?: () => void }).unref?.();
  });
  try {
    const context = (globalThis as Record<symbol, WaitUntilContext | undefined>)[Symbol.for("@next/request-context")];
    const waitUntil = context?.get?.()?.waitUntil;
    if (waitUntil) {
      waitUntil(delayed());
      return;
    }
  } catch {
    // Fall through.
  }
  void delayed();
}

function deploymentFields(env: Record<string, string | undefined>) {
  return {
    region: env.VERCEL_REGION,
    commit: env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12),
    env: env.VERCEL_ENV ?? (env.NODE_ENV === "test" ? "test" : env.NODE_ENV === "production" ? undefined : "development"),
  };
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const env = options.env ?? process.env;
  const out = options.console ?? console;
  const schedule = options.schedule ?? defaultSchedule;
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? 100;
  const maxBuffer = options.maxBuffer ?? 1000;
  const minRank = () => LEVEL_RANK[env.NOREON_LOG_LEVEL as LogLevel] ?? LEVEL_RANK.info;
  // Console lines in the running app (next dev/start, Vercel); quiet in check scripts unless asked.
  const consoleOn = () =>
    env.NOREON_LOG_CONSOLE ? env.NOREON_LOG_CONSOLE !== "off" : Boolean(env.VERCEL || env.NODE_ENV === "development" || env.NODE_ENV === "production");
  const buffer: LogEvent[] = [];
  let dropped = 0;
  let scheduled = false;
  let lastWarning = 0;
  let config: AxiomConfig | null | undefined;
  const destination = () => {
    if (config === undefined) config = env.NEXT_PHASE === "phase-production-build" ? null : axiomConfig(env);
    return config;
  };

  const warnOnce = (reason: string, status?: number) => {
    const at = Date.now();
    if (at - lastWarning < 60_000) return;
    lastWarning = at;
    try {
      out.warn(JSON.stringify(redactEvent("warn", "log.ingest_failed", { outcome: reason === "timeout" ? "timeout" : "error", db_status: status, dropped })));
    } catch {
      // Never let logging break a request.
    }
  };

  async function flush(): Promise<void> {
    scheduled = false;
    const target = destination();
    if (!target) {
      buffer.length = 0;
      return;
    }
    while (buffer.length) {
      const batch = buffer.splice(0, batchSize);
      if (dropped) {
        batch.push(redactEvent("warn", "log.dropped", { dropped }, now()));
        dropped = 0;
      }
      const result = await sendToAxiom(target, batch, options.send ?? platformFetch(), options.timeoutMs);
      if (!result.ok) {
        warnOnce(result.reason ?? "error", result.status);
        return;
      }
    }
  }

  function write(level: LogLevel, msg: string, fields?: Record<string, unknown>) {
    try {
      if (LEVEL_RANK[level] < minRank()) return;
      const context = currentLogContext();
      const event = redactEvent(level, msg, { ...context, ...deploymentFields(env), ...fields }, now());
      if (consoleOn()) {
        const line = JSON.stringify(event);
        if (level === "error") out.error(line);
        else if (level === "warn") out.warn(line);
        else out.log(line);
      }
      if (!destination()) return;
      if (buffer.length >= maxBuffer) {
        buffer.shift();
        dropped++;
      }
      buffer.push(event);
      if (!scheduled) {
        scheduled = true;
        schedule(flush);
      } else if (buffer.length % batchSize === 0) {
        schedule(flush);
      }
    } catch {
      // Never let logging break a request.
    }
  }

  return {
    debug: (msg, fields) => write("debug", msg, fields),
    info: (msg, fields) => write("info", msg, fields),
    warn: (msg, fields) => write("warn", msg, fields),
    error: (msg, fields) => write("error", msg, fields),
    flush: () => flush().catch(() => {}),
    pending: () => buffer.length,
  };
}

/**
 * The app's logger. Import this, never console, for request and sweep lines. One instance per
 * process (shared through globalThis), so the instrumentation bundle and the app share a buffer.
 */
const LOGGER = Symbol.for("noreon.observability.logger");
const sharedLogger = globalThis as typeof globalThis & { [key: symbol]: Logger | undefined };
export const log: Logger = (sharedLogger[LOGGER] ??= createLogger());

/** Error fields without data: name, a code when the error carries one, scrubbed message and frames. */
export function errorFields(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { error_name: typeof error === "object" ? "NonError" : typeof error };
  const code = (error as { code?: unknown }).code;
  return {
    error_name: error.name,
    error_code: typeof code === "string" || typeof code === "number" ? String(code) : undefined,
    error_message: error.message,
    error_stack: error.stack,
  };
}
