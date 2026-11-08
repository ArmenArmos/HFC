import assert from "node:assert/strict";
import { request } from "node:http";

// Run against a local Next server configured for the named mode, without credentials.
const origin = process.argv[2];
const mode = process.argv[3];
assert.ok(origin && ["localhost", "127.0.0.1"].includes(new URL(origin).hostname), "A local server URL is required");
assert.ok(mode === "real" || mode === "demo", "Specify real or demo configuration");
async function check(host: string, path: string, status: number, location?: string, copy?: string) {
  const response = await new Promise<{status: number; location?: string; body: string}>((resolve, reject) => {
    const req = request(new URL(path, origin), { headers: { host } }, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => resolve({status: res.statusCode!, location: res.headers.location, body}));
    });
    req.on("error", reject);
    req.end();
  });
  assert.equal(response.status, status, `${mode}: ${host}${path}`);
  if (location) assert.equal(new URL(response.location!, origin).pathname, location);
  if (copy) assert.ok(response.body.includes(copy), `${host}${path} renders ${copy}`);
}
for (const host of ["backoffice.noreon.health"]) { // doctors.noreon.health redirects to backoffice (one staff domain)
  await check(host, "/", 307, mode === "real" ? "/staff/real/members" : host.startsWith("doctors") ? "/staff/doctor" : "/staff/backoffice");
  if (mode === "real") for (const path of ["/staff/login", "/staff/doctor", "/staff/nurse", "/staff/backoffice", "/staff/backoffice/cases", "/staff/case/example", "/staff/ai", "/staff/reports"]) {
    const legacyEntry = host.startsWith("doctors") ? path === "/staff/doctor" : path === "/staff/backoffice" || path === "/staff/backoffice/cases";
    await check(host, path, legacyEntry ? 307 : 404, legacyEntry ? "/staff/real/members" : undefined);
  }
  else {
    await check(host, "/staff/login", 200);
    await check(host, host.startsWith("doctors") ? "/staff/backoffice" : "/staff/doctor", 404);
  }
  await check(host, "/staff/real/login", mode === "real" ? 200 : 404, undefined, mode === "real" ? "Noreon staff sign in" : undefined);
  if (mode === "real") await check(host, "/staff/real/members", 307, "/staff/real/login");
}
await check("demo.noreon.health", "/staff/login?portal=admin", mode === "demo" ? 200 : 404, undefined, mode === "demo" ? "Noreon Demo Staff" : undefined);
await check("demo.noreon.health", "/staff/real/login", 404);
if (mode === "demo") for (const path of ["/staff/doctor", "/staff/nurse", "/staff/backoffice", "/staff/case/example"]) await check("demo.noreon.health", path, 307, "/staff/login");
for (const host of ["app.noreon.health", "unknown.example.invalid"]) for (const path of ["/staff/login", "/staff/real/login", "/staff/real/members"]) await check(host, path, 404);
console.log(`Actual staff HTTP routes passed in ${mode} mode: source boundaries, unauthenticated redirects and login rendering`);
