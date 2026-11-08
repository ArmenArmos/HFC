import type { NextConfig } from "next";
import { withSentryConfig } from "@sentry/nextjs/config";

import { warnIfCaptchaDisabled } from "./lib/captcha";
import { deploymentErrors } from "./lib/deployment";
import { euSentryDsn } from "./lib/monitoring/sentry-options";

const errors = deploymentErrors(process.env);
if (errors.length) throw new Error(errors.join("\n"));
warnIfCaptchaDisabled(process.env);

const nextConfig: NextConfig = {
  /** Route strings are checked against the routes that exist. */
  typedRoutes: true,
  // The GP report PDF embeds DejaVu Sans (the template's font, with Armenian glyphs).
  outputFileTracingIncludes: {'/staff/real/members/*/gp-report': ['./lib/gp-report/fonts/*.ttf']},
  headers() {
    // Baseline anti-framing and navigation policy. Script nonces need a separate
    // rollout across static/streamed pages; this does not claim script-XSS protection.
    const baseline = "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'";
    const previewHeaders = [
      {key: 'X-Frame-Options', value: 'SAMEORIGIN'},
      {key: 'Content-Security-Policy', value: "default-src 'none'; frame-ancestors 'self'"},
    ];
    return [
      {source: '/:path*', headers: [
        {key: 'X-Content-Type-Options', value: 'nosniff'},
        {key: 'X-Frame-Options', value: 'DENY'},
        {key: 'Content-Security-Policy', value: baseline},
        {key: 'Referrer-Policy', value: 'same-origin'},
        {key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=()'},
      ]},
      {source: '/patient/sw.js', headers: [
        {key: 'Content-Type', value: 'application/javascript; charset=utf-8'},
        {key: 'Cache-Control', value: 'no-store'},
        {key: 'Service-Worker-Allowed', value: '/patient/'},
      ]},
      {source: '/staff/real/members/:id/reports/:reportId', headers: [{key: 'Referrer-Policy', value: 'no-referrer'}]},
      // The lab check shows the audited PDF beside its values, so this route alone may be framed by our own pages.
      {source: '/staff/real/members/:id/documents/:fileId', headers: previewHeaders},
      // Member uploads use the same audited, same-origin preview in doctor chat.
      {source: '/staff/real/members/:id/member-uploads/:docId', headers: [
        ...previewHeaders,
        {key: 'Referrer-Policy', value: 'no-referrer'},
      ]},
      // Config headers take precedence over route handlers in this Next version.
      // Preserve the stricter uploaded-file policy, including shared downloads.
      ...['/patient/reports/shared', '/staff/reports', '/api/patient/reports/:id/original'].map(source => ({
        source, headers: [{key: 'Content-Security-Policy', value: "default-src 'none'; sandbox; frame-ancestors 'none'"}],
      })),
      ...['/staff/reports', '/api/patient/reports/:id/original'].map(source => ({
        source, has: [{type: 'query' as const, key: 'preview', value: '1'}], headers: previewHeaders,
      })),
    ];
  },
  // Patient details and verification codes must not appear in development action logs.
  logging: { serverFunctions: false },
  redirects() {
    if (process.env.NOREON_DEPLOYMENT_TARGET === "app") {
      return [{ source: "/", missing: [{ type: "host" as const, value: "(doctors|backoffice|staging-backoffice)\\.noreon\\.health" }], destination: "/patient", permanent: false }];
    }
    return [
      ...["app\\.noreon\\.health", "staging\\.noreon\\.health"].map((host) => ({
        source: "/",
        has: [{ type: "host" as const, value: host }],
        destination: "/patient",
        permanent: false,
      })),
      // No standalone privacy policy is approved yet; the homepage section is the privacy text.
      { source: "/privacy", destination: "/#privacy", permanent: false },
    ];
  },
};

/**
 * Sentry is wired into the build only when an EU DSN is configured. Source maps are made
 * and uploaded only when SENTRY_AUTH_TOKEN is present (Vercel builds); after upload they
 * are deleted and their sourceMappingURL comments stripped, so browsers never get them.
 * A failed upload warns instead of failing the deploy, and the deletion still runs.
 */
function withSentry(config: NextConfig): NextConfig {
  if (!euSentryDsn(process.env.NEXT_PUBLIC_SENTRY_DSN)) return config;
  const uploadSourceMaps = Boolean(process.env.SENTRY_AUTH_TOKEN && process.env.SENTRY_ORG && process.env.SENTRY_PROJECT);
  return withSentryConfig(config, {
    org: process.env.SENTRY_ORG,
    project: process.env.SENTRY_PROJECT,
    authToken: process.env.SENTRY_AUTH_TOKEN,
    silent: !process.env.CI && !process.env.VERCEL,
    telemetry: false,
    widenClientFileUpload: true,
    sourcemaps: { disable: !uploadSourceMaps, deleteSourcemapsAfterUpload: true },
    errorHandler: (error: Error) => {
      console.warn(`[sentry] Source map upload failed; the build continues without readable stack traces: ${error.message}`);
    },
  });
}

export default withSentry(nextConfig);
