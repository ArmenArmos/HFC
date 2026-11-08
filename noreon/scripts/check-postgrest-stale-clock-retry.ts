import assert from 'node:assert/strict';
import { withStaleClockRetry } from '@/lib/supabase/postgrest-retry';

// The exact rejection captured from local PostgREST v16.1 on the patient page.
const futureIat = () => new Response('{"code":"PGRST303","message":"JWT issued at future"}', {
  status: 401,
  headers: { 'WWW-Authenticate': 'Bearer error="invalid_token", error_description="JWT issued at future"' },
});
const expired = () => new Response('{"code":"PGRST303","message":"JWT expired"}', {
  status: 401,
  headers: { 'WWW-Authenticate': 'Bearer error="invalid_token", error_description="JWT expired"' },
});
const ok = () => new Response('[]', { status: 200 });
const rest = 'http://127.0.0.1:54321/rest/v1/patient_consents?select=version';

function harness(...responses: Array<() => Response>) {
  const calls: Array<{ input: unknown; init?: RequestInit }> = [];
  const waits: number[] = [];
  const base = (async (input: unknown, init?: RequestInit) => {
    calls.push({ input, init });
    const next = responses.shift();
    assert.ok(next, 'Unexpected extra request');
    return next();
  }) as typeof fetch;
  const fetcher = withStaleClockRetry(base, async ms => { waits.push(ms); });
  return { fetcher, calls, waits };
}

const warn = console.warn;
console.warn = () => {};
try {
  {
    const h = harness(futureIat, ok);
    const res = await h.fetcher(rest, { method: 'GET', headers: { Authorization: 'Bearer t' } });
    assert.equal(res.status, 200, 'A stale-clock rejection of a read must be repeated once');
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[1].input, h.calls[0].input, 'The repeat must reuse the same request');
    assert.deepEqual(h.calls[1].init?.headers, h.calls[0].init?.headers, 'The repeat must reuse the same token');
    assert.ok(h.calls[1].init?.signal instanceof AbortSignal, 'The repeat must opt out of Next render dedupe');
    assert.deepEqual(h.waits, [1000]);
  }
  {
    // Next's render dedupe (dedupe-fetch.js) replays a cached response for an
    // identical GET unless options.signal is set, and keeps a tee branch of every
    // body unread. Model both rules: the repeat must reach the server and must not
    // hang on cancelling the retained branch.
    const sent: string[] = [];
    const cache = new Map<string, Response>();
    const server = [futureIat, ok];
    const dedupe = (async (input: unknown, init?: RequestInit) => {
      const key = String(input);
      if (!init?.signal && cache.has(key)) return cache.get(key)!.clone();
      sent.push(key);
      const real = server.shift()!();
      const [mine, kept] = real.body!.tee();
      const init2 = { status: real.status, headers: real.headers };
      if (!init?.signal) cache.set(key, new Response(kept, init2));
      return new Response(mine, init2);
    }) as typeof fetch;
    const fetcher = withStaleClockRetry(dedupe, async () => {});
    const res = await Promise.race([
      fetcher(rest),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Retry hung on a retained tee branch')), 2000)),
    ]);
    assert.equal(res.status, 200, 'The repeat must bypass render dedupe and reach PostgREST');
    assert.equal(sent.length, 2);
  }
  for (const [input, init] of [
    ['http://127.0.0.1:54321/rest/v1/rpc/get_booking_context?p=1', { method: 'GET' }],
    ['http://127.0.0.1:54321/rest/v1/rpc/get_booking_context?p=1', { method: 'HEAD' }],
  ] as const) {
    const h = harness(futureIat);
    const res = await h.fetcher(input, init);
    assert.equal(res.status, 401, `RPC via ${init.method} must never be repeated`);
    assert.equal(h.calls.length, 1);
  }
  {
    const h = harness(futureIat, futureIat);
    const res = await h.fetcher(rest);
    assert.equal(res.status, 401, 'A second rejection must reach the caller unchanged');
    assert.equal(h.calls.length, 2, 'Never more than one repeat');
  }
  {
    const h = harness(futureIat, ok);
    const res = await h.fetcher(new Request(rest, { method: 'HEAD' }));
    assert.equal(res.status, 200, 'HEAD given as a Request object is a read and is repeated');
    assert.equal(h.calls.length, 2);
  }
  for (const method of ['POST', 'PATCH', 'DELETE']) {
    const h = harness(futureIat);
    const res = await h.fetcher(rest, { method, body: '{}' });
    assert.equal(res.status, 401, `${method} must never be repeated`);
    assert.equal(h.calls.length, 1);
  }
  {
    const h = harness(expired);
    const res = await h.fetcher(rest);
    assert.equal(res.status, 401, 'An expired token is a real auth failure and is not repeated');
    assert.equal(h.calls.length, 1);
  }
  {
    const h = harness(() => new Response('{"code":"PGRST301"}', { status: 401 }));
    assert.equal((await h.fetcher(rest)).status, 401, 'Other 401s pass through');
    assert.equal(h.calls.length, 1);
  }
  {
    const h = harness(() => new Response('boom', { status: 500 }));
    assert.equal((await h.fetcher(rest)).status, 500, 'Server errors pass through');
    assert.equal(h.calls.length, 1);
  }
  {
    const h = harness(futureIat);
    const res = await h.fetcher('http://127.0.0.1:54321/auth/v1/user');
    assert.equal(res.status, 401, 'Only the REST API is in scope');
    assert.equal(h.calls.length, 1);
  }
  {
    const controller = new AbortController();
    controller.abort();
    const h = harness(futureIat);
    const res = await h.fetcher(rest, { signal: controller.signal });
    assert.equal(res.status, 401, 'An aborted request is not repeated');
    assert.equal(h.calls.length, 1);
  }
} finally {
  console.warn = warn;
}

console.log('PostgREST stale-clock rejection is repeated once for REST reads only; every other failure passes through.');
