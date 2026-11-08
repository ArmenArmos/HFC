import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";

const real = {
  NOREON_REAL_MEMBER_REVIEW_ENABLED: "true",
  NEXT_PUBLIC_PATIENT_DEMO: "false",
  NOREON_SHARED_DEMO: "false",
  NOREON_DEPLOYMENT_TARGET: "app",
  NEXT_PUBLIC_SUPABASE_URL: "https://real.example.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "public-key",
  NOREON_WORKSPACE_SUPABASE_URL: "https://real.example.invalid",
};
const saved = Object.fromEntries(Object.keys(real).map(key => [key, process.env[key]]));
function request(host: string, path: string, method = "GET") {
  return new NextRequest(`https://${host}${path}`, { method, headers: { host } });
}
try {
  Object.assign(process.env, real);
  for (const [host, path] of [
    ["doctors.noreon.health", "/staff/doctor"],
    // One staff domain: an old doctor bookmark redirected to backoffice lands on the real workspace.
    ["backoffice.noreon.health", "/staff/doctor"],
    ["backoffice.noreon.health", "/staff/backoffice"],
    ["backoffice.noreon.health", "/staff/backoffice/cases"],
  ]) {
    for (const method of ["GET", "HEAD"]) {
      const result = await proxy(request(host, `${path}?next=https://evil.invalid`, method));
      assert.equal(result.status, 307, `${method} ${host}${path} reaches the real portal`);
      assert.equal(result.headers.get("location"), `https://${host}/staff/real/members`);
    }
    assert.equal((await proxy(request(host, path, "POST"))).status, 404, "Legacy writes remain blocked");
  }
  for (const [host, path] of [
    ["doctors.noreon.health", "/staff/backoffice"],
    ["doctors.noreon.health", "/staff/doctor/example"],
    ["backoffice.noreon.health", "/staff/backoffice/doctors"],
    ["app.noreon.health", "/staff/doctor"],
    ["doctors.noreon.health.evil.invalid", "/staff/doctor"],
  ]) assert.equal((await proxy(request(host, path))).status, 404);
  process.env.NOREON_REAL_MEMBER_REVIEW_ENABLED = "false";
  assert.equal((await proxy(request("doctors.noreon.health", "/staff/doctor"))).status, 404);
  Object.assign(process.env, real, {
    NEXT_PUBLIC_PATIENT_DEMO: "true", NOREON_SHARED_DEMO: "true", NOREON_DEPLOYMENT_TARGET: "demo",
  });
  const demo = await proxy(request("demo.noreon.health", "/staff/doctor"));
  assert.equal(demo.headers.get("location"), null, "Demo keeps its existing workspace route");
} finally {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
console.log("Legacy staff entries preserve portal, method and real/demo boundaries");
