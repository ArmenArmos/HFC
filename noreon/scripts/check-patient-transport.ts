import assert from "node:assert/strict";
import { safeRequest } from "@/lib/patient/transport";

assert.equal(
  await safeRequest(async () => {
    throw new TypeError("network disconnected");
  }),
  null,
);
assert.deepEqual(await safeRequest(async () => ({ ok: false })), { ok: false });
assert.deepEqual(await safeRequest(async () => ({ ok: true, revision: 7 })), {
  ok: true,
  revision: 7,
});
console.log("Patient transport: server results pass through and transport failures read as null.");
