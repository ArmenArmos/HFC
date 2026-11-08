import 'server-only';
import webPush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { log } from '@/lib/observability/logger';
import { memberPushConfig, pushEndpointAllowed } from './config';
import { sweepMemberPush } from './sweep';

/** No keys means no database access, sends, or member-facing error. */
export async function runMemberPushSweep() {
  try {
    const config = memberPushConfig();
    if (!config) return null;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) return null;
    // New RPCs are migration-owned; regenerate Database on the lead's local replay.
    const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const rpc = async (name: string, args: Record<string, unknown>) => {
      const { data, error } = await client.rpc(name, args).abortSignal(AbortSignal.timeout(4000));
      if (error) throw new Error('Push database unavailable');
      return data;
    };
    const report = await sweepMemberPush(rpc, async (subscription, payload, options) => {
      // A 410 removes the subscription: this endpoint can never work.
      if (!pushEndpointAllowed(subscription.endpoint)) throw { statusCode: 410 };
      // The library's timeout is per socket. This is the whole send.
      return Promise.race([webPush.sendNotification(subscription, payload, { ...options, timeout: 8000,
        vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey } }),
      new Promise((_, reject) => { setTimeout(() => reject(new Error('Push send timed out')), 8000); })]);
    });
    log.info('member_push_sweep', { counts: { claimed: report.claimed, sent: report.sent, failed: report.failed, deleted: report.gone } });
    return report;
  } catch { return null; }
}
