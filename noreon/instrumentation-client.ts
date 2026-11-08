import * as Sentry from "@sentry/nextjs";

import { installEnvelopeScrub, sentryOptions } from "./lib/monitoring/sentry-options";

// Browser errors on members' phones. Off unless NEXT_PUBLIC_SENTRY_DSN is an EU Sentry DSN.
// The env values are spelled out so Next inlines them into the browser bundle.
const options = sentryOptions({
  NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
  NEXT_PUBLIC_VERCEL_ENV: process.env.NEXT_PUBLIC_VERCEL_ENV,
});

if (options.enabled) {
  try {
    // No performance tracing and no release-health sessions; only errors (sentry-options.ts).
    installEnvelopeScrub(Sentry.init(options));
  } catch {
    // Monitoring must never stop the app from starting.
  }
}
