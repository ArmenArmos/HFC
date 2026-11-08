import * as Sentry from "@sentry/nextjs";

import { installEnvelopeScrub, sentryOptions } from "./lib/monitoring/sentry-options";

// Edge runtime (proxy.ts). Off unless NEXT_PUBLIC_SENTRY_DSN is an EU Sentry DSN.
const options = sentryOptions(process.env);
if (options.enabled) installEnvelopeScrub(Sentry.init(options));
