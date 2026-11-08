import { withRouteLogging } from '@/lib/observability/with-logging';
import { reuse, telegramHealth } from '@/lib/health/checks';
import { outboundConfig } from '@/lib/telegram-runtime/config';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const check = reuse(() => telegramHealth(outboundConfig()?.botToken || null, fetch, Math.floor(Date.now() / 1000)));

/** Uptime probe for the bot: the webhook as Telegram sees it. The token never leaves the server. */
export const GET = withRouteLogging(async function GET() {
  const answer = await check();
  return Response.json(answer.body, { status: answer.status, headers: { 'Cache-Control': 'no-store' } });
});
