"use client";
import { createOutbox, indexedDbOutboxStore, type Outbox } from "@/lib/offline/outbox";

/**
 * WP R: one outbox per tab for the member app (chat messages and BP readings), bound to the account the page was
 * rendered for. The account binding module patches fetch when it loads, so it is imported only when the outbox is
 * first used in a browser, never by merely importing this file.
 */
let shared: Promise<Outbox | null> | null = null;
export function memberOutbox(): Promise<Outbox | null> {
  if (typeof window === "undefined") return Promise.resolve(null);
  return shared ??= import("@/components/patient/account-binding")
    .then(binding => createOutbox(indexedDbOutboxStore(), binding.boundAccount))
    .catch(() => { shared = null; return null; });
}
