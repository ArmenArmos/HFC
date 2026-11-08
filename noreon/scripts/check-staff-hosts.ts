import assert from "node:assert/strict";
import { demoStaffHostAllowed, staffHostAllowed, staffPathAllowed, staffPortalForHost } from "@/lib/staff/hosts";
assert.equal(staffPortalForHost("doctors.noreon.health"), "doctor");
assert.equal(staffPortalForHost("backoffice.noreon.health"), "admin");
for (const host of ["demo.noreon.health", "app.noreon.health", "www.noreon.health", "noreon-core.vercel.app"]) {
  assert.equal(staffHostAllowed(host), false);
  assert.equal(staffPathAllowed(host, "/staff/login"), false);
}
assert.equal(staffHostAllowed("doctors.noreon.health", "admin"), false);
assert.equal(staffHostAllowed("backoffice.noreon.health", "doctor"), true, "One staff domain: backoffice serves doctors");
assert.equal(staffPathAllowed("doctors.noreon.health", "/staff/backoffice"), false);
assert.equal(staffPathAllowed("backoffice.noreon.health", "/staff/doctor"), false);
assert.equal(staffPathAllowed("doctors.noreon.health", "/patient/dashboard"), false);
assert.equal(staffPathAllowed("backoffice.noreon.health", "/api/patient/reports"), false);
assert.equal(staffPathAllowed("doctors.noreon.health", "/staff/case/example"), false);
console.log("Staff host and role boundary checks passed");

for (const host of ["doctors.noreon.health", "backoffice.noreon.health"]) {
  assert.equal(staffPathAllowed(host, "/manifest.webmanifest"), true);
  assert.equal(staffPathAllowed(host, "/icons/icon-192.png"), true);
  assert.equal(staffPathAllowed(host, "/api/patient/reports"), false);
}

assert.equal(staffHostAllowed("doctors.noreon.health","nurse"),true);
assert.equal(staffHostAllowed("backoffice.noreon.health","nurse"),true);
assert.equal(staffPathAllowed("backoffice.noreon.health","/staff/nurse"),false);
assert.equal(staffPathAllowed("doctors.noreon.health","/staff/nurse"),false);

// A real-mode staff alias must never fall back to demo; existing demo aliases remain usable during rollout.
const realEnv = { NOREON_REAL_MEMBER_REVIEW_ENABLED: "true", NEXT_PUBLIC_PATIENT_DEMO: "false", NOREON_DEPLOYMENT_TARGET: "app", NEXT_PUBLIC_SUPABASE_URL: "https://real.example.invalid", NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key" };
const demoEnv = { NEXT_PUBLIC_PATIENT_DEMO: "true", NOREON_SHARED_DEMO: "true", NOREON_DEPLOYMENT_TARGET: "demo" };
for (const host of ["doctors.noreon.health", "backoffice.noreon.health"]) {
  for (const path of ["/staff/login", "/staff/doctor", "/staff/backoffice", "/staff/case/example", "/staff/ai", "/staff/reports", "/staff/realistic"]) {
    assert.equal(staffPathAllowed(host, path, realEnv), false, `${host}${path} cannot expose demo`);
    assert.equal(staffPathAllowed(host, path, { ...realEnv, NOREON_REAL_MEMBER_REVIEW_ENABLED: "false" }), false, "Disabled review never falls back to demo");
    const wrongPortal = (host.startsWith("doctors") && path.startsWith("/staff/backoffice")) || (host.startsWith("backoffice") && (path.startsWith("/staff/doctor") || path.startsWith("/staff/nurse")));
    assert.equal(staffPathAllowed(host, path, demoEnv), !wrongPortal, "Existing demo staff aliases remain usable until moved");
  }
  for (const path of ["/staff/real/login", "/staff/real/members", "/staff/real/members/example"]) {
    assert.equal(staffPathAllowed(host, path, realEnv), true);
    assert.equal(staffPathAllowed(host, path, demoEnv), false);
    assert.equal(staffPathAllowed(host, path, { ...realEnv, NOREON_WORKSPACE_SUPABASE_URL: "https://other.example.invalid" }), false);
    assert.equal(staffPathAllowed(host, path, { ...realEnv, NOREON_REAL_MEMBER_REVIEW_ENABLED: "false" }), false);
  }
}
for (const path of ["/staff/login", "/staff/doctor", "/staff/nurse", "/staff/backoffice", "/staff/case/example"]) {
  assert.equal(staffPathAllowed("demo.noreon.health", path, demoEnv), true);
  assert.equal(staffPathAllowed("demo.noreon.health", path, realEnv), false);
  assert.equal(staffPathAllowed("demo.noreon.health", path, { ...demoEnv, NOREON_SHARED_DEMO: "false" }), false);
  assert.equal(staffPathAllowed("demo.noreon.health", path, { ...demoEnv, NOREON_DEPLOYMENT_TARGET: "app" }), false);
}
assert.equal(staffPathAllowed("demo.noreon.health", "/staff/real/login", demoEnv), false);
for (const host of ["app.noreon.health", "unknown.example.invalid", "doctors.noreon.health.evil.invalid"]) {
  for (const env of [realEnv, demoEnv]) for (const path of ["/staff/login", "/staff/real/login", "/staff/real/members"]) assert.equal(staffPathAllowed(host, path, env), false);
}
console.log("Staff real/demo source isolation checks passed");

for (const role of ["admin", "doctor", "nurse"] as const) {
  assert.equal(demoStaffHostAllowed("demo.noreon.health", role, demoEnv), true);
  assert.equal(demoStaffHostAllowed("doctors.noreon.health", role, demoEnv), role !== "admin");
  assert.equal(demoStaffHostAllowed("backoffice.noreon.health", role, demoEnv), role === "admin", "The legacy demo stays admin-only on backoffice");
  assert.equal(demoStaffHostAllowed("app.noreon.health", role, demoEnv), false);
}
assert.equal(staffPathAllowed("localhost:3000", "/staff/real/members", { ...realEnv, NODE_ENV: "production" }), false);
assert.equal(staffPathAllowed("localhost:3000", "/staff/real/members", { ...realEnv, NODE_ENV: "development" }), true);
assert.equal(demoStaffHostAllowed("localhost:3000", undefined, { ...demoEnv, NODE_ENV: "production" }), false);
assert.equal(staffHostAllowed("DOCTORS.NOREON.HEALTH:443", "doctor"), true);
console.log("Demo authentication host and local production boundaries passed");
