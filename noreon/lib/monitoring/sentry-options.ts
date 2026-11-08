/**
 * One set of Sentry options for the browser, Node and edge runtimes.
 *
 * Sentry starts only when NEXT_PUBLIC_SENTRY_DSN is set and points at Sentry's EU ingest
 * (`*.de.sentry.io`). Health-adjacent error data must stay in the EU, and a US DSN is
 * refused here rather than trusted to configuration. With no DSN the app runs as before.
 */
import type { getDefaultIntegrations, init } from "@sentry/nextjs";

import { beforeSend, beforeSendTransaction, scrubBreadcrumb, scrubEnvelope } from "./scrub";

type Environment = Record<string, string | undefined>;

/** Sentry's EU (Frankfurt) ingest host, e.g. o123.ingest.de.sentry.io. */
const EU_INGEST_HOST = /(^|\.)ingest\.de\.sentry\.io$/;

/** The DSN when it is set and EU-hosted; otherwise undefined, which keeps Sentry off. */
export function euSentryDsn(dsn: string | undefined): string | undefined {
  if (!dsn) return undefined;
  try {
    const url = new URL(dsn);
    return url.protocol === "https:" && EU_INGEST_HOST.test(url.hostname) ? dsn : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Integrations we never run: release-health sessions (browser and server; they carry the
 * IP address and user agent outside beforeSend, and we do not use crash-free rates) and
 * performance tracing (errors are the goal).
 */
type Integration = ReturnType<typeof getDefaultIntegrations>[number];
type Client = NonNullable<ReturnType<typeof init>>;

const DROPPED_INTEGRATIONS = new Set(["BrowserSession", "ProcessSession", "BrowserTracing"]);

export function keptIntegrations(defaults: Integration[]): Integration[] {
  return defaults.filter((integration) => !DROPPED_INTEGRATIONS.has(integration.name));
}

/** After init: scrub every envelope (sessions, client reports, check-ins) before it is sent. */
export function installEnvelopeScrub(client: Client | undefined): void {
  client?.on("beforeEnvelope", (envelope: unknown) => scrubEnvelope(envelope as unknown as Parameters<typeof scrubEnvelope>[0]));
}

/**
 * `process.env.NEXT_PUBLIC_*` must be written out literally for Next to inline it into the
 * browser bundle, so callers pass the values in rather than this module reading them.
 */
export function sentryOptions(env: Environment) {
  const dsn = euSentryDsn(env.NEXT_PUBLIC_SENTRY_DSN);
  return {
    dsn,
    enabled: Boolean(dsn),
    environment: env.NEXT_PUBLIC_VERCEL_ENV ?? env.VERCEL_ENV ?? "development",
    // Errors are the goal. No tracesSampleRate means no performance tracing: no transactions
    // or spans are sent (the browser also drops the tracing integration, instrumentation-client.ts).
    // Session Replay is not installed (no replayIntegration). Turning it on later needs
    // maskAllText, blockAllMedia and a legal OK.
    // SDK 11 replaced `sendDefaultPii` with per-category switches; every category is off or narrowed.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: { request: { allow: ["user-agent", "x-request-id", "content-type", "accept-language"] }, response: false },
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
      // Source lines around a frame are code, but they are not needed: source maps give the code.
      frameContextLines: 0,
    },
    // Server hostnames are Vercel's, not people's, but there is no need to send them.
    includeServerName: false,
    integrations: keptIntegrations,
    maxBreadcrumbs: 30,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSend,
    // SDK 11 streams spans by default and then ignores beforeSendTransaction; keep the
    // classic lifecycle so the transaction scrubber applies if tracing is ever turned on.
    traceLifecycle: "static",
    beforeSendTransaction,
  } satisfies Parameters<typeof init>[0];
}
