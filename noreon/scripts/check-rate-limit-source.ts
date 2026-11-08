import assert from 'node:assert/strict';
import { redactEvent } from '@/lib/observability/redact';
import { parseRetry, rateClaim, rateKey, refusalFields, sourceBucket, unknownSourceFields } from '@/lib/security/rate-limit-core';
// Abuse limits key on Vercel's own client-address header only. Spoofed X-Forwarded-For or
// X-Real-IP values must not move a request into a fresh bucket, and nothing raw leaves the app.
const vercel = { vercel: true, secret: 'test-only-service-secret-at-least-32-characters' };
const key = rateKey(vercel);
const h = (v: Record<string, string>) => new Headers(v);

assert.equal(sourceBucket(h({ 'x-vercel-forwarded-for': '203.0.113.7' }), vercel), '203.0.113.7');
// Client-supplied forwarding headers are ignored: same bucket whatever they say.
for (const spoof of [{ 'x-forwarded-for': '198.51.100.1' }, { 'x-real-ip': '198.51.100.2' }, { 'forwarded': 'for=198.51.100.3' }, { 'cf-connecting-ip': '198.51.100.4' }] as Record<string, string>[])
  assert.equal(sourceBucket(h({ 'x-vercel-forwarded-for': '203.0.113.7', ...spoof }), vercel), '203.0.113.7');
// Without Vercel's header every request shares one bucket instead of getting a free one each.
assert.equal(sourceBucket(h({ 'x-forwarded-for': '198.51.100.1' }), vercel), 'unknown');
assert.equal(sourceBucket(h({ 'x-vercel-forwarded-for': '203.0.113.7, 198.51.100.1' }), vercel), 'unknown');
assert.equal(sourceBucket(h({ 'x-vercel-forwarded-for': 'fe80::1%en0' }), vercel), 'unknown');
// IPv6 rotates within a subscriber's /64: one bucket for the prefix; IPv4-mapped joins IPv4.
assert.equal(sourceBucket(h({ 'x-vercel-forwarded-for': '2001:db8:1:2::1' }), vercel), sourceBucket(h({ 'x-vercel-forwarded-for': '2001:db8:1:2:ffff::9' }), vercel));
assert.notEqual(sourceBucket(h({ 'x-vercel-forwarded-for': '2001:db8:1:2::1' }), vercel), sourceBucket(h({ 'x-vercel-forwarded-for': '2001:db8:1:3::1' }), vercel));
assert.equal(sourceBucket(h({ 'x-vercel-forwarded-for': '::ffff:203.0.113.7' }), vercel), '203.0.113.7');
// Off Vercel there is no trustworthy address: the source bucket is skipped, account buckets remain.
assert.equal(sourceBucket(h({ 'x-vercel-forwarded-for': '203.0.113.7' }), { ...vercel, vercel: false }), null);
assert.equal(rateClaim([{ kind: 'source' }], null, key), null);

const claim = rateClaim([{ kind: 'source' }, { kind: 'email', value: ' Staff@Example.invalid ', mode: 'peek' }], '203.0.113.7', key)!;
assert.deepEqual(claim.kinds, ['source', 'email']);
assert.deepEqual(claim.modes, ['take', 'peek']);
for (const k of claim.keys) assert.match(k, /^[a-f0-9]{64}$/);
assert.ok(!JSON.stringify(claim).includes('203.0.113.7') && !JSON.stringify(claim).toLowerCase().includes('example'), 'raw values left the app');
assert.equal(claim.keys[1], rateClaim([{ kind: 'email', value: 'staff@example.invalid' }], null, key)!.keys[0], 'email not normalised');
// The same value in two kinds is two different buckets.
assert.notEqual(rateClaim([{ kind: 'phone', value: 'x' }], null, key)!.keys[0], rateClaim([{ kind: 'user', value: 'x' }], null, key)!.keys[0]);
assert.throws(() => rateKey({ vercel: true, secret: 'short' }));
assert.throws(() => rateKey({ vercel: true, secret: undefined }));
assert.throws(() => rateClaim([{ kind: 'phone', value: '  ' }], null, key));

assert.equal(parseRetry(0), 0);
assert.equal(parseRetry(899), 899);
for (const bad of [-1, 1.5, '0', null, undefined, 86401, Number.NaN]) assert.throws(() => parseRetry(bad));
// Refusal log lines carry the operation and kinds only, and every field survives the log allow-list
// (a dropped field would leave the Axiom monitor without its grouping key).
const refused = redactEvent('warn', 'rate_limited', refusalFields('member_code', claim.kinds, 120));
assert.equal(refused.msg, 'rate_limited');
assert.equal(refused.operation, 'member_code');
assert.equal(refused.limit_kinds, 'source,email');
assert.equal(refused.retry_after, 120);
assert.equal(refused.redacted_fields, undefined, 'No refusal field is dropped by the allow-list');
const unknown = redactEvent('warn', 'rate_limit_source_unknown', unknownSourceFields('staff_signin'));
assert.equal(unknown.operation, 'staff_signin');
assert.equal(unknown.redacted_fields, undefined);
for (const op of ['member_code', 'member_verify', 'member_link', 'staff_signin', 'member_upload', 'clinic_upload'] as const) assert.equal(redactEvent('warn', 'rate_limited', refusalFields(op, ['source', 'phone', 'email', 'user'], 1)).redacted_fields, undefined, op);
console.log('Rate limit buckets use only Vercel\'s client address, resist forwarded-header spoofing and send only digests.');
