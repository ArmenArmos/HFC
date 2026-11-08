// Exercise the real Supabase query builder against an isolated HTTP boundary.
// Reintroducing a serial clinic read or dropping inactive clinicians must fail.
import assert from "node:assert/strict";
import type { WorkspaceCase } from "@/lib/staff/cases";

process.env.NOREON_SHARED_DEMO = "true";
process.env.NOREON_WORKSPACE_SUPABASE_URL = "http://127.0.0.1:1";
process.env.NOREON_WORKSPACE_SERVICE_ROLE_KEY = "fictional-unused-key";
const originalFetch = globalThis.fetch;
let calls = 0;
let staff: Record<string, unknown> | null = null;
let clinic: { active: boolean } | null = null;
let unavailable = false;
const doctorId = "11111111-1111-4111-8111-111111111111";
const item = { assignedDoctorId: doctorId } as WorkspaceCase;
globalThis.fetch = async (input) => {
  calls++;
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  assert.equal(url.origin, "http://127.0.0.1:1", "Never contact a real service");
  if (unavailable) return Response.json({ message: "unavailable" }, { status: 503 });
  if (url.pathname.endsWith("/workspace_staff")) {
    assert.equal(url.searchParams.get("user_id"), `eq.${doctorId}`);
    const selection = url.searchParams.get("select") ?? "";
    assert.ok(!selection.includes("!inner"), "Missing clinics must retain the inactive doctor display");
    return Response.json(staff ? { ...staff, ...(selection.includes("workspace_clinics") ? { clinic } : {}) } : null);
  }
  if (url.pathname.endsWith("/workspace_clinics")) return Response.json(clinic);
  throw new Error(`Unexpected boundary ${url.pathname}`);
};
try {
  const { assignedCaseDoctor } = await import("@/lib/staff/cases");
  staff = { user_id: doctorId, display_name: "Doctor Example", active: true, role: "doctor", clinic_id: "clinic" };
  clinic = { active: true };
  assert.deepEqual(await assignedCaseDoctor(item), { id: doctorId, name: "Doctor Example", active: true });
  assert.equal(calls, 1, "Doctor and clinic enrichment must require one round trip");
  for (const [doctorActive, clinicRow] of [[false, { active: true }], [true, { active: false }], [true, null]] as const) {
    calls = 0;
    staff.active = doctorActive;
    clinic = clinicRow;
    assert.deepEqual(await assignedCaseDoctor(item), { id: doctorId, name: "Doctor Example", active: false });
    assert.equal(calls, 1);
  }
  for (const row of [null, { ...staff, role: "admin" }, { ...staff, clinic_id: null }]) {
    staff = row;
    calls = 0;
    assert.equal(await assignedCaseDoctor(item), null);
    assert.equal(calls, 1);
  }
  calls = 0;
  assert.equal(await assignedCaseDoctor({ assignedDoctorId: null } as WorkspaceCase), null);
  assert.equal(calls, 0);
  unavailable = true;
  assert.equal(await assignedCaseDoctor(item), null, "Unavailable enrichment fails closed");
  unavailable = false;
  staff = { user_id: doctorId, display_name: "Updated doctor", active: true, role: "doctor", clinic_id: "clinic" };
  clinic = { active: true };
  assert.deepEqual(await assignedCaseDoctor(item), { id: doctorId, name: "Updated doctor", active: true }, "Later calls see fresh identity and clinic data");
  console.log("Assigned doctor HTTP boundary: one read, unchanged inactive/missing display, fresh subsequent calls and unavailable handling passed.");
} finally {
  globalThis.fetch = originalFetch;
}
