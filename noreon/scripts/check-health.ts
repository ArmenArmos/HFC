import assert from 'node:assert/strict';
import { appHealth, reuse, telegramHealth } from '@/lib/health/checks';
import { staffPathAllowed } from '@/lib/staff/hosts';
// Uptime probes answer fixed codes only (no token, no error text), and are reachable on both hosts.
const ok = await appHealth(async () => true, 'abcdef1234567890');
assert.deepEqual(ok, { status: 200, body: { status: 'ok', db: 'ok', version: 'abcdef1' } });
const down = await appHealth(async () => { throw Error('connect ECONNREFUSED secret-host:5432'); }, undefined);
assert.equal(down.status, 503);
assert.ok(!JSON.stringify(down).includes('secret'), 'error text leaked');
assert.equal(down.body.version, 'local');

const token = '123456:SECRET-test-token';
const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
const now = 1_800_000_000;
const good = { ok: true, result: { url: 'https://app.noreon.health/api/telegram/webhook', pending_update_count: 0 } };
assert.deepEqual(await telegramHealth(token, reply(good), now), { status: 200, body: { status: 'ok' } });
assert.deepEqual((await telegramHealth(null, reply(good), now)).body, { status: 'off' });
assert.equal((await telegramHealth(token, reply({ ok: true, result: { url: '' } }), now)).body.reason, 'not_registered');
assert.equal((await telegramHealth(token, reply({ ok: true, result: { ...good.result, pending_update_count: 51 } }), now)).body.reason, 'backlog');
assert.equal((await telegramHealth(token, reply({ ok: true, result: { ...good.result, last_error_date: now - 60 } }), now)).body.reason, 'recent_error');
assert.equal((await telegramHealth(token, reply({ ok: true, result: { ...good.result, last_error_date: now - 3600 } }), now)).status, 200);
assert.equal((await telegramHealth(token, reply({ ok: false }, 401), now)).body.reason, 'unreachable');
const thrown = await telegramHealth(token, (async () => { throw Error(`fetch failed for https://api.telegram.org/bot${token}/`); }) as unknown as typeof fetch, now);
assert.equal(thrown.body.reason, 'unreachable');
assert.ok(!JSON.stringify(thrown).includes('SECRET'), 'token leaked');

let calls = 0, t = 0;
const cached = reuse(async () => { calls++; return ok; }, () => t);
await cached(); await cached(); t = 9_999; await cached();
assert.equal(calls, 1, 'probe flood reached the database');
t = 10_000; await cached();
assert.equal(calls, 2);

assert.equal(staffPathAllowed('backoffice.noreon.health', '/api/health', {}), true);
assert.equal(staffPathAllowed('backoffice.noreon.health', '/api/health/telegram', {}), false);
console.log('Health probes return fixed codes without secrets, reuse results under load and are reachable on the backoffice host.');
