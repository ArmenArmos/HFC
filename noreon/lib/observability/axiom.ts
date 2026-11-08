import type { LogEvent } from "./redact";

/**
 * Axiom ingest over HTTPS (NDJSON). Configured only by three server-only variables that
 * are set for Production in Vercel; with AXIOM_TOKEN unset nothing is sent. The token is
 * read here and nowhere else, never logged and never given a NEXT_PUBLIC_ name.
 */
export type AxiomConfig = { url: string; token: string };

const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.axiom\.co$/;
const DATASET = /^[A-Za-z0-9_-]{1,128}$/;

export function axiomConfig(env: Record<string, string | undefined> = process.env): AxiomConfig | null {
  const token = env.AXIOM_TOKEN?.trim();
  const dataset = env.AXIOM_DATASET?.trim();
  // No default domain: Noreon's dataset lives in the EU region, so an unset AXIOM_DOMAIN
  // must not fall back to the US endpoint (api.axiom.co).
  const domain = env.AXIOM_DOMAIN?.trim().toLowerCase();
  if (!token || !dataset || !domain || !DATASET.test(dataset) || !DOMAIN.test(domain)) return null;
  return { url: `https://${domain}/v1/ingest/${dataset}`, token };
}

export const INGEST_TIMEOUT_MS = 2000;

/** Never throws. Returns whether Axiom accepted the batch. */
export async function sendToAxiom(
  config: AxiomConfig,
  events: readonly LogEvent[],
  send: typeof fetch,
  timeoutMs = INGEST_TIMEOUT_MS,
): Promise<{ ok: boolean; status?: number; reason?: string }> {
  if (!events.length) return { ok: true };
  try {
    const response = await send(config.url, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/x-ndjson" },
      body: events.map((event) => JSON.stringify(event)).join("\n"),
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
    response.body?.cancel().catch(() => {});
    return response.ok ? { ok: true, status: response.status } : { ok: false, status: response.status, reason: "status" };
  } catch (error) {
    const name = error instanceof Error ? error.name : "unknown";
    return { ok: false, reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : "network" };
  }
}
