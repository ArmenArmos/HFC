/**
 * Uptime signals (docs/operations/uptime.md). Answers carry fixed codes only: no secrets, no
 * member data, no error text. Each check is bounded and its result is reused for a few seconds,
 * so a flood of probes costs one database read or one Telegram call per instance per window.
 */
export type HealthAnswer = { status: number; body: Record<string, string> };

const REUSE_MS = 10_000;
export function reuse(compute: () => Promise<HealthAnswer>, now: () => number = Date.now) {
  let last: { at: number; answer: Promise<HealthAnswer> } | null = null;
  return () => {
    const t = now();
    if (!last || t - last.at >= REUSE_MS) last = { at: t, answer: compute() };
    return last.answer;
  };
}

/** App up, and the database answers a read through the same API the app uses. */
export async function appHealth(ping: (signal: AbortSignal) => Promise<boolean>, version: string | undefined): Promise<HealthAnswer> {
  const v = /^[0-9a-f]{7,40}$/.test(version ?? '') ? version!.slice(0, 7) : 'local';
  let db = false;
  try { db = await ping(AbortSignal.timeout(3000)); } catch { db = false; }
  return db ? { status: 200, body: { status: 'ok', db: 'ok', version: v } } : { status: 503, body: { status: 'degraded', db: 'unreachable', version: v } };
}

type WebhookInfo = { url?: unknown; pending_update_count?: unknown; last_error_date?: unknown };
/**
 * The bot webhook's own state as Telegram reports it: registered to this app, no backlog, no
 * delivery error in the last 15 minutes. Telegram off is reported as off, not as a failure.
 */
export async function telegramHealth(token: string | null, fetcher: typeof fetch, nowSeconds: number): Promise<HealthAnswer> {
  if (!token) return { status: 200, body: { status: 'off' } };
  const degraded = (reason: string) => ({ status: 503, body: { status: 'degraded', reason } });
  let info: WebhookInfo;
  try {
    const response = await fetcher(`https://api.telegram.org/bot${token}/getWebhookInfo`, { signal: AbortSignal.timeout(3000), redirect: 'error', cache: 'no-store' });
    const json = (await response.json()) as { ok?: unknown; result?: WebhookInfo };
    if (!response.ok || json.ok !== true || !json.result) return degraded('unreachable');
    info = json.result;
  } catch { return degraded('unreachable'); }
  if (typeof info.url !== 'string' || !info.url.endsWith('/api/telegram/webhook')) return degraded('not_registered');
  if (typeof info.pending_update_count === 'number' && info.pending_update_count > 50) return degraded('backlog');
  if (typeof info.last_error_date === 'number' && nowSeconds - info.last_error_date < 900) return degraded('recent_error');
  return { status: 200, body: { status: 'ok' } };
}
