import assert from "node:assert/strict";
import { dispatchDoctorInvitation, invitationContextSchema, type InvitationContext, type InvitationDispatch } from "@/lib/staff/real-invitation-dispatch";
const context: InvitationContext = {
  role: "doctor",
  id: "11111111-1111-4111-8111-111111111111", generation: 1, operationId: "33333333-3333-4333-8333-333333333333",
  expectedAuthUserId: "22222222-2222-4222-8222-222222222222", authUserId: null,
  email: "doctor@example.invalid", name: "Test doctor", clinicId: "44444444-4444-4444-8444-444444444444",
  issuerId: "55555555-5555-4555-8555-555555555555", status: "pending", sendStatus: "pending",
  expiresAt: "2030-01-01T00:00:00Z", tokenDigest: null, tokenType: null, dispatchClaimedAt: null,
};
let calls: string[] = [];
const user = { id: context.expectedAuthUserId, email: context.email, confirmed: false };
function deps(overrides: Partial<InvitationDispatch> = {}): InvitationDispatch {
  return {
    origin: "https://doctors.noreon.health",
    claim: async () => { calls.push("claim"); return { ...context, claimed: true }; },
    readUser: async id => { calls.push("read"); assert.equal(id, context.expectedAuthUserId); return null; },
    createUser: async (id, email) => { calls.push("create"); assert.equal(id, user.id); assert.equal(email, user.email); return user; },
    bind: async id => { calls.push("bind"); assert.equal(id, user.id); return { ...context, authUserId: id }; },
    generateLink: async (email, type) => { calls.push("link"); assert.equal(email, user.email); assert.equal(type, "invite"); return { userId: user.id, tokenHash: "a".repeat(64) }; },
    storeToken: async (digest, type) => { calls.push("token"); assert.equal(digest.length, 64); assert.notEqual(digest, "a".repeat(64)); return { ...context, authUserId: user.id, tokenDigest: digest, tokenType: type }; },
    send: async input => { calls.push("send"); assert.ok(input.url.startsWith("https://doctors.noreon.health/staff/real/invite#")); return { status: "accepted", reference: "fixture" }; },
    record: async result => { calls.push("record"); assert.ok(["accepted", "failed", "unknown"].includes(result.status)); },
    ...overrides,
  };
}
assert.equal((await dispatchDoctorInvitation(context, deps())).ok, true);
assert.deepEqual(calls, ["claim", "read", "create", "bind", "link", "token", "send", "record"]);
calls = [];
assert.equal((await dispatchDoctorInvitation(context, deps({ claim: async () => ({ ...context, claimed: false }) }))).ok, false);
assert.deepEqual(calls, [], "Duplicate claim performs no external work");
calls = [];
await dispatchDoctorInvitation(context, deps({ createUser: async () => { calls.push("create"); throw Error("timeout"); } }));
assert.ok(!calls.includes("send"));
assert.equal(calls.filter(c => c === "create").length, 1);
calls = [];
await dispatchDoctorInvitation(context, deps({ generateLink: async () => ({ userId: context.issuerId, tokenHash: "a".repeat(64) }) }));
assert.ok(!calls.includes("token") && !calls.includes("send"), "Different Auth identity cannot receive a link");
calls = [];
assert.equal((await dispatchDoctorInvitation(context, deps({ readUser: async () => user }))).ok, true);
assert.ok(!calls.includes("create"), "Reserved UUID reconciliation preserves existing identity");
calls = [];
await dispatchDoctorInvitation(context, deps({ bind: async () => { throw Error("reissued"); } }));
assert.ok(!calls.includes("link") && !calls.includes("send"));
let outcome="";
await dispatchDoctorInvitation(context,deps({generateLink:async()=>{throw Error("fixture preparation failure");},record:async result=>{outcome=result.status;}}));
assert.equal(outcome,"failed","A known failure before sending must not imply uncertain delivery");
await dispatchDoctorInvitation(context,deps({send:async()=>{throw Error("fixture delivery timeout");},record:async result=>{outcome=result.status;}}));
assert.equal(outcome,"unknown","A transport timeout after send starts must remain uncertain");
console.log("Invitation dispatch identity, claim, fencing and timeout checks passed");

for (const change of [{role: "nurse" as const}, {name: "Changed name"}, {clinicId: context.issuerId}]) {
  calls = [];
  await dispatchDoctorInvitation(context, deps({bind: async () => ({ ...context, authUserId: user.id, ...change })}));
  assert.ok(!calls.includes("link") && !calls.includes("send"), "Changed role/name/clinic fences stale dispatch");
}

const withoutRole = Object.fromEntries(Object.entries(context).filter(([key]) => key !== "role"));
assert.equal(invitationContextSchema.safeParse(withoutRole).success, false, "Missing immutable role must not default to Doctor");
