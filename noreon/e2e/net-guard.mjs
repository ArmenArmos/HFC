// Loaded into the app server with NODE_OPTIONS. Any name that does not resolve to this machine fails loudly and is
// recorded, for fetch and for every other client (Twilio's axios, plain https). A stub that stopped working then
// fails the run instead of reaching a real provider.
import { appendFileSync } from "node:fs";
import dns from "node:dns";

// next/font fetches fonts while compiling and next dev asks npm for its latest version. No member data goes there.
const ALLOWED = new Set(["127.0.0.1", "localhost", "::1", "fonts.googleapis.com", "fonts.gstatic.com", "registry.npmjs.org"]);
const log = process.env.NOREON_E2E_BLOCKED_LOG;
const refuse = (host) => {
  if (log) appendFileSync(log, `${host}\n`);
  return Object.assign(new Error(`E2E network guard refused ${host}`), { code: "ENOTFOUND" });
};
const lookup = dns.lookup;
dns.lookup = (host, options, callback) => {
  const done = typeof options === "function" ? options : callback;
  if (ALLOWED.has(host)) return lookup(host, options, callback);
  process.nextTick(done, refuse(host));
  return {};
};
const promised = dns.promises.lookup;
dns.promises.lookup = (host, options) => (ALLOWED.has(host) ? promised(host, options) : Promise.reject(refuse(host)));
