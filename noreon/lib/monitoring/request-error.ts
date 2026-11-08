import type { Instrumentation } from "next";

/**
 * Unhandled render, route handler, server action and proxy errors go to Sentry. Kept as
 * its own function so instrumentation.ts can call it next to the Axiom logger's handler.
 * Sentry is imported lazily and only when a DSN is configured.
 */
export const reportRequestErrorToSentry: Instrumentation.onRequestError = async (error, request, context) => {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureRequestError(error, request, context);
  } catch {
    // Error reporting must never raise a second error.
  }
};
