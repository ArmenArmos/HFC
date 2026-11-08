import { abortableRequest } from "./request.ts";
import {
  parseJourneySnapshot,
  type JourneyTransport,
} from "./journey-protocol.ts";
import type { SaveResult } from "../../../../lib/patient/types";
/** Fixed destination prevents a build option from redirecting member credentials. */
export function createJourneyHttp(
  userId: string,
  tokenFor: (signal: AbortSignal) => Promise<string>,
  fetcher: typeof fetch = fetch,
  timeoutMs = 15000,
): JourneyTransport {
  async function request(signal: AbortSignal, body?: unknown) {
    const controller = new AbortController(),
      abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    const timer = setTimeout(abort, timeoutMs);
    try {
      return await abortableRequest(async () => {
        const token = await tokenFor(controller.signal);
        if (controller.signal.aborted) throw Error("Unavailable");
        const response = await fetcher(
          "https://app.noreon.health/api/native/journey",
          {
            method: body === undefined ? "GET" : "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: controller.signal,
            redirect: "error",
          },
        );
        const value: unknown = await response.json();
        if (controller.signal.aborted) throw Error("Unavailable");
        return { status: response.status, value };
      }, controller.signal);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  return {
    async read(signal) {
      const r = await request(signal);
      if (r.status !== 200) throw Error("Unavailable");
      return parseJourneySnapshot(r.value, userId);
    },
    async write(command, signal): Promise<SaveResult> {
      const r = await request(signal, command);
      if (r.status === 400) return { ok: false, reason: "invalid" };
      if (r.status === 409) return { ok: false, reason: "conflict" };
      const v = r.value as Partial<SaveResult> | null;
      if (
        r.status !== 200 ||
        !v ||
        v.ok !== true ||
        !Number.isSafeInteger(v.revision) ||
        v.revision! < 0
      )
        throw Error("Unavailable");
      return { ok: true, revision: v.revision! };
    },
  };
}
