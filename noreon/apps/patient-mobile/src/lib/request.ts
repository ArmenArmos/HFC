/** End UI waits even when session verification does not support AbortSignal. */
export async function abortableRequest<T>(
  run: () => Promise<T>,
  signal: AbortSignal,
): Promise<T> {
  if (signal.aborted) throw Error("Request cancelled");
  let onAbort: () => void = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    onAbort = () => reject(Error("Request cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    return await Promise.race([run(), cancelled]);
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** A single deadline covers authentication and the request; no automatic retries. */
export async function boundedRequest<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs = 15000,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await abortableRequest(
      () => run(controller.signal),
      controller.signal,
    );
  } finally {
    clearTimeout(timer);
  }
}
