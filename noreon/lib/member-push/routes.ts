import 'server-only';
import { z } from 'zod';
import { patientIdentity } from '@/lib/patient/auth';
import { demoEnabled } from '@/lib/patient/demo';
import { createClient } from '@/lib/supabase/server';
import { memberPushConfig, pushEndpointAllowed } from './config';

const endpoint = z.string().min(12).max(2048).refine(pushEndpointAllowed);
const subscribe = z.strictObject({ endpoint, expirationTime: z.number().nullable().optional(),
  keys: z.strictObject({ p256dh: z.string().regex(/^[A-Za-z0-9_-]{87}$/), auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/) }) });
const unsubscribe = z.strictObject({ endpoint });
type SessionPushRpc = { rpc(name: string, args: Record<string, string>): PromiseLike<{ data: unknown; error: unknown }> };

export async function memberPushRequest(request: Request, operation: 'subscribe' | 'unsubscribe') {
  const headers = { 'Cache-Control': 'no-store' };
  const reply = (error: string, status: number) => Response.json({ error }, { status, headers });
  if (demoEnabled() || !memberPushConfig()) return reply('unavailable', 404);
  if (request.headers.get('origin') !== new URL(request.url).origin) return reply('forbidden', 403);
  try {
    if (!await patientIdentity()) return reply('unauthorized', 401);
    // Push subscriptions are tiny. Never retain or log the request, including failures.
    const body = await request.text();
    if (body.length > 4096) return reply('invalid', 400);
    let raw: unknown;
    try { raw = JSON.parse(body); } catch { return reply('invalid', 400); }
    const args: Record<string, string> = {};
    if (operation === 'subscribe') {
      const input = subscribe.safeParse(raw);
      if (!input.success) return reply('invalid', 400);
      args.p_endpoint = input.data.endpoint;
      args.p_p256dh = input.data.keys.p256dh;
      args.p_auth = input.data.keys.auth;
    } else {
      const input = unsubscribe.safeParse(raw);
      if (!input.success) return reply('invalid', 400);
      args.p_endpoint = input.data.endpoint;
    }
    const client = await createClient() as unknown as SessionPushRpc;
    const { data, error } = await client.rpc(`member_push_${operation}`, args);
    if (error || !z.object({ ok: z.literal(true) }).safeParse(data).success) return reply('unavailable', 503);
    return Response.json({ ok: true }, { headers });
  } catch { return reply('unavailable', 503); }
}
