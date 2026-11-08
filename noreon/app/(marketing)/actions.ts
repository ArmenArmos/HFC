"use server";

import {loggedAction} from '@/lib/observability/with-logging';
import type { AccessRequest } from "@/lib/marketing/access-request";

export type AccessRequestResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "unavailable" };

/** Requests are disabled while the public site is informational only. */
export const submitAccessRequest=loggedAction("submitAccessRequest",async function submitAccessRequest(
  _input: AccessRequest,
): Promise<AccessRequestResult> {
  void _input;
  return { ok: false, reason: "unavailable" };
});
