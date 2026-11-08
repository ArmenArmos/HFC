// Local reproduction for output/member-session-2026-10-17/FINDINGS.md. Not a CI check.
// Needs a local Supabase stack with a short JWT expiry and a test OTP, and `next dev` on it:
//   supabase/config.toml: jwt_expiry = 60, [auth.sms] enable_signup = true,
//   [auth.sms.test_otp] 37477000001 = "123456" (and any SMS provider enabled with dummy values)
//   APP=http://localhost:3461 SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/repro-member-session-local.mjs local|global
// Two cookie jars stand for the installed home-screen app (A) and Safari (B), signed in as one member.
import {createServerClient} from '@supabase/ssr';

const APP = process.env.APP ?? 'http://localhost:3461';
const URL_ = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_ANON_KEY;
const PHONE = '+37477000001', CODE = '123456';
const scope = process.argv[2] === 'global' ? 'global' : 'local';
const wait = (s) => new Promise((r) => setTimeout(r, s * 1000));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function jar() {
  const cookies = new Map();
  const client = createServerClient(URL_, KEY, {
    cookies: {
      getAll: () => [...cookies].map(([name, value]) => ({name, value})),
      setAll: (list) => { for (const {name, value, options} of list) { if (options?.maxAge === 0 || !value) cookies.delete(name); else cookies.set(name, value); } },
    },
  });
  return {cookies, client};
}
async function signIn(device) {
  const otp = await device.client.auth.signInWithOtp({phone: PHONE});
  if (otp.error) throw Error(otp.error.message);
  const v = await device.client.auth.verifyOtp({phone: PHONE, token: CODE, type: 'sms'});
  if (v.error) throw Error(v.error.message);
  return v.data.session.access_token;
}
async function visit(device, label, headers = {}) {
  const res = await fetch(`${APP}/patient/dashboard`, {redirect: 'manual', headers: {cookie: [...device.cookies].map(([n, v]) => `${n}=${v}`).join('; '), ...headers}});
  const set = res.headers.getSetCookie().filter((c) => c.startsWith('sb-'));
  for (const c of set) {
    const [pair] = c.split(';'); const i = pair.indexOf('=');
    const name = pair.slice(0, i), value = pair.slice(i + 1);
    if (!value || /max-age=0/i.test(c)) device.cookies.delete(name); else device.cookies.set(name, value);
  }
  const location = res.headers.get('location') ?? '';
  const signedOut = res.status >= 300 && res.status < 400 && /\/patient\?next=/.test(location);
  const maxAge = set.map((c) => /max-age=(\d+)/i.exec(c)?.[1]).find(Boolean);
  log(`${label}: HTTP ${res.status}${location ? ` -> ${new URL(location, APP).pathname}${new URL(location, APP).search}` : ''}; refreshed cookie ${set.length ? `yes (Max-Age ${maxAge})` : 'no'}; ${signedOut ? 'SIGNED OUT' : 'still signed in'}`);
  return {signedOut, refreshed: set.length > 0};
}

const A = jar(), B = jar();
await signIn(A); await wait(6); await signIn(B); // the local SMS max_frequency is 5 s
log(`A (home-screen app) and B (Safari) signed in as ${PHONE}; JWT expiry is short.`);
await visit(A, 'A page load');
log('A is idle for 65 s, past the access-token expiry...');
await wait(65);
const r1 = await visit(A, 'A RSC navigation after expiry', {rsc: '1'});
const r2 = await visit(A, 'A next page load (uses the refreshed cookie)');
log(`B signs out with scope "${scope}".`);
await B.client.auth.signOut({scope});
log('A is idle for another 65 s...');
await wait(65);
const r3 = await visit(A, 'A opens the app again');
const ok = r1.refreshed && !r1.signedOut && !r2.signedOut && (scope === 'local' ? !r3.signedOut : r3.signedOut);
console.log(ok ? `RESULT (${scope}): as expected; ${scope === 'local' ? 'A survived B signing out' : 'B signing out ended A too (the reported logout)'}` : `RESULT (${scope}): UNEXPECTED`);
process.exitCode = ok ? 0 : 1;
