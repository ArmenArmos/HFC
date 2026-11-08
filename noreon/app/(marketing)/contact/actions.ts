"use server";

import {loggedAction} from '@/lib/observability/with-logging';
import { validContact, type ContactRequest } from "@/lib/marketing/contact";

export const sendContact=loggedAction("sendContact",async function sendContact(input: ContactRequest): Promise<{ ok: boolean }> {
  if (!validContact(input)) return { ok: false };
  if (input.website) return { ok: true };
  const endpoint = process.env.SHEETS_WEBHOOK_URL;
  const secret = process.env.SHEETS_WEBHOOK_SECRET;
  if (!endpoint || !secret) return { ok: false };
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret, intent: "contact", id: input.id,
        name: input.name.trim(), email: input.email.trim(), message: input.message.trim(),
        callback: input.callback, phone: input.callback ? input.phone.trim() : "",
      }),
      signal: AbortSignal.timeout(20000),
      redirect: "follow",
    });
    if (!response.ok) return { ok: false };
    const result = await response.json();
    // Old demo-only deployments must never appear to have delivered a message.
    return { ok: result.ok === true && result.contactVersion === 1 && result.notified === true };
  } catch {
    console.error("[contact] Request delivery failed");
    return { ok: false };
  }
});
