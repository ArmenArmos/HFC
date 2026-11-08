/** Mocked provider/session IO. Never reads credentials or contacts a push service. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { z } from 'zod';
import { memberPushConfig, pushEndpointAllowed } from '@/lib/member-push/config';
import { pushFits, sweepMemberPush } from '@/lib/member-push/sweep';
const id = '11111111-1111-4111-8111-111111111111';
const config = { NOREON_MEMBER_PUSH_ENABLED: 'true', NOREON_VAPID_PUBLIC_KEY: 'A'.repeat(87),
  NOREON_VAPID_PRIVATE_KEY: 'B'.repeat(43), NOREON_VAPID_SUBJECT: 'mailto:push@example.invalid' };
for (const value of [undefined, 'TRUE', 'false', '1']) assert.equal(memberPushConfig({ ...config, NOREON_MEMBER_PUSH_ENABLED: value }), null);
for (const name of Object.keys(config)) assert.equal(memberPushConfig({ ...config, [name]: undefined }), null);
assert.ok(memberPushConfig(config));
const delivery = { deliveryId: id, attemptId: id, noticeId: id, endpoint: 'https://web.push.apple.com/sensitive-endpoint',
  p256dh: 'sensitive-public-key', auth: 'sensitive-auth', text: 'You have an update.', ttlSeconds: 123,
  app_text: 'Sensitive member details never leave chat' };
let outcomes: Record<string, unknown>[] = [];
const rpc = async (name: string, args: Record<string, unknown>) => {
  if (name === 'member_push_claim') return { deliveries: [delivery] };
  assert.equal(name, 'member_push_outcome'); outcomes.push(args); return { ok: true };
};
const logs: unknown[] = [];
const previousLog = console.log, previousWarn = console.warn, previousError = console.error;
try {
  console.log = console.warn = console.error = (...args: unknown[]) => { logs.push(args); };
  const report = await sweepMemberPush(rpc, async (subscription, payload, options) => {
    assert.equal(subscription.endpoint, delivery.endpoint);
    assert.deepEqual(JSON.parse(payload), { text: delivery.text, noticeId: id });
    assert.equal(payload.includes(delivery.app_text), false);
    assert.deepEqual(options, { TTL: 123, topic: id.replaceAll('-', '') });
  });
  assert.equal(report.sent, 1); assert.equal(outcomes[0].p_outcome, 'sent');
  for (const [status, outcome] of [[410, 'gone'], [404, 'gone'], [429, 'retryable'], [400, 'failed'], [500, 'unknown'], [null, 'unknown']] as const) {
    outcomes = [];
    await assert.doesNotReject(() => sweepMemberPush(rpc, async () => { throw { statusCode: status, body: delivery.app_text, endpoint: delivery.endpoint }; }));
    assert.equal(outcomes[0].p_outcome, outcome);
  }
  await assert.doesNotReject(() => sweepMemberPush(async () => { throw Error(delivery.auth); }, async () => {}));
  await assert.doesNotReject(() => sweepMemberPush(async name => {
    if (name === 'member_push_claim') return { deliveries: [delivery] }; throw Error(delivery.endpoint);
  }, async () => {}));
  assert.deepEqual(logs, [], 'Provider errors, endpoints, keys and text never reach logs');
} finally { console.log = previousLog; console.warn = previousWarn; console.error = previousError; }

// One bad endpoint in a batch: the good delivery still goes, and both outcomes are recorded.
{
  const good = { ...delivery, deliveryId: '22222222-2222-4222-8222-222222222222' };
  const bad = { ...delivery, deliveryId: '33333333-3333-4333-8333-333333333333', endpoint: 'not a url' };
  const outcomes: unknown[] = [], sent: string[] = [];
  const report = await sweepMemberPush(async (name, args) => {
    if (name === 'member_push_claim') return { deliveries: [bad, good] };
    outcomes.push([args.p_delivery, args.p_outcome]); return { ok: true };
  }, async subscription => {
    if (subscription.endpoint === bad.endpoint) throw { statusCode: 410 };
    sent.push(subscription.endpoint);
  });
  assert.deepEqual(sent, [good.endpoint]); assert.equal(report.claimed, 2); assert.equal(report.gone, 1);
  assert.deepEqual(new Set(outcomes.map(x => JSON.stringify(x))), new Set([JSON.stringify([bad.deliveryId, 'gone']), JSON.stringify([good.deliveryId, 'sent'])]));
}

// A late batch waits for the next run: the job's deadline is 50 s, and a batch can take about 10 s.
assert.equal(pushFits(16_999), false); assert.equal(pushFits(17_000), true);
const dispatchRoute = readFileSync('app/api/internal/telegram/dispatch/route.ts', 'utf8');
assert.equal(dispatchRoute.match(/await runMemberPushSweep/g)?.length, 2);
assert.equal(dispatchRoute.match(/if\(pushFits\(remainingMs\(\)\)\)await runMemberPushSweep/g)?.length, 2, 'Every push run checks the time left first');

// Actual request handler with isolated auth/session/config; not a source-only route assertion.
const exports: Record<string, (request: Request, operation: string) => Promise<Response>> = {};
let enabled = false, signedIn = true, rpcCalls = 0;
const modules: Record<string, unknown> = {
  'server-only': {}, zod: { z },
  '@/lib/patient/auth': { patientIdentity: async () => signedIn ? { userId: id } : null },
  '@/lib/patient/demo': { demoEnabled: () => false },
  './config': { memberPushConfig: () => enabled ? config : null, pushEndpointAllowed },
  '@/lib/supabase/server': { createClient: async () => ({ rpc: async () => { rpcCalls++; return { data: { ok: true }, error: null }; } }) },
};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/member-push/routes.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
{ exports, require: (name: string) => modules[name], Response, URL });
const request = (body: unknown, origin = 'https://app.example.invalid') => new Request('https://app.example.invalid/api/patient/push/subscribe',
  { method: 'POST', headers: { origin }, body: JSON.stringify(body) });
const subscription = { endpoint: delivery.endpoint, expirationTime: null, keys: { p256dh: 'A'.repeat(87), auth: 'B'.repeat(22) } };
assert.equal((await exports.memberPushRequest(request(subscription), 'subscribe')).status, 404); assert.equal(rpcCalls, 0);
enabled = true;
assert.equal((await exports.memberPushRequest(request(subscription, 'https://other.example.invalid'), 'subscribe')).status, 403);
signedIn = false; assert.equal((await exports.memberPushRequest(request(subscription), 'subscribe')).status, 401); signedIn = true;
assert.equal((await exports.memberPushRequest(request({ ...subscription, memberId: id }), 'subscribe')).status, 400);
assert.equal((await exports.memberPushRequest(request({ ...subscription, endpoint: 'http://bad.invalid' }), 'subscribe')).status, 400);
assert.equal((await exports.memberPushRequest(request(subscription), 'subscribe')).status, 200);
assert.equal((await exports.memberPushRequest(request({ endpoint: delivery.endpoint }), 'unsubscribe')).status, 200);
console.log('Member push: mocked provider payload, TTL/topic, failures, privacy, exact flag and session routes PASS.');

// The configured entry point calls mocked web-push itself, with synthetic VAPID values.
// This also proves the disabled entry point does not create a database client.
const serverExports: Record<string, unknown> = {};
let configured = false, clients = 0, sends = 0;
const serverLogs: unknown[] = [];
const serverCalls: string[] = [];
const serverModules: Record<string, unknown> = {
  'server-only': {},
  'web-push': { sendNotification: async (_subscription: unknown, payload: string, options: Record<string, unknown>) => {
    sends++; assert.deepEqual(JSON.parse(payload), { text: delivery.text, noticeId: id });
    assert.equal(options.TTL, delivery.ttlSeconds); assert.equal(options.topic, id.replaceAll('-', ''));
    assert.equal(options.timeout, 8000);
    throw { statusCode: 410, body: delivery.app_text, endpoint: delivery.endpoint };
  } },
  '@supabase/supabase-js': { createClient: () => { clients++; return { rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: async () => {
    serverCalls.push(name);
    return { data: await rpc(name, args), error: null };
  } }) }; } },
  '@/lib/observability/logger': { log: { info: (...args: unknown[]) => serverLogs.push(args) } },
  './config': { memberPushConfig: () => configured ? { publicKey: config.NOREON_VAPID_PUBLIC_KEY, privateKey: config.NOREON_VAPID_PRIVATE_KEY, subject: config.NOREON_VAPID_SUBJECT } : null, pushEndpointAllowed },
  './sweep': { sweepMemberPush },
};
vm.runInNewContext(ts.transpileModule(readFileSync('lib/member-push/server.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText,
{ exports: serverExports, require: (name: string) => serverModules[name], URL, AbortSignal, Promise, setTimeout,
  process: { env: { NEXT_PUBLIC_SUPABASE_URL: 'https://db.example.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' } } });
const run = serverExports.runMemberPushSweep as () => Promise<unknown>;
assert.equal(await run(), null); assert.equal(clients, 0);
configured = true; await assert.doesNotReject(run); assert.equal(sends, 1);
assert.deepEqual(serverCalls, ['member_push_claim', 'member_push_outcome']);
const allowed = pushEndpointAllowed;
for (const value of ['https://web.push.apple.com/a', 'https://fcm.googleapis.com/fcm/send/a', 'https://updates.push.services.mozilla.com/a', 'https://db5p.notify.windows.com/a']) assert.equal(allowed(value), true);
for (const value of ['http://web.push.apple.com/a', 'https://169.254.169.254/a', 'https://127.0.0.1/a', 'https://web.push.apple.com.evil.test/a', 'https://a:b@web.push.apple.com/a', 'https://web.push.apple.com:8443/a', 'not a url']) assert.equal(allowed(value), false);
const logged = JSON.stringify(serverLogs);
for (const secret of [delivery.endpoint, delivery.p256dh, delivery.auth, delivery.text, delivery.app_text, config.NOREON_VAPID_PRIVATE_KEY, 'synthetic-service-key']) assert.equal(logged.includes(secret), false);
console.log('Member push configured entry: mocked web-push, silent disabled mode, push-service allow list and count-only logs PASS.');
