import assert from "node:assert/strict";
import * as transport from "@/lib/patient/transport";

// Sign-out returns the server result unchanged and reads a thrown transport error as null.
assert.deepEqual(await transport.safeSignOut(async () => ({ ok: true })), { ok: true });
assert.deepEqual(await transport.safeSignOut(async () => ({ ok: false })), { ok: false });
assert.equal(await transport.safeSignOut(async () => { throw new Error("network"); }), null);
assert.deepEqual(await transport.safeRequest(async () => ({ ok: true, revision: 2 })), { ok: true, revision: 2 });
console.log("Patient sign-out: server result passes through; transport failures read as null.");
