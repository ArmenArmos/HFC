import type { Instrumentation } from "next";
import { warnIfCaptchaDisabled } from "./lib/captcha";
import { reportRequestErrorToSentry } from "./lib/monitoring/request-error";

/**
 * Runs once per server instance: repeat the staging CAPTCHA warning in runtime logs, start
 * Sentry when configured (both runtimes), and start Supabase call logging (nodejs only).
 */
export async function register() {
  warnIfCaptchaDisabled(process.env);
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
    const { installSupabaseFetchLogging } = await import("./lib/observability/supabase-fetch");
    installSupabaseFetchLogging();
  }
  if (process.env.NEXT_RUNTIME === "edge") await import("./sentry.edge.config");
}

/** Unhandled render, route and action errors in Axiom: route template, request id and the scrubbed error only. */
const logRequestErrorToAxiom: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  try {
    const { log, errorFields } = await import("./lib/observability/logger");
    const { REQUEST_ID_HEADER } = await import("./lib/observability/request-id");
    const header = request.headers[REQUEST_ID_HEADER];
    const digest = (error as { digest?: unknown } | null)?.digest;
    log.error("error.unhandled", {
      request_id: Array.isArray(header) ? header[0] : header,
      route: context.routePath,
      route_type: context.routeType,
      method: request.method,
      digest: typeof digest === "string" && /^\d+$/.test(digest) ? digest : undefined,
      ...errorFields(error),
    });
    await log.flush();
  } catch {
    // Error reporting must never raise a second error.
  }
};

/** Both reporters run; neither can stop the other. Sentry also runs on the edge runtime. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  await Promise.allSettled([reportRequestErrorToSentry(error, request, context), logRequestErrorToAxiom(error, request, context)]);
};
