"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Next's error.tsx boundaries catch render errors before Sentry's global handlers see
 * them, so each boundary renders this to report its error. Renders nothing, and does
 * nothing when Sentry is not started. The optional call covers Node test harnesses,
 * which load the SDK's CommonJS build without every named export.
 */
export function ReportError({ error }: { error?: unknown }) {
  useEffect(() => {
    if (error) Sentry.captureException?.(error);
  }, [error]);
  return null;
}
