import type { SecureDriver } from "./session-storage";
import { abortableRequest } from "./request.ts";

/** One native queue; retired SDK instances cannot operate on replacement credentials. */
export function createCredentialVault(
  driver: SecureDriver,
  sessionKey: string,
) {
  let tail: Promise<unknown> = Promise.resolve();
  const keys = new Set([
    sessionKey,
    `${sessionKey}-user`,
    `${sessionKey}-code-verifier`,
    `${sessionKey}-flows-code-verifier`,
  ]);
  function serial<T>(work: () => Promise<T>): Promise<T> {
    const result = tail.then(work);
    tail = result.catch(() => {});
    return result;
  }
  return {
    lease(onFailure: () => void = () => {}) {
      let active = true;
      function check() {
        if (!active) throw Error("Session retired");
      }
      function run<T>(key: string, work: () => Promise<T>) {
        keys.add(key);
        return serial(async () => {
          check();
          try {
            return await work();
          } catch {
            if (active) onFailure();
            throw Error("Secure session storage unavailable");
          }
        });
      }
      return {
        retire() {
          active = false;
        },
        storage: {
          async getItem(key: string) {
            const value = await run(key, () => driver.getItem(key));
            check();
            return value;
          },
          setItem: (key: string, value: string) =>
            run(key, () => driver.setItem(key, value)),
          removeItem: (key: string) => run(key, () => driver.removeItem(key)),
        } satisfies SecureDriver,
      };
    },
    clear() {
      return serial(async () => {
        try {
          for (const key of keys) await driver.removeItem(key);
        } catch {
          throw Error("Secure session storage unavailable");
        }
      });
    },
  };
}

/** Bound fetch waits even if an adapter ignores AbortSignal. No automatic retries. */
export function createAuthTransport(fetcher: typeof fetch, timeoutMs = 15000) {
  let active = true;
  const requests = new Set<AbortController>();
  return {
    retire() {
      active = false;
      for (const request of requests) request.abort();
    },
    fetch: (async (
      input: Parameters<typeof fetch>[0],
      init?: Parameters<typeof fetch>[1],
    ) => {
      if (!active) throw Error("Session retired");
      const controller = new AbortController();
      const caller =
        init?.signal ??
        (typeof Request !== "undefined" && input instanceof Request
          ? input.signal
          : undefined);
      const abort = () => controller.abort();
      requests.add(controller);
      if (caller?.aborted) controller.abort();
      else caller?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, timeoutMs);
      try {
        const result = await abortableRequest(
          () => fetcher(input, { ...init, signal: controller.signal }),
          controller.signal,
        );
        if (!active || controller.signal.aborted)
          throw Error("Request cancelled");
        return result;
      } finally {
        clearTimeout(timer);
        caller?.removeEventListener("abort", abort);
        requests.delete(controller);
      }
    }) satisfies typeof fetch,
  };
}
