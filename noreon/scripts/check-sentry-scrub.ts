import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {scrubBreadcrumb, scrubEnvelope, scrubEvent, scrubText, scrubUrl, sensitiveKey} from '@/lib/monitoring/scrub';
import {euSentryDsn, installEnvelopeScrub, sentryOptions} from '@/lib/monitoring/sentry-options';
// Sentry must never receive member data (18 Oct). Feed the scrubber and a real SDK run
// (mock transport, nothing leaves the machine) PHI and PII samples and assert none of
// them appears in what would be sent.

const EU_DSN = 'https://abc123@o4500000000000000.ingest.de.sentry.io/4500000000000001';
const MEMBER_ID = '3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b';
const REQUEST_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

// Every one of these must be absent from anything sent.
const PHI = [
  '+37491234567', '091 23 45 67', '37491234567', 'armen.petrosyan@example.com', 'Armen Petrosyan',
  'Արմեն Պետրոսյան', 'գլխացավ ունեմ', 'Иван Иванов', '148/96', '148 / 96', '7.8 mmol/L', '5.6', '212 mg/dL',
  'chest pain since morning', 'sb-access-token', 'secret-cookie-value', 'Bearer eyJhbGciOi',
  '203.0.113.42', 'lisinopril 10mg', 'phone=%2B374', 'code=123456', '123456', 'Petrosyan',
  'i feel dizzy', 'anna petrosyan', 'otp=4821', 'component-for-anna',
];

// SDK-generated values are random or time-based and can contain a numeric sample by
// chance: an SDK version "10.15.6" or a timestamp holds "5.6" (it failed #240's verify on
// 18 Oct). They carry no member data, so they are dropped before the check.
const SDK_KEYS = new Set(['timestamp', 'start_timestamp', 'sent_at', 'started', 'duration', 'event_id', 'trace_id', 'span_id', 'parent_span_id', 'sid', 'sdk', 'runtime', 'os']);
function withoutSdkValues(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutSdkValues);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !SDK_KEYS.has(key)).map(([key, item]) => [key, withoutSdkValues(item)]));
}
// A numeric sample counts only as a whole number, not inside a longer one ("15.6", "7123456789").
const numeric = /^[0-9./ ]+$/;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const leaks = (text: string, sample: string) =>
  numeric.test(sample) ? new RegExp(`(^|[^0-9.])${escape(sample)}($|[^0-9])`).test(text) : text.includes(sample);
function assertClean(label: string, value: unknown) {
  let data = value;
  if (typeof value === 'string') try { data = JSON.parse(value); } catch { data = value; }
  const text = typeof data === 'string' ? data : JSON.stringify(withoutSdkValues(data));
  for (const sample of PHI) assert.ok(!leaks(text, sample), `${label} leaked ${JSON.stringify(sample)}: ${text}`);
}
// Control: the check itself still catches every sample wherever member data can sit.
for (const sample of PHI) {
  for (const where of [`x ${sample} y`, `${sample}`, `a(${sample}),b`]) {
    assert.throws(() => assertClean('control', where), /leaked/, `plain text with ${sample}`);
    assert.throws(() => assertClean('control', {message: where}), /leaked/, `event message with ${sample}`);
    assert.throws(() => assertClean('control', JSON.stringify([{event_id: 'e'}, [[{type: 'event'}, {exception: {values: [{value: where}]}, breadcrumbs: [{message: where}], extra: {v: where}, timestamp: 5.6}]]])), /leaked/, `envelope with ${sample}`);
  }
}
assert.doesNotThrow(() => assertClean('control', JSON.stringify([{sdk: {version: '10.15.6'}, sent_at: '2026-10-18T05:06:12.345Z'}, [[{type: 'event'}, {timestamp: 1792277115.6, event_id: 'a1234567b', contexts: {trace: {trace_id: 'f123456e'}}}]]])), 'SDK versions, timestamps and ids are not member data');

// 0. The scrubber runs in members' browsers before the app: no regex lookbehind, which
// Safari before 16.4 cannot parse (the whole client bundle would fail to start).
for (const file of ['lib/monitoring/scrub.ts', 'lib/monitoring/sentry-options.ts', 'instrumentation-client.ts']) {
  assert.ok(!/\(\?<[!=]/.test(readFileSync(file, 'utf8')), `${file} uses a regex lookbehind`);
}

// 1. The EU guard: only https DSNs on Sentry's German ingest start Sentry.
assert.equal(euSentryDsn(EU_DSN), EU_DSN);
assert.equal(euSentryDsn('https://abc@o1.ingest.us.sentry.io/2'), undefined);
assert.equal(euSentryDsn('https://abc@o1.ingest.sentry.io/2'), undefined);
assert.equal(euSentryDsn('https://abc@ingest.de.sentry.io.evil.example/2'), undefined);
assert.equal(euSentryDsn('http://abc@o1.ingest.de.sentry.io/2'), undefined);
assert.equal(euSentryDsn('not a url'), undefined);
assert.equal(euSentryDsn(undefined), undefined);
assert.equal(sentryOptions({}).enabled, false);
assert.equal(sentryOptions({NEXT_PUBLIC_SENTRY_DSN: 'https://abc@o1.ingest.us.sentry.io/2'}).enabled, false);
const options = sentryOptions({NEXT_PUBLIC_SENTRY_DSN: EU_DSN, NEXT_PUBLIC_VERCEL_ENV: 'production'});
assert.equal(options.enabled, true);
assert.equal(options.environment, 'production');
assert.equal('tracesSampleRate' in options, false, 'tracing stays off');
assert.equal(options.dataCollection.userInfo, false);
assert.equal(options.dataCollection.cookies, false);
assert.deepEqual(options.dataCollection.httpBodies, []);
assert.equal(options.dataCollection.urlQueryParams, false);
assert.equal(options.dataCollection.stackFrameVariables, false);

// 2. Free text keeps its shape and loses the data.
const message = `Insert failed for Armen Petrosyan (+37491234567, armen.petrosyan@example.com): Key (phone)=(091 23 45 67) value "chest pain since morning" BP 148/96 glucose 7.8 mmol/L LDL 5.6 cholesterol 212 mg/dL note «գլխացавոр» Արմեն Պետրոսյան, Иван Иванов at /patient/care?phone=%2B374&code=123456 member ${MEMBER_ID}`;
const scrubbed = scrubText(message);
assertClean('scrubText', scrubbed);
assert.ok(scrubText(`no rows for member ${MEMBER_ID}`).includes(MEMBER_ID), 'internal ids survive');
assert.ok(scrubbed.startsWith('Insert failed for'), 'the shape of the message survives');
assert.equal(scrubText("Cannot read properties of undefined (reading 'map')"), "Cannot read properties of undefined (reading 'map')");
assert.equal(scrubUrl('https://app.noreon.health/patient/care?phone=%2B37491234567#otp'), 'https://app.noreon.health/patient/care');
assert.equal(scrubUrl(`/staff/real/members/${MEMBER_ID}?q=Armen`), `/staff/real/members/${MEMBER_ID}`);
// Opaque notice tokens can contain no digits at all; ordinary path heuristics cannot recognize them.
for(const token of ['ab'.repeat(24),'a1'.repeat(24)]){
 const url=`https://backoffice.noreon.health/staff/real/n/${token}`;
 assert.equal(scrubUrl(url),'https://backoffice.noreon.health/staff/real/n/[redacted]');
 assert.ok(!scrubText(`Request failed at ${url}`).includes(token));
 assert.ok(!JSON.stringify(scrubBreadcrumb({category:'navigation',data:{from:url,to:url}})).includes(token));
 assert.ok(!JSON.stringify(scrubEvent({request:{url}})).includes(token));
}
for (const key of ['phone', 'firstName', 'last_name', 'systolic', 'labValue', 'messageText', 'member_note', 'x-forwarded-for', 'ip_address', 'access_token', 'diagnosis_code', 'code', 'otp_code', 'smsCode']) {
  assert.ok(sensitiveKey(key) || key === 'x-forwarded-for', `${key} is sensitive`);
}
for (const key of ['status_code', 'method', 'route', 'description', 'script', 'zip_version', 'error_code']) assert.equal(sensitiveKey(key), false, `${key} is not sensitive`);

// 2b. The privacy review's adversarial cases (18 Oct, OPUS_REVIEW.md F1/F2). Each pair is
// an input and the fragments that must not survive scrubText.
const ADVERSARIAL: Array<[string, string[]]> = [
  ['telegram send failed: i have chest pain and feel dizzy', ['chest', 'pain', 'dizzy', 'i have']],
  ['No member found for Anna', ['Anna']],
  ['duplicate member armen petrosyan', ['armen', 'petrosyan']],
  ['invalid input syntax for type uuid: "armen.petrosyan"', ['armen', 'petrosyan']],
  ['new row for relation "bp_readings" violates check constraint. Failing row contains (3f2b8c1e-9a4d-4e6f-8b2a-1c3d5e7f9a0b, 300, 96, chest pain).', ['300', '96', 'chest pain']],
  ['Failing row contains (null, Anna, +37491234567)', ['Anna', '374']],
  ['systolic 148 diastolic 96', ['148', '96']],
  ['bp 148 over 96', ['148', '96']],
  ['glucose 212', ['212']],
  ['pulse 88 after walking', ['88', 'walking']],
  ['hba1c 7 percent', ['hba1c 7', 'percent']],
  ['weight 92 kg', ['92']],
  ['otp 123456 expired', ['123456']],
  ['call 234567', ['234567']],
  ['code 4821 rejected', ['4821']],
  ['taking lisinopril daily', ['lisinopril', 'daily']],
  ['history of hypertension and diabetes', ['hypertension', 'diabetes']],
  ['member wrote: glxacav unem', ['glxacav', 'unem']],
  ['https://api.telegram.org/bot7123456789:AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw/sendMessage', ['7123456789', 'AAHdqTcvCH1vGWJxfSeofSAs0K5PALDsaw']],
  ['jwt rejected eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U', ['eyJhbGciOiJIUzI1NiJ9', 'dozjgNryP4J3jVmNHl0w5N']],
  ['Authorization: Bearer sb_secret_abcdef123456', ['sb_secret_abcdef123456']],
  ['message from @armen_p failed', ['armen_p']],
  ['JSON parsing failed: Text: patient armen petrosyan, age 54, systolic 148, reports chest pain', ['armen', 'petrosyan', '54', '148', 'chest']],
  ['Cannot deliver to Anna Petrosyan', ['Anna', 'Petrosyan']],
  ['ARMEN reported headache', ['headache', 'reported']],
  ['user typed: my pressure is high today', ['my pressure', 'high today']],
  ['Zoe reply: you should rest and drink water', ['rest', 'drink', 'water']],
  ['note "feeling better since monday"', ['feeling', 'monday']],
  ["note 'i forgot my pills'", ['forgot', 'pills']],
  ['value «գլխացավ ունեմ» rejected', ['գլխացավ', 'ունեմ']],
  ['Иван Иванов не найден', ['Иван', 'не найден']],
  ['ლაშა failed', ['ლაშა']],
  ['contact armen.petrosyan@example.com', ['armen.petrosyan']],
  ['phone +374 91 234567 invalid', ['91 234567', '374']],
  ['phone 091-23-45-67 invalid', ['091-23-45-67', '45-67']],
  ['lab LDL 4.9 HDL 1.1', ['4.9', '1.1']],
  ['creatinine 1.2 mg/dL', ['1.2']],
  ['cholesterol 212 mg/dl', ['212']],
  ['reading 148/96 saved', ['148/96']],
  ['reading 148 / 96 saved', ['148 / 96']],
  ['born 1971-04-12', ['1971', '04-12']],
  ['address 12 Abovyan street', ['Abovyan', 'street']],
  ['GET /patient/members/armen-petrosyan-37491234567/care?phone=1', ['37491234567', 'phone=1']],
  ['Error: '+'x'.repeat(50)+' and then a very long pasted member message that goes on and on '.repeat(5), ['goes on and on goes']],
];
assert.ok(ADVERSARIAL.length >= 44, `${ADVERSARIAL.length} adversarial cases`);
for (const [input, forbidden] of ADVERSARIAL) {
  const out = scrubText(input);
  for (const fragment of forbidden) assert.ok(!out.includes(fragment), `scrubText leaked ${JSON.stringify(fragment)} from ${JSON.stringify(input)} -> ${JSON.stringify(out)}`);
  assert.ok(out.length <= 201, 'messages are capped near 200 characters');
}
// Useful triage text still survives.
assert.equal(scrubText('TypeError: Failed to fetch'), 'TypeError: Failed to fetch');
assert.equal(scrubText('Request failed with status code 500'), 'Request failed with status code 500');
assert.equal(scrubText('ChunkLoadError: Loading chunk 412 failed'), 'ChunkLoadError: Loading chunk 412 failed');
assert.equal(scrubText(`PGRST116: no rows for member ${MEMBER_ID} at /staff/real/members/${MEMBER_ID}`), `PGRST116: no rows for member ${MEMBER_ID} at /staff/real/members/${MEMBER_ID}`);
assert.equal(scrubText('duplicate key value violates unique constraint "bp_readings_pkey"'), 'duplicate key value violates unique constraint "bp_readings_pkey"');

// 3. Breadcrumbs: console is dropped, requests keep method, status and a bare URL.
assert.equal(scrubBreadcrumb({category: 'console', message: 'member Armen Petrosyan +37491234567'}), null);
const fetchCrumb = scrubBreadcrumb({category: 'fetch', type: 'http', data: {method: 'POST', status_code: 500, url: 'https://x.supabase.co/rest/v1/members?phone=eq.%2B37491234567', request_body: '{"systolic":148}', response_body_size: 12}});
assert.deepEqual(fetchCrumb?.data, {method: 'POST', status_code: 500, url: 'https://x.supabase.co/rest/v1/members'});

// 4. A full event with PHI everywhere.
const event = scrubEvent({
  event_id: 'a'.repeat(32),
  message,
  logentry: {message: 'Saved reading for %s', params: ['Armen Petrosyan', '148/96']},
  transaction: '/patient/care?phone=%2B374',
  user: {id: MEMBER_ID, email: 'armen.petrosyan@example.com', username: 'Armen Petrosyan', ip_address: '203.0.113.42'},
  request: {
    method: 'POST',
    url: 'https://app.noreon.health/patient/care?phone=%2B374&code=123456',
    query_string: 'phone=%2B374&code=123456',
    data: {systolic: 148, diastolic: 96, note: 'chest pain since morning'},
    cookies: {'sb-access-token': 'secret-cookie-value'},
    env: {REMOTE_ADDR: '203.0.113.42'},
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone)', 'x-request-id': REQUEST_ID, cookie: 'sb-access-token=secret-cookie-value',
      authorization: 'Bearer eyJhbGciOi', 'x-forwarded-for': '203.0.113.42', referer: 'https://app.noreon.health/patient?phone=%2B374',
      'x-member-phone': '+37491234567',
    },
  },
  exception: {values: [{type: 'PostgrestError', value: message, stacktrace: {frames: [{filename: 'app/patient/care/actions.ts', function: 'saveReading', lineno: 42, vars: {phone: '+37491234567', reading: '148/96', name: 'Armen Petrosyan'}}]}}]},
  breadcrumbs: [
    {category: 'console', level: 'log', message: 'Armen Petrosyan 148/96'},
    {category: 'navigation', data: {from: '/patient?phone=%2B374', to: `/patient/care?code=123456`}},
    {category: 'ui.click', message: 'button[aria-label="Armen Petrosyan"]'},
    {category: 'xhr', data: {method: 'GET', url: '/api/patient/reports?name=Armen%20Petrosyan', status_code: 200, body: 'lisinopril 10mg'}},
  ],
  extra: {member: {name: 'Armen Petrosyan', phone: '+37491234567'}, labs: '7.8 mmol/L'},
  contexts: {
    browser: {name: 'Mobile Safari', version: '18.0'},
    os: {name: 'iOS', version: '18.0'},
    member: {name: 'Armen Petrosyan', phone: '+37491234567', medication: 'lisinopril 10mg'},
    response: {headers: {'set-cookie': 'sb-access-token=secret-cookie-value'}},
    trace: {trace_id: 'b'.repeat(32), span_id: 'c'.repeat(16), data: {'http.url': 'https://app.noreon.health/patient?phone=%2B374'}},
  },
  tags: {member_phone: '+37491234567', route: '/patient/care', note: 'chest pain since morning'},
  spans: [{span_id: 'd'.repeat(16), trace_id: 'b'.repeat(32), start_timestamp: 0, description: 'GET /rest/v1/members?phone=eq.%2B37491234567', data: {'db.statement': 'select * where phone = 37491234567', 'http.method': 'GET'}}],
} as unknown as Parameters<typeof scrubEvent>[0]);
assertClean('scrubEvent', event);
assert.equal(event.tags?.request_id, REQUEST_ID, 'the Axiom request id becomes a tag');
assert.deepEqual(event.user, {id: MEMBER_ID, ip_address: null}, 'only the internal UUID identifies the member; IP and geo inference is refused');
assert.deepEqual(Object.keys(event.request?.headers ?? {}).sort(), ['user-agent', 'x-request-id']);
assert.equal(event.request?.url, 'https://app.noreon.health/patient/care');
assert.equal(event.extra, undefined);
assert.deepEqual(Object.keys(event.contexts ?? {}).sort(), ['browser', 'os', 'trace']);
assert.equal(event.contexts?.browser?.name, 'Mobile Safari', 'runtime facts survive');
assert.equal(event.breadcrumbs?.length, 3);
assert.equal(event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.vars, undefined);
assert.equal(event.exception?.values?.[0]?.type, 'PostgrestError');
type AnyEvent = Parameters<typeof scrubEvent>[0];
assert.deepEqual(scrubEvent({user: {email: 'a@b.co', id: 'Armen', geo: {city: 'Yerevan', country_code: 'AM'}}} as AnyEvent).user, {ip_address: null}, 'a non-UUID user id and geo are dropped');
assert.deepEqual(scrubEvent({} as AnyEvent).user, {ip_address: null}, 'every event refuses IP inference');
assert.equal(scrubEvent({request: {headers: {'x-request-id': 'Armen Petrosyan +37491234567'}}} as AnyEvent).tags?.request_id, undefined, 'a malformed request id is not tagged');

// 4b. Fields outside message text (review F2): mechanism data, fingerprint, frame URLs,
// React component stacks and allow-listed header values that do not look like headers.
const crafted = scrubEvent({
  fingerprint: ['{{ default }}', 'Armen Petrosyan'],
  request: {headers: {'content-type': 'text/plain; note=i feel dizzy', 'accept-language': 'hy-AM,en;q=0.8'}},
  exception: {values: [{type: 'Error', value: 'boom', mechanism: {type: 'generic', handled: true, data: {note: 'i feel dizzy', phone: '+37491234567'}},
    stacktrace: {frames: [{filename: 'https://app.noreon.health/patient/care?otp=4821#x', abs_path: 'https://app.noreon.health/patient/care?otp=4821', function: 'onClick', lineno: 1}]}}]},
  contexts: {react: {version: '19.2.8', componentStack: 'at component-for-anna'}},
} as unknown as AnyEvent);
assertClean('crafted F2 event', crafted);
assert.deepEqual(crafted.fingerprint?.[0], '{{ default }}');
assert.equal(crafted.exception?.values?.[0]?.mechanism?.data, undefined);
assert.equal(crafted.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename, 'https://app.noreon.health/patient/care');
assert.equal(crafted.contexts?.react?.version, '19.2.8');
assert.deepEqual(crafted.request?.headers, {'accept-language': 'hy-AM,en;q=0.8'});

// 5. The real SDK with these options, through a mock transport: what would go over the wire.
// The server build of the SDK, as Node loads it (require resolves the package's node entry).
const Sentry = createRequire(import.meta.url)('@sentry/nextjs') as typeof import('@sentry/nextjs');
const sent: string[] = [];
const client = Sentry.init({
  ...options,
  // Sessions are sent only when a release is known. CI has one (the SDK reads GITHUB_SHA),
  // a laptop usually does not, which is why this passed locally and failed on CI (18 Oct).
  // Pin it so every machine exercises the same envelopes.
  release: 'check-sentry-scrub',
  // The envelope as the SDK hands it to the network layer, after every hook has run.
  transport: () => ({
    send: async (envelope: unknown) => {
      sent.push(JSON.stringify(envelope));
      return {statusCode: 200};
    },
    flush: async () => true,
  }),
});
installEnvelopeScrub(client);
const running = (client as unknown as {getOptions(): {integrations: Array<{name: string}>}}).getOptions().integrations.map((integration) => integration.name);
for (const name of ['ProcessSession', 'BrowserSession', 'BrowserTracing']) assert.ok(!running.includes(name), `${name} is not installed`);
Sentry.addBreadcrumb({category: 'console', message: 'Armen Petrosyan +37491234567'});
Sentry.addBreadcrumb({category: 'fetch', data: {url: '/api/patient/reports?phone=%2B37491234567', method: 'POST', status_code: 500}});
Sentry.setUser({id: MEMBER_ID, email: 'armen.petrosyan@example.com', ip_address: '203.0.113.42'});
Sentry.setExtra('reading', '148/96');
Sentry.setContext('member', {name: 'Armen Petrosyan', phone: '+37491234567'});
Sentry.captureException(new Error(message));
// Linked causes (Error.cause) and a custom fingerprint go through the same scrub.
Sentry.withScope((scope) => {
  scope.setFingerprint(['anna petrosyan']);
  Sentry.captureException(new Error('telegram send failed', {cause: new Error('member said i feel dizzy, anna petrosyan')}));
});
Sentry.captureMessage(`Telegram reply failed for Armen Petrosyan: "chest pain since morning" +37491234567`);
// Session tracking is off, but force one release-health session through the pipeline so
// the envelope backstop is exercised: sessions never pass beforeSend and carry the IP.
Sentry.startSession();
Sentry.captureSession();
// Close (not just flush) before asserting, so every envelope the SDK will ever send in
// this run, on any Node version and in any order, is in `sent` (CI on Node 24, 18 Oct).
await Sentry.close(2000);
assert.ok(sent.length >= 4, `envelopes reached the mock transport (${sent.length})`);
const sessions = sent.filter((body) => body.includes('{"type":"session"}') || body.includes('{"type":"sessions"}'));
assert.ok(sessions.length >= 1, 'a session envelope was produced and checked');
for (const body of sent) {
  assertClean('SDK envelope', body);
  assert.ok(!/"ip_address":"/.test(body), 'no envelope of any type carries an IP address');
  assert.ok(!body.includes('"user_agent"'), 'no envelope carries a session user agent');
  assert.ok(!body.includes('"geo"'), 'no geo is sent');
}
for (const body of sent.filter((item) => item.includes('{"type":"event"}'))) assert.ok(body.includes('"ip_address":null'), 'events refuse IP inference');
assert.ok(sent.some((body) => body.includes(MEMBER_ID)), 'the internal member id is kept');

// The envelope backstop on its own: session, aggregate and nested IPs.
const envelope: Parameters<typeof scrubEnvelope>[0] = [{}, [
  [{type: 'session'}, {sid: 'x', did: 'armen.petrosyan@example.com', attrs: {release: 'r', ip_address: '203.0.113.42', user_agent: 'Mozilla/5.0 (iPhone)'}}],
  [{type: 'sessions'}, {attrs: {ip_address: '203.0.113.42'}, aggregates: [{did: 'Armen Petrosyan', exited: 1}, {did: MEMBER_ID, exited: 1}]}],
  [{type: 'event'}, {user: {ip_address: null}, contexts: {deep: {ip_address: '203.0.113.42'}}}],
]];
scrubEnvelope(envelope);
const scrubbedEnvelope = JSON.stringify(envelope);
assertClean('scrubEnvelope', scrubbedEnvelope);
assert.ok(!scrubbedEnvelope.includes('Mozilla'), 'session user agent dropped');
assert.ok(scrubbedEnvelope.includes(MEMBER_ID) && scrubbedEnvelope.includes('"ip_address":null'), 'UUID did and the inference flag survive');

console.log(`Sentry scrub: EU guard, text, breadcrumbs, full event, envelope backstop and ${sent.length} SDK envelopes (${sessions.length} session) checked; no PHI, PII or IP leaked.`);
