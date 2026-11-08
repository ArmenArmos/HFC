import 'server-only';
import { z } from 'zod';

export type PushRpc = (name: string, args: Record<string, unknown>) => Promise<unknown>;
export type PushSend = (subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string,
  options: { TTL: number; topic: string }) => Promise<unknown>;
const claimSchema = z.object({ deliveries: z.array(z.object({
  deliveryId: z.uuid(), attemptId: z.uuid(), noticeId: z.uuid(), // Any string: one bad endpoint must not discard the deliveries claimed with it. The sender refuses it alone.
  endpoint: z.string(),
  p256dh: z.string(), auth: z.string(), text: z.string().min(1).max(240),
  ttlSeconds: z.number().int().min(1).max(21600),
})) });

/**
 * Time a batch needs: 4 s to claim, 8 s for the sends, 4 s for the outcomes. Claiming and then losing the run would
 * strand its deliveries, so a late batch waits for the next run.
 */
export const pushFits = (remainingMs: number) => remainingMs >= 17_000;

/** All errors stay inside the sweep. An uncertain send is never retried: it may already have arrived. */
export async function sweepMemberPush(rpc: PushRpc, send: PushSend) {
  const report = { claimed: 0, sent: 0, failed: 0, gone: 0 };
  try {
    const parsed = claimSchema.safeParse(await rpc('member_push_claim', { p_limit: 30 }));
    if (!parsed.success) return report;
    report.claimed = parsed.data.deliveries.length;
    await Promise.all(parsed.data.deliveries.map(async delivery => {
      let outcome = 'sent';
      try {
        await send({ endpoint: delivery.endpoint, keys: { p256dh: delivery.p256dh, auth: delivery.auth } },
          JSON.stringify({ text: delivery.text, noticeId: delivery.noticeId }),
          { TTL: delivery.ttlSeconds, topic: delivery.noticeId.replaceAll('-', '') });
        report.sent++;
      } catch (error) {
        const status = typeof error === 'object' && error !== null && 'statusCode' in error ? error.statusCode : null;
        outcome = status === 404 || status === 410 ? 'gone' : status === 429 ? 'retryable'
          : typeof status === 'number' && status >= 400 && status < 500 ? 'failed' : 'unknown';
        if (outcome === 'gone') report.gone++; else report.failed++;
      }
      // If recording fails, the claim stays in-flight rather than risking another alert.
      try { await rpc('member_push_outcome', { p_delivery: delivery.deliveryId, p_attempt: delivery.attemptId, p_outcome: outcome }); } catch { /* counts only */ }
    }));
  } catch { report.failed++; }
  return report;
}
